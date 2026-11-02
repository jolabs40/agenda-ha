"""Recurrence engine, free of Home Assistant imports.

Times are stored as naive local times ("2026-11-02T21:30") so that a 21:30 event
stays at 21:30 across DST changes. The time zone is applied only when
occurrences are placed on the timeline.

Event shape (missing fields take their default value):

    {
      "id": "a1b2c3",
      "enabled": true,
      "all_day": false,
      "start": "2026-11-02T21:30",   # or "2026-11-02" for an all-day event
      "end":   "2026-11-03T08:30",   # exclusive; the next day for an all-day event
      "repeat": {
        "freq": "none" | "daily" | "weekly" | "monthly",
        "interval": 1,                # every N days / weeks / months
        "weekdays": [0, 1, 2, 3, 4],  # Monday = 0 (weekly repetition)
        "until": "2027-06-30",        # last possible start day, inclusive
        "exclude": ["2026-11-11"],    # days without an occurrence
        "include": ["2026-12-24"],    # days added on top of the rule
        "holidays": "ignore" | "exclude" | "only",
        "calendars": ["calendar.trips"],  # condition calendars, none by default
        "calendar_mode": "exclude" | "only",
        "calendar_match": "any" | "all",  # busy in one of them, or in all of them
        "period": "always" | "school" | "vacation",  # against the shared school calendar
        "monthly": "day" | "weekday" | "last_weekday",  # 12th / 2nd Monday / last Monday
        "weeks": "all" | "even" | "odd"   # ISO week numbers
      },
      "start_sun": {"event": "sunrise" | "sunset", "offset": -30} | null,
      "end_sun": {...} | null,        # replace the time of day of start / end
      "state": {...} | null           # what linked entities should be (see devices.py)
    }

Public holidays, calendar days and sun times are passed in through a `Context`.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Set
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta, tzinfo
from typing import Any

FREQ_NONE = "none"
FREQ_DAILY = "daily"
FREQ_WEEKLY = "weekly"
FREQ_MONTHLY = "monthly"
FREQS = (FREQ_NONE, FREQ_DAILY, FREQ_WEEKLY, FREQ_MONTHLY)

HOLIDAYS_IGNORE = "ignore"
HOLIDAYS_EXCLUDE = "exclude"
HOLIDAYS_ONLY = "only"
HOLIDAYS_MODES = (HOLIDAYS_IGNORE, HOLIDAYS_EXCLUDE, HOLIDAYS_ONLY)

CALENDAR_EXCLUDE = "exclude"
CALENDAR_ONLY = "only"
CALENDAR_MODES = (CALENDAR_EXCLUDE, CALENDAR_ONLY)
CALENDAR_ANY = "any"
CALENDAR_ALL = "all"
CALENDAR_MATCHES = (CALENDAR_ANY, CALENDAR_ALL)

PERIOD_ALWAYS = "always"
PERIOD_SCHOOL = "school"
PERIOD_VACATION = "vacation"
PERIODS = (PERIOD_ALWAYS, PERIOD_SCHOOL, PERIOD_VACATION)

MONTHLY_DAY = "day"
MONTHLY_WEEKDAY = "weekday"
MONTHLY_LAST_WEEKDAY = "last_weekday"
MONTHLY_MODES = (MONTHLY_DAY, MONTHLY_WEEKDAY, MONTHLY_LAST_WEEKDAY)

WEEKS_ALL = "all"
WEEKS_EVEN = "even"
WEEKS_ODD = "odd"
WEEKS_MODES = (WEEKS_ALL, WEEKS_EVEN, WEEKS_ODD)

SUNRISE = "sunrise"
SUNSET = "sunset"
SUN_EVENTS = (SUNRISE, SUNSET)
MAX_SUN_OFFSET = 720  # minutes

ONE_DAY = timedelta(days=1)


def _no_holiday(_day: date) -> bool:
    return False


def _no_sun(_day: date, _event: str) -> datetime | None:
    return None


@dataclass(frozen=True)
class Context:
    """External facts the engine depends on."""

    is_holiday: Callable[[date], bool] = _no_holiday
    # local days on which a calendar has at least one event, by entity id
    calendar_days: Mapping[str, Set[date]] = field(default_factory=dict)
    # school holiday days, or None when no school calendar is set
    vacation_days: Set[date] | None = None
    # naive local time of sunrise or sunset on a day; None keeps the stored time
    sun: Callable[[date, str], datetime | None] = _no_sun


NO_CONTEXT = Context()


@dataclass(frozen=True)
class Occurrence:
    """One occurrence of an event, placed on the timeline."""

    event_id: str
    day: date  # the day it starts: excluding this day removes it
    start: datetime  # UTC: Python ignores offsets when two datetimes share a tzinfo
    end: datetime  # exclusive
    all_day: bool

    @property
    def duration(self) -> timedelta:
        return self.end - self.start


def parse_point(value: str) -> datetime:
    """Parse "2026-11-02" or "2026-11-02T21:30[:00]" into a naive datetime."""
    value = value.strip()
    if len(value) == 10:
        return datetime.combine(date.fromisoformat(value), datetime.min.time())
    point = datetime.fromisoformat(value)
    if point.tzinfo is not None:
        raise ValueError(f"local time expected, without offset: {value}")
    return point


def bounds(event: dict[str, Any]) -> tuple[datetime, timedelta]:
    """Naive start and wall-clock duration of the event."""
    start = parse_point(event["start"])
    end = parse_point(event["end"])
    if end <= start:
        raise ValueError("the end must come after the start")
    return start, end - start


def validate_event(event: dict[str, Any]) -> None:
    """Raise ValueError if the event is inconsistent."""
    start, _ = bounds(event)
    if event.get("all_day") and (len(event["start"].strip()) != 10 or len(event["end"].strip()) != 10):
        raise ValueError("an all-day event is described by dates only")
    repeat = event.get("repeat") or {}
    freq = repeat.get("freq", FREQ_NONE)
    if freq not in FREQS:
        raise ValueError(f"unknown repetition: {freq}")
    if int(repeat.get("interval", 1)) < 1:
        raise ValueError("the interval must be at least 1")
    for day in repeat.get("weekdays") or []:
        if not 0 <= int(day) <= 6:
            raise ValueError(f"invalid weekday: {day}")
    if repeat.get("holidays", HOLIDAYS_IGNORE) not in HOLIDAYS_MODES:
        raise ValueError("unknown public holiday setting")
    if repeat.get("calendars"):
        if repeat.get("calendar_mode", CALENDAR_EXCLUDE) not in CALENDAR_MODES:
            raise ValueError("unknown calendar condition")
        if repeat.get("calendar_match", CALENDAR_ANY) not in CALENDAR_MATCHES:
            raise ValueError("unknown calendar match")
    if repeat.get("period", PERIOD_ALWAYS) not in PERIODS:
        raise ValueError("unknown period")
    if repeat.get("monthly", MONTHLY_DAY) not in MONTHLY_MODES:
        raise ValueError("unknown monthly repetition")
    if repeat.get("weeks", WEEKS_ALL) not in WEEKS_MODES:
        raise ValueError("unknown week restriction")
    for key in ("start_sun", "end_sun"):
        anchor = event.get(key)
        if not anchor:
            continue
        if event.get("all_day"):
            raise ValueError("an all-day event cannot follow the sun")
        if anchor.get("event") not in SUN_EVENTS:
            raise ValueError(f"unknown sun event: {anchor.get('event')}")
        if abs(int(anchor.get("offset", 0))) > MAX_SUN_OFFSET:
            raise ValueError("the sun offset is limited to 12 hours")
    for key in ("exclude", "include"):
        for day in repeat.get(key) or []:
            date.fromisoformat(day)
    if repeat.get("until") and date.fromisoformat(repeat["until"]) < start.date():
        raise ValueError("the repetition ends before it starts")


def _monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _same_day_of_month(day: date, first: date, mode: str) -> bool:
    """Monthly match: same date, same rank of weekday (2nd Monday), or last weekday."""
    if mode == MONTHLY_WEEKDAY:
        return day.weekday() == first.weekday() and (day.day - 1) // 7 == (first.day - 1) // 7
    if mode == MONTHLY_LAST_WEEKDAY:
        return day.weekday() == first.weekday() and (day + timedelta(days=7)).month != day.month
    return day.day == first.day


def wall_bounds(event: dict[str, Any], day: date, ctx: Context = NO_CONTEXT) -> tuple[datetime, datetime] | None:
    """Naive local start and end of the occurrence starting on `day`.

    Sun anchors replace the time of day; when they bring the end before the start
    (sunset after the fixed end in summer) there is no occurrence that day.
    """
    first, duration = bounds(event)
    last = first + duration
    span = (last.date() - first.date()).days
    start = datetime.combine(day, first.time())
    end = datetime.combine(day + timedelta(days=span), last.time())
    for key, which in (("start_sun", "start"), ("end_sun", "end")):
        anchor = event.get(key)
        if not anchor:
            continue
        on = day if which == "start" else day + timedelta(days=span)
        sun = ctx.sun(on, anchor["event"])
        if sun is None:
            continue
        point = sun + timedelta(minutes=int(anchor.get("offset", 0)))
        if which == "start":
            start = point
        else:
            end = point
    if end <= start:
        return None
    return start, end


def starts_on(event: dict[str, Any], day: date, ctx: Context = NO_CONTEXT) -> bool:
    """Whether an occurrence of the event starts on this day."""
    repeat = event.get("repeat") or {}
    first = parse_point(event["start"]).date()
    iso = day.isoformat()

    if iso in (repeat.get("exclude") or ()):
        return False
    # explicitly added days bypass the rule and its conditions
    if iso in (repeat.get("include") or ()):
        return True
    if day < first:
        return False
    until = repeat.get("until")
    if until and iso > until:
        return False

    freq = repeat.get("freq", FREQ_NONE)
    interval = max(1, int(repeat.get("interval", 1)))
    if freq == FREQ_NONE:
        # holiday and calendar conditions only apply to repeating events
        return day == first
    if freq == FREQ_DAILY:
        match = (day - first).days % interval == 0
    elif freq == FREQ_WEEKLY:
        weekdays = repeat.get("weekdays") or [first.weekday()]
        weeks = (_monday(day) - _monday(first)).days // 7
        match = day.weekday() in weekdays and weeks % interval == 0
    elif freq == FREQ_MONTHLY:
        months = (day.year - first.year) * 12 + day.month - first.month
        match = months % interval == 0 and _same_day_of_month(day, first, repeat.get("monthly", MONTHLY_DAY))
    else:
        return False
    if not match:
        return False

    weeks = repeat.get("weeks", WEEKS_ALL)
    if weeks != WEEKS_ALL and (day.isocalendar().week % 2 == 0) != (weeks == WEEKS_EVEN):
        return False

    holidays = repeat.get("holidays", HOLIDAYS_IGNORE)
    if holidays == HOLIDAYS_EXCLUDE and ctx.is_holiday(day):
        return False
    if holidays == HOLIDAYS_ONLY and not ctx.is_holiday(day):
        return False

    calendars = repeat.get("calendars")
    if calendars:
        busy = [day in ctx.calendar_days.get(calendar, ()) for calendar in calendars]
        hit = all(busy) if repeat.get("calendar_match", CALENDAR_ANY) == CALENDAR_ALL else any(busy)
        if hit != (repeat.get("calendar_mode", CALENDAR_EXCLUDE) == CALENDAR_ONLY):
            return False

    period = repeat.get("period", PERIOD_ALWAYS)
    if period != PERIOD_ALWAYS:
        # without a school calendar no day is known as a school holiday
        vacation = ctx.vacation_days is not None and day in ctx.vacation_days
        if vacation != (period == PERIOD_VACATION):
            return False
    return True


def occurrences(
    event: dict[str, Any],
    tz: tzinfo,
    start: datetime,
    end: datetime,
    ctx: Context = NO_CONTEXT,
) -> list[Occurrence]:
    """Occurrences of the event overlapping [start, end) (aware bounds)."""
    if not event.get("enabled", True):
        return []
    _, duration = bounds(event)
    local_start = start.astimezone(tz).replace(tzinfo=None)
    local_end = end.astimezone(tz).replace(tzinfo=None)
    # an occurrence that started the day before (or earlier, if long) may spill over;
    # a sun anchor can make it longer than the stored duration
    margin = 2 * ONE_DAY if event.get("start_sun") or event.get("end_sun") else ONE_DAY
    day = (local_start - duration).date() - margin
    last = local_end.date()
    found: list[Occurrence] = []
    while day <= last:
        if starts_on(event, day, ctx) and (wall := wall_bounds(event, day, ctx)) is not None:
            occ_start = wall[0].replace(tzinfo=tz).astimezone(UTC)
            occ_end = wall[1].replace(tzinfo=tz).astimezone(UTC)
            if occ_end > start and occ_start < end:
                found.append(
                    Occurrence(
                        event_id=event["id"],
                        day=day,
                        start=occ_start,
                        end=occ_end,
                        all_day=bool(event.get("all_day")),
                    )
                )
        day += ONE_DAY
    return found


def all_occurrences(
    events: Iterable[dict[str, Any]],
    tz: tzinfo,
    start: datetime,
    end: datetime,
    ctx: Context = NO_CONTEXT,
) -> list[Occurrence]:
    found: list[Occurrence] = []
    for event in events:
        found.extend(occurrences(event, tz, start, end, ctx))
    found.sort(key=lambda occ: (occ.start, occ.end))
    return found


def next_transition(
    events: list[dict[str, Any]], tz: tzinfo, after: datetime, ctx: Context = NO_CONTEXT
) -> datetime | None:
    """Next occurrence start or end strictly after `after`."""
    for horizon in (2, 14, 62, 400):
        window_end = after + timedelta(days=horizon)
        points = [
            point
            for occ in all_occurrences(events, tz, after, window_end, ctx)
            for point in (occ.start, occ.end)
            if point > after
        ]
        if points:
            return min(points)
    return None


def winner(occs: Iterable[Occurrence]) -> Occurrence | None:
    """The occurrence in charge: the latest start wins, then the shortest."""
    best: Occurrence | None = None
    for occ in occs:
        if best is None or (occ.start, -occ.duration) > (best.start, -best.duration):
            best = occ
    return best


def active_at(events: list[dict[str, Any]], tz: tzinfo, at: datetime, ctx: Context = NO_CONTEXT) -> list[Occurrence]:
    """Occurrences running at `at` (start included, end excluded)."""
    return [occ for occ in all_occurrences(events, tz, at, at + timedelta(seconds=1), ctx) if occ.start <= at < occ.end]


def desired_state(
    events: list[dict[str, Any]],
    tz: tzinfo,
    at: datetime,
    default: dict[str, Any] | None,
    ctx: Context = NO_CONTEXT,
) -> tuple[dict[str, Any] | None, Occurrence | None]:
    """State of the event in charge at `at`, or the default state."""
    by_id = {event["id"]: event for event in events}
    with_state = [occ for occ in active_at(events, tz, at, ctx) if by_id[occ.event_id].get("state")]
    occ = winner(with_state)
    if occ is None:
        return default, None
    return by_id[occ.event_id]["state"], occ


def calendar_days(events: Iterable[tuple[str, str]], tz: tzinfo) -> set[date]:
    """Local days covered by (start, end) pairs from calendar.get_events.

    All-day events come as dates with an exclusive end, others as aware datetimes.
    """
    days: set[date] = set()
    for start, end in events:
        if len(start) == 10:
            first = date.fromisoformat(start)
            stop = date.fromisoformat(end) if len(end) == 10 else first + ONE_DAY
            # some published calendars give one-day events an end equal to their start
            stop = max(stop, first + ONE_DAY)
        else:
            begin = datetime.fromisoformat(start).astimezone(tz)
            finish = datetime.fromisoformat(end).astimezone(tz)
            first = begin.date()
            # an event ending at midnight does not touch the next day
            stop = (finish - timedelta(microseconds=1)).date() + ONE_DAY
            stop = max(stop, first + ONE_DAY)
        day = first
        while day < stop:
            days.add(day)
            day += ONE_DAY
    return days
