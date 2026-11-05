"""Device kinds an agenda can control, and the service calls to reach a state.

No Home Assistant imports here, so this can be unit tested.

The linked entities of an agenda all belong to the domains of its kind, and
every event state is one of the kind's state types:

    climate   {"type": "temperature", "temperature": 20.5}
              {"type": "preset", "preset": "eco"}
              {"type": "mode", "hvac_mode": "fan_only"}       # no setpoint
              {"type": "off"}
              the first three may also carry hvac_mode, fan_mode, swing_mode
              and swing_horizontal_mode, written only when chosen
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
    KIND_CLIMATE: frozenset({"temperature", "preset", "mode", "off"}),
    KIND_ON_OFF: frozenset({"on", "off"}),
    KIND_COVER: frozenset({"position"}),
    KIND_SELECT: frozenset({"option"}),
    KIND_NUMBER: frozenset({"value"}),
}

# hvac modes tried, in order, to switch back on a thermostat that has no turn_on
ON_HVAC_MODES = ("heat", "heat_cool", "auto", "cool", "dry", "fan_only")

# optional settings of a climate state, and the service setting each one
CLIMATE_SETTINGS = {
    "fan_mode": "set_fan_mode",
    "swing_mode": "set_swing_mode",
    "swing_horizontal_mode": "set_swing_horizontal_mode",
}

# ClimateEntityFeature.TURN_ON: the device goes back to its own last mode
CLIMATE_TURN_ON = 256

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


def _switch_on(
    current: str, attributes: Mapping[str, Any], wanted: Mapping[str, Any], last_mode: str | None
) -> Call | None:
    """The call that puts a thermostat in the right mode, if one is needed.

    Without a chosen mode, a thermostat that is off goes back to its own last mode
    (turn_on), else to the last one Agenda saw, else to the first usual one: an air
    conditioner must not start heating in summer.
    """
    modes = attributes.get("hvac_modes") or []
    mode = wanted.get("hvac_mode")
    if mode:
        return ("climate", "set_hvac_mode", {"hvac_mode": mode}) if current != mode and mode in modes else None
    if current != "off":
        return None
    if int(attributes.get("supported_features") or 0) & CLIMATE_TURN_ON:
        return ("climate", "turn_on", {})
    if last_mode in modes and last_mode != "off":
        return ("climate", "set_hvac_mode", {"hvac_mode": last_mode})
    on_mode = next((m for m in ON_HVAC_MODES if m in modes), None)
    return ("climate", "set_hvac_mode", {"hvac_mode": on_mode}) if on_mode else None


def plan(
    entity_id: str,
    current: str,
    attributes: Mapping[str, Any],
    wanted: Mapping[str, Any],
    last_mode: str | None = None,
) -> list[Call]:
    """Return the (domain, service, data) calls that bring the entity to `wanted`.

    Calls that would not change anything are skipped, except for thermostats:
    their setpoint is always sent so that a new event overrides manual changes.
    `last_mode` is the last mode other than off Agenda saw on a thermostat.
    """
    domain = domain_of(entity_id)
    kind = wanted.get("type")
    calls: list[Call] = []
    if attributes.get("assumed_state") and domain != "climate":
        # without feedback the state shown is only a guess, it may be wrong: always send
        current = "unknown"
        attributes = {k: v for k, v in attributes.items() if k not in ("current_position", "brightness")}

    if domain == "climate":
        if kind == "off":
            if current != "off":
                calls.append(("climate", "set_hvac_mode", {"hvac_mode": "off"}))
        elif kind in ("temperature", "preset", "mode"):
            # the mode by its own call, not through set_temperature: each integration
            # may ignore that field, and Versatile Thermostat does, leaving the thermostat off
            switch = _switch_on(current, attributes, wanted, last_mode)
            if switch:
                calls.append(switch)
            for key, service in CLIMATE_SETTINGS.items():
                value = wanted.get(key)
                if value is not None and attributes.get(key) != value:
                    calls.append(("climate", service, {key: value}))
            if kind == "preset":
                calls.append(("climate", "set_preset_mode", {"preset_mode": wanted["preset"]}))
            elif kind == "temperature":
                calls.append(("climate", "set_temperature", {"temperature": wanted["temperature"]}))

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


def _close(value: Any, target: Any, tolerance: float) -> bool:
    try:
        return abs(float(value) - float(target)) <= tolerance + 1e-6
    except (TypeError, ValueError):
        return False


def unavailable(current: str | None, attributes: Mapping[str, Any]) -> bool:
    """Whether a device cannot be commanded now. A device with an assumed state (a shutter
    driven by radio, without feedback) is unknown until its first command: it takes one."""
    if current is None or current == "unavailable":
        return True
    return current == "unknown" and not attributes.get("assumed_state")


def moving(entity_id: str, current: str) -> bool:
    """A cover on its way: too early to tell whether it got there."""
    return domain_of(entity_id) == "cover" and current in ("opening", "closing")


def reached(entity_id: str, current: str, attributes: Mapping[str, Any], wanted: Mapping[str, Any]) -> bool:
    """Whether the entity shows the wanted state. True when this cannot be told."""
    domain = domain_of(entity_id)
    kind = wanted.get("type")

    if domain == "climate":
        if kind == "off":
            return current == "off"
        if current == "off" or (wanted.get("hvac_mode") and current != wanted["hvac_mode"]):
            return False
        if any(wanted.get(key) is not None and attributes.get(key) != wanted[key] for key in CLIMATE_SETTINGS):
            return False
        if kind == "preset":
            return attributes.get("preset_mode") == wanted["preset"]
        if kind == "temperature":
            if not isinstance(attributes.get("temperature"), (int, float)):
                return True  # a setpoint range: not something Agenda sets
            # the device may round to its own step
            step = attributes.get("target_temp_step") or 0.5
            return _close(attributes["temperature"], wanted["temperature"], step / 2)
        return True

    if domain in KIND_DOMAINS[KIND_ON_OFF]:
        if kind == "off":
            return current == "off"
        if current != "on":
            return False
        brightness = wanted.get("brightness") if domain == "light" else None
        raw = attributes.get("brightness")
        if brightness is None or not isinstance(raw, (int, float)):
            return True
        return _close(raw * 100 / 255, brightness, 2)

    if domain == "cover" and kind == "position":
        position = int(wanted["position"])
        if int(attributes.get("supported_features") or 0) & COVER_SET_POSITION:
            return _close(attributes.get("current_position"), position, 2)
        return current == ("open" if position > 0 else "closed")

    if domain in KIND_DOMAINS[KIND_SELECT] and kind == "option":
        return current == wanted["option"]

    if domain in KIND_DOMAINS[KIND_NUMBER] and kind == "value":
        return _close(current, wanted["value"], (attributes.get("step") or 0) / 2)

    return True


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
    "de": {
        "comfort": "Komfort",
        "eco": "Eco",
        "frost": "Frostschutz",
        "boost": "Boost",
        "away": "Abwesend",
        "activity": "Aktivität",
        "none": "Manuell",
        "off": "Aus",
        "on": "Ein",
        "open": "Offen",
        "closed": "Geschlossen",
    },
    "nl": {
        "comfort": "Comfort",
        "eco": "Eco",
        "frost": "Vorst",
        "boost": "Boost",
        "away": "Afwezig",
        "activity": "Activiteit",
        "none": "Handmatig",
        "off": "Uit",
        "on": "Aan",
        "open": "Open",
        "closed": "Dicht",
    },
}

# hvac modes chosen in an event, apart from preset names that could be the same words
MODE_LABELS = {
    "fr": {
        "heat": "Chauffage",
        "cool": "Clim",
        "heat_cool": "Auto",
        "auto": "Auto",
        "dry": "Déshumidification",
        "fan_only": "Ventilation",
    },
    "en": {
        "heat": "Heat",
        "cool": "Cool",
        "heat_cool": "Auto",
        "auto": "Auto",
        "dry": "Dry",
        "fan_only": "Fan",
    },
    "de": {
        "heat": "Heizen",
        "cool": "Kühlen",
        "heat_cool": "Auto",
        "auto": "Auto",
        "dry": "Entfeuchten",
        "fan_only": "Lüften",
    },
    "nl": {
        "heat": "Verwarmen",
        "cool": "Koelen",
        "heat_cool": "Auto",
        "auto": "Auto",
        "dry": "Drogen",
        "fan_only": "Ventileren",
    },
}

# languages writing decimals with a comma
DECIMAL_COMMA = ("fr", "de", "nl")


def label(state: Mapping[str, Any] | None, language: str, unit: str | None = None) -> str | None:
    """Short text for a state, e.g. "20.5 °C", "Eco", "On 80 %"."""
    if not state:
        return None
    lang = language[:2]
    words = LABELS.get(lang, LABELS["en"])

    def number(value: float) -> str:
        text = f"{value:g}"
        return text.replace(".", ",") if lang in DECIMAL_COMMA else text

    kind = state.get("type")
    mode = state.get("hvac_mode")
    mode = MODE_LABELS.get(lang, MODE_LABELS["en"]).get(mode, mode) if mode else None
    if kind == "temperature":
        text = f"{number(float(state['temperature']))} {unit or '°C'}"
        return f"{mode} {text}" if mode else text
    if kind == "preset":
        text = words.get(state["preset"], state["preset"])
        return f"{mode} {text}" if mode else text
    if kind == "mode":
        return mode
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
