"""Constants of the Agenda integration."""

from __future__ import annotations

from datetime import timedelta

from .devices import KIND_NONE

DOMAIN = "agenda"

# .storage/agenda.<entry_id>: one file per agenda
STORAGE_VERSION = 1
STORAGE_MINOR_VERSION = 3  # 1.2 renamed climates/setpoint to entities/state, 1.3 allows several calendars
# .storage/agenda: settings shared by all agendas
SHARED_STORAGE_VERSION = 1

STATIC_URL = "/agenda_static"
PANEL_URL = "agenda"
PANEL_ELEMENT = "agenda-panel"

PLATFORMS = ["calendar", "switch", "sensor"]

# sent with the entry id whenever an agenda changes
SIGNAL_UPDATED = f"{DOMAIN}_updated"

# some thermostat integrations need a while after startup before accepting commands
RESYNC_DELAY_S = 45

# window and refresh period of the condition calendar cache
CALENDAR_PAST = timedelta(days=7)
CALENDAR_FUTURE = timedelta(days=120)
CALENDAR_REFRESH = timedelta(minutes=30)

# in the data of a new entry: the agenda to copy, read once when it is set up
COPY_OF = "copy_of"

# colours given in turn to new agendas
PALETTE = [
    "#ef6c00",
    "#1e88e5",
    "#8e24aa",
    "#43a047",
    "#e53935",
    "#00897b",
    "#6d4c41",
    "#3949ab",
]

DEFAULT_SETTINGS = {
    "color": PALETTE[0],
    "icon": "mdi:calendar-clock",
    "kind": KIND_NONE,
    "entities": [],
    "default_state": None,
    "resync_on_start": True,
    # absence mode: whether this agenda pauses, and the state it keeps meanwhile
    # (None: the default state)
    "follow_absence": True,
    "away_state": None,
}

# a condition entity changing state settles before the agenda reacts
CONDITION_DELAY_S = 2
# a condition entity unavailable or unknown (a sensor slow to come back after a restart)
# keeps its last state for this long
CONDITION_WAIT = timedelta(minutes=10)

# devices without feedback are mostly driven by radio: commands to them go one at a time,
# this far apart, so that they do not collide
RADIO_GAP_S = 1.0

# a device changed by hand, with the setting undo, is put back after this delay; if it is
# changed again too often, it is left alone until the next change
UNDO_DELAY_S = 5
UNDO_MAX = 3
UNDO_WINDOW_S = 600

# a device back after being unavailable settles before it gets its state
AVAILABLE_DELAY_S = 10
# delay before checking that a device shows the state it was sent; a moving cover is
# checked again, this many times at most
CHECK_DELAY_S = 15
CHECK_MOVING_TRIES = 8

# a thermostat may be given its state early, this many minutes at most; what comes is looked
# at again this often
PREHEAT_LIMIT = 180
PREHEAT_LIMIT_MIN = 15
PREHEAT_LIMIT_MAX = 360
PREHEAT_TICK = timedelta(minutes=5)
REASON_PREHEAT = "preheat"
REASON_PREHEAT_CANCEL = "preheat_cancel"
# the entity a setpoint or a value follows changed
REASON_SOURCE = "source"

# fired for each device given a state, before the command so that the logbook names the
# agenda as its cause, and for each device that did not follow it
EVENT_APPLIED = f"{DOMAIN}_state_applied"
EVENT_FAILED = f"{DOMAIN}_state_failed"
