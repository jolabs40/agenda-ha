"""Runtime of a single agenda: storage, timer and execution.

At each transition the end actions run first, then the linked entities get the
wanted state, then the start actions run. Handling ends before starts keeps the
end of one event from undoing the next one when they are back to back.

An event with conditions takes charge (state and start actions) only while they
hold; its end actions always run. During the absence mode an agenda that follows
it keeps its away state and runs no action.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import copy
from datetime import date, datetime, time, timedelta
import logging
from typing import Any
import uuid

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import STATE_UNAVAILABLE, STATE_UNKNOWN
from homeassistant.core import Context, Event, HomeAssistant, callback
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
    DEFAULT_SETTINGS,
    DOMAIN,
    PALETTE,
    SIGNAL_UPDATED,
    STORAGE_MINOR_VERSION,
    STORAGE_VERSION,
)
from .migration import migrate
from .shared import Shared

_LOGGER = logging.getLogger(__name__)

SERVICE_TIMEOUT_S = 30


def wall(point: datetime, tz) -> str:
    """Format as naive local time, e.g. 2026-11-02T21:30."""
    return point.astimezone(tz).strftime("%Y-%m-%dT%H:%M")


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
        self.settings: dict[str, Any] = dict(DEFAULT_SETTINGS)
        self.settings["color"] = PALETTE[index % len(PALETTE)]
        self.enabled = True
        self.events: list[dict[str, Any]] = []
        self.next_change: datetime | None = None
        self._last = dt_util.utcnow()
        self._unsub_timer: Callable[[], None] | None = None
        self._applied: dict[str, Any] | None = None
        self._run_lock = asyncio.Lock()
        # condition calendars: busy local days, and the span they were read for
        self._calendar_days: dict[str, set[date]] = {}
        self._calendar_span: tuple[date, date] | None = None
        self._calendars_ready = False
        self._unsub_calendars: list[Callable[[], None]] = []
        self._refresh_pending: Callable[[], None] | None = None
        self._unsub_conditions: Callable[[], None] | None = None
        self._condition_pending: Callable[[], None] | None = None
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
        for entity_id in self.linked:
            state = self.hass.states.get(entity_id)
            if state and state.attributes.get("unit_of_measurement"):
                return state.attributes["unit_of_measurement"]
        return None

    def state_label(self, state: dict[str, Any] | None) -> str | None:
        return devices.label(state, self.hass.config.language, self.unit())

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

    async def async_save(self) -> None:
        await self._store.async_save({"settings": self.settings, "enabled": self.enabled, "events": self.events})

    async def async_remove_storage(self) -> None:
        await self._store.async_remove()

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
        )

    def occurrences(
        self, start: datetime, end: datetime, ctx: recurrence.Context | None = None
    ) -> list[recurrence.Occurrence]:
        return recurrence.all_occurrences(self.events, self.tz, start, end, ctx or self.context())

    def active(self, at: datetime | None = None) -> list[recurrence.Occurrence]:
        return recurrence.active_at(self.events, self.tz, at or dt_util.utcnow(), self.context())

    def conditions_hold(self, event: dict[str, Any]) -> bool:
        """Whether the event's entity conditions hold now (all of them)."""
        for cond in event.get("conditions") or []:
            state = self.hass.states.get(cond["entity_id"])
            matches = state is not None and state.state == str(cond.get("state", ""))
            if matches == bool(cond.get("not")):
                return False
        return True

    def absent(self, at: datetime | None = None) -> bool:
        return bool(self.settings.get("follow_absence", True)) and self.shared.absent_at(at or dt_util.utcnow())

    def desired(self, at: datetime | None = None) -> tuple[dict[str, Any] | None, recurrence.Occurrence | None]:
        at = at or dt_util.utcnow()
        default = self.settings.get("default_state")
        if self.absent(at):
            return self.settings.get("away_state") or default, None
        # conditions are read now: a future state assumes they keep their value
        events = [event for event in self.events if self.conditions_hold(event)]
        return recurrence.desired_state(events, self.tz, at, default, self.context())

    @callback
    def async_start(self) -> None:
        self._last = dt_util.utcnow()
        self._schedule()
        self._track_calendars()
        self._track_conditions()
        self._unsub_absence = self.shared.async_on_absence_change(self.async_absence_changed)

    @callback
    def async_stop(self) -> None:
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self._untrack_calendars()
        self._untrack_conditions()
        if self._unsub_absence:
            self._unsub_absence()
            self._unsub_absence = None

    @callback
    def _schedule(self) -> None:
        if self._unsub_timer:
            self._unsub_timer()
            self._unsub_timer = None
        self.next_change = recurrence.next_transition(self.events, self.tz, self._last, self.context())
        if self.next_change is not None:
            self._unsub_timer = async_track_point_in_time(self.hass, self._on_timer, self.next_change)
        until = self.shared.absence_until()
        if self.absent() and until is not None and (self.next_change is None or until < self.next_change):
            # what the panel shows; the shared settings end the absence themselves
            self.next_change = until

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
        occs = self.occurrences(since, until + timedelta(seconds=1))
        ended = sorted((o for o in occs if since < o.end <= until), key=lambda o: o.end)
        started = sorted(
            (o for o in occs if since < o.start <= until and self.conditions_hold(self.event(o.event_id))),
            key=lambda o: o.start,
        )
        self._notify()
        if not self.enabled or self.absent() or not (ended or started):
            return
        async with self._run_lock:
            for occ in ended:
                await self._async_run_actions(occ, "end")
            if self.linked:
                # resend the state when an event starts, to override manual changes
                force = any(self.event(o.event_id).get("state") for o in started)
                await self.async_apply_state(force=force)
            for occ in started:
                await self._async_run_actions(occ, "start")

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

    async def async_apply_state(self, force: bool = False) -> None:
        """Apply the current wanted state to the linked entities."""
        if not self.linked or not self.enabled:
            return
        wanted, _ = self.desired()
        if wanted is None or (not force and wanted == self._applied):
            return
        if not devices.accepts(self.kind, wanted):
            _LOGGER.warning("Agenda %s: state %s does not fit kind %s", self.name, wanted, self.kind)
            return
        self._applied = copy.deepcopy(wanted)
        for entity_id in self.linked:
            await self._async_apply_to(entity_id, wanted)

    async def _async_apply_to(self, entity_id: str, wanted: dict[str, Any]) -> None:
        state = self.hass.states.get(entity_id)
        if state is None or state.state in (STATE_UNAVAILABLE, STATE_UNKNOWN):
            _LOGGER.warning("Agenda %s: %s is not available", self.name, entity_id)
            return
        for domain, service, data in devices.plan(entity_id, state.state, state.attributes, wanted):
            try:
                async with asyncio.timeout(SERVICE_TIMEOUT_S):
                    await self.hass.services.async_call(
                        domain, service, {"entity_id": entity_id, **data}, blocking=True
                    )
                _LOGGER.debug("Agenda %s: %s.%s %s %s", self.name, domain, service, entity_id, data)
            except (HomeAssistantError, TimeoutError, ValueError) as err:
                _LOGGER.error("Agenda %s: %s refused %s.%s %s: %s", self.name, entity_id, domain, service, data, err)
                return

    def condition_calendars(self) -> set[str]:
        calendars = {
            calendar
            for event in self.events
            for key in ("calendars", "except_calendars")
            for calendar in (event.get("repeat") or {}).get(key) or ()
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

    async def _async_calendar_days(
        self, calendars: set[str], start: date, end: date
    ) -> tuple[dict[str, set[date]], bool]:
        """Busy days per calendar over [start, end), and whether all could be read.

        A calendar entity may not exist yet during startup.
        """
        tz = self.tz
        start_dt = datetime.combine(start, time.min, tz)
        end_dt = datetime.combine(end, time.min, tz)
        found: dict[str, set[date]] = {}
        complete = True
        for entity_id in sorted(calendars):
            if self.hass.states.get(entity_id) is None:
                found[entity_id] = self._calendar_days.get(entity_id, set())
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
                found[entity_id] = self._calendar_days.get(entity_id, set())
                complete = False
                continue
            events = ((response or {}).get(entity_id) or {}).get("events") or []
            found[entity_id] = recurrence.calendar_days(((str(e["start"]), str(e["end"])) for e in events), tz)
        return found, complete

    async def async_refresh_calendars(self, apply: bool = True) -> None:
        calendars = self.condition_calendars()
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
            async with self._run_lock:
                await self.async_apply_state(force=True)
        self._notify()

    async def async_context_for(self, start: datetime, end: datetime) -> recurrence.Context:
        """Context for [start, end), reading calendars outside the cached span."""
        calendars = self.condition_calendars()
        span = self._calendar_span
        first, last = start.astimezone(self.tz).date(), end.astimezone(self.tz).date()
        if not calendars or (span and span[0] <= first and last <= span[1]):
            return self.context()
        extra, _ = await self._async_calendar_days(calendars, first - timedelta(days=1), last + timedelta(days=1))
        return self.context(extra)

    async def _async_changed(self, before: dict[str, Any] | None) -> None:
        """Persist, reschedule, and apply the state if the change affects it."""
        await self.async_save()
        if self.condition_calendars() != set(self._calendar_days):
            # a new condition calendar must be read before deciding anything
            self._track_calendars(refresh=False)
            await self.async_refresh_calendars(apply=False)
        self._track_conditions()
        self._last = dt_util.utcnow()
        self._schedule()
        after, _ = self.desired()
        if after != before:
            async with self._run_lock:
                await self.async_apply_state(force=True)
        self._notify()

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
        if self.linked != old_entities:
            before = {"force": True}  # newly linked entities must get the state
        if not apply:
            self._applied, _ = self.desired()
            before, _ = self.desired()
        await self._async_changed(before)

    async def async_set_enabled(self, enabled: bool) -> None:
        self.enabled = enabled
        await self.async_save()
        if enabled:
            async with self._run_lock:
                await self.async_apply_state(force=True)
        self._notify()

    async def async_resync(self) -> None:
        """Re-apply the wanted state (startup, resync action)."""
        async with self._run_lock:
            await self.async_apply_state(force=True)
        self._notify()

    def condition_entities(self) -> set[str]:
        return {cond["entity_id"] for event in self.events for cond in event.get("conditions") or []}

    @callback
    def _track_conditions(self) -> None:
        self._untrack_conditions()
        entities = self.condition_entities()
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

    @callback
    def _on_condition_change(self, _event: Event) -> None:
        if self._condition_pending:
            self._condition_pending()
        self._condition_pending = async_call_later(self.hass, CONDITION_DELAY_S, self._on_condition_settled)

    @callback
    def _on_condition_settled(self, _now: datetime) -> None:
        self._condition_pending = None
        self.hass.async_create_background_task(self._async_reapply(), f"{DOMAIN} {self.name} condition")

    async def _async_reapply(self) -> None:
        async with self._run_lock:
            await self.async_apply_state()
        self._notify()

    async def async_absence_changed(self) -> None:
        """The absence mode started or ended: reschedule and apply the state."""
        self._last = dt_util.utcnow()
        self._schedule()
        async with self._run_lock:
            await self.async_apply_state(force=True)
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
        if self.condition_calendars() != set(self._calendar_days):
            self._track_calendars(refresh=False)
        await self.async_refresh_calendars(apply=False)
        self._schedule()
        after, _ = self.desired()
        if after != before:
            async with self._run_lock:
                await self.async_apply_state(force=True)
        self._notify()

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
        }

    async def async_occurrences_dict(self, start: datetime, end: datetime) -> list[dict[str, Any]]:
        ctx = await self.async_context_for(start, end)
        return [
            {
                "event_id": occ.event_id,
                "day": occ.day.isoformat(),
                "start": wall(occ.start, self.tz),
                "end": wall(occ.end, self.tz),
                "all_day": occ.all_day,
            }
            for occ in self.occurrences(start, end, ctx)
        ]
