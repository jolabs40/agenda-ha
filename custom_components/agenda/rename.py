"""An entity renamed in Home Assistant: its new id wherever an agenda keeps the old one.

Pure Python, without Home Assistant. Each function changes what it is given in place and
tells whether it changed anything.
"""

from __future__ import annotations

from collections.abc import MutableMapping, MutableSet
from typing import Any

from .recurrence import calendar_key, text_of_key


def _swap(items: list[str], old: str, new: str) -> list[str]:
    # the new id may be there already: an entity is kept once
    return list(dict.fromkeys(new if item == old else item for item in items))


def in_keys(mapping: MutableMapping[str, Any], old: str, new: str) -> bool:
    if old not in mapping:
        return False
    value = mapping.pop(old)
    mapping.setdefault(new, value)
    return True


def in_set(items: MutableSet[str], old: str, new: str) -> bool:
    if old not in items:
        return False
    items.discard(old)
    items.add(new)
    return True


def in_calendar_keys(mapping: MutableMapping[str, Any], old: str, new: str) -> bool:
    """Keys from recurrence.calendar_key: a calendar, or a calendar and a text."""
    changed = False
    for key in [key for key in mapping if text_of_key(key)[0] == old]:
        value = mapping.pop(key)
        mapping.setdefault(calendar_key(new, text_of_key(key)[1]), value)
        changed = True
    return changed


def in_state(state: MutableMapping[str, Any] | None, old: str, new: str) -> bool:
    """The entity a setpoint or a value follows."""
    if state and state.get("source") == old:
        state["source"] = new
        return True
    return False


def in_event(event: MutableMapping[str, Any], old: str, new: str) -> bool:
    changed = in_state(event.get("state"), old, new)
    for condition in event.get("conditions") or []:
        if condition.get("entity_id") == old:
            condition["entity_id"] = new
            changed = True
    repeat = event.get("repeat") or {}
    for key in ("calendars", "except_calendars"):
        if old in (repeat.get(key) or []):
            repeat[key] = _swap(repeat[key], old, new)
            changed = True
    if repeat.get("calendar_texts"):
        changed |= in_keys(repeat["calendar_texts"], old, new)
    return changed


def in_settings(settings: MutableMapping[str, Any], old: str, new: str) -> bool:
    changed = False
    if old in (settings.get("entities") or []):
        settings["entities"] = _swap(settings["entities"], old, new)
        changed = True
    if settings.get("temperature_sensor") == old:
        settings["temperature_sensor"] = new
        changed = True
    for key in ("default_state", "away_state"):
        changed |= in_state(settings.get(key), old, new)
    return changed
