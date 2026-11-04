"""Stored data of older versions, brought up to date. Pure Python."""

from __future__ import annotations

import re
from typing import Any

from .devices import KIND_CLIMATE, KIND_NONE

# colours end up in style attributes
COLOR = re.compile(r"#[0-9a-fA-F]{6}\Z")


def _is_color(value: Any) -> bool:
    return isinstance(value, str) and COLOR.match(value) is not None


def upgrade_repeat(repeat: Any) -> Any:
    """Storage 1.3: repeat.calendar (one entity or null) -> repeat.calendars (a list)."""
    if not isinstance(repeat, dict) or "calendar" not in repeat:
        return repeat
    repeat = dict(repeat)
    calendar = repeat.pop("calendar")
    repeat.setdefault("calendars", [calendar] if calendar else [])
    return repeat


def migrate(data: dict[str, Any]) -> dict[str, Any]:
    """Bring stored data up to date; already migrated data is left unchanged.

    1.1 -> 1.2, thermostat-only fields become generic ones:
    settings.climates -> settings.entities (+ settings.kind)
    settings.default_setpoint -> settings.default_state
    event.setpoint -> event.state

    1.2 -> 1.3, several condition calendars per event: see upgrade_repeat.

    A colour other than #rrggbb is dropped; the agenda then keeps its palette colour.
    """
    settings = dict(data.get("settings") or {})
    if "climates" in settings:
        climates = settings.pop("climates") or []
        settings.setdefault("entities", climates)
        settings.setdefault("kind", KIND_CLIMATE if climates else KIND_NONE)
    if "default_setpoint" in settings:
        settings.setdefault("default_state", settings.pop("default_setpoint"))
    if "color" in settings and not _is_color(settings["color"]):
        del settings["color"]
    events = []
    for event in data.get("events") or []:
        event = dict(event)
        if "setpoint" in event:
            event.setdefault("state", event.pop("setpoint"))
        if "repeat" in event:
            event["repeat"] = upgrade_repeat(event["repeat"])
        for key in ("color", "text_color"):
            if event.get(key) is not None and not _is_color(event[key]):
                event[key] = None
        events.append(event)
    return {**data, "settings": settings, "events": events}
