"""The agenda as a Home Assistant calendar: Calendar panel, triggers, cards."""

from __future__ import annotations

from datetime import date, datetime, timedelta

import voluptuous as vol

from homeassistant.components.calendar import CalendarEntity, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceResponse, SupportsResponse
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .entity import AgendaEntity
from .manager import Agenda
from .recurrence import Occurrence, winner


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    agenda: Agenda = hass.data[DOMAIN]["agendas"][entry.entry_id]
    async_add_entities([AgendaCalendar(agenda)])
    platform = entity_platform.async_get_current_platform()
    platform.async_register_entity_service("resync", None, "async_resync")
    platform.async_register_entity_service(
        "skip_next",
        {vol.Optional("event"): cv.string},
        "async_skip_next",
        supports_response=SupportsResponse.OPTIONAL,
    )
    dates = {vol.Required("event"): cv.string, vol.Required("dates"): vol.All(cv.ensure_list, [cv.date])}
    platform.async_register_entity_service("add_dates", dates, "async_add_dates")
    platform.async_register_entity_service("remove_dates", dates, "async_remove_dates")
    platform.async_register_entity_service("advance", None, "async_advance")
    platform.async_register_entity_service("apply_event", {vol.Required("event"): cv.string}, "async_apply_event")
    platform.async_register_entity_service("resume", None, "async_resume")


class AgendaCalendar(AgendaEntity, CalendarEntity):
    _attr_name = None

    def __init__(self, agenda: Agenda) -> None:
        super().__init__(agenda, "calendar")

    def _to_event(self, occ: Occurrence) -> CalendarEvent:
        event = self.agenda.event(occ.event_id)
        tz = self.agenda.tz
        if occ.all_day:
            start, end = occ.start.astimezone(tz).date(), occ.end.astimezone(tz).date()
        else:
            start, end = occ.start.astimezone(tz), occ.end.astimezone(tz)
        return CalendarEvent(
            start=start,
            end=end,
            summary=self.agenda.label(event),
            description=event.get("note") or None,
            uid=event["id"],
            recurrence_id=occ.day.isoformat() if (event.get("repeat") or {}).get("freq", "none") != "none" else None,
        )

    @property
    def event(self) -> CalendarEvent | None:
        now = dt_util.utcnow()
        current = winner(self.agenda.active(now))
        if current is not None:
            return self._to_event(current)
        upcoming = [o for o in self.agenda.occurrences(now, now + timedelta(days=30)) if o.start > now]
        return self._to_event(upcoming[0]) if upcoming else None

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        return [self._to_event(occ) for occ in self.agenda.occurrences(start_date, end_date)]

    async def async_resync(self) -> None:
        await self.agenda.async_resync()

    async def async_skip_next(self, event: str | None = None) -> ServiceResponse:
        day = await self.agenda.async_skip_next(event)
        return {"skipped": day}

    async def async_add_dates(self, event: str, dates: list[date]) -> None:
        await self.agenda.async_change_dates(event, dates, add=True)

    async def async_remove_dates(self, event: str, dates: list[date]) -> None:
        await self.agenda.async_change_dates(event, dates, add=False)

    async def async_advance(self) -> None:
        await self.agenda.async_advance()

    async def async_apply_event(self, event: str) -> None:
        await self.agenda.async_apply_named(event)

    async def async_resume(self) -> None:
        await self.agenda.async_resume()
