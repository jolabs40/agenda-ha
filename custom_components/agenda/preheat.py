"""Reaching a setpoint on time: what past rises teach, and how early to start.

No Home Assistant imports here, so this can be unit tested. Temperatures are in °C,
rates in °C per hour and delays in minutes: the caller converts.

A rise starts when a device is given a setpoint far enough from the measure, and ends
when the measure gets there. "Rise" also covers a fall, with an air conditioner cooling.
Its first minutes say little, the device is getting going: they give the dead time, and
the rate is counted after them.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from statistics import median
from typing import Any

HEAT = "heat"
COOL = "cool"

# used until MIN_SAMPLES rises are known
DEFAULT_RATES = {HEAT: 1.5, COOL: 2.5}
DEFAULT_DEAD_TIME = 10.0
MIN_SAMPLES = 3

MIN_RATE = 0.1
MAX_RATE = 10.0
# weight of the latest rise in the learned rate
SMOOTHING = 0.3
DEAD_TIMES_KEPT = 9

# a rise needs more than this between the measure and the setpoint
MIN_GAP = 0.5
# and it is over this close to the setpoint
CLOSE_ENOUGH = 0.2
# the start of a rise left out of its rate, in minutes
SETTLING = 10.0
# what the measure must gain to show that the device has got going
FIRST_MOVE = 0.1
# a measure this soon after the setpoint, in minutes, is the device waking up to report
# where it is: the rise starts from it
FRESH = 0.5
# a measure that still goes this far past the setpoint once it is there, in °C, is taken near
# the radiator or the air conditioner rather than in the room: what it teaches is too fast
SUSPECT_OVERSHOOT = 0.8
# how long the measure is watched once the setpoint is reached, in minutes
AFTERWARDS = 60.0
OVERSHOOTS_KEPT = 5
SUSPECT_SAMPLES = 2
# a rise takes a little longer than its rate says
MARGIN = 1.1

# share of the rate lost per °C of extra difference with outdoors, and the most this may
# change it. A first guess, to be replaced by a real model of the room
OUTDOOR_EFFECT = 0.02
OUTDOOR_LIMIT = 0.3

RISING = "rising"
DONE = "done"
ABANDONED = "abandoned"


def _bounded(rate: float) -> float:
    return max(MIN_RATE, min(MAX_RATE, rate))


def _toward(direction: str, value: float) -> float:
    """A difference counted positive in the direction of a rise."""
    return value if direction == HEAT else -value


@dataclass(frozen=True)
class Sample:
    """What one finished rise measured."""

    rate: float
    dead_time: float
    outdoor_gap: float | None = None


@dataclass
class Learned:
    """What past rises of one device, in one direction, teach."""

    rate: float | None = None
    samples: int = 0
    last: str | None = None
    dead_times: list[float] = field(default_factory=list)
    # usual difference between the measure and outdoors when a rise starts
    outdoor_gap: float | None = None
    # how far the measure went past the setpoint after the latest rises
    overshoots: list[float] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Learned:
        return cls(
            rate=data.get("rate"),
            samples=int(data.get("samples") or 0),
            last=data.get("last"),
            dead_times=list(data.get("dead_times") or []),
            outdoor_gap=data.get("outdoor_gap"),
            overshoots=list(data.get("overshoots") or []),
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def known(self) -> bool:
        return self.rate is not None and self.samples >= MIN_SAMPLES

    def add(self, sample: Sample, at: datetime) -> None:
        rate = _bounded(sample.rate)
        self.rate = rate if self.rate is None else SMOOTHING * rate + (1 - SMOOTHING) * self.rate
        self.samples += 1
        self.last = at.isoformat()
        self.dead_times = [*self.dead_times, sample.dead_time][-DEAD_TIMES_KEPT:]
        if sample.outdoor_gap is not None:
            gap = sample.outdoor_gap
            self.outdoor_gap = gap if self.outdoor_gap is None else SMOOTHING * gap + (1 - SMOOTHING) * self.outdoor_gap

    def add_overshoot(self, value: float) -> None:
        self.overshoots = [*self.overshoots, round(value, 2)][-OVERSHOOTS_KEPT:]

    @property
    def overshoot(self) -> float | None:
        """How far the measure usually goes past the setpoint, once there."""
        if len(self.overshoots) < SUSPECT_SAMPLES:
            return None
        return float(median(self.overshoots))

    @property
    def suspect(self) -> bool:
        """Whether the measure is unlikely to be the room's."""
        return (self.overshoot or 0) >= SUSPECT_OVERSHOOT


def direction(mode: str | None, target: float, measure: float) -> str | None:
    """Which way the device has to go, None when it cannot or need not."""
    if target > measure and mode in ("heat", "heat_cool", "auto"):
        return HEAT
    if target < measure and mode in ("cool", "heat_cool", "auto"):
        return COOL
    return None


def is_rise(way: str, current: float, target: float) -> bool:
    """Whether going from one setpoint to another is a rise: a way back to a lower setpoint
    while heating is not one, and is not worth starting early."""
    return _toward(way, target - current) > 0


def corrected_rate(rate: float, usual_gap: float | None, gap: float | None, way: str) -> float:
    """The rate for today's difference with outdoors: a colder day slows heating down."""
    if usual_gap is None or gap is None:
        return rate
    effect = OUTDOOR_EFFECT * _toward(way, gap - usual_gap)
    return _bounded(rate * (1 - max(-OUTDOOR_LIMIT, min(OUTDOOR_LIMIT, effect))))


def expected_rate(learned: Learned | None, way: str, outdoor_gap: float | None = None) -> float:
    if learned is None or not learned.known:
        return DEFAULT_RATES[way]
    return corrected_rate(learned.rate, learned.outdoor_gap, outdoor_gap, way)


def expected_dead_time(learned: Learned | None) -> float:
    if learned is None or not learned.known or not learned.dead_times:
        return DEFAULT_DEAD_TIME
    return float(median(learned.dead_times))


def lead_minutes(way: str, target: float, measure: float, rate: float, dead_time: float, limit: float) -> float:
    """How long before the start the device must be given its setpoint."""
    gap = _toward(way, target - measure)
    if gap <= 0:
        return 0.0
    return min(dead_time + gap / rate * 60 * MARGIN, limit)


@dataclass
class Rise:
    """A rise under way."""

    way: str
    target: float
    started: datetime
    start_temp: float
    outdoor_gap: float | None = None
    moved: tuple[datetime, float] | None = None
    counted: tuple[datetime, float] | None = None

    @classmethod
    def begin(
        cls, way: str, target: float, measure: float, at: datetime, outdoor_gap: float | None = None
    ) -> Rise | None:
        """A rise to follow, None when the setpoint is too close to the measure."""
        if abs(target - measure) <= MIN_GAP:
            return None
        return cls(way, target, at, measure, outdoor_gap)

    def _minutes(self, at: datetime) -> float:
        return (at - self.started).total_seconds() / 60

    def update(self, at: datetime, temp: float, limit: float) -> str:
        """Take a new measure; limit is the longest a rise may last, in minutes."""
        minutes = self._minutes(at)
        if minutes < FRESH:
            self.start_temp = temp
            return RISING if _toward(self.way, self.target - temp) > MIN_GAP else ABANDONED
        gain = _toward(self.way, temp - self.start_temp)
        if minutes > limit or gain <= -MIN_GAP:
            return ABANDONED
        if self.moved is None and gain >= FIRST_MOVE:
            self.moved = (at, temp)
        if self.moved is not None and self.counted is None and minutes >= SETTLING:
            self.counted = (at, temp)
        return DONE if _toward(self.way, self.target - temp) <= CLOSE_ENOUGH else RISING

    def sample(self, at: datetime, temp: float) -> Sample | None:
        """What a rise that got there at `at` measured. A quick device is there before
        the settling time is over: its rate is then counted from its first move."""
        points = [p for p in (self.counted, self.moved, (self.started, self.start_temp)) if p and p[0] < at]
        if not points:
            return None
        since, from_temp = points[0]
        gain = _toward(self.way, temp - from_temp)
        if gain <= 0:
            return None
        hours = (at - since).total_seconds() / 3600
        dead_time = self._minutes(self.moved[0] if self.moved else at)
        return Sample(gain / hours, dead_time, self.outdoor_gap)


@dataclass
class Overshoot:
    """The measure once a rise got there. In the room, it stays near the setpoint; on a
    radiator valve, it keeps going for half an hour once the valve is closed."""

    way: str
    target: float
    reached: datetime
    peak: float = 0.0

    def over(self, at: datetime) -> bool:
        return (at - self.reached).total_seconds() / 60 > AFTERWARDS

    def update(self, at: datetime, temp: float) -> bool:
        """Take a new measure; whether the watch is over."""
        if self.over(at):
            return True
        self.peak = max(self.peak, _toward(self.way, temp - self.target))
        return False

    def result(self, cut_short: bool = False) -> float | None:
        """How far the measure went past the setpoint. A watch cut short by a new setpoint
        only tells of a measure that already went far."""
        if cut_short and self.peak < SUSPECT_OVERSHOOT:
            return None
        return self.peak
