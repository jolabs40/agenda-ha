"""Binary sensor of the whole house: on on public holidays, as the agendas know them."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from homeassistant.components.binary_sensor import DOMAIN as BINARY_SENSOR_DOMAIN, BinarySensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_change
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .house import HOLIDAY_ID, HOUSE_DEVICE, house_slot
from .shared import Shared


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    shared: Shared = hass.data[DOMAIN]["shared"]
    entry.async_on_unload(
        house_slot(hass).offer(
            entry.entry_id, BINARY_SENSOR_DOMAIN, async_add_entities, lambda: PublicHolidaySensor(shared)
        )
    )


class PublicHolidaySensor(BinarySensorEntity):
    """Follows the country and region of the shared settings, like the events."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = HOLIDAY_ID
    _attr_unique_id = HOLIDAY_ID
    _attr_device_info = HOUSE_DEVICE

    def __init__(self, shared: Shared) -> None:
        self.shared = shared
        # the same in every language, for automations and the README
        self.entity_id = f"{BINARY_SENSOR_DOMAIN}.agenda_{HOLIDAY_ID}"

    async def async_added_to_hass(self) -> None:
        @callback
        def changed(_now: datetime | None = None) -> None:
            self.async_write_ha_state()

        self.async_on_remove(async_track_time_change(self.hass, changed, hour=0, minute=0, second=0))
        self.async_on_remove(self.shared.async_on_holidays_change(changed))

    @property
    def is_on(self) -> bool:
        return self.shared.is_holiday(dt_util.now().date())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        today = dt_util.now().date()
        upcoming = self.shared.next_holiday(today)
        return {
            "holiday": self.shared.holiday_name(today),
            "tomorrow": self.shared.is_holiday(today + timedelta(days=1)),
            "next_date": upcoming[0].isoformat() if upcoming else None,
            "next_holiday": upcoming[1] if upcoming else None,
        }
