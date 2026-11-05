"""Logbook entries for the states Agenda gives its devices, and for those they did not take.

The applied event is fired before the command, with the command's context: the logbook
then also names the agenda as the cause of the device's own changes. Filtered on a device,
the logbook of Home Assistant keeps only the events of that device's integration: the
lines below show in the full logbook, the cause on the device's changes everywhere.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback

from .const import DOMAIN, EVENT_APPLIED, EVENT_FAILED

TEXTS: dict[str, dict[str, Any]] = {
    "en": {
        "applied": "set by agenda {agenda}: {label}",
        "failed": "did not take the state of agenda {agenda}: {label}",
        "reasons": {
            "retry": "second try",
            "available": "back online",
            "undo": "change by hand undone",
            "manual_end": "end of the change by hand",
        },
    },
    "fr": {
        "applied": "réglé par l'agenda {agenda} : {label}",
        "failed": "n'a pas pris l'état de l'agenda {agenda} : {label}",
        "reasons": {
            "retry": "second essai",
            "available": "de retour",
            "undo": "réglage à la main défait",
            "manual_end": "fin du réglage à la main",
        },
    },
    "de": {
        "applied": "von der Agenda {agenda} eingestellt: {label}",
        "failed": "hat den Zustand der Agenda {agenda} nicht übernommen: {label}",
        "reasons": {
            "retry": "zweiter Versuch",
            "available": "wieder erreichbar",
            "undo": "Änderung von Hand rückgängig gemacht",
            "manual_end": "Ende der Änderung von Hand",
        },
    },
    "nl": {
        "applied": "ingesteld door agenda {agenda}: {label}",
        "failed": "heeft de toestand van agenda {agenda} niet overgenomen: {label}",
        "reasons": {
            "retry": "tweede poging",
            "available": "weer bereikbaar",
            "undo": "wijziging met de hand ongedaan gemaakt",
            "manual_end": "einde van de wijziging met de hand",
        },
    },
}


@callback
def async_describe_events(
    hass: HomeAssistant,
    async_describe_event: Callable[[str, str, Callable[[Event], dict[str, str]]], None],
) -> None:
    def texts() -> dict[str, Any]:
        return TEXTS.get((hass.config.language or "en")[:2], TEXTS["en"])

    def describe(event: Event, key: str) -> dict[str, str]:
        data = event.data
        entity_id = data.get("entity_id")
        state = hass.states.get(entity_id) if entity_id else None
        words = texts()
        label = data.get("label") or ""
        message = words[key].format(agenda=data.get("agenda", ""), label=label)
        # an event without a name is called by its state, already given
        event = (data.get("event") or {}).get("name")
        extra = [text for text in (event, words["reasons"].get(data.get("reason"))) if text and text != label]
        if extra:
            message += f" ({', '.join(extra)})"
        return {"name": state.name if state else (entity_id or DOMAIN), "message": message, "entity_id": entity_id}

    async_describe_event(DOMAIN, EVENT_APPLIED, lambda event: describe(event, "applied"))
    async_describe_event(DOMAIN, EVENT_FAILED, lambda event: describe(event, "failed"))
