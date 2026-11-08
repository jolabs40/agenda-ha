// Reaching the setpoint on time: the settings of a thermostat agenda, and what the views
// show of it.

const V = new URL(import.meta.url).search;
const { esc, fmtNum, friendlyName, splitByDay, wall, wm } = await import(`./agenda-lib.js${V}`);

const LIMIT = { min: 15, max: 360, usual: 180 };

export const PREHEAT_STYLES = `
  [data-sec="preheat"] { display: flex; flex-direction: column; gap: 10px; }
  [data-sec="preheat"] .hint { margin-top: -6px; }
  [data-sec="preheat"] .fld .hint { margin-top: 0; }
  .pre-line { font-size: 13px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .pre-line b { font-weight: 500; color: var(--primary-text-color); }
  .pre-name { font-size: 13px; font-weight: 500; margin-top: 4px; }
  [data-sec="preheat"] .pre-warn { margin: 2px 0 0; padding-left: 8px; border-left: 3px solid var(--warning-color, #f57c00); }
`;

const isTemperature = (s) => s.entity_id.startsWith("sensor.") && s.attributes.device_class === "temperature";

function options(hass, selected, fits, noneLabel) {
  const found = Object.values(hass.states)
    .filter(fits)
    .map((s) => [s.entity_id, friendlyName(hass, s.entity_id)])
    .sort((a, b) => a[1].localeCompare(b[1]));
  // a sensor gone from Home Assistant stays listed: saving must not drop it unseen
  if (selected && !found.some(([id]) => id === selected)) found.unshift([selected, selected]);
  return [["", noneLabel], ...found]
    .map(
      ([id, name]) => `<option value="${esc(id)}" ${id === (selected || "") ? "selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
}

export const outdoorOptions = (hass, selected, T) =>
  options(hass, selected, (s) => isTemperature(s) || s.entity_id.startsWith("weather."), T.none);

function speedLine(label, rate, delay, samples, T) {
  const known = samples >= 3;
  const facts = [
    `${fmtNum(rate, T, 2)} °C/h`,
    T.preheat_delay(fmtNum(delay, T)),
    known ? T.preheat_rises(samples) : T.preheat_default(samples),
  ];
  return `<div class="pre-line"><b>${esc(label)}</b> ${esc(facts.join(" · "))}</div>`;
}

function speedRows(hass, T, agenda, cfg) {
  const speeds = agenda.preheat?.speeds || {};
  const ids = (cfg.entities || []).filter((id) => speeds[id]);
  if (!ids.length) return `<p class="hint">${esc(T.preheat_no_speed)}</p>`;
  return ids
    .map((id) => {
      const s = speeds[id];
      const modes = hass.states[id]?.attributes?.hvac_modes || [];
      const name = ids.length > 1 ? `<div class="pre-name">${esc(friendlyName(hass, id))}</div>` : "";
      const heat = modes.includes("heat") || !modes.includes("cool");
      const over = Math.max(s.overshoot || 0, s.cool_overshoot || 0);
      const warn = s.suspect ? `<p class="hint pre-warn">${esc(T.preheat_suspect(fmtNum(over, T)))}</p>` : "";
      return `${name}${heat ? speedLine(T.preheat_heat, s.heat_rate, s.dead_time, s.samples, T) : ""}${
        modes.includes("cool") ? speedLine(T.preheat_cool, s.cool_rate, s.cool_dead_time, s.cool_samples, T) : ""
      }${warn}`;
    })
    .join("");
}

/** The section of the settings of an agenda, in `sec`; it writes to cfg. */
export function preheatSection(sec, { hass, T, agenda, cfg, reset }) {
  if (cfg.kind !== "climate") {
    sec.innerHTML = "";
    return;
  }
  const limit = Number(cfg.preheat_max_minutes) || LIMIT.usual;
  const details = cfg.preheat
    ? `<label class="fld"><span>${esc(T.preheat_max)}</span>
        <div class="row tight"><input type="number" class="inp num" min="${LIMIT.min}" max="${LIMIT.max}" step="15" data-preheat-max value="${limit}"> min</div></label>
      <label class="fld"><span>${esc(T.preheat_sensor)}</span>
        <select class="inp" data-preheat-sensor>${options(hass, cfg.temperature_sensor, isTemperature, T.preheat_sensor_none)}</select>
        <p class="hint">${esc(T.preheat_sensor_hint)}</p></label>
      <div class="fld"><span>${esc(T.preheat_speeds)}</span>${speedRows(hass, T, agenda, cfg)}
        <div><button class="btn sm" data-preheat-reset>${esc(T.preheat_reset)}</button></div></div>`
    : "";
  sec.innerHTML = `<label class="tgl"><input type="checkbox" data-preheat ${cfg.preheat ? "checked" : ""}><span></span>${esc(T.preheat)}</label>
    <p class="hint">${esc(T.preheat_hint)}</p>${details}`;
  sec.querySelector("[data-preheat]").addEventListener("change", (x) => {
    cfg.preheat = x.target.checked;
    preheatSection(sec, { hass, T, agenda, cfg, reset });
  });
  sec.querySelector("[data-preheat-max]")?.addEventListener("change", (x) => {
    const value = Math.round(Number(x.target.value) || LIMIT.usual);
    cfg.preheat_max_minutes = Math.max(LIMIT.min, Math.min(LIMIT.max, value));
    x.target.value = cfg.preheat_max_minutes;
  });
  sec.querySelector("[data-preheat-sensor]")?.addEventListener("change", (x) => {
    cfg.temperature_sensor = x.target.value || null;
  });
  sec.querySelector("[data-preheat-reset]")?.addEventListener("click", reset);
}

/** What an agenda sends of these settings. */
export const preheatSettings = (cfg) => ({
  preheat: cfg.kind === "climate" && !!cfg.preheat,
  preheat_max_minutes: Number(cfg.preheat_max_minutes) || LIMIT.usual,
  temperature_sensor: cfg.temperature_sensor || null,
});

/** The early start of an agenda on one or more days: {day: [{from, to}]}. */
export function preheatBands(agenda, firstDay, days) {
  const next = agenda.preheat?.next;
  return next ? splitByDay([{ start: next.start, end: next.target }], firstDay, days) : {};
}

/** One line on what an agenda is preparing, "" when nothing. */
export function preheatNote(agenda, T) {
  const next = agenda.preheat?.next;
  if (!next || !agenda.enabled) return "";
  return next.running
    ? T.preheating_for(wall(wm(next.target)).slice(11))
    : T.preheat_planned(wall(wm(next.start)).slice(11));
}
