"""Base entity shared by the agenda platforms."""

from __future__ import annotations

from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, SIGNAL_UPDATED
from .manager import Agenda


class AgendaEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, agenda: Agenda, key: str) -> None:
        self.agenda = agenda
        self._attr_unique_id = f"{agenda.entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, agenda.entry_id)},
            name=f"Agenda {agenda.name}",
            manufacturer="Agenda",
            model="Agenda",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        @callback
        def updated(entry_id: str | None) -> None:
            if entry_id == self.agenda.entry_id:
                self.async_write_ha_state()

        self.async_on_remove(async_dispatcher_connect(self.hass, SIGNAL_UPDATED, updated))
