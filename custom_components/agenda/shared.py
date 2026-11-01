"""Public holiday settings shared by all agendas.

Defaults to the core country; the panel can pick another country and a subdivision.
"""

from __future__ import annotations

from datetime import date, timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

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
    """Holiday settings, stored in `.storage/agenda`."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store[dict[str, Any]] = Store(hass, SHARED_STORAGE_VERSION, DOMAIN)
        self.country: str | None = None  # None means the core country
        self.subdiv: str | None = None
        self._holidays = None

    @property
    def effective_country(self) -> str | None:
        return self.country or self.hass.config.country

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        settings = data.get("holidays") or {}
        self.country = settings.get("country")
        self.subdiv = settings.get("subdiv")
        await self.async_rebuild()

    async def async_rebuild(self) -> None:
        country = self.effective_country
        if not country:
            self._holidays = None
            return
        self._holidays = await self.hass.async_add_executor_job(
            _build_holidays, country, self.subdiv, self.hass.config.language
        )

    async def async_set(self, country: str | None, subdiv: str | None) -> None:
        self.country = country or None
        self.subdiv = subdiv or None
        await self._store.async_save({"holidays": {"country": self.country, "subdiv": self.subdiv}})
        await self.async_rebuild()

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

    def as_dict(self) -> dict[str, Any]:
        return {
            "country": self.effective_country,
            "configured": self.country,
            "subdiv": self.subdiv,
            "ha_country": self.hass.config.country,
        }
