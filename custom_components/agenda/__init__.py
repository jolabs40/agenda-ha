"""Agenda: calendar-based scheduling for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path

import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_CORE_CONFIG_UPDATE
from homeassistant.core import CoreState, Event, HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration
from homeassistant.util import dt as dt_util

from . import websocket
from .const import (
    COPY_OF,
    DOMAIN,
    PANEL_ELEMENT,
    PANEL_URL,
    PLATFORMS,
    RESYNC_DELAY_S,
    SIGNAL_UPDATED,
    STATIC_URL,
)
from .control import async_remove_issues
from .manager import Agenda
from .shared import Shared

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

FRONTEND_DIR = Path(__file__).parent / "frontend"


def _frontend_version(version: str) -> str:
    """Cache-busting suffix for the panel and card URLs."""
    newest = max((f.stat().st_mtime for f in FRONTEND_DIR.glob("*.js")), default=0)
    return f"{version}-{int(newest)}"


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    shared = Shared(hass)
    await shared.async_load()
    hass.data.setdefault(DOMAIN, {"agendas": {}, "shared": shared})

    async def _core_config_updated(_event: Event) -> None:
        # holidays follow the core country unless one was picked in the panel;
        # sun times follow the home location
        await shared.async_rebuild()
        for agenda in list(hass.data[DOMAIN]["agendas"].values()):
            await agenda.async_context_changed()

    hass.bus.async_listen(EVENT_CORE_CONFIG_UPDATE, _core_config_updated)

    async def _set_absence(call: ServiceCall) -> None:
        until = call.data.get("until")
        if until is not None:
            until = (dt_util.as_local(until) if until.tzinfo else until).strftime("%Y-%m-%dT%H:%M")
        await shared.async_set_absence(True, until)

    async def _end_absence(_call: ServiceCall) -> None:
        await shared.async_set_absence(False)

    hass.services.async_register(
        DOMAIN, "set_absence", _set_absence, schema=vol.Schema({vol.Optional("until"): cv.datetime})
    )
    hass.services.async_register(DOMAIN, "end_absence", _end_absence, schema=vol.Schema({}))

    integration = await async_get_integration(hass, DOMAIN)
    version = await hass.async_add_executor_job(_frontend_version, str(integration.version))

    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(FRONTEND_DIR), cache_headers=False)])
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title="Agenda",
        sidebar_icon="mdi:calendar-month",
        module_url=f"{STATIC_URL}/agenda-panel.js?v={version}",
        config={"version": version},
        require_admin=False,
    )
    # spare users from registering the card as a dashboard resource
    add_extra_js_url(hass, f"{STATIC_URL}/agenda-card.js?v={version}")

    websocket.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    agendas: dict[str, Agenda] = hass.data[DOMAIN]["agendas"]
    agenda = Agenda(hass, entry, index=len(agendas))
    await agenda.async_load()
    if COPY_OF in entry.data:
        if source := agendas.get(entry.data[COPY_OF]):
            await agenda.async_copy_from(source)
        hass.config_entries.async_update_entry(entry, data={})
    agendas[entry.entry_id] = agenda

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    agenda.async_start()

    if hass.state is not CoreState.running:
        # catch up on transitions missed while Home Assistant was down
        async def _resync() -> None:
            if entry.entry_id not in agendas:
                return
            await agenda.async_refresh_calendars(apply=False)
            if agenda.settings.get("resync_on_start"):
                await agenda.async_resync()

        @callback
        def _later(_now) -> None:
            hass.async_create_task(_resync())

        @callback
        def _started(_hass: HomeAssistant) -> None:
            entry.async_on_unload(async_call_later(hass, RESYNC_DELAY_S, _later))

        entry.async_on_unload(async_at_started(hass, _started))

    entry.async_on_unload(agenda.async_stop)
    async_dispatcher_send(hass, SIGNAL_UPDATED, entry.entry_id)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN]["agendas"].pop(entry.entry_id, None)
        async_dispatcher_send(hass, SIGNAL_UPDATED, entry.entry_id)
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove the stored events and the repair issues along with the entry."""
    agenda = Agenda(hass, entry, index=0)
    await agenda.async_remove_storage()
    async_remove_issues(hass, entry.entry_id)
