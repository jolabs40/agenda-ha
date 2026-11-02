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
