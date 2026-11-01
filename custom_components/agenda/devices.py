"""Device kinds an agenda can control, and the service calls to reach a state.

No Home Assistant imports here, so this can be unit tested.

The linked entities of an agenda all belong to the domains of its kind, and
every event state is one of the kind's state types:

    climate   {"type": "temperature", "temperature": 20.5}
              {"type": "preset", "preset": "eco"}
              {"type": "off"}
    on_off    {"type": "on", "brightness": 80 | None}   # brightness: lights only, %
              {"type": "off"}
    cover     {"type": "position", "position": 0..100}  # 0 closed, 100 open
    select    {"type": "option", "option": "Eco"}
    number    {"type": "value", "value": 12.5}
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

KIND_NONE = "none"
KIND_CLIMATE = "climate"
KIND_ON_OFF = "on_off"
KIND_COVER = "cover"
KIND_SELECT = "select"
KIND_NUMBER = "number"

KIND_DOMAINS: dict[str, tuple[str, ...]] = {
    KIND_NONE: (),
    KIND_CLIMATE: ("climate",),
    KIND_ON_OFF: ("switch", "light", "input_boolean", "fan"),
    KIND_COVER: ("cover",),
    KIND_SELECT: ("select", "input_select"),
    KIND_NUMBER: ("number", "input_number"),
}
KINDS = tuple(KIND_DOMAINS)

KIND_STATE_TYPES: dict[str, frozenset[str]] = {
    KIND_NONE: frozenset(),
    KIND_CLIMATE: frozenset({"temperature", "preset", "off"}),
    KIND_ON_OFF: frozenset({"on", "off"}),
    KIND_COVER: frozenset({"position"}),
    KIND_SELECT: frozenset({"option"}),
    KIND_NUMBER: frozenset({"value"}),
}

# hvac modes tried, in order, to switch a thermostat back on
ON_HVAC_MODES = ("heat", "heat_cool", "auto", "cool", "dry", "fan_only")

# CoverEntityFeature.SET_POSITION
COVER_SET_POSITION = 4

Call = tuple[str, str, dict[str, Any]]


def domain_of(entity_id: str) -> str:
    return entity_id.split(".", 1)[0]


def kind_of(entity_id: str) -> str | None:
    domain = domain_of(entity_id)
    for kind, domains in KIND_DOMAINS.items():
        if domain in domains:
            return kind
    return None


def accepts(kind: str, state: Mapping[str, Any] | None) -> bool:
    """Whether a state fits an agenda of this kind. None always fits."""
    return state is None or state.get("type") in KIND_STATE_TYPES.get(kind, ())


def plan(entity_id: str, current: str, attributes: Mapping[str, Any], wanted: Mapping[str, Any]) -> list[Call]:
    """Return the (domain, service, data) calls that bring the entity to `wanted`.

    Calls that would not change anything are skipped, except for thermostats:
    their setpoint is always sent so that a new event overrides manual changes.
    """
    domain = domain_of(entity_id)
    kind = wanted.get("type")
    calls: list[Call] = []

    if domain == "climate":
        modes = attributes.get("hvac_modes") or []
        on_mode = next((m for m in ON_HVAC_MODES if m in modes), None)
        if kind == "off":
            if current != "off":
                calls.append(("climate", "set_hvac_mode", {"hvac_mode": "off"}))
        elif kind == "preset":
            if current == "off" and on_mode:
                calls.append(("climate", "set_hvac_mode", {"hvac_mode": on_mode}))
            calls.append(("climate", "set_preset_mode", {"preset_mode": wanted["preset"]}))
        elif kind == "temperature":
            data: dict[str, Any] = {"temperature": wanted["temperature"]}
            if current == "off" and on_mode:
                data["hvac_mode"] = on_mode
            calls.append(("climate", "set_temperature", data))

    elif domain in KIND_DOMAINS[KIND_ON_OFF]:
        if kind == "off":
            if current != "off":
                calls.append((domain, "turn_off", {}))
        elif kind == "on":
            brightness = wanted.get("brightness") if domain == "light" else None
            if brightness is not None:
                raw = attributes.get("brightness")
                now = round(raw * 100 / 255) if isinstance(raw, (int, float)) else None
                if current != "on" or now != brightness:
                    calls.append((domain, "turn_on", {"brightness_pct": brightness}))
            elif current != "on":
                calls.append((domain, "turn_on", {}))

    elif domain == "cover" and kind == "position":
        position = int(wanted["position"])
        if int(attributes.get("supported_features") or 0) & COVER_SET_POSITION:
            if attributes.get("current_position") != position:
                calls.append(("cover", "set_cover_position", {"position": position}))
        elif position > 0:
            if current not in ("open", "opening"):
                calls.append(("cover", "open_cover", {}))
        elif current not in ("closed", "closing"):
            calls.append(("cover", "close_cover", {}))

    elif domain in KIND_DOMAINS[KIND_SELECT] and kind == "option":
        if current != wanted["option"]:
            calls.append((domain, "select_option", {"option": wanted["option"]}))

    elif domain in KIND_DOMAINS[KIND_NUMBER] and kind == "value":
        try:
            same = float(current) == float(wanted["value"])
        except (TypeError, ValueError):
            same = False
        if not same:
            calls.append((domain, "set_value", {"value": wanted["value"]}))

    return calls


LABELS = {
    "fr": {
        "comfort": "Confort",
        "eco": "Éco",
        "frost": "Hors-gel",
        "boost": "Boost",
        "away": "Absent",
        "activity": "Activité",
        "none": "Manuel",
        "off": "Arrêt",
        "on": "Marche",
        "open": "Ouvert",
        "closed": "Fermé",
    },
    "en": {
        "comfort": "Comfort",
        "eco": "Eco",
        "frost": "Frost",
        "boost": "Boost",
        "away": "Away",
        "activity": "Activity",
        "none": "Manual",
        "off": "Off",
        "on": "On",
        "open": "Open",
        "closed": "Closed",
    },
}


def label(state: Mapping[str, Any] | None, language: str, unit: str | None = None) -> str | None:
    """Short text for a state, e.g. "20.5 °C", "Eco", "On 80 %"."""
    if not state:
        return None
    french = language.startswith("fr")
    words = LABELS["fr" if french else "en"]

    def number(value: float) -> str:
        text = f"{value:g}"
        return text.replace(".", ",") if french else text

    kind = state.get("type")
    if kind == "temperature":
        return f"{number(float(state['temperature']))} °C"
    if kind == "preset":
        return words.get(state["preset"], state["preset"])
    if kind == "off":
        return words["off"]
    if kind == "on":
        brightness = state.get("brightness")
        return words["on"] if brightness is None else f"{words['on']} {brightness} %"
    if kind == "position":
        position = int(state["position"])
        if position >= 100:
            return words["open"]
        if position <= 0:
            return words["closed"]
        return f"{position} %"
    if kind == "option":
        return str(state["option"])
    if kind == "value":
        text = number(float(state["value"]))
        return f"{text} {unit}" if unit else text
    return None
