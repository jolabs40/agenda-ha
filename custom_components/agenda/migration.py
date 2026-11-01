"""Stored data of older versions, brought up to date. Pure Python."""

from __future__ import annotations

from typing import Any

from .devices import KIND_CLIMATE, KIND_NONE


def migrate(data: dict[str, Any]) -> dict[str, Any]:
    """Storage 1.1 -> 1.2: thermostat-only fields become generic ones.

    settings.climates -> settings.entities (+ settings.kind)
    settings.default_setpoint -> settings.default_state
    event.setpoint -> event.state
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
        events.append(event)
    return {**data, "settings": settings, "events": events}
