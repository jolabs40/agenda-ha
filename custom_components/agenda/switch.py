"""Switches: one per agenda to pause it, and one for the absence mode of the whole house."""

from __future__ import annotations

from typing import Any

from homeassistant.components.switch import DOMAIN as SWITCH_DOMAIN, SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import AgendaEntity
from .house import ABSENCE_ID, HOUSE_DEVICE, house_slot
from .manager import Agenda
from .shared import Shared


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    agenda: Agenda = hass.data[DOMAIN]["agendas"][entry.entry_id]
    async_add_entities([AgendaEnabledSwitch(agenda)])
    shared: Shared = hass.data[DOMAIN]["shared"]
    entry.async_on_unload(
        house_slot(hass).offer(entry.entry_id, SWITCH_DOMAIN, async_add_entities, lambda: AbsenceSwitch(shared))
    )


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


class AbsenceSwitch(SwitchEntity):
    """On while the absence mode runs; turned on, it lasts until turned off."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = ABSENCE_ID
    _attr_unique_id = ABSENCE_ID
    _attr_device_info = HOUSE_DEVICE

    def __init__(self, shared: Shared) -> None:
        self.shared = shared
        # the same in every language, for automations and the README
        self.entity_id = f"{SWITCH_DOMAIN}.agenda_absence"

    async def async_added_to_hass(self) -> None:
        async def changed() -> None:
            self.async_write_ha_state()

        self.async_on_remove(self.shared.async_on_absence_change(changed))

    @property
    def is_on(self) -> bool:
        return self.shared.absence is not None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        until = self.shared.absence_until()
        return {"until": until.isoformat() if until else None}

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self.shared.async_check_editor(self._context)
        # already on, it keeps its end
        if self.shared.absence is None:
            await self.shared.async_set_absence(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self.shared.async_check_editor(self._context)
        await self.shared.async_set_absence(False)
