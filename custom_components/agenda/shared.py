"""Settings shared by all agendas: public holidays, the school holiday calendar,
the absence mode and who may edit.

Holidays default to the core country; the panel can pick another country and a
subdivision. Sun times come from the home location.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, time, timedelta
import logging
from typing import Any

from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, Unauthorized
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
from homeassistant.helpers.sun import get_astral_event_date
from homeassistant.util import dt as dt_util

from . import recurrence
from .const import DOMAIN, SHARED_STORAGE_VERSION

_LOGGER = logging.getLogger(__name__)


def _holiday_language(supported: tuple[str, ...], language: str) -> str | None:
    """Best match for Home Assistant's language among those of a country."""
    wanted = language.replace("-", "_")
    if wanted in supported:
        return wanted
    prefix = wanted[:2]
    return next((lang for lang in supported if lang.split("_")[0] == prefix), None)


def _build_holidays(country: str, subdiv: str | None, language: str):
    """Blocking: the library imports country modules and loads translations."""
    import holidays  # pylint: disable=import-outside-toplevel

    this_year = date.today().year
    years = range(this_year - 1, this_year + 3)
    try:
        probe = holidays.country_holidays(country, years=[])
    except NotImplementedError:
        _LOGGER.warning("No public holidays known for country %s", country)
        return None
    lang = _holiday_language(tuple(probe.supported_languages), language)
    try:
        return holidays.country_holidays(country, subdiv=subdiv or None, language=lang, years=years)
    except NotImplementedError:
        _LOGGER.warning("Unknown subdivision %s for %s, using the whole country", subdiv, country)
        return holidays.country_holidays(country, language=lang, years=years)


def _holiday_options(country: str | None) -> dict[str, Any]:
    """Blocking: supported countries, and the subdivisions of one of them."""
    import holidays  # pylint: disable=import-outside-toplevel

    supported = holidays.list_supported_countries()
    subdivisions: list[dict[str, Any]] = []
    if country in supported:
        aliases = holidays.country_holidays(country, years=[]).get_subdivision_aliases()
        subdivisions = [{"code": code, "names": list(aliases.get(code, []))} for code in supported[country]]
    return {"countries": sorted(supported), "subdivisions": subdivisions}


class Shared:
    """Shared settings, stored in `.storage/agenda`."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, SHARED_STORAGE_VERSION, DOMAIN)
        self.country: str | None = None  # None means the core country
        self.subdiv: str | None = None
        self.school_calendar: str | None = None
        self.outdoor_sensor: str | None = None  # a sensor or a weather entity
        self._holidays = None
        # absence mode: {"until": "2026-11-10T18:00" | None} while away, else None
        self.absence: dict[str, Any] | None = None
        self.allow_users = False  # non-admin users may edit events
        self._sun_cache: dict[tuple[date, str], datetime | None] = {}
        self._absence_listeners: list[Callable[[], Any]] = []
        self._unsub_absence: Callable[[], None] | None = None

    @property
    def effective_country(self) -> str | None:
        return self.country or self.hass.config.country

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        settings = data.get("holidays") or {}
        self.country = settings.get("country")
        self.subdiv = settings.get("subdiv")
        self.school_calendar = data.get("school_calendar")
        self.outdoor_sensor = data.get("outdoor_sensor")
        self.absence = data.get("absence")
        self.allow_users = bool(data.get("allow_users", False))
        await self.async_rebuild()
        self._watch_absence_end()

    async def async_rebuild(self) -> None:
        self._sun_cache.clear()
        country = self.effective_country
        if not country:
            self._holidays = None
            return
        self._holidays = await self.hass.async_add_executor_job(
            _build_holidays, country, self.subdiv, self.hass.config.language
        )

    async def _async_save(self) -> None:
        await self._store.async_save(
            {
                "holidays": {"country": self.country, "subdiv": self.subdiv},
                "school_calendar": self.school_calendar,
                "outdoor_sensor": self.outdoor_sensor,
                "absence": self.absence,
                "allow_users": self.allow_users,
            }
        )

    async def async_set(
        self,
        country: str | None,
        subdiv: str | None,
        school_calendar: str | None,
        allow_users: bool | None = None,
        outdoor_sensor: str | None = None,
    ) -> None:
        self.country = country or None
        self.subdiv = subdiv or None
        self.school_calendar = school_calendar or None
        self.outdoor_sensor = outdoor_sensor or None
        if allow_users is not None:
            self.allow_users = allow_users
        await self._async_save()
        await self.async_rebuild()

    def sun(self, day: date, which: str) -> datetime | None:
        """Naive local time of sunrise or sunset on a local day."""
        key = (day, which)
        if key not in self._sun_cache:
            point = get_astral_event_date(self.hass, which, day)
            tz = dt_util.get_default_time_zone()
            self._sun_cache[key] = point.astimezone(tz).replace(tzinfo=None, second=0, microsecond=0) if point else None
            if len(self._sun_cache) > 4000:
                self._sun_cache.clear()
        return self._sun_cache[key]

    def absence_until(self) -> datetime | None:
        if not self.absence or not self.absence.get("until"):
            return None
        return datetime.fromisoformat(self.absence["until"]).replace(tzinfo=dt_util.get_default_time_zone())

    def absent_at(self, at: datetime) -> bool:
        if self.absence is None:
            return False
        until = self.absence_until()
        return until is None or at < until

    async def async_check_editor(self, context: Context | None) -> None:
        """Events and the absence, as in the panel: admins, or every user when allowed.

        Automations and other calls without a user are let through.
        """
        if context is None or context.user_id is None or self.allow_users:
            return
        user = await self.hass.auth.async_get_user(context.user_id)
        if user is not None and not user.is_admin:
            raise Unauthorized(context=context)

    @callback
    def async_on_absence_change(self, listener: Callable[[], Any]) -> Callable[[], None]:
        self._absence_listeners.append(listener)
        return lambda: self._absence_listeners.remove(listener)

    async def async_set_absence(self, active: bool, until: str | None = None) -> None:
        """Start (until a local time, or until stopped) or stop the absence mode."""
        if active and until:
            datetime.fromisoformat(until)
        self.absence = {"until": until or None} if active else None
        await self._async_save()
        self._watch_absence_end()
        await self._async_absence_changed()

    async def _async_absence_changed(self) -> None:
        for listener in list(self._absence_listeners):
            await listener()

    @callback
    def _watch_absence_end(self) -> None:
        if self._unsub_absence:
            self._unsub_absence()
            self._unsub_absence = None
        until = self.absence_until()
        if until is None:
            return
        if until <= dt_util.now():
            self.absence = None
            self.hass.async_create_task(self._async_save())
            return

        @callback
        def _ended(_now: datetime) -> None:
            self._unsub_absence = None
            self.absence = None
            self.hass.async_create_task(self._async_end_absence())

        self._unsub_absence = async_track_point_in_time(self.hass, _ended, until)

    async def _async_end_absence(self) -> None:
        await self._async_save()
        await self._async_absence_changed()

    async def async_options(self, country: str | None) -> dict[str, Any]:
        return await self.hass.async_add_executor_job(_holiday_options, country)

    def is_holiday(self, day: date) -> bool:
        return self._holidays is not None and day in self._holidays

    def between(self, start: date, end: date) -> dict[str, str]:
        """Holiday names by ISO date over [start, end)."""
        if self._holidays is None:
            return {}
        found: dict[str, str] = {}
        day = start
        while day < end:
            name = self._holidays.get(day)
            if name:
                found[day.isoformat()] = name
            day += timedelta(days=1)
        return found

    async def async_vacation_between(self, start: date, end: date) -> dict[str, str]:
        """School holiday names by ISO date over [start, end), for display."""
        if not self.school_calendar or self.hass.states.get(self.school_calendar) is None:
            return {}
        tz = dt_util.get_default_time_zone()
        try:
            response = await self.hass.services.async_call(
                "calendar",
                "get_events",
                {
                    "entity_id": self.school_calendar,
                    "start_date_time": datetime.combine(start, time.min, tz).isoformat(),
                    "end_date_time": datetime.combine(end, time.min, tz).isoformat(),
                },
                blocking=True,
                return_response=True,
            )
        except (HomeAssistantError, ValueError) as err:
            _LOGGER.warning("Cannot read %s: %s", self.school_calendar, err)
            return {}
        found: dict[str, str] = {}
        for event in ((response or {}).get(self.school_calendar) or {}).get("events") or []:
            for day in recurrence.calendar_days([(str(event["start"]), str(event["end"]))], tz):
                if start <= day < end:
                    found.setdefault(day.isoformat(), event.get("summary") or "")
        return found

    def as_dict(self) -> dict[str, Any]:
        return {
            "country": self.effective_country,
            "configured": self.country,
            "subdiv": self.subdiv,
            "ha_country": self.hass.config.country,
            "school_calendar": self.school_calendar,
            "outdoor_sensor": self.outdoor_sensor,
            "absence": self.absence,
            "allow_users": self.allow_users,
        }
