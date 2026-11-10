"""Diagnostics of an agenda, to attach to a bug report.

Settings, events and runtime state, the devices as they are now, and the last steps of
the commands sent to them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir
from homeassistant.loader import async_get_integration
from homeassistant.util import dt as dt_util

from .const import DOMAIN

if TYPE_CHECKING:
    from .manager import Agenda


def _entities_in(value: Any) -> set[str]:
    """Entities named in conditions, or followed by a state."""
    found: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("entity_id", "source") and isinstance(item, str) and "." in item:
                found.add(item)
            else:
                found |= _entities_in(item)
    elif isinstance(value, list):
        for item in value:
            found |= _entities_in(item)
    return found


def _state(hass: HomeAssistant, entity_id: str) -> dict[str, Any] | None:
    state = hass.states.get(entity_id)
    if state is None:
        return None
    return {
        "state": state.state,
        "attributes": dict(state.attributes),
        "last_changed": state.last_changed.isoformat(),
        "last_updated": state.last_updated.isoformat(),
        "changed_by_user": state.context.user_id is not None,
    }


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    integration = await async_get_integration(hass, DOMAIN)
    data: dict[str, Any] = {"agenda_version": str(integration.version), "home_assistant": HA_VERSION}
    agenda: Agenda | None = hass.data.get(DOMAIN, {}).get("agendas", {}).get(entry.entry_id)
    if agenda is None:
        return {**data, "loaded": False}
    now = dt_util.utcnow()
    wanted, occ = agenda.desired(now)
    control = agenda.control
    prefix = f"not_applied_{entry.entry_id}_"
    issues = [
        issue.to_json()
        for (domain, issue_id), issue in ir.async_get(hass).issues.items()
        if domain == DOMAIN and issue_id.startswith(prefix)
    ]
    others = _entities_in([agenda.events, agenda.settings.get("default_state")]) - set(agenda.linked)
    return {
        **data,
        "now": dt_util.as_local(now).isoformat(),
        "time_zone": str(agenda.tz),
        "agenda": agenda.as_dict(),
        "wanted_now": {"state": wanted, "event_id": occ.event_id if occ else None},
        "runtime": agenda.runtime_data(),
        "control": {
            "applied": control.applied,
            "waiting": sorted(control.waiting),
            "touched": sorted(control.touched),
            "last_mode": control.last_mode,
            "journal": list(control.journal),
        },
        "devices": {entity_id: _state(hass, entity_id) for entity_id in agenda.linked},
        "other_entities": {entity_id: _state(hass, entity_id) for entity_id in sorted(others)},
        "shared": agenda.shared.as_dict(),
        "issues": issues,
    }
