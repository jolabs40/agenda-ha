"""Runtime of a single agenda: storage, timer and execution.

At each transition the end actions run first, then the linked entities get the
wanted state, then the start actions run. Handling ends before starts keeps the
end of one event from undoing the next one when they are back to back.

An event with conditions takes charge (state and start actions) only while they
hold; its end actions run only if they held at its start. During the absence
mode an agenda that follows it keeps its away state and runs no action.

A device changed by hand is left alone until the next change of the agenda, the next
day, or not at all (setting manual_hold). An override puts the state of an event, or
the next one, ahead of the schedule until a given time. Both are kept across restarts
in a storage file of their own, which older versions do not read.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import copy
from datetime import date, datetime, time, timedelta
import logging
import random
from typing import Any
import uuid

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Context, Event, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    async_call_later,
    async_track_point_in_time,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.script import Script, async_validate_actions_config
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import devices, recurrence
from .const import (
    CALENDAR_FUTURE,
    CALENDAR_PAST,
    CALENDAR_REFRESH,
    CONDITION_DELAY_S,
    CONDITION_WAIT,
    DEFAULT_SETTINGS,
    DOMAIN,
    PALETTE,
    PREHEAT_LIMIT,
    REASON_PREHEAT_CANCEL,
    REASON_SOURCE,
    SIGNAL_UPDATED,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
)
from .control import Control
from .migration import migrate
from .preheater import Preheater
from .recurrence import wall
from .shared import Shared

_LOGGER = logging.getLogger(__name__)

RUNTIME_STORAGE_VERSION = 1

# how long a device changed by hand is left alone
MANUAL_NEXT_CHANGE = "next_change"
MANUAL_NEXT_DAY = "next_day"
MANUAL_NEVER = "never"
# put back at once
MANUAL_UNDO = "undo"
MANUAL_HOLDS = (MANUAL_NEXT_CHANGE, MANUAL_NEXT_DAY, MANUAL_NEVER, MANUAL_UNDO)

# states that say nothing about a condition entity
NO_STATE = ("unavailable", "unknown")
# an occurrence shown aside: its entity conditions do not hold now
CONDITIONS_UNMET = "conditions"
# ... or its event is turned off
TURNED_OFF = "off"

# reasons that take every device back, hand changes included
TAKE_BACK = ("edit", "enabled", "absence", "override", "resume", "apply")


class AgendaStore(Store[dict[str, Any]]):
    async def _async_migrate_func(
        self, old_major_version: int, old_minor_version: int, old_data: dict[str, Any]
    ) -> dict[str, Any]:
        if old_major_version > STORAGE_VERSION:
            raise NotImplementedError
        return migrate(old_data)


class Agenda:
    """An agenda and its schedule."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, index: int) -> None:
        self.hass = hass
        self.entry = entry
        self._store = AgendaStore(
            hass,
            STORAGE_VERSION,
            f"{DOMAIN}.{entry.entry_id}",
            minor_version=STORAGE_MINOR_VERSION,
        )
        self._runtime: Store[dict[str, Any]] = Store(
            hass, RUNTIME_STORAGE_VERSION, f"{DOMAIN}.{entry.entry_id}.runtime"
        )
        # state put ahead of the schedule: {"state", "until", "kind", "event_id"}
        self.override: dict[str, Any] | None = None
        self._unsub_holds: Callable[[], None] | None = None
        self.settings: dict[str, Any] = dict(DEFAULT_SETTINGS)
        self.settings["color"] = PALETTE[index % len(PALETTE)]
        self.enabled = True
        self.events: list[dict[str, Any]] = []
        self.next_change: datetime | None = None
        self._last = dt_util.utcnow()
        self._unsub_timer: Callable[[], None] | None = None
        self.control = Control(self)
        self.preheater = Preheater(self)
        self.run_lock = asyncio.Lock()
        # condition calendars: busy local days, and the span they were read for
        self._calendar_days: dict[str, set[date]] = {}
        self._calendar_span: tuple[date, date] | None = None
        self._calendars_ready = False
        self._unsub_calendars: list[Callable[[], None]] = []
        self._refresh_pending: Callable[[], None] | None = None
        self._unsub_conditions: Callable[[], None] | None = None
        self._condition_pending: Callable[[], None] | None = None
        # condition entities and sources that changed since the last decision
        self._changed: set[str] = set()
        # last real state of each condition entity, and since when it has none (None: it has one)
        self._known: dict[str, tuple[str, datetime | None]] = {}
        # occurrences their conditions kept out at the start, until their end: no end actions for them
        self._refused: dict[str, datetime] = {}
        self._unsub_wait: Callable[[], None] | None = None
        self._unsub_stop: Callable[[], None] | None = None
        self._unsub_absence: Callable[[], None] | None = None

    @property
    def entry_id(self) -> str:
        return self.entry.entry_id

    @property
    def name(self) -> str:
        return self.entry.title

    @property
    def tz(self):
        return dt_util.get_default_time_zone()

    @property
    def kind(self) -> str:
        return self.settings.get("kind") or devices.KIND_NONE

    @property
    def linked(self) -> list[str]:
        return list(self.settings.get("entities") or [])

    @property
    def shared(self) -> Shared:
        return self.hass.data[DOMAIN]["shared"]

    def event(self, event_id: str) -> dict[str, Any]:
        for event in self.events:
            if event["id"] == event_id:
                return event
        raise KeyError(event_id)

    def unit(self) -> str | None:
        if self.kind == devices.KIND_CLIMATE:
            return self.hass.config.units.temperature_unit
        for entity_id in self.linked:
            state = self.hass.states.get(entity_id)
            if state and state.attributes.get("unit_of_measurement"):
                return state.attributes["unit_of_measurement"]
        return None

    def state_label(self, state: dict[str, Any] | None) -> str | None:
        return devices.label(self.follow(state), self.hass.config.language, self.unit())

    def follow(self, state: dict[str, Any] | None) -> dict[str, Any] | None:
        """The state with the value its source has now, see devices.follow."""
        source = (state or {}).get("source")
        return devices.follow(state, self._condition_state(source)) if source else state

    def label(self, event: dict[str, Any]) -> str:
        """Event name, or its state when unnamed."""
        if event.get("name"):
            return event["name"]
        return self.state_label(event.get("state")) or "—"

    async def async_load(self) -> None:
        data = await self._store.async_load()
        if data:
            data = migrate(data)
            self.settings.update(data.get("settings") or {})
            self.enabled = data.get("enabled", True)
            self.events = data.get("events") or []
        runtime = await self._runtime.async_load() or {}
        now = dt_util.utcnow()

        def moment(text: str | None) -> datetime | None:
            return dt_util.parse_datetime(text) if text else None

        for entity_id, until in (runtime.get("holds") or {}).items():
            until = moment(until)
            if until is None or until > now:
                self.control.holds[entity_id] = until
        override = runtime.get("override")
        if override and (until := moment(override.get("until"))) and until > now:
            self.override = {**override, "until": until}
        for entity_id, (state, since) in (runtime.get("conditions") or {}).items():
            # a state seen until the restart is waited for from now on
            since = moment(since) or now
            if now - since < CONDITION_WAIT:
                self._known[entity_id] = (state, since)
        for key, end in (runtime.get("refused") or {}).items():
            if (end := moment(end)) and end > now:
                self._refused[key] = end
        self.preheater.load(runtime)

    async def async_save(self) -> None:
        await self._store.async_save({"settings": self.settings, "enabled": self.enabled, "events": self.events})

    def runtime_data(self) -> dict[str, Any]:
        override = self.override
        return {
            "holds": {e: until.isoformat() if until else None for e, until in self.control.holds.items()},
            "override": {**override, "until": override["until"].isoformat()} if override else None,
            "conditions": {
                e: [state, since.isoformat() if since else None] for e, (state, since) in self._known.items()
            },
            "refused": {key: end.isoformat() for key, end in self._refused.items()},
            **self.preheater.storage(),
        }

    @callback
    def _save_runtime(self) -> None:
        self._runtime.async_delay_save(self.runtime_data, 1)

    async def async_remove_storage(self) -> None:
        await self._store.async_remove()
        await self._runtime.async_remove()

    def context(self, extra: dict[str, set[date]] | None = None) -> recurrence.Context:
        days = self._calendar_days
        if extra:
            days = {key: days.get(key, set()) | extra.get(key, set()) for key in {*days, *extra}}
        school = self.shared.school_calendar
        return recurrence.Context(
            is_holiday=self.shared.is_holiday,
            calendar_days=days,
            vacation_days=days.get(school, set()) if school else None,
            sun=self.shared.sun,
            shift=self._presence_shift,
        )

    def _presence_shift(self, event_id: str, at: datetime, which: str) -> int:
        """Presence simulation: during an absence, an agenda that keeps its schedule moves its
        starts and ends by up to presence_jitter minutes. The draw is fixed for an event, a day
        and a bound, so that the week, the sensors and the timer agree."""
        jitter = int(self.settings.get("presence_jitter") or 0)
        if not jitter or self.settings.get("follow_absence", True):
            return 0
        if not self.shared.absent_at(dt_util.as_utc(at.replace(tzinfo=self.tz))):
            return 0
        return random.Random(f"{event_id}|{at.date()}|{which}").randint(-jitter, jitter)

    def occurrences(
        self, start: datetime, end: datetime, ctx: recurrence.Context | None = None
    ) -> list[recurrence.Occurrence]:
        return recurrence.all_occurrences(self.events, self.tz, start, end, ctx or self.context())

    def active(self, at: datetime | None = None) -> list[recurrence.Occurrence]:
        return recurrence.active_at(self.events, self.tz, at or dt_util.utcnow(), self.context())

    def conditions_hold(self, event: dict[str, Any]) -> bool:
        """Whether the event's entity conditions hold now."""
        return recurrence.conditions_met(event, self._condition_state)

    def _condition_state(self, entity_id: str) -> str | None:
        """State of a condition entity. Unavailable or unknown, it keeps its last state for a
        while: deciding on a sensor that is not back yet would move devices twice."""
        state = self.hass.states.get(entity_id)
        if state is not None and state.state not in NO_STATE:
            return state.state
        known = self._known.get(entity_id)
        if known and (known[1] is None or dt_util.utcnow() - known[1] < CONDITION_WAIT):
            return known[0]
        return state.state if state else None

    def absent(self, at: datetime | None = None) -> bool:
        return bool(self.settings.get("follow_absence", True)) and self.shared.absent_at(at or dt_util.utcnow())

    def desired(
        self, at: datetime | None = None, override: bool = True
    ) -> tuple[dict[str, Any] | None, recurrence.Occurrence | None]:
        """The state wanted at this time, and the occurrence giving it. A followed value is
        the one its entity has now, whatever the time."""
        state, occ = self._scheduled(at or dt_util.utcnow(), override)
        return self.follow(state), occ

    def _scheduled(self, at: datetime, override: bool) -> tuple[dict[str, Any] | None, recurrence.Occurrence | None]:
        default = self.settings.get("default_state")
        if self.absent(at):
            return self.settings.get("away_state") or default, None
        if override and self.override and at < self.override["until"]:
            return self.override["state"], None
        if (early := self.preheater.running_at(at)) is not None:
            return early
        # conditions are read now: a future state assumes they keep their value
        events = [event for event in self.events if self.conditions_hold(event)]
        return recurrence.desired_state(events, self.tz, at, default, self.context())

    @callback
    def async_start(self) -> None:
        self._last = dt_util.utcnow()
        self._schedule()
        self._track_calendars()
        self._track_conditions()
        self.control.track()
        self.preheater.start()
        self._schedule_holds()
        self._unsub_absence = self.shared.async_on_absence_change(self.async_absence_changed)
        # the last states of the condition entities are written once, when Home Assistant stops
        self._unsub_stop = self.hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, self._on_ha_stop)

    @callback
    def _on_ha_stop(self, _event: Event) -> None:
        self._runtime.async_delay_save(self.runtime_data, 0)

    @callback
    def async_stop(self) -> None:
        if self._unsub_stop:
            self._unsub_stop()
            self._unsub_stop = None
            if self._known:
                self._save_runtime()
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self._untrack_calendars()
        self._untrack_conditions()
        self.control.stop()
        self.preheater.stop()
        if self._unsub_holds:
            self._unsub_holds()
            self._unsub_holds = None
        if self._unsub_absence:
            self._unsub_absence()
            self._unsub_absence = None

    @callback
    def _schedule(self) -> None:
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self.next_change = recurrence.next_transition(self.events, self.tz, self._last, self.context())
        ends = self.override["until"] if self.override else None
        if ends is not None and ends > self._last and (self.next_change is None or ends < self.next_change):
            self.next_change = ends
        if self.next_change is not None:
            self._unsub_timer = async_track_point_in_time(self.hass, self._on_timer, self.next_change)
        until = self.shared.absence_until()
        if self.absent() and until is not None and (self.next_change is None or until < self.next_change):
            # what the panel shows; the shared settings end the absence themselves
            self.next_change = until
        self.preheater.evaluate()

    @callback
    def _on_timer(self, _now: datetime) -> None:
        self._unsub_timer = None
        since = self._last
        until = max(dt_util.utcnow(), self.next_change or since)
        self._last = until
        self._schedule()
        self.hass.async_create_background_task(self._async_process(since, until), f"{DOMAIN} {self.name} transition")

    async def _async_process(self, since: datetime, until: datetime) -> None:
        """Handle every start and end in (since, until]."""
        if self.condition_calendars() and not self._calendars_ready:
            await self.async_refresh_calendars(apply=False)
        expired = self.override is not None and self.override["until"] <= until
        if expired:
            self.override = None
            self._save_runtime()
        occs = self.occurrences(since, until + timedelta(seconds=1))
        ended = sorted((o for o in occs if since < o.end <= until), key=lambda o: o.end)
        starting = sorted((o for o in occs if since < o.start <= until), key=lambda o: o.start)
        started = [o for o in starting if self.conditions_hold(self.event(o.event_id))]
        refused = {self._occ_key(o): o.end for o in starting if o not in started}
        if refused or any(end <= since for end in self._refused.values()):
            self._refused = {key: end for key, end in self._refused.items() if end > since} | refused
            self._save_runtime()
        self._notify()
        if not self.enabled or self.absent() or not (ended or started or expired):
            return
        async with self.run_lock:
            for occ in ended:
                if self._refused.pop(self._occ_key(occ), None) is None:
                    await self._async_run_actions(occ, "end")
            if self.linked:
                # resend the state when an event starts, to override manual changes
                force = expired or any(self.event(o.event_id).get("state") for o in started)
                await self.async_apply_state(force=force, reason="schedule")
            for occ in started:
                await self._async_run_actions(occ, "start")

    @staticmethod
    def _occ_key(occ: recurrence.Occurrence) -> str:
        return f"{occ.event_id} {occ.start.isoformat()}"

    async def _async_run_actions(self, occ: recurrence.Occurrence, phase: str) -> None:
        event = self.event(occ.event_id)
        actions = event.get(f"{phase}_actions") or []
        if not actions:
            return
        try:
            validated = await async_validate_actions_config(self.hass, cv.SCRIPT_SCHEMA(copy.deepcopy(actions)))
            script = Script(
                self.hass,
                validated,
                f"{self.name} – {self.label(event)}",
                DOMAIN,
                script_mode="parallel",
                max_runs=10,
                logger=_LOGGER,
            )
            await script.async_run(
                run_variables={
                    "agenda": self.name,
                    "phase": phase,
                    "event": {
                        "id": event["id"],
                        "name": self.label(event),
                        "start": occ.start.isoformat(),
                        "end": occ.end.isoformat(),
                    },
                },
                context=Context(),
            )
        except Exception:  # one broken action must not stop the others
            _LOGGER.exception("Agenda %s: %s actions of '%s' failed", self.name, phase, self.label(event))

    async def async_apply_state(self, force: bool = False, reason: str = "change") -> None:
        """Apply the current wanted state to the linked entities.

        Without force, only to the devices that did not get it yet. Devices changed by
        hand are skipped, unless the reason takes every device back.
        """
        if reason in TAKE_BACK and self.control.holds:
            self.control.holds.clear()
            self._save_runtime()
            self._schedule_holds()
        if not self.linked or not self.enabled:
            return
        wanted, occ = self.desired()
        if wanted is None:
            return
        if not devices.accepts(self.kind, wanted):
            _LOGGER.warning("Agenda %s: state %s does not fit kind %s", self.name, wanted, self.kind)
            return
        for entity_id in self.linked:
            if self.control.held(entity_id):
                continue
            if force or self.control.applied.get(entity_id) != wanted:
                await self.control.async_apply(entity_id, wanted, reason, occ)

    @callback
    def manual_change(self, entity_id: str) -> None:
        """Someone else changed a device: leave it alone for a while, as set, or put it back."""
        mode = self.settings.get("manual_hold", MANUAL_NEXT_CHANGE)
        if mode == MANUAL_NEVER or not self.enabled:
            return
        if mode == MANUAL_UNDO:
            if self.control.undo(entity_id):
                return
            # something keeps setting it otherwise: no fight
            _LOGGER.warning("Agenda %s: %s keeps being changed, left alone until the next change", self.name, entity_id)
            mode = MANUAL_NEXT_CHANGE
        if mode == MANUAL_NEXT_DAY:
            until = dt_util.start_of_local_day(dt_util.now() + timedelta(days=1))
        else:
            until = self.next_change
        self.control.holds[entity_id] = dt_util.as_utc(until) if until else None
        _LOGGER.info("Agenda %s: %s changed by hand, left alone until %s", self.name, entity_id, until or "resumed")
        self._save_runtime()
        self._schedule_holds()
        self._notify()

    @callback
    def manual_end(self, entity_id: str) -> None:
        """A device changed by hand is back to the agenda's state."""
        if entity_id in self.control.holds:
            del self.control.holds[entity_id]
            self._save_runtime()
            self._schedule_holds()
            self._notify()

    @callback
    def _schedule_holds(self) -> None:
        if self._unsub_holds:
            self._unsub_holds()
            self._unsub_holds = None
        ends = [until for until in self.control.holds.values() if until is not None]
        if ends:
            self._unsub_holds = async_track_point_in_time(self.hass, self._on_holds_end, min(ends))

    @callback
    def _on_holds_end(self, _now: datetime) -> None:
        self._unsub_holds = None
        self.hass.async_create_background_task(self._async_holds_end(), f"{DOMAIN} {self.name} hand changes")

    async def _async_holds_end(self) -> None:
        """Devices left alone long enough get the agenda's state back."""
        now = dt_util.utcnow()
        ended = [e for e, until in self.control.holds.items() if until is not None and until <= now]
        for entity_id in ended:
            del self.control.holds[entity_id]
        self._save_runtime()
        self._schedule_holds()
        async with self.run_lock:
            wanted, occ = self.desired()
            if self.enabled and wanted is not None and devices.accepts(self.kind, wanted):
                for entity_id in ended:
                    state = self.hass.states.get(entity_id)
                    # a transition at the same time may have done it already
                    if entity_id in self.linked and not (
                        state and devices.reached(entity_id, state.state, state.attributes, wanted)
                    ):
                        await self.control.async_apply(entity_id, wanted, "manual_end", occ)
        self._notify()

    async def _async_overridden(self) -> None:
        self._save_runtime()
        self._last = dt_util.utcnow()
        self._schedule()
        async with self.run_lock:
            await self.async_apply_state(force=True, reason="override")
        self._notify()

    async def async_advance(self) -> None:
        """Put the next state of the schedule ahead of it, until its time comes."""
        start = dt_util.utcnow()
        if self.override and self.override["until"] > start:
            start = self.override["until"]
        nxt = recurrence.next_transition(self.events, self.tz, start, self.context())
        state = self.desired(nxt, override=False)[0] if nxt else None
        if nxt is None or state is None:
            raise HomeAssistantError(f"nothing comes next in agenda {self.name}")
        self.override = {"state": copy.deepcopy(state), "until": nxt, "kind": "next", "event_id": None}
        await self._async_overridden()

    async def async_apply_event(self, event_id: str, state: dict[str, Any] | None = None) -> None:
        """Put the state of an event (or the one given) ahead of the schedule, until its
        next occurrence ends."""
        event = self.event(event_id)
        state = state or event.get("state")
        if not state:
            raise HomeAssistantError(f"event '{self.label(event)}' has no state")
        if not devices.accepts(self.kind, state):
            raise HomeAssistantError(f"state {state} does not fit an agenda of kind {self.kind}")
        now = dt_util.utcnow()
        occs = [o for o in self.occurrences(now, now + timedelta(days=400)) if o.event_id == event_id and o.end > now]
        if not occs:
            raise HomeAssistantError(f"event '{self.label(event)}' does not come again")
        until = min(occs, key=lambda o: o.start).end
        self.override = {"state": copy.deepcopy(state), "until": until, "kind": "event", "event_id": event_id}
        await self._async_overridden()

    async def async_apply_named(self, name: str) -> None:
        """The event of that name with a state that comes first, as for apply_event."""
        ids = {event["id"] for event in self._named(name) if event.get("state")}
        now = dt_util.utcnow()
        occs = [o for o in self.occurrences(now, now + timedelta(days=400)) if o.event_id in ids and o.end > now]
        if not occs:
            raise HomeAssistantError(f"no event named '{name}' with a state comes again in agenda {self.name}")
        await self.async_apply_event(min(occs, key=lambda o: o.start).event_id)

    async def async_resume(self) -> None:
        """Back to the schedule: no override, no device left alone."""
        self.override = None
        self._save_runtime()
        self._last = dt_util.utcnow()
        self._schedule()
        async with self.run_lock:
            await self.async_apply_state(force=True, reason="resume")
        self._notify()

    def condition_keys(self) -> set[str]:
        """Keys of the busy days to read: by calendar, or by calendar and text."""
        keys = set().union(*(recurrence.condition_keys(event) for event in self.events))
        school = self.shared.school_calendar
        if school and school in self.condition_calendars():
            keys.add(school)
        return keys

    @property
    def calendars_ready(self) -> bool:
        return self._calendars_ready or not self.condition_calendars()

    def condition_calendars(self) -> set[str]:
        calendars = {
            recurrence.text_of_key(key)[0] for event in self.events for key in recurrence.condition_keys(event)
        }
        school = self.shared.school_calendar
        if school and any(
            (event.get("repeat") or {}).get("period", recurrence.PERIOD_ALWAYS) != recurrence.PERIOD_ALWAYS
            for event in self.events
        ):
            calendars.add(school)
        return calendars

    @callback
    def _track_calendars(self, refresh: bool = True) -> None:
        self._untrack_calendars()
        calendars = self.condition_calendars()
        if not calendars:
            self._calendar_days = {}
            self._calendar_span = None
            self._calendars_ready = False
            return
        self._unsub_calendars = [
            async_track_state_change_event(self.hass, sorted(calendars), self._on_calendar_change),
            async_track_time_interval(self.hass, self._on_calendar_tick, CALENDAR_REFRESH),
        ]
        if refresh:
            self.hass.async_create_background_task(self.async_refresh_calendars(), f"{DOMAIN} {self.name} calendars")

    @callback
    def _untrack_calendars(self) -> None:
        for unsub in self._unsub_calendars:
            unsub()
        self._unsub_calendars = []
        if self._refresh_pending:
            self._refresh_pending()
            self._refresh_pending = None

    @callback
    def _on_calendar_change(self, _event: Event) -> None:
        # a calendar changes state when its events start or end, or after an edit
        if self._refresh_pending:
            self._refresh_pending()
        self._refresh_pending = async_call_later(self.hass, 5, self._on_calendar_tick)

    @callback
    def _on_calendar_tick(self, _now: datetime) -> None:
        self._refresh_pending = None
        self.hass.async_create_background_task(self.async_refresh_calendars(), f"{DOMAIN} {self.name} calendars")

    async def _async_calendar_days(self, keys: set[str], start: date, end: date) -> tuple[dict[str, set[date]], bool]:
        """Busy days per key (calendar, or calendar and text) over [start, end), and whether
        all could be read. Each calendar is read once. A calendar entity may not exist yet
        during startup.
        """
        tz = self.tz
        start_dt = datetime.combine(start, time.min, tz)
        end_dt = datetime.combine(end, time.min, tz)
        found: dict[str, set[date]] = {}
        complete = True
        by_calendar: dict[str, list[str]] = {}
        for key in sorted(keys):
            by_calendar.setdefault(recurrence.text_of_key(key)[0], []).append(key)
        own = self.agenda_entities().get("calendar")
        for entity_id, entity_keys in by_calendar.items():
            if entity_id == own:
                continue
            if self.hass.states.get(entity_id) is None:
                for key in entity_keys:
                    found[key] = self._calendar_days.get(key, set())
                complete = False
                continue
            try:
                response = await self.hass.services.async_call(
                    "calendar",
                    "get_events",
                    {
                        "entity_id": entity_id,
                        "start_date_time": start_dt.isoformat(),
                        "end_date_time": end_dt.isoformat(),
                    },
                    blocking=True,
                    return_response=True,
                )
            except (HomeAssistantError, ValueError) as err:
                _LOGGER.warning("Agenda %s: cannot read %s: %s", self.name, entity_id, err)
                for key in entity_keys:
                    found[key] = self._calendar_days.get(key, set())
                complete = False
                continue
            events = ((response or {}).get(entity_id) or {}).get("events") or []
            for key in entity_keys:
                text = recurrence.text_of_key(key)[1]
                found[key] = recurrence.calendar_days(
                    ((str(e["start"]), str(e["end"])) for e in events if recurrence.event_has_text(e, text)), tz
                )
        if own in by_calendar:
            ctx = self.context(found)
            for key in by_calendar[own]:
                text = recurrence.text_of_key(key)[1]
                found[key] = recurrence.own_calendar_days(self.events, own, text, self.label, tz, start_dt, end_dt, ctx)
        return found, complete

    async def async_refresh_calendars(self, apply: bool = True) -> None:
        calendars = self.condition_keys()
        today = dt_util.now().date()
        start, end = today - CALENDAR_PAST, today + CALENDAR_FUTURE
        days: dict[str, set[date]] = {}
        self._calendars_ready = True
        if calendars:
            days, self._calendars_ready = await self._async_calendar_days(calendars, start, end)
        if days == self._calendar_days:
            self._calendar_span = (start, end) if calendars else None
            return
        before, _ = self.desired()
        self._calendar_days = days
        self._calendar_span = (start, end) if calendars else None
        self._schedule()
        after, _ = self.desired()
        if apply and after != before:
            async with self.run_lock:
                await self.async_apply_state(force=True, reason="calendar")
        self._notify()

    async def async_context_for(self, start: datetime, end: datetime) -> recurrence.Context:
        """Context for [start, end), reading calendars outside the cached span."""
        calendars = self.condition_keys()
        span = self._calendar_span
        first, last = start.astimezone(self.tz).date(), end.astimezone(self.tz).date()
        if not calendars or (span and span[0] <= first and last <= span[1]):
            return self.context()
        extra, _ = await self._async_calendar_days(calendars, first - timedelta(days=1), last + timedelta(days=1))
        return self.context(extra)

    async def _async_changed(self, before: dict[str, Any] | None) -> None:
        """Persist, reschedule, and apply the state if the change affects it."""
        await self.async_save()
        if self.condition_keys() != set(self._calendar_days):
            # a new condition calendar must be read before deciding anything
            self._track_calendars(refresh=False)
            await self.async_refresh_calendars(apply=False)
        elif self.agenda_entities().get("calendar") in self.condition_calendars():
            await self.async_refresh_calendars(apply=False)
        self._track_conditions()
        self._last = dt_util.utcnow()
        self._schedule()
        after, _ = self.desired()
        if after != before:
            async with self.run_lock:
                await self.async_apply_state(force=True, reason="edit")
        self._notify()
        self._refresh_dependents()

    @callback
    def _refresh_dependents(self) -> None:
        """Agendas that use this one's calendar as a condition read it again now.

        An edit seldom changes the calendar's state, so their state listener stays silent.
        """
        calendar = self.agenda_entities().get("calendar")
        for other in self.hass.data[DOMAIN]["agendas"].values():
            if other is not self and calendar in other.condition_calendars():
                self.hass.async_create_background_task(
                    other.async_refresh_calendars(), f"{DOMAIN} {other.name} calendars"
                )

    async def async_validate_event(self, event: dict[str, Any]) -> None:
        try:
            recurrence.validate_event(event)
        except (ValueError, KeyError) as err:
            raise HomeAssistantError(str(err)) from err
        if not devices.accepts(self.kind, event.get("state")):
            raise HomeAssistantError(f"state {event.get('state')} does not fit an agenda of kind {self.kind}")
        for key in ("start_actions", "end_actions"):
            if event.get(key):
                await async_validate_actions_config(self.hass, cv.SCRIPT_SCHEMA(copy.deepcopy(event[key])))

    async def async_save_event(self, event: dict[str, Any]) -> dict[str, Any]:
        await self.async_validate_event(event)
        before, _ = self.desired()
        if event.get("id"):
            index = self.events.index(self.event(event["id"]))
            self.events[index] = event
        else:
            event["id"] = uuid.uuid4().hex[:12]
            self.events.append(event)
        await self._async_changed(before)
        return event

    async def async_delete_event(self, event_id: str) -> None:
        before, _ = self.desired()
        self.events.remove(self.event(event_id))
        await self._async_changed(before)

    async def async_detach(self, event_id: str, day: str, replacement: dict[str, Any] | None) -> dict[str, Any] | None:
        """Exclude one occurrence from its series, optionally replacing it with a one-off event."""
        series = self.event(event_id)
        date.fromisoformat(day)
        if replacement is not None:
            replacement = dict(replacement, id=uuid.uuid4().hex[:12])
            replacement["repeat"] = {"freq": recurrence.FREQ_NONE}
            await self.async_validate_event(replacement)
        before, _ = self.desired()
        repeat = series.setdefault("repeat", {})
        excluded = set(repeat.get("exclude") or [])
        excluded.add(day)
        repeat["exclude"] = sorted(excluded)
        repeat["include"] = [d for d in repeat.get("include") or [] if d != day]
        if replacement is not None:
            self.events.append(replacement)
        await self._async_changed(before)
        return replacement

    async def async_save_settings(self, settings: dict[str, Any], name: str | None, apply: bool = True) -> None:
        """Update settings. With apply=False, newly linked entities keep their state
        until the next transition."""
        kind = settings.get("kind", self.kind)
        entities = settings.get("entities", self.linked)
        wrong = [e for e in entities if devices.kind_of(e) != kind]
        if wrong:
            raise HomeAssistantError(f"{', '.join(wrong)} cannot be controlled as {kind}")
        before, _ = self.desired()
        old_entities = self.linked
        if kind != self.kind:
            # drop states that do not fit the new kind
            for event in self.events:
                if not devices.accepts(kind, event.get("state")):
                    event["state"] = None
            if not devices.accepts(kind, settings.get("default_state", self.settings.get("default_state"))):
                settings["default_state"] = None
        self.settings.update(settings)
        if name and name != self.entry.title:
            self.hass.config_entries.async_update_entry(self.entry, title=name)
        for key, off in (("presence_jitter", 0), ("all_day_header", False)):
            # off is not stored either
            if key in settings and settings[key] == off:
                del settings[key]
                self.settings.pop(key, None)
        if settings.get("manual_hold") == MANUAL_NEXT_CHANGE:
            # the default is not stored: older versions refuse unknown settings
            del settings["manual_hold"]
            self.settings.pop("manual_hold", None)
        if settings.get("manual_hold") in (MANUAL_NEVER, MANUAL_UNDO) and self.control.holds:
            self.control.holds.clear()
            self._save_runtime()
            self._schedule_holds()
        for key, unset in (("preheat", False), ("preheat_max_minutes", PREHEAT_LIMIT), ("temperature_sensor", None)):
            # nor is this, and it only means something on thermostats
            if kind != devices.KIND_CLIMATE or self.settings.get(key, unset) == unset:
                settings.pop(key, None)
                self.settings.pop(key, None)
        if self.linked != old_entities:
            self.control.track()
            before = {"force": True}  # newly linked entities must get the state
        self.preheater.sync()
        if not apply:
            before, _ = self.desired()
            self.control.assume(before)
        await self._async_changed(before)

    async def async_copy_from(self, source: Agenda) -> None:
        """Take the events and settings of another agenda, except its colour and its
        devices: two agendas on one device would fight over it."""
        self.settings = {**copy.deepcopy(source.settings), "color": self.settings["color"], "entities": []}
        # the sensor of a room, as much as its thermostat
        self.settings.pop("temperature_sensor", None)
        self.events = copy.deepcopy(source.events)
        await self.async_save()

    async def async_set_enabled(self, enabled: bool) -> None:
        if not enabled:
            # the one command of a suspended agenda: an early setpoint must not stay
            async with self.run_lock:
                if self.preheater.cancel():
                    await self.async_apply_state(reason=REASON_PREHEAT_CANCEL)
        self.enabled = enabled
        await self.async_save()
        if enabled:
            async with self.run_lock:
                await self.async_apply_state(force=True, reason="enabled")
        self.preheater.evaluate()
        self._notify()

    async def async_resync(self, take_back: bool = False) -> None:
        """Re-apply the wanted state. At startup and from the resync action, devices set by
        hand are left alone; from the panel's button (take_back), they are taken back too."""
        async with self.run_lock:
            await self.async_apply_state(force=True, reason="apply" if take_back else "resync")
        self._notify()

    def condition_entities(self) -> set[str]:
        return {cond["entity_id"] for event in self.events for cond in event.get("conditions") or []}

    def source_entities(self) -> set[str]:
        """The entities a setpoint or a value follows."""
        states = [event.get("state") for event in self.events]
        states += [self.settings.get("default_state"), self.settings.get("away_state")]
        return {state["source"] for state in states if state and state.get("source")}

    @callback
    def _track_conditions(self) -> None:
        """Follow the condition entities and the sources: both change what is wanted, and a
        source left without a state keeps its last value for a while, as a condition does."""
        self._untrack_conditions()
        entities = self.condition_entities() | self.source_entities()
        self._known = {e: known for e, known in self._known.items() if e in entities}
        for entity_id in entities:
            self._remember(entity_id, self.hass.states.get(entity_id))
        self._schedule_wait()
        if entities:
            self._unsub_conditions = async_track_state_change_event(
                self.hass, sorted(entities), self._on_condition_change
            )

    @callback
    def _untrack_conditions(self) -> None:
        if self._unsub_conditions:
            self._unsub_conditions()
            self._unsub_conditions = None
        if self._condition_pending:
            self._condition_pending()
            self._condition_pending = None
        if self._unsub_wait:
            self._unsub_wait()
            self._unsub_wait = None

    def _remember(self, entity_id: str, state: State | None) -> None:
        if state is not None and state.state not in NO_STATE:
            self._known[entity_id] = (state.state, None)
        elif (known := self._known.get(entity_id)) and known[1] is None:
            self._known[entity_id] = (known[0], dt_util.utcnow())

    @callback
    def _schedule_wait(self) -> None:
        """Decide again when a condition entity has been without a state for too long."""
        if self._unsub_wait:
            self._unsub_wait()
            self._unsub_wait = None
        ends = [since + CONDITION_WAIT for _, since in self._known.values() if since is not None]
        if ends:
            self._unsub_wait = async_track_point_in_time(self.hass, self._on_wait_end, min(ends))

    @callback
    def _on_wait_end(self, _now: datetime) -> None:
        self._unsub_wait = None
        now = dt_util.utcnow()
        self._known = {
            e: (state, since)
            for e, (state, since) in self._known.items()
            if since is None or now - since < CONDITION_WAIT
        }
        self._schedule_wait()
        self.hass.async_create_background_task(self._async_reapply(), f"{DOMAIN} {self.name} condition")

    @callback
    def _on_condition_change(self, event: Event) -> None:
        self._remember(event.data["entity_id"], event.data.get("new_state"))
        self._changed.add(event.data["entity_id"])
        self._schedule_wait()
        if self._condition_pending:
            self._condition_pending()
        self._condition_pending = async_call_later(self.hass, CONDITION_DELAY_S, self._on_condition_settled)

    @callback
    def _on_condition_settled(self, _now: datetime) -> None:
        self._condition_pending = None
        # only sources moved: the devices get a new value, not a new state of the schedule
        reason = "condition" if self._changed & self.condition_entities() else REASON_SOURCE
        self._changed = set()
        self.hass.async_create_background_task(self._async_reapply(reason), f"{DOMAIN} {self.name} condition")

    async def _async_reapply(self, reason: str = "condition") -> None:
        self.preheater.evaluate()
        async with self.run_lock:
            await self.async_apply_state(reason=reason)
        self._notify()

    async def async_absence_changed(self) -> None:
        """The absence mode started or ended: reschedule and apply the state."""
        self._last = dt_util.utcnow()
        self._schedule()
        async with self.run_lock:
            await self.async_apply_state(force=True, reason="absence")
        self._notify()

    def _named(self, name: str | None) -> list[dict[str, Any]]:
        """Events with this name (case insensitive), or all events without a name."""
        if not name:
            return list(self.events)
        found = [event for event in self.events if (event.get("name") or "").strip().lower() == name.strip().lower()]
        if not found:
            raise HomeAssistantError(f"no event named '{name}' in agenda {self.name}")
        return found

    async def async_skip_next(self, name: str | None = None) -> str | None:
        """Remove the next occurrence to start (of the named event); returns its day."""
        now = dt_util.utcnow()
        ids = {event["id"] for event in self._named(name)}
        upcoming = [
            occ for occ in self.occurrences(now, now + timedelta(days=400)) if occ.event_id in ids and occ.start > now
        ]
        if not upcoming:
            return None
        first = min(upcoming, key=lambda occ: occ.start)
        await self.async_detach(first.event_id, first.day.isoformat(), None)
        return first.day.isoformat()

    async def async_change_dates(self, name: str, days: list[date], add: bool) -> None:
        """Add occurrences on these days, or remove them (for automations)."""
        before, _ = self.desired()
        for event in self._named(name):
            repeat = event.setdefault("repeat", {})
            include, exclude = set(repeat.get("include") or []), set(repeat.get("exclude") or [])
            for day in days:
                iso = day.isoformat()
                (include if add else exclude).add(iso)
                (exclude if add else include).discard(iso)
            repeat["include"], repeat["exclude"] = sorted(include), sorted(exclude)
        await self._async_changed(before)

    async def async_context_changed(self) -> None:
        """Reschedule after the shared settings changed."""
        before, _ = self.desired()
        if self.condition_keys() != set(self._calendar_days):
            self._track_calendars(refresh=False)
        await self.async_refresh_calendars(apply=False)
        self._schedule()
        after, _ = self.desired()
        if after != before:
            async with self.run_lock:
                await self.async_apply_state(force=True, reason="settings")
        self._notify()

    @callback
    def preheat_changed(self, save: bool = True) -> None:
        if save:
            self._save_runtime()
        self._notify()

    def reset_learning(self, entity_id: str | None = None) -> None:
        if entity_id is not None and entity_id not in self.linked:
            raise HomeAssistantError(f"{entity_id} is not linked to agenda {self.name}")
        self.preheater.reset(entity_id)

    @callback
    def _notify(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_UPDATED, self.entry_id)

    def agenda_entities(self) -> dict[str, str]:
        """{"calendar": …, "enabled": …, "current": …, "next_change": …}"""
        registry = er.async_get(self.hass)
        prefix = f"{self.entry_id}_"
        return {
            entry.unique_id.removeprefix(prefix): entry.entity_id
            for entry in er.async_entries_for_config_entry(registry, self.entry_id)
        }

    def next_label(self) -> str | None:
        """Label of what comes next: the state, or the event names."""
        nxt = self.next_change
        if nxt is None:
            return None
        if self.linked:
            state, _ = self.desired(nxt)
            return self.state_label(state)
        active = self.active(nxt)
        return ", ".join(self.label(self.event(o.event_id)) for o in active) or "—"

    def as_dict(self) -> dict[str, Any]:
        now = dt_util.utcnow()
        state, occ = self.desired(now)
        return {
            "entry_id": self.entry_id,
            "name": self.name,
            "enabled": self.enabled,
            "settings": self.settings,
            "events": self.events,
            "next_change": wall(self.next_change, self.tz) if self.next_change else None,
            "next_label": self.next_label(),
            "next_state": self.desired(self.next_change)[0] if self.next_change else None,
            "state": state,
            "state_event": occ.event_id if occ else None,
            "absent": self.absent(now),
            "agenda_entities": self.agenda_entities(),
            "override": (
                {**self.override, "until": wall(self.override["until"], self.tz)}
                if self.override and self.override["until"] > now
                else None
            ),
            # devices changed by hand and left alone: until when, None until resumed
            "holds": {
                entity_id: wall(until, self.tz) if until else None
                for entity_id, until in self.control.holds.items()
                if self.control.held(entity_id, now)
            },
            "preheat": self.preheater.as_dict(),
        }

    def _occ_dict(self, occ: recurrence.Occurrence) -> dict[str, Any]:
        return {
            "event_id": occ.event_id,
            "day": occ.day.isoformat(),
            "start": wall(occ.start, self.tz),
            "end": wall(occ.end, self.tz),
            "all_day": occ.all_day,
        }

    async def async_occurrences_dict(
        self, start: datetime, end: datetime
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Occurrences over [start, end), and those a calendar condition removes, for the panel.

        "busy" names the condition calendars with something on the day: the week marks them.
        Occurrences whose entity conditions do not hold now are put aside as well, as the
        schedule does: several events at the same time, one per mode, show only the one in charge.
        So are those of an event turned off, which the week would lose otherwise.
        """
        ctx = await self.async_context_for(start, end)

        def entry(occ: recurrence.Occurrence, **extra: Any) -> dict[str, Any]:
            busy = recurrence.busy_calendars(self.event(occ.event_id), occ.day, ctx)
            return {**self._occ_dict(occ), **extra, **({"busy": busy} if busy else {})}

        skipped = [
            entry(occ, reason=reason)
            for event in self.events
            for occ, reason in recurrence.skipped(event, self.tz, start, end, ctx)
        ]
        skipped += [
            entry(occ, reason=TURNED_OFF)
            for event in self.events
            if not event.get("enabled", True)
            for occ in recurrence.occurrences({**event, "enabled": True}, self.tz, start, end, ctx)
        ]
        holds = {event["id"]: self.conditions_hold(event) for event in self.events}
        found = []
        for occ in self.occurrences(start, end, ctx):
            if holds[occ.event_id]:
                found.append(entry(occ))
            else:
                skipped.append(entry(occ, reason=CONDITIONS_UNMET))
        return found, skipped
