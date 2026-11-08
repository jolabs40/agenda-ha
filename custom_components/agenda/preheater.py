"""Giving a thermostat its state early, so that the room is there when the event starts.

Only what depends on Home Assistant lives here: the learning and the sums are in preheat.py.

While a preheat runs, `Agenda.desired` returns the state of the coming event, so every path
that sends or checks a state sees it. Stopping one is a matter of no longer answering: the
next command sends what the agenda wants without it. The event itself is unchanged, its
start actions run at its start.

The coming event is taken as if it started at the launch, and the rule of overlaps stays:
what started before gives way, what starts between the launch and the event keeps the upper
hand until it ends.

Versatile Thermostat shows no attribute that gives a heating rate on the over_climate
thermostats this was tried on: its temperature_slope is the slope of the moment, not of a
rise. Learning starts from the defaults on every device.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta
import logging
from typing import TYPE_CHECKING, Any

from homeassistant.const import UnitOfTemperature
from homeassistant.core import CoreState, Event, State, callback
from homeassistant.helpers.event import (
    async_track_point_in_time,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.util import dt as dt_util
from homeassistant.util.unit_conversion import TemperatureConverter

from . import devices, preheat
from .const import CHECK_DELAY_S, DOMAIN, PREHEAT_LIMIT, PREHEAT_TICK, REASON_PREHEAT, REASON_PREHEAT_CANCEL
from .recurrence import Occurrence, wall

if TYPE_CHECKING:
    from .manager import Agenda

_LOGGER = logging.getLogger(__name__)


@dataclass
class Plan:
    """An early start, computed or launched."""

    occ: Occurrence
    state: dict[str, Any]
    launch: datetime

    @property
    def minutes(self) -> int:
        return round((self.occ.start - self.launch).total_seconds() / 60)

    def as_storage(self) -> dict[str, Any]:
        occ = self.occ
        return {
            "event_id": occ.event_id,
            "day": occ.day.isoformat(),
            "start": occ.start.isoformat(),
            "end": occ.end.isoformat(),
            "all_day": occ.all_day,
            "launch": self.launch.isoformat(),
            "state": self.state,
        }

    @classmethod
    def from_storage(cls, data: dict[str, Any]) -> Plan:
        occ = Occurrence(
            data["event_id"],
            date.fromisoformat(data["day"]),
            dt_util.parse_datetime(data["start"]),
            dt_util.parse_datetime(data["end"]),
            data["all_day"],
        )
        return cls(occ, data["state"], dt_util.parse_datetime(data["launch"]))


class Preheater:
    """Learns how fast the devices of an agenda are, and starts them early."""

    def __init__(self, agenda: Agenda) -> None:
        self.agenda = agenda
        self.hass = agenda.hass
        self.learned: dict[str, dict[str, preheat.Learned]] = {}
        self.plan: Plan | None = None
        self.running: Plan | None = None
        self._rises: dict[str, preheat.Rise] = {}
        self._afters: dict[str, preheat.Overshoot] = {}
        self._measures: dict[str, float] = {}
        self._started = False
        self._unsubs: list[Callable[[], None]] = []
        self._unsub_launch: Callable[[], None] | None = None

    @property
    def enabled(self) -> bool:
        return self.agenda.kind == devices.KIND_CLIMATE and bool(self.agenda.settings.get("preheat"))

    @property
    def limit(self) -> int:
        return int(self.agenda.settings.get("preheat_max_minutes") or PREHEAT_LIMIT)

    @property
    def current(self) -> Plan | None:
        return self.running or self.plan

    def load(self, runtime: dict[str, Any]) -> None:
        self.learned = {
            entity_id: {way: preheat.Learned.from_dict(data) for way, data in ways.items()}
            for entity_id, ways in (runtime.get("learning") or {}).items()
        }
        if running := runtime.get("preheat"):
            plan = Plan.from_storage(running)
            if plan.occ.start > dt_util.utcnow():
                self.running = plan

    def storage(self) -> dict[str, Any]:
        return {
            "learning": {
                entity_id: {way: learned.as_dict() for way, learned in ways.items()}
                for entity_id, ways in self.learned.items()
            },
            "preheat": self.running.as_storage() if self.running else None,
        }

    @callback
    def start(self) -> None:
        self._started = True
        self.sync()

    @callback
    def stop(self) -> None:
        self._started = False
        self._unlisten()

    @callback
    def _unlisten(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        self._cancel_launch()

    @callback
    def _cancel_launch(self) -> None:
        if self._unsub_launch:
            self._unsub_launch()
            self._unsub_launch = None

    @callback
    def sync(self) -> None:
        """Follow the settings; forget the devices no longer linked."""
        if not self._started:
            return
        self._unlisten()
        linked = set(self.agenda.linked)
        self.learned = {e: ways for e, ways in self.learned.items() if e in linked}
        self._rises = {e: rise for e, rise in self._rises.items() if e in linked}
        self._afters = {e: watch for e, watch in self._afters.items() if e in linked}
        self._measures = {}
        if self.enabled:
            self._unsubs.append(async_track_time_interval(self.hass, self._on_tick, PREHEAT_TICK))
            if sensor := self.agenda.settings.get("temperature_sensor"):
                self._unsubs.append(async_track_state_change_event(self.hass, [sensor], self._on_sensor))
        else:
            self._rises = {}
            self._afters = {}
        self.evaluate()

    @callback
    def _on_tick(self, now: datetime) -> None:
        # a measure that no longer moves gives no news: the watch ends on time anyway
        for entity_id in [e for e, watch in self._afters.items() if watch.over(now)]:
            self._close_overshoot(entity_id)
        self.evaluate()

    @callback
    def _on_launch_time(self, _now: datetime) -> None:
        self._unsub_launch = None
        self.evaluate()

    @callback
    def _on_sensor(self, _event: Event) -> None:
        for entity_id in self.agenda.linked:
            self._measure_changed(entity_id)

    @callback
    def device_changed(self, entity_id: str, state: State) -> None:
        """A linked device changed: its measure, or what it shows."""
        if not self.enabled:
            return
        rise = self._rises.get(entity_id)
        if rise is not None and not self._following(entity_id, state, rise.started):
            del self._rises[entity_id]
        watch = self._afters.get(entity_id)
        if watch is not None and not self._following(entity_id, state, watch.reached):
            self._close_overshoot(entity_id, cut_short=True)
        if not self.agenda.settings.get("temperature_sensor"):
            self._measure_changed(entity_id)

    def _following(self, entity_id: str, state: State, since: datetime) -> bool:
        """Whether a device still works towards the setpoint of its rise: it is not, once a
        hand, an open window or a lost connection changed what it shows."""
        if devices.unavailable(state.state, state.attributes):
            return False
        # a device takes a moment to show what it was sent
        if dt_util.utcnow() - since < timedelta(seconds=CHECK_DELAY_S):
            return True
        wanted = self.agenda.control.applied.get(entity_id)
        return wanted is not None and devices.reached(entity_id, state.state, state.attributes, wanted)

    @callback
    def _measure_changed(self, entity_id: str) -> None:
        measure = self._measure(entity_id)
        if measure is None:
            self._rises.pop(entity_id, None)
            self._close_overshoot(entity_id, cut_short=True)
            self._measures.pop(entity_id, None)
            return
        if measure == self._measures.get(entity_id):
            return
        self._measures[entity_id] = measure
        self._follow(entity_id, measure)
        if self.running is None:
            self.evaluate()

    def _follow(self, entity_id: str, measure: float) -> None:
        now = dt_util.utcnow()
        watch = self._afters.get(entity_id)
        if watch is not None and watch.update(now, measure):
            self._close_overshoot(entity_id)
        rise = self._rises.get(entity_id)
        if rise is None:
            return
        status = rise.update(now, measure, 2 * self.limit)
        if status == preheat.RISING:
            return
        del self._rises[entity_id]
        sample = rise.sample(now, measure) if status == preheat.DONE else None
        if sample is None:
            return
        self.learned.setdefault(entity_id, {}).setdefault(rise.way, preheat.Learned()).add(sample, now)
        self._afters[entity_id] = preheat.Overshoot(rise.way, rise.target, now)
        _LOGGER.debug("Agenda %s: %s learned %s", self.agenda.name, entity_id, sample)
        self.agenda.preheat_changed()

    @callback
    def _close_overshoot(self, entity_id: str, cut_short: bool = False) -> None:
        watch = self._afters.pop(entity_id, None)
        if watch is None:
            return
        known = self.learned.get(entity_id, {}).get(watch.way)
        value = watch.result(cut_short)
        if known is None or value is None:
            return
        known.add_overshoot(value)
        _LOGGER.debug("Agenda %s: %s went %.1f past its setpoint", self.agenda.name, entity_id, value)
        self.agenda.preheat_changed()

    @callback
    def applied(self, entity_id: str, wanted: dict[str, Any]) -> None:
        """A device was given a state: a rise starts, or goes on with the same setpoint."""
        if not self.enabled:
            return
        target = self._celsius(wanted["temperature"]) if wanted.get("type") == "temperature" else None
        watch = self._afters.get(entity_id)
        if watch is not None and watch.target != target:
            self._close_overshoot(entity_id, cut_short=True)
        if target is None:
            self._rises.pop(entity_id, None)
            return
        rise = self._rises.get(entity_id)
        if rise is not None and rise.target == target:
            return
        self._rises.pop(entity_id, None)
        measure = self._measure(entity_id)
        if measure is None:
            return
        way = preheat.direction(self._mode(entity_id, wanted), target, measure)
        if way is None:
            return
        if rise := preheat.Rise.begin(way, target, measure, dt_util.utcnow(), self._outdoor_gap(measure)):
            self._rises[entity_id] = rise
            self._measures[entity_id] = measure

    def _read(self, value: Any, unit: str | None) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return self._celsius(number, unit)

    def _celsius(self, value: float, unit: str | None = None) -> float:
        if unit not in TemperatureConverter.VALID_UNITS:
            unit = self.hass.config.units.temperature_unit
        if unit == UnitOfTemperature.CELSIUS:
            return value
        return TemperatureConverter.convert(value, unit, UnitOfTemperature.CELSIUS)

    def _measure(self, entity_id: str) -> float | None:
        """The room's temperature. Without its sensor, nothing is decided on the device's own."""
        if sensor := self.agenda.settings.get("temperature_sensor"):
            state = self.hass.states.get(sensor)
            return self._read(state.state, state.attributes.get("unit_of_measurement")) if state else None
        state = self.hass.states.get(entity_id)
        return self._read(state.attributes.get("current_temperature"), None) if state else None

    def _outdoor_gap(self, measure: float) -> float | None:
        entity_id = self.agenda.shared.outdoor_sensor
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None:
            return None
        if devices.domain_of(entity_id) == "weather":
            outdoor = self._read(state.attributes.get("temperature"), state.attributes.get("temperature_unit"))
        else:
            outdoor = self._read(state.state, state.attributes.get("unit_of_measurement"))
        return None if outdoor is None else measure - outdoor

    def _mode(self, entity_id: str, wanted: dict[str, Any]) -> str | None:
        """The mode the device will run in: the event's, or the one it goes back to."""
        if wanted.get("hvac_mode"):
            return wanted["hvac_mode"]
        state = self.hass.states.get(entity_id)
        if state is None:
            return None
        if state.state not in ("off", "unknown", "unavailable"):
            return state.state
        modes = state.attributes.get("hvac_modes") or []
        last = self.agenda.control.last_mode.get(entity_id)
        if last in modes:
            return last
        if "heat" in modes and "cool" in modes:
            # a reversible device never seen running: the gap decides
            return "heat_cool"
        return next((mode for mode in ("heat", "cool") if mode in modes), None)

    def _lead(self, entity_id: str, wanted: dict[str, Any], current: dict[str, Any] | None) -> float:
        """Minutes ahead for one device, 0 when it has nothing to anticipate."""
        measure = self._measure(entity_id)
        if measure is None:
            return 0.0
        target = self._celsius(wanted["temperature"])
        way = preheat.direction(self._mode(entity_id, wanted), target, measure)
        if way is None:
            return 0.0
        if (
            current
            and current.get("type") == "temperature"
            and not preheat.is_rise(way, self._celsius(current["temperature"]), target)
        ):
            return 0.0
        known = self.learned.get(entity_id, {}).get(way)
        rate = preheat.expected_rate(known, way, self._outdoor_gap(measure))
        return preheat.lead_minutes(way, target, measure, rate, preheat.expected_dead_time(known), self.limit)

    def _coming(self, now: datetime) -> Iterator[tuple[Occurrence, dict[str, Any]]]:
        """The occurrences to come, in order, in charge at their start with a setpoint."""
        agenda = self.agenda
        horizon = now + timedelta(minutes=self.limit) + PREHEAT_TICK
        for occ in sorted((o for o in agenda.occurrences(now, horizon) if o.start > now), key=lambda o: o.start):
            wanted, winner = agenda.desired(occ.start, override=False)
            if winner == occ and wanted.get("type") == "temperature":
                yield occ, wanted

    def _in_between(self, since: datetime, target: Occurrence) -> list[Occurrence]:
        """Events with a state that start between the launch and the coming event."""
        agenda = self.agenda
        found = []
        for occ in agenda.occurrences(since, target.start):
            event = agenda.event(occ.event_id)
            if since < occ.start < target.start and event.get("state") and agenda.conditions_hold(event):
                found.append(occ)
        return found

    def _compute(self, now: datetime) -> Plan | None:
        agenda = self.agenda
        if not self.enabled or not agenda.enabled or agenda.absent(now):
            return None
        current, _ = agenda.desired(now)
        free = [entity_id for entity_id in agenda.linked if not agenda.control.held(entity_id, now)]
        for occ, wanted in self._coming(now):
            # an event that needs nothing does not hide the one after it
            lead = max((self._lead(entity_id, wanted, current) for entity_id in free), default=0.0)
            if lead <= 0:
                continue
            launch = (occ.start - timedelta(minutes=lead)).replace(second=0, microsecond=0)
            waits = [other.end for other in self._in_between(launch, occ)]
            if agenda.override:
                waits.append(agenda.override["until"])
            launch = max([launch, *waits])
            if launch < occ.start:
                return Plan(occ, wanted, launch)
        return None

    def _valid(self, plan: Plan, at: datetime) -> bool:
        """Whether a running preheat still has an event to prepare."""
        agenda = self.agenda
        if not self.enabled or not agenda.enabled or agenda.absent(at):
            return False
        occ = plan.occ
        event = next((e for e in agenda.events if e["id"] == occ.event_id), None)
        if event is None or not devices.same_state(event.get("state"), plan.state) or not agenda.conditions_hold(event):
            return False
        around = timedelta(seconds=1)
        return any(
            o.event_id == occ.event_id and o.start == occ.start
            for o in agenda.occurrences(occ.start - around, occ.start + around)
        )

    def running_at(self, at: datetime) -> tuple[dict[str, Any], Occurrence] | None:
        """The state and occurrence in charge at this time because of a preheat."""
        plan = self.running
        if plan is None or not plan.launch <= at < plan.occ.start or not self._valid(plan, at):
            return None
        if any(occ.start <= at < occ.end for occ in self._in_between(plan.launch, plan.occ)):
            return None
        return plan.state, plan.occ

    def _shown(self) -> tuple[Any, ...] | None:
        plan = self.current
        return (plan.occ, plan.launch, self.running is not None) if plan else None

    @callback
    def evaluate(self) -> None:
        """Decide again what comes next. Runs on every change, and every few minutes."""
        agenda = self.agenda
        # conditions and calendars are not known yet while starting
        if not self._started or self.hass.state is not CoreState.running or not agenda.calendars_ready:
            return
        self._cancel_launch()
        now = dt_util.utcnow()
        before = self._shown()
        if agenda.absent(now) or not agenda.enabled:
            self._rises = {}
        cancelled = False
        run = self.running
        if run is not None and (now >= run.occ.start or not self._valid(run, now)):
            cancelled = now < run.occ.start
            self.running = None
            agenda.preheat_changed()
        self.plan = self._compute(now) if self.running is None else None
        if self.plan is not None:
            if self.plan.launch <= now:
                self._launch(self.plan, now)
            elif self.plan.launch - now <= PREHEAT_TICK:
                self._unsub_launch = async_track_point_in_time(self.hass, self._on_launch_time, self.plan.launch)
        if cancelled:
            self.hass.async_create_background_task(self._async_cancelled(), f"{DOMAIN} {agenda.name} preheat")
        if self._shown() != before:
            agenda.preheat_changed(save=False)

    def _launch(self, plan: Plan, now: datetime) -> None:
        plan.launch = now
        self.running, self.plan = plan, None
        _LOGGER.info("Agenda %s: preheating %d minutes ahead", self.agenda.name, plan.minutes)
        self.agenda.preheat_changed()
        self.hass.async_create_background_task(self._async_launch(plan), f"{DOMAIN} {self.agenda.name} preheat")

    async def _async_launch(self, plan: Plan) -> None:
        agenda = self.agenda
        async with agenda.run_lock:
            if self.running is plan:
                await agenda.async_apply_state(force=True, reason=REASON_PREHEAT)

    async def _async_cancelled(self) -> None:
        agenda = self.agenda
        async with agenda.run_lock:
            await agenda.async_apply_state(reason=REASON_PREHEAT_CANCEL)

    @callback
    def cancel(self) -> bool:
        """Stop what runs; whether something did."""
        if self.running is None:
            return False
        self.running = None
        self.agenda.preheat_changed()
        return True

    def event_data(self, reason: str) -> dict[str, Any]:
        """What the applied event says of a preheat."""
        plan = self.running
        if reason != REASON_PREHEAT or plan is None:
            return {}
        tz = self.agenda.tz
        return {
            "preheat_minutes": plan.minutes,
            "preheat_start": plan.launch.astimezone(tz).isoformat(),
            "target_time": plan.occ.start.astimezone(tz).isoformat(),
        }

    def speeds(self, entity_id: str) -> dict[str, Any]:
        """The rates and delays in use for a device, as learned or by default."""
        ways = self.learned.get(entity_id) or {}
        heat, cool = ways.get(preheat.HEAT), ways.get(preheat.COOL)
        return {
            "heat_rate": round(preheat.expected_rate(heat, preheat.HEAT), 2),
            "cool_rate": round(preheat.expected_rate(cool, preheat.COOL), 2),
            "dead_time": round(preheat.expected_dead_time(heat), 1),
            "cool_dead_time": round(preheat.expected_dead_time(cool), 1),
            "samples": heat.samples if heat else 0,
            "cool_samples": cool.samples if cool else 0,
            "last_sample": max((k.last for k in (heat, cool) if k and k.last), default=None),
            "overshoot": heat.overshoot if heat else None,
            "cool_overshoot": cool.overshoot if cool else None,
            "suspect": any(k.suspect for k in (heat, cool) if k),
        }

    def slowest(self) -> dict[str, Any] | None:
        """The speeds of the slowest linked device, the one the lead depends on."""
        speeds = [self.speeds(entity_id) for entity_id in self.agenda.linked]
        return min(speeds, key=lambda s: s["heat_rate"], default=None)

    @callback
    def reset(self, entity_id: str | None = None) -> None:
        """Forget what was learned, for one device or for all."""
        for known in (self.learned, self._rises, self._afters):
            if entity_id is None:
                known.clear()
            else:
                known.pop(entity_id, None)
        self.agenda.preheat_changed()
        self.evaluate()

    def as_dict(self) -> dict[str, Any] | None:
        agenda = self.agenda
        if agenda.kind != devices.KIND_CLIMATE:
            return None
        plan = self.current
        tz = agenda.tz
        return {
            "enabled": self.enabled,
            "next": {
                "event_id": plan.occ.event_id,
                "day": plan.occ.day.isoformat(),
                "start": wall(plan.launch, tz),
                "target": wall(plan.occ.start, tz),
                "minutes": plan.minutes,
                "running": self.running is not None,
            }
            if plan
            else None,
            "speeds": {entity_id: self.speeds(entity_id) for entity_id in agenda.linked},
        }
