"""Entities of the whole house: the absence switch and the public holiday sensor.

They exist once, whatever the number of agendas, on a device of their own. An entity needs
a config entry and there is one per agenda: the first agenda set up carries them, and
another one takes them over when that agenda is unloaded or deleted.
"""

from __future__ import annotations

from collections.abc import Callable
import inspect
import logging

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

ABSENCE_ID = "absence"
HOLIDAY_ID = "public_holiday"
# platform and unique id of each entity of the house
ENTITIES = (("switch", ABSENCE_ID), ("binary_sensor", HOLIDAY_ID))

HOUSE_DEVICE = DeviceInfo(
    identifiers={(DOMAIN, "shared")},
    name="Agenda",
    manufacturer="Agenda",
    model="Agenda",
    entry_type=DeviceEntryType.SERVICE,
)

# since Home Assistant 2026.8 a device has a single config entry, and moves with
# new_config_entry_id; before, add_config_entry_id gave it one more
_MOVE_DEVICE = (
    "new_config_entry_id"
    if "new_config_entry_id" in inspect.signature(dr.DeviceRegistry.async_update_device).parameters
    else "add_config_entry_id"
)


class HouseSlot:
    """Decides which agenda carries the entities of the house."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.owner: str | None = None
        # entry id, then platform: how to add the entity of that platform
        self._offers: dict[str, dict[str, tuple[AddEntitiesCallback, Callable[[], Entity]]]] = {}

    @callback
    def offer(
        self, entry_id: str, platform: str, add: AddEntitiesCallback, make: Callable[[], Entity]
    ) -> Callable[[], None]:
        self._offers.setdefault(entry_id, {})[platform] = (add, make)
        if self.owner is None:
            self._place(entry_id)
        elif self.owner == entry_id:
            add([make()])

        @callback
        def withdraw() -> None:
            # every platform of an agenda withdraws when it goes, the first one for all
            if self._offers.pop(entry_id, None) is None:
                return
            if self.owner == entry_id:
                self.owner = None
                if self._offers:
                    self._place(next(iter(self._offers)))

        return withdraw

    @callback
    def _place(self, entry_id: str) -> None:
        self.owner = entry_id
        # moved now, before Home Assistant clears or disables what belonged to the agenda
        # that goes: adding the entities again only updates the registry later
        registry = er.async_get(self.hass)
        device_ids: set[str] = set()
        for platform, unique_id in ENTITIES:
            entity_id = registry.async_get_entity_id(platform, DOMAIN, unique_id)
            item = registry.async_get(entity_id) if entity_id else None
            if item is None or item.config_entry_id == entry_id:
                continue
            if item.device_id:
                device_ids.add(item.device_id)
            disabled = item.disabled_by
            registry.async_update_entity(
                item.entity_id,
                config_entry_id=entry_id,
                disabled_by=None if disabled is er.RegistryEntryDisabler.CONFIG_ENTRY else disabled,
            )
        # the device after its entities: since 2026.8, a device that moves drops the entities
        # left on its former config entry
        for device_id in device_ids:
            try:
                dr.async_get(self.hass).async_update_device(device_id, **{_MOVE_DEVICE: entry_id})
            except HomeAssistantError as err:
                # that agenda already has a device of the house, left by an earlier version:
                # the entities join it when added
                _LOGGER.debug("Device of the house not moved to %s: %s", entry_id, err)
        for add, make in self._offers[entry_id].values():
            add([make()])


def house_slot(hass: HomeAssistant) -> HouseSlot:
    return hass.data[DOMAIN].setdefault("house_slot", HouseSlot(hass))
