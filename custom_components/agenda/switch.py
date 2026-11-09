"""Switches: one per agenda to pause it, and one for the absence mode of the whole house."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.components.switch import DOMAIN as SWITCH_DOMAIN, SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import AgendaEntity
from .manager import Agenda
from .shared import Shared

ABSENCE_ID = "absence"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    agenda: Agenda = hass.data[DOMAIN]["agendas"][entry.entry_id]
    async_add_entities([AgendaEnabledSwitch(agenda)])
    slot: AbsenceSlot = hass.data[DOMAIN].setdefault("absence_slot", AbsenceSlot(hass))
    entry.async_on_unload(slot.offer(entry.entry_id, async_add_entities))


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


class AbsenceSlot:
    """The absence switch exists once, whatever the number of agendas.

    An entity needs a config entry and there is one per agenda: the first agenda set up
    carries the switch, and another one takes it over when that agenda is unloaded or deleted.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.owner: str | None = None
        self._adders: dict[str, AddEntitiesCallback] = {}

    @callback
    def offer(self, entry_id: str, add: AddEntitiesCallback) -> Callable[[], None]:
        self._adders[entry_id] = add
        if self.owner is None:
            self._place(entry_id)

        @callback
        def withdraw() -> None:
            self._adders.pop(entry_id, None)
            if self.owner == entry_id:
                self.owner = None
                if self._adders:
                    self._place(next(iter(self._adders)))

        return withdraw

    @callback
    def _place(self, entry_id: str) -> None:
        self.owner = entry_id
        # moved now, before Home Assistant clears or disables what belonged to the agenda
        # that goes: adding the entity again only updates the registry later
        registry = er.async_get(self.hass)
        entity_id = registry.async_get_entity_id(SWITCH_DOMAIN, DOMAIN, ABSENCE_ID)
        item = registry.async_get(entity_id) if entity_id else None
        if item is not None and item.config_entry_id != entry_id:
            if item.device_id:
                dr.async_get(self.hass).async_update_device(item.device_id, add_config_entry_id=entry_id)
            disabled = item.disabled_by
            registry.async_update_entity(
                item.entity_id,
                config_entry_id=entry_id,
                disabled_by=None if disabled is er.RegistryEntryDisabler.CONFIG_ENTRY else disabled,
            )
        self._adders[entry_id]([AbsenceSwitch(self.hass.data[DOMAIN]["shared"])])


class AbsenceSwitch(SwitchEntity):
    """On while the absence mode runs; turned on, it lasts until turned off."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = ABSENCE_ID
    _attr_unique_id = ABSENCE_ID
    _attr_device_info = DeviceInfo(
        identifiers={(DOMAIN, "shared")},
        name="Agenda",
        manufacturer="Agenda",
        model="Agenda",
        entry_type=DeviceEntryType.SERVICE,
    )

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
