"""Active switch: when off, the agenda neither applies states nor runs actions."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import AgendaEntity
from .manager import Agenda


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    agenda: Agenda = hass.data[DOMAIN]["agendas"][entry.entry_id]
    async_add_entities([AgendaEnabledSwitch(agenda)])


class AgendaEnabledSwitch(AgendaEntity, SwitchEntity):
    _attr_translation_key = "enabled"

    def __init__(self, agenda: Agenda) -> None:
        super().__init__(agenda, "enabled")

    @property
    def is_on(self) -> bool:
        return self.agenda.enabled

    @property
    def icon(self) -> str:
        return "mdi:calendar-check" if self.agenda.enabled else "mdi:calendar-lock"

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.agenda.async_set_enabled(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.agenda.async_set_enabled(False)
