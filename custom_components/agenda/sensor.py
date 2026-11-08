"""Current state, next change and heating rate sensors."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import devices
from .const import DOMAIN, SIGNAL_UPDATED
from .entity import AgendaEntity
from .manager import Agenda, wall

RATE_KEY = "heating_rate"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    agenda: Agenda = hass.data[DOMAIN]["agendas"][entry.entry_id]
    async_add_entities([AgendaCurrentSensor(agenda), AgendaNextChangeSensor(agenda)])
    registry = er.async_get(hass)
    added = False

    @callback
    def sync_rate_sensor(entry_id: str | None = None) -> None:
        """The kind of an agenda is chosen after it is created, and may change."""
        nonlocal added
        if entry_id not in (None, agenda.entry_id) or entry.entry_id not in hass.data[DOMAIN]["agendas"]:
            return
        if agenda.kind == devices.KIND_CLIMATE:
            if not added:
                added = True
                async_add_entities([AgendaRateSensor(agenda)])
            return
        added = False
        unique_id = f"{agenda.entry_id}_{RATE_KEY}"
        if entity_id := registry.async_get_entity_id("sensor", DOMAIN, unique_id):
            registry.async_remove(entity_id)

    sync_rate_sensor()
    entry.async_on_unload(async_dispatcher_connect(hass, SIGNAL_UPDATED, sync_rate_sensor))


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
            # ahead of the schedule until then, and the devices left alone after a change by hand
            "override_until": wall(override["until"], tz) if (override := self.agenda.override) else None,
            "set_by_hand": sorted(e for e in self.agenda.control.holds if self.agenda.control.held(e)),
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
        attributes = {
            "state": state,
            "label": (self.agenda.label(self.agenda.event(occ.event_id)) if occ else self.agenda.state_label(state)),
        }
        if plan := self.agenda.preheater.current:
            attributes["preheat_start"] = wall(plan.launch, self.agenda.tz)
            attributes["preheat_minutes"] = plan.minutes
        return attributes


class AgendaRateSensor(AgendaEntity, SensorEntity):
    """How fast the thermostats of an agenda warm their room up, as learned. With several,
    the slowest one: the lead depends on it."""

    _attr_translation_key = RATE_KEY
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_native_unit_of_measurement = "°C/h"
    _attr_suggested_display_precision = 2

    def __init__(self, agenda: Agenda) -> None:
        super().__init__(agenda, RATE_KEY)

    def _speeds(self) -> dict[str, Any] | None:
        speeds = self.agenda.preheater.slowest()
        if speeds is None or not (self.agenda.preheater.enabled or speeds["samples"]):
            return None
        return speeds

    @property
    def native_value(self) -> float | None:
        speeds = self._speeds()
        return speeds["heat_rate"] if speeds else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        speeds = self._speeds()
        if speeds is None:
            return {}
        return {key: value for key, value in speeds.items() if key != "heat_rate"}
