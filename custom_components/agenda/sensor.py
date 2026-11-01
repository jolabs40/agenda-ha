"""Current state and next change sensors."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import AgendaEntity
from .manager import Agenda, wall


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    agenda: Agenda = hass.data[DOMAIN]["agendas"][entry.entry_id]
    async_add_entities([AgendaCurrentSensor(agenda), AgendaNextChangeSensor(agenda)])


class AgendaCurrentSensor(AgendaEntity, SensorEntity):
    """Wanted state of the linked entities, or the running events."""

    _attr_translation_key = "current"

    def __init__(self, agenda: Agenda) -> None:
        super().__init__(agenda, "current")

    @property
    def native_value(self) -> str:
        if self.agenda.linked:
            state, _ = self.agenda.desired()
            return self.agenda.state_label(state) or "—"
        active = self.agenda.active()
        if not active:
            return "—"
        return ", ".join(self.agenda.label(self.agenda.event(o.event_id)) for o in active)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        state, occ = self.agenda.desired()
        tz = self.agenda.tz
        return {
            "events": [
                {
                    "name": self.agenda.label(self.agenda.event(o.event_id)),
                    "start": wall(o.start, tz),
                    "end": wall(o.end, tz),
                }
                for o in self.agenda.active()
            ],
            "state": state,
            "state_event": self.agenda.label(self.agenda.event(occ.event_id)) if occ else None,
            "enabled": self.agenda.enabled,
        }


class AgendaNextChangeSensor(AgendaEntity, SensorEntity):
    _attr_translation_key = "next_change"
    _attr_device_class = SensorDeviceClass.TIMESTAMP

    def __init__(self, agenda: Agenda) -> None:
        super().__init__(agenda, "next_change")

    @property
    def native_value(self):
        return self.agenda.next_change

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        nxt = self.agenda.next_change
        if nxt is None:
            return {}
        state, occ = self.agenda.desired(nxt)
        return {
            "state": state,
            "label": (self.agenda.label(self.agenda.event(occ.event_id)) if occ else self.agenda.state_label(state)),
        }
