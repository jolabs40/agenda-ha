"""Commands to the devices of an agenda.

Every command carries a context of Agenda's own, so that a change made by someone
else can be told apart: the agenda then leaves that device alone for a while (a
hold). A device unavailable when its state is due gets it when it comes back. A
device that does not show its state a while after the command gets it once more; if
it still does not, a repair issue and an event tell the user. A device without feedback
(assumed state) gets its command once, unchecked, and such commands go one at a time
across all agendas, since they mostly travel by radio.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Callable, Coroutine
import copy
from datetime import datetime
import logging
from typing import TYPE_CHECKING, Any

import voluptuous as vol

from homeassistant.core import Context, Event, HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.event import async_call_later, async_track_state_change_event
from homeassistant.util import dt as dt_util

from . import devices
from .const import (
    AVAILABLE_DELAY_S,
    CHECK_DELAY_S,
    CHECK_MOVING_TRIES,
    DOMAIN,
    EVENT_APPLIED,
    EVENT_FAILED,
    RADIO_GAP_S,
    UNDO_DELAY_S,
    UNDO_MAX,
    UNDO_WINDOW_S,
)

if TYPE_CHECKING:
    from .manager import Agenda
    from .recurrence import Occurrence

_LOGGER = logging.getLogger(__name__)

SERVICE_TIMEOUT_S = 30
OWN_CONTEXTS = 64


def _issue_id(entry_id: str, entity_id: str) -> str:
    return f"not_applied_{entry_id}_{entity_id}"


class RadioGate:
    """Shared by all agendas: two radio commands sent at once can collide, and a device
    without feedback never tells that it missed one."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.last = 0.0


def _radio(hass: HomeAssistant) -> RadioGate:
    return hass.data[DOMAIN].setdefault("radio", RadioGate())


@callback
def async_remove_issues(hass: HomeAssistant, entry_id: str) -> None:
    """Drop the repair issues of a deleted agenda."""
    prefix = _issue_id(entry_id, "")
    for domain, issue_id in list(ir.async_get(hass).issues):
        if domain == DOMAIN and issue_id.startswith(prefix):
            ir.async_delete_issue(hass, DOMAIN, issue_id)


class Control:
    """Sends the agenda's state to its devices and keeps an eye on them."""

    def __init__(self, agenda: Agenda) -> None:
        self.agenda = agenda
        self.hass = agenda.hass
        # state last sent to each device
        self.applied: dict[str, dict[str, Any]] = {}
        # devices that were unavailable when their state was due
        self.waiting: set[str] = set()
        # last mode other than off seen on each thermostat
        self.last_mode: dict[str, str] = {}
        # devices someone else moved away from their state since the last command
        self.touched: set[str] = set()
        # devices changed by hand, left alone until then (None: until the schedule is resumed)
        self.holds: dict[str, datetime | None] = {}
        self._own: deque[str] = deque(maxlen=OWN_CONTEXTS)
        # when each device changed by hand was last put back (setting undo)
        self._undone: dict[str, list[float]] = {}
        self._timers: dict[str, Callable[[], None]] = {}
        self._unsub: Callable[[], None] | None = None

    def own(self, context: Context | None) -> bool:
        """Whether a state change comes from one of Agenda's commands."""
        return context is not None and (context.id in self._own or context.parent_id in self._own)

    def held(self, entity_id: str, at: datetime | None = None) -> bool:
        """Whether a device changed by hand is still left alone."""
        if entity_id not in self.holds:
            return False
        until = self.holds[entity_id]
        return until is None or until > (at or dt_util.utcnow())

    @callback
    def track(self) -> None:
        """Follow the linked devices; forget those no longer linked."""
        self.stop()
        linked = set(self.agenda.linked)
        for entity_id in set(self.applied) | self.waiting | self.touched:
            if entity_id not in linked:
                self.applied.pop(entity_id, None)
                ir.async_delete_issue(self.hass, DOMAIN, _issue_id(self.agenda.entry_id, entity_id))
        self.waiting &= linked
        self.touched &= linked
        self.holds = {e: until for e, until in self.holds.items() if e in linked}
        self._undone = {e: times for e, times in self._undone.items() if e in linked}
        for entity_id in linked:
            state = self.hass.states.get(entity_id)
            if state is not None:
                self._remember_mode(entity_id, state)
        if linked:
            self._unsub = async_track_state_change_event(self.hass, sorted(linked), self._on_change)

    @callback
    def stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        for cancel in self._timers.values():
            cancel()
        self._timers.clear()

    @callback
    def assume(self, wanted: dict[str, Any] | None) -> None:
        """Take the devices as already in this state, without sending anything."""
        for entity_id in self.agenda.linked:
            if wanted is None:
                self.applied.pop(entity_id, None)
            else:
                self.applied[entity_id] = copy.deepcopy(wanted)

    def _remember_mode(self, entity_id: str, state: State) -> None:
        if devices.domain_of(entity_id) == "climate" and state.state not in ("off", "unknown", "unavailable"):
            self.last_mode[entity_id] = state.state

    @callback
    def _on_change(self, event: Event) -> None:
        entity_id = event.data["entity_id"]
        old: State | None = event.data.get("old_state")
        new: State | None = event.data.get("new_state")
        if new is None:
            return
        self._remember_mode(entity_id, new)
        if devices.unavailable(new.state, new.attributes):
            return
        if entity_id in self.waiting and (old is None or devices.unavailable(old.state, old.attributes)):
            self._later(entity_id, AVAILABLE_DELAY_S, self._async_back)
            return
        wanted = self.applied.get(entity_id)
        if (
            wanted is not None
            and old is not None
            and not self.own(new.context)
            and devices.reached(entity_id, old.state, old.attributes, wanted)
            and not devices.reached(entity_id, new.state, new.attributes, wanted)
        ):
            self.touched.add(entity_id)
            self.agenda.manual_change(entity_id)
        elif entity_id in self.holds and not self.own(new.context):
            # put back as the agenda wants it now: the agenda takes it back. What it sent
            # last may be older, or unknown after a restart
            now_wanted, _ = self.agenda.desired()
            if now_wanted is not None and devices.reached(entity_id, new.state, new.attributes, now_wanted):
                self.agenda.manual_end(entity_id)

    @callback
    def _later(self, entity_id: str, delay: float, job: Callable[..., Coroutine[Any, Any, None]], *args: Any) -> None:
        """Run job(entity_id, *args) after a delay; one pending job per device."""
        if cancel := self._timers.pop(entity_id, None):
            cancel()

        @callback
        def _run(_now: datetime) -> None:
            self._timers.pop(entity_id, None)
            self.hass.async_create_background_task(job(entity_id, *args), f"{DOMAIN} {self.agenda.name} {entity_id}")

        self._timers[entity_id] = async_call_later(self.hass, delay, _run)

    async def async_apply(
        self,
        entity_id: str,
        wanted: dict[str, Any],
        reason: str,
        occ: Occurrence | None = None,
        attempt: int = 1,
    ) -> None:
        """Send the state to one device. The caller holds the agenda's run lock."""
        agenda = self.agenda
        state = self.hass.states.get(entity_id)
        if state is None or devices.unavailable(state.state, state.attributes):
            if entity_id not in self.waiting:
                _LOGGER.warning(
                    "Agenda %s: %s is not available, it will get its state when it is back", agenda.name, entity_id
                )
            self.waiting.add(entity_id)
            if cancel := self._timers.pop(entity_id, None):
                cancel()
            return
        self.waiting.discard(entity_id)
        self.touched.discard(entity_id)
        context = Context()
        self._own.append(context.id)
        calls = devices.plan(entity_id, state.state, state.attributes, wanted, self.last_mode.get(entity_id))
        assumed = bool(state.attributes.get("assumed_state"))
        if calls:
            event = agenda.event(occ.event_id) if occ else None
            data = {
                **self._event_data(entity_id, wanted),
                "reason": reason,
                "event": {"id": event["id"], "name": agenda.label(event)} if event else None,
            }
            if assumed:
                gate = _radio(self.hass)
                async with gate.lock:
                    wait = gate.last + RADIO_GAP_S - self.hass.loop.time()
                    if wait > 0:
                        await asyncio.sleep(wait)
                    self.hass.bus.async_fire(EVENT_APPLIED, data, context=context)
                    await self._async_send(entity_id, calls, context)
                    gate.last = self.hass.loop.time()
            else:
                # fired first, the event is the origin of the context: the logbook then shows the
                # agenda as the cause of the device's changes
                self.hass.bus.async_fire(EVENT_APPLIED, data, context=context)
                await self._async_send(entity_id, calls, context)
        self.applied[entity_id] = copy.deepcopy(wanted)
        if assumed:
            # no feedback: its state is only Home Assistant's guess, so there is nothing to check,
            # and sending again could move a single-button shutter the other way
            if cancel := self._timers.pop(entity_id, None):
                cancel()
            ir.async_delete_issue(self.hass, DOMAIN, _issue_id(agenda.entry_id, entity_id))
            return
        self._later(entity_id, CHECK_DELAY_S, self._async_check, wanted, attempt, 0)

    async def _async_send(self, entity_id: str, calls: list[tuple[str, str, dict[str, Any]]], context: Context) -> None:
        name = self.agenda.name
        for domain, service, data in calls:
            try:
                async with asyncio.timeout(SERVICE_TIMEOUT_S):
                    await self.hass.services.async_call(
                        domain, service, {"entity_id": entity_id, **data}, blocking=True, context=context
                    )
                _LOGGER.debug("Agenda %s: %s.%s %s %s", name, domain, service, entity_id, data)
            # vol.Invalid: an input_number refuses a value out of its range that way
            except (HomeAssistantError, TimeoutError, ValueError, vol.Invalid) as err:
                _LOGGER.error("Agenda %s: %s refused %s.%s %s: %s", name, entity_id, domain, service, data, err)
                return

    @callback
    def undo(self, entity_id: str) -> bool:
        """Put a device changed by hand back soon; False when it was changed back too often."""
        now = self.hass.loop.time()
        recent = [t for t in self._undone.get(entity_id, []) if now - t < UNDO_WINDOW_S]
        if len(recent) >= UNDO_MAX:
            self._undone.pop(entity_id, None)
            return False
        self._undone[entity_id] = [*recent, now]
        self._later(entity_id, UNDO_DELAY_S, self._async_undo)
        return True

    async def _async_undo(self, entity_id: str) -> None:
        agenda = self.agenda
        async with agenda.run_lock:
            if not agenda.enabled or entity_id not in agenda.linked or self.held(entity_id):
                return
            wanted, occ = agenda.desired()
            state = self.hass.states.get(entity_id)
            if wanted is None or state is None or not devices.accepts(agenda.kind, wanted):
                return
            if devices.reached(entity_id, state.state, state.attributes, wanted):
                return
            _LOGGER.info("Agenda %s: %s changed by hand, put back", agenda.name, entity_id)
            await self.async_apply(entity_id, wanted, "undo", occ)

    def _event_data(self, entity_id: str, wanted: dict[str, Any]) -> dict[str, Any]:
        agenda = self.agenda
        return {
            "agenda": agenda.name,
            "entry_id": agenda.entry_id,
            "entity_id": entity_id,
            "state": copy.deepcopy(wanted),
            "label": agenda.state_label(wanted),
        }

    async def _async_back(self, entity_id: str) -> None:
        """A device is back: it gets the state wanted now, not the one it missed."""
        agenda = self.agenda
        async with agenda.run_lock:
            if entity_id not in self.waiting or entity_id not in agenda.linked:
                return
            wanted, occ = agenda.desired()
            if not agenda.enabled or wanted is None or not devices.accepts(agenda.kind, wanted) or self.held(entity_id):
                self.waiting.discard(entity_id)
                return
            _LOGGER.info("Agenda %s: %s is back", agenda.name, entity_id)
            await self.async_apply(entity_id, wanted, "available", occ)

    async def _async_check(self, entity_id: str, wanted: dict[str, Any], attempt: int, tries: int) -> None:
        agenda = self.agenda
        if (
            not agenda.enabled
            or entity_id not in agenda.linked
            or self.applied.get(entity_id) != wanted
            or entity_id in self.touched
            or entity_id in self.waiting
        ):
            return
        state = self.hass.states.get(entity_id)
        if state is None or devices.unavailable(state.state, state.attributes):
            self.waiting.add(entity_id)
            return
        if devices.reached(entity_id, state.state, state.attributes, wanted):
            ir.async_delete_issue(self.hass, DOMAIN, _issue_id(agenda.entry_id, entity_id))
            return
        if devices.moving(entity_id, state.state) and tries < CHECK_MOVING_TRIES:
            self._later(entity_id, CHECK_DELAY_S, self._async_check, wanted, attempt, tries + 1)
            return
        if attempt == 1:
            _LOGGER.info("Agenda %s: %s does not show %s, sending it again", agenda.name, entity_id, wanted)
            async with agenda.run_lock:
                if self.applied.get(entity_id) == wanted:
                    wanted_now, occ = agenda.desired()
                    if wanted_now == wanted:
                        await self.async_apply(entity_id, wanted, "retry", occ, attempt=2)
            return
        self._report(entity_id, wanted, state)

    def _report(self, entity_id: str, wanted: dict[str, Any], state: State) -> None:
        agenda = self.agenda
        label = agenda.state_label(wanted) or str(wanted)
        name = state.attributes.get("friendly_name") or entity_id
        _LOGGER.warning("Agenda %s: %s still does not show %s after a second try", agenda.name, entity_id, label)
        ir.async_create_issue(
            self.hass,
            DOMAIN,
            _issue_id(agenda.entry_id, entity_id),
            is_fixable=False,
            is_persistent=False,
            severity=ir.IssueSeverity.WARNING,
            translation_key="not_applied",
            translation_placeholders={"agenda": agenda.name, "entity": name, "state": label},
        )
        self.hass.bus.async_fire(EVENT_FAILED, self._event_data(entity_id, wanted))
