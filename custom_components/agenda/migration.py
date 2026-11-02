"""Stored data of older versions, brought up to date. Pure Python."""

from __future__ import annotations

from typing import Any

from .devices import KIND_CLIMATE, KIND_NONE


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
    """
    settings = dict(data.get("settings") or {})
    if "climates" in settings:
        climates = settings.pop("climates") or []
        settings.setdefault("entities", climates)
        settings.setdefault("kind", KIND_CLIMATE if climates else KIND_NONE)
    if "default_setpoint" in settings:
        settings.setdefault("default_state", settings.pop("default_setpoint"))
    events = []
    for event in data.get("events") or []:
        event = dict(event)
        if "setpoint" in event:
            event.setdefault("state", event.pop("setpoint"))
        if "repeat" in event:
            event["repeat"] = upgrade_repeat(event["repeat"])
        events.append(event)
    return {**data, "settings": settings, "events": events}
