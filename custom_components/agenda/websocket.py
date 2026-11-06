"""Websocket API used by the panel.

Agenda settings and shared settings require an admin user; events and the absence
mode may also be edited by other users when the shared settings allow it. Event actions
run as scripts with full rights, so only admins may set or change them.
"""

from __future__ import annotations

from collections.abc import Callable
import copy
from datetime import date, datetime, timedelta
from functools import wraps
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util

from . import devices, recurrence
from .const import COPY_OF, DOMAIN, SIGNAL_UPDATED
from .manager import MANUAL_HOLDS, Agenda
from .migration import COLOR, upgrade_repeat
from .shared import Shared

HVAC_MODE = vol.All(cv.string, vol.NotIn(["off"]))

# optional climate settings; unset ones are dropped since older versions refuse unknown keys
CLIMATE_SETTINGS = {vol.Optional(key): vol.Any(None, cv.string) for key in devices.CLIMATE_SETTINGS}
CLIMATE_EXTRAS = {vol.Optional("hvac_mode"): vol.Any(None, HVAC_MODE), **CLIMATE_SETTINGS}


def _drop_unset(state: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in state.items() if value is not None}


STATE_SCHEMA = vol.Any(
    None,
    vol.All(
        vol.Schema(
            {
                vol.Required("type"): "temperature",
                # 4 to 35 °C, or 39 to 95 °F
                vol.Required("temperature"): vol.All(vol.Coerce(float), vol.Range(min=4, max=95)),
                **CLIMATE_EXTRAS,
            }
        ),
        _drop_unset,
    ),
    vol.All(
        vol.Schema({vol.Required("type"): "preset", vol.Required("preset"): cv.string, **CLIMATE_EXTRAS}),
        _drop_unset,
    ),
    vol.All(
        vol.Schema({vol.Required("type"): "mode", vol.Required("hvac_mode"): HVAC_MODE, **CLIMATE_SETTINGS}),
        _drop_unset,
    ),
    vol.Schema({vol.Required("type"): "off"}),
    vol.Schema(
        {
            vol.Required("type"): "on",
            vol.Optional("brightness", default=None): vol.Any(
                None, vol.All(vol.Coerce(int), vol.Range(min=1, max=100))
            ),
        }
    ),
    vol.Schema(
        {
            vol.Required("type"): "position",
            vol.Required("position"): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        }
    ),
    vol.Schema({vol.Required("type"): "option", vol.Required("option"): cv.string}),
    vol.Schema({vol.Required("type"): "value", vol.Required("value"): vol.Coerce(float)}),
)


def _drop_empty_except(repeat: dict[str, Any]) -> dict[str, Any]:
    """Leave the second calendar list and unused calendar texts out: older versions refuse
    unknown keys, so events stay editable after a downgrade."""
    if not repeat.get("except_calendars"):
        repeat.pop("except_calendars", None)
        repeat.pop("except_match", None)
    listed = {*(repeat.get("calendars") or []), *(repeat.get("except_calendars") or [])}
    texts = {
        calendar: text.strip()
        for calendar, text in (repeat.get("calendar_texts") or {}).items()
        if calendar in listed and calendar != recurrence.HOLIDAYS_CALENDAR and text and text.strip()
    }
    if texts:
        repeat["calendar_texts"] = texts
    else:
        repeat.pop("calendar_texts", None)
    return repeat


CALENDARS = vol.All([vol.Any(recurrence.HOLIDAYS_CALENDAR, cv.entity_domain("calendar"))], vol.Unique())

REPEAT_SCHEMA = vol.All(
    # a page loaded before the update still sends a single calendar
    upgrade_repeat,
    vol.Schema(
        {
            vol.Optional("freq", default=recurrence.FREQ_NONE): vol.In(recurrence.FREQS),
            vol.Optional("interval", default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=366)),
            vol.Optional("weekdays", default=[]): [vol.All(vol.Coerce(int), vol.Range(min=0, max=6))],
            vol.Optional("until", default=None): vol.Any(None, cv.date),
            vol.Optional("exclude", default=[]): [cv.date],
            vol.Optional("include", default=[]): [cv.date],
            vol.Optional("holidays", default=recurrence.HOLIDAYS_IGNORE): vol.In(recurrence.HOLIDAYS_MODES),
            vol.Optional("calendars", default=[]): CALENDARS,
            vol.Optional("calendar_mode", default=recurrence.CALENDAR_EXCLUDE): vol.In(recurrence.CALENDAR_MODES),
            vol.Optional("calendar_match", default=recurrence.CALENDAR_ANY): vol.In(recurrence.CALENDAR_MATCHES),
            vol.Optional("except_calendars"): CALENDARS,
            vol.Optional("except_match"): vol.In(recurrence.CALENDAR_MATCHES),
            # a calendar counts only the days of its events containing this text
            vol.Optional("calendar_texts"): {cv.string: vol.Any(None, cv.string)},
            vol.Optional("period", default=recurrence.PERIOD_ALWAYS): vol.In(recurrence.PERIODS),
            vol.Optional("monthly", default=recurrence.MONTHLY_DAY): vol.In(recurrence.MONTHLY_MODES),
            vol.Optional("weeks", default=recurrence.WEEKS_ALL): vol.In(recurrence.WEEKS_MODES),
        }
    ),
    _drop_empty_except,
)

CLOCK = vol.Match(r"^([01]\d|2[0-3]):[0-5]\d$")

SUN_SCHEMA = vol.Any(
    None,
    vol.All(
        vol.Schema(
            {
                vol.Required("event"): vol.In(recurrence.SUN_EVENTS),
                vol.Optional("offset", default=0): vol.All(
                    vol.Coerce(int), vol.Range(min=-recurrence.MAX_SUN_OFFSET, max=recurrence.MAX_SUN_OFFSET)
                ),
                # clock bounds of the sun time, left out when unset for older versions
                vol.Optional("not_before"): vol.Any(None, CLOCK),
                vol.Optional("not_after"): vol.Any(None, CLOCK),
            }
        ),
        _drop_unset,
    ),
)


def _has_bound(cond: dict[str, Any]) -> dict[str, Any]:
    if cond.get("above") is None and cond.get("below") is None:
        raise vol.Invalid("a number condition needs above or below")
    return _drop_unset(cond)


CONDITION_SCHEMA = vol.Any(
    vol.Schema(
        {
            vol.Required("entity_id"): cv.entity_id,
            vol.Required("state"): vol.All(vol.Coerce(str), vol.Length(min=1)),
            vol.Optional("not", default=False): bool,
        }
    ),
    vol.All(
        vol.Schema(
            {
                vol.Required("entity_id"): cv.entity_id,
                vol.Optional("above"): vol.Any(None, vol.Coerce(float)),
                vol.Optional("below"): vol.Any(None, vol.Coerce(float)),
            }
        ),
        _has_bound,
    ),
)

EVENT_SCHEMA = vol.Schema(
    {
        vol.Optional("id"): vol.Any(None, cv.string),
        vol.Optional("name", default=""): str,
        vol.Optional("icon", default=None): vol.Any(None, str),
        vol.Optional("color", default=None): vol.Any(None, vol.Match(COLOR)),
        vol.Optional("text_color", default=None): vol.Any(None, vol.Match(COLOR)),
        vol.Optional("enabled", default=True): bool,
        vol.Optional("all_day", default=False): bool,
        vol.Required("start"): cv.string,
        vol.Required("end"): cv.string,
        vol.Optional("repeat", default={}): REPEAT_SCHEMA,
        vol.Optional("state", default=None): STATE_SCHEMA,
        vol.Optional("start_actions", default=[]): list,
        vol.Optional("end_actions", default=[]): list,
        vol.Optional("note", default=""): str,
        vol.Optional("start_sun", default=None): SUN_SCHEMA,
        vol.Optional("end_sun", default=None): SUN_SCHEMA,
        vol.Optional("conditions", default=[]): [CONDITION_SCHEMA],
        vol.Optional("conditions_match"): vol.In(["all", "any"]),
    }
)

SETTINGS_SCHEMA = vol.Schema(
    {
        vol.Optional("color"): vol.Match(COLOR),
        vol.Optional("icon"): str,
        vol.Optional("kind"): vol.In(devices.KINDS),
        vol.Optional("entities"): [cv.entity_id],
        vol.Optional("default_state"): STATE_SCHEMA,
        vol.Optional("resync_on_start"): bool,
        vol.Optional("follow_absence"): bool,
        vol.Optional("away_state"): STATE_SCHEMA,
        vol.Optional("manual_hold"): vol.In(MANUAL_HOLDS),
        vol.Optional("presence_jitter"): vol.All(vol.Coerce(int), vol.Range(min=0, max=60)),
    }
)


def require_editor(func: Callable) -> Callable:
    """Admin users, or every user when the shared settings allow it."""

    @wraps(func)
    def check(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> Any:
        if not connection.user.is_admin and not _shared(hass).allow_users:
            connection.send_error(msg["id"], websocket_api.ERR_UNAUTHORIZED, "Unauthorized")
            return None
        return func(hass, connection, msg)

    return check


def _event_json(event: dict[str, Any]) -> dict[str, Any]:
    """Turn validated date objects back into strings for storage."""
    repeat = dict(event.get("repeat") or {})
    if repeat.get("until"):
        repeat["until"] = str(repeat["until"])
    repeat["exclude"] = sorted({str(d) for d in repeat.get("exclude") or []})
    repeat["include"] = sorted({str(d) for d in repeat.get("include") or []})
    event = {**event, "repeat": repeat}
    # "all" is the default, left out for older versions
    if event.get("conditions_match") != "any" or len(event.get("conditions") or []) < 2:
        event.pop("conditions_match", None)
    return event


def _keep_actions(event: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    """The actions of the stored event, none for a new one: what a non-admin user may save."""
    return {**event, **{key: copy.deepcopy((stored or {}).get(key) or []) for key in ("start_actions", "end_actions")}}


def _agendas(hass: HomeAssistant) -> dict[str, Agenda]:
    return hass.data[DOMAIN]["agendas"]


def _shared(hass: HomeAssistant) -> Shared:
    return hass.data[DOMAIN]["shared"]


def _agenda(hass: HomeAssistant, entry_id: str) -> Agenda:
    try:
        return _agendas(hass)[entry_id]
    except KeyError as err:
        raise HomeAssistantError(f"unknown agenda: {entry_id}") from err


def _local_midnight(day: str) -> datetime:
    return datetime.combine(date.fromisoformat(day), datetime.min.time()).replace(
        tzinfo=dt_util.get_default_time_zone()
    )


@callback
def async_register(hass: HomeAssistant) -> None:
    for handler in (
        ws_list,
        ws_occurrences,
        ws_subscribe,
        ws_save_event,
        ws_delete_event,
        ws_detach,
        ws_save_settings,
        ws_duplicate,
        ws_set_enabled,
        ws_override,
        ws_resync,
        ws_holiday_options,
        ws_save_shared,
        ws_sun,
        ws_set_absence,
    ):
        websocket_api.async_register_command(hass, handler)


@websocket_api.websocket_command({vol.Required("type"): "agenda/list"})
@callback
def ws_list(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    agendas = sorted(_agendas(hass).values(), key=lambda a: a.name.lower())
    connection.send_result(
        msg["id"],
        {
            "time_zone": str(dt_util.get_default_time_zone()),
            "now": dt_util.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "shared": _shared(hass).as_dict(),
            "agendas": [agenda.as_dict() for agenda in agendas],
        },
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/occurrences",
        vol.Required("start"): cv.string,  # "2026-11-02", local midnight included
        vol.Required("end"): cv.string,  # local midnight excluded
    }
)
@websocket_api.async_response
async def ws_occurrences(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    try:
        start, end = _local_midnight(msg["start"]), _local_midnight(msg["end"])
    except ValueError as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
        return
    if not start < end <= start + timedelta(days=62):
        connection.send_error(msg["id"], "invalid_format", "invalid period (62 days at most)")
        return
    found = {entry_id: await agenda.async_occurrences_dict(start, end) for entry_id, agenda in _agendas(hass).items()}
    connection.send_result(
        msg["id"],
        {
            "agendas": {entry_id: occs for entry_id, (occs, _) in found.items()},
            # a page from an older version ignores this key
            "skipped": {entry_id: skipped for entry_id, (_, skipped) in found.items()},
            "holidays": _shared(hass).between(start.date(), end.date()),
            "vacation": await _shared(hass).async_vacation_between(start.date(), end.date()),
        },
    )


@websocket_api.websocket_command({vol.Required("type"): "agenda/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Tell the panel whenever an agenda changes."""

    @callback
    def forward(entry_id: str) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"entry_id": entry_id}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_UPDATED, forward)
    connection.send_result(msg["id"])


@websocket_api.websocket_command(
    {vol.Required("type"): "agenda/holidays/options", vol.Optional("country"): vol.Any(None, str)}
)
@websocket_api.async_response
async def ws_holiday_options(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    shared = _shared(hass)
    country = msg.get("country") or shared.effective_country
    connection.send_result(msg["id"], await shared.async_options(country))


async def _guard(connection, msg, coro_factory) -> None:
    try:
        result = await coro_factory()
    except vol.Invalid as err:
        connection.send_error(msg["id"], "invalid_format", str(err))
    except (HomeAssistantError, ValueError, KeyError) as err:
        connection.send_error(msg["id"], "invalid", str(err) or repr(err))
    else:
        connection.send_result(msg["id"], result)


@require_editor
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/event/save",
        vol.Required("entry_id"): cv.string,
        vol.Required("event"): dict,
    }
)
@websocket_api.async_response
async def ws_save_event(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    async def run():
        agenda = _agenda(hass, msg["entry_id"])
        event = _event_json(EVENT_SCHEMA(msg["event"]))
        if not connection.user.is_admin:
            event = _keep_actions(event, agenda.event(event["id"]) if event.get("id") else None)
        return await agenda.async_save_event(event)

    await _guard(connection, msg, run)


@require_editor
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/event/delete",
        vol.Required("entry_id"): cv.string,
        vol.Required("event_id"): cv.string,
    }
)
@websocket_api.async_response
async def ws_delete_event(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    await _guard(
        connection,
        msg,
        lambda: _agenda(hass, msg["entry_id"]).async_delete_event(msg["event_id"]),
    )


@require_editor
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/event/detach",
        vol.Required("entry_id"): cv.string,
        vol.Required("event_id"): cv.string,
        vol.Required("day"): cv.string,
        vol.Optional("event"): vol.Any(None, dict),  # missing: delete the occurrence
    }
)
@websocket_api.async_response
async def ws_detach(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    async def run():
        agenda = _agenda(hass, msg["entry_id"])
        replacement = msg.get("event")
        if replacement is not None:
            replacement = _event_json(EVENT_SCHEMA(replacement))
            if not connection.user.is_admin:
                # the day moved out of the series keeps the series' actions
                replacement = _keep_actions(replacement, agenda.event(msg["event_id"]))
        return await agenda.async_detach(msg["event_id"], msg["day"], replacement)

    await _guard(connection, msg, run)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/settings/save",
        vol.Required("entry_id"): cv.string,
        vol.Required("settings"): dict,
        vol.Optional("name"): cv.string,
        vol.Optional("apply", default=True): bool,
    }
)
@websocket_api.async_response
async def ws_save_settings(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    async def run():
        settings = SETTINGS_SCHEMA(msg["settings"])
        await _agenda(hass, msg["entry_id"]).async_save_settings(settings, msg.get("name"), msg["apply"])

    await _guard(connection, msg, run)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/duplicate",
        vol.Required("entry_id"): cv.string,
        vol.Required("name"): cv.string,
    }
)
@websocket_api.async_response
async def ws_duplicate(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    async def run():
        source = _agenda(hass, msg["entry_id"])
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}, data={"name": msg["name"], COPY_OF: source.entry_id}
        )
        if result["type"] is not FlowResultType.CREATE_ENTRY:
            raise HomeAssistantError(result.get("reason") or "not created")
        return {"entry_id": result["result"].entry_id}

    await _guard(connection, msg, run)


@require_editor
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/set_enabled",
        vol.Required("entry_id"): cv.string,
        vol.Required("enabled"): bool,
    }
)
@websocket_api.async_response
async def ws_set_enabled(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    await _guard(
        connection,
        msg,
        lambda: _agenda(hass, msg["entry_id"]).async_set_enabled(msg["enabled"]),
    )


@require_editor
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/override",
        vol.Required("entry_id"): cv.string,
        vol.Required("action"): vol.In(["next", "event", "resume"]),
        vol.Optional("event_id"): cv.string,
        # the state shown in the editor, which may not be saved yet
        vol.Optional("state"): STATE_SCHEMA,
    }
)
@websocket_api.async_response
async def ws_override(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Skip to the next state, put an event's state ahead of the schedule, or go back to it."""

    async def run():
        agenda = _agenda(hass, msg["entry_id"])
        if msg["action"] == "next":
            await agenda.async_advance()
        elif msg["action"] == "event":
            await agenda.async_apply_event(msg.get("event_id") or "", msg.get("state"))
        else:
            await agenda.async_resume()

    await _guard(connection, msg, run)


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "agenda/resync", vol.Required("entry_id"): cv.string})
@websocket_api.async_response
async def ws_resync(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    # the Apply now button of the settings: devices set by hand are taken back too
    await _guard(connection, msg, lambda: _agenda(hass, msg["entry_id"]).async_resync(take_back=True))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/shared/save",
        vol.Optional("country", default=None): vol.Any(None, vol.All(str, vol.Length(min=2, max=3))),
        vol.Optional("subdiv", default=None): vol.Any(None, str),
        vol.Optional("school_calendar", default=None): vol.Any(None, cv.entity_domain("calendar")),
        vol.Optional("allow_users"): bool,
    }
)
@websocket_api.async_response
async def ws_save_shared(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    async def run():
        shared = _shared(hass)
        country = msg["country"]
        if country:
            options = await shared.async_options(country)
            if country not in options["countries"]:
                raise HomeAssistantError(f"unknown country: {country}")
        await shared.async_set(country, msg["subdiv"], msg["school_calendar"], msg.get("allow_users"))
        for agenda in _agendas(hass).values():
            await agenda.async_context_changed()

    await _guard(connection, msg, run)


@websocket_api.websocket_command({vol.Required("type"): "agenda/sun", vol.Required("date"): cv.date})
@callback
def ws_sun(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    """Sunrise and sunset of a local day, for the event editor."""
    shared = _shared(hass)
    times = {which: shared.sun(msg["date"], which) for which in recurrence.SUN_EVENTS}
    connection.send_result(msg["id"], {key: t.strftime("%H:%M") if t else None for key, t in times.items()})


@require_editor
@websocket_api.websocket_command(
    {
        vol.Required("type"): "agenda/absence/set",
        vol.Required("active"): bool,
        vol.Optional("until", default=None): vol.Any(None, cv.string),  # local "2026-11-10T18:00"
    }
)
@websocket_api.async_response
async def ws_set_absence(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict) -> None:
    await _guard(connection, msg, lambda: _shared(hass).async_set_absence(msg["active"], msg["until"]))
