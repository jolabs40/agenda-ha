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
from homeassistant.util import dt as dt_util

from .const import DOMAIN, EVENT_APPLIED, EVENT_FAILED, REASON_PREHEAT

TEXTS: dict[str, dict[str, Any]] = {
    "en": {
        "applied": "set by agenda {agenda}: {label}",
        "failed": "did not take the state of agenda {agenda}: {label}",
        "preheat": "preheating by agenda {agenda}: {label} for {target} (started {start})",
        "reasons": {
            "preheat_cancel": "preheating cancelled",
            "retry": "second try",
            "available": "back online",
            "undo": "change by hand undone",
            "manual_end": "end of the change by hand",
            "source": "new value of {source}",
        },
    },
    "fr": {
        "applied": "réglé par l'agenda {agenda} : {label}",
        "failed": "n'a pas pris l'état de l'agenda {agenda} : {label}",
        "preheat": "préchauffage par l'agenda {agenda} : {label} pour {target} (début {start})",
        "reasons": {
            "preheat_cancel": "préchauffage annulé",
            "retry": "second essai",
            "available": "de retour",
            "undo": "réglage à la main défait",
            "manual_end": "fin du réglage à la main",
            "source": "nouvelle valeur de {source}",
        },
    },
    "de": {
        "applied": "von der Agenda {agenda} eingestellt: {label}",
        "failed": "hat den Zustand der Agenda {agenda} nicht übernommen: {label}",
        "preheat": "Vorheizen durch Agenda {agenda}: {label} für {target} (Beginn {start})",
        "reasons": {
            "preheat_cancel": "Vorheizen abgebrochen",
            "retry": "zweiter Versuch",
            "available": "wieder erreichbar",
            "undo": "Änderung von Hand rückgängig gemacht",
            "manual_end": "Ende der Änderung von Hand",
            "source": "neuer Wert von {source}",
        },
    },
    "nl": {
        "applied": "ingesteld door agenda {agenda}: {label}",
        "failed": "heeft de toestand van agenda {agenda} niet overgenomen: {label}",
        "preheat": "voorverwarmen door agenda {agenda}: {label} voor {target} (begin {start})",
        "reasons": {
            "preheat_cancel": "voorverwarmen geannuleerd",
            "retry": "tweede poging",
            "available": "weer bereikbaar",
            "undo": "wijziging met de hand ongedaan gemaakt",
            "manual_end": "einde van de wijziging met de hand",
            "source": "nieuwe waarde van {source}",
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

    def clock(text: str) -> str:
        return dt_util.as_local(dt_util.parse_datetime(text)).strftime("%H:%M")

    def describe(event: Event, key: str) -> dict[str, str]:
        data = event.data
        entity_id = data.get("entity_id")
        state = hass.states.get(entity_id) if entity_id else None
        words = texts()
        label = data.get("label") or ""
        agenda = data.get("agenda", "")
        if data.get("reason") == REASON_PREHEAT and key == "applied":
            target, start = clock(data["target_time"]), clock(data["preheat_start"])
            message = words["preheat"].format(agenda=agenda, label=label, target=target, start=start)
        else:
            message = words[key].format(agenda=agenda, label=label)
            # an event without a name is called by its state, already given
            event = (data.get("event") or {}).get("name")
            source = (data.get("state") or {}).get("source")
            followed = hass.states.get(source) if source else None
            why = (
                words["reasons"].get(data.get("reason"), "").format(source=followed.name if followed else source or "")
            )
            extra = [text for text in (event, why) if text and text != label]
            if extra:
                message += f" ({', '.join(extra)})"
        return {"name": state.name if state else (entity_id or DOMAIN), "message": message, "entity_id": entity_id}

    async_describe_event(DOMAIN, EVENT_APPLIED, lambda event: describe(event, "applied"))
    async_describe_event(DOMAIN, EVENT_FAILED, lambda event: describe(event, "failed"))
