// Per-kind state handling: labels, colours, live text and the state picker.
// State shapes match devices.py.

const V = new URL(import.meta.url).search;
const { esc, fmtNum, friendlyName, gradient, mix, OFF_COLOR, textColor } = await import(`./agenda-lib.js${V}`);

export const KIND_DOMAINS = {
  none: [],
  climate: ["climate"],
  on_off: ["switch", "light", "input_boolean", "fan"],
  cover: ["cover"],
  select: ["select", "input_select"],
  number: ["number", "input_number"],
};

export const KIND_ICONS = {
  none: "mdi:calendar-check-outline",
  climate: "mdi:thermostat",
  on_off: "mdi:power",
  cover: "mdi:window-shutter",
  select: "mdi:form-dropdown",
  number: "mdi:numeric",
};

const LIVE_ICONS = {
  climate: "mdi:thermometer",
  on_off: "mdi:power",
  cover: "mdi:window-shutter",
  select: "mdi:form-dropdown",
  number: "mdi:numeric",
};

export const kindOf = (agenda) => agenda?.settings?.kind || "none";
/** Whether events carry a state (true even before devices are linked). */
export const hasStates = (agenda) => kindOf(agenda) !== "none";
const linked = (agenda) => agenda?.settings?.entities || [];
const domain = (entityId) => entityId.split(".")[0];
const states = (hass, agenda) =>
  linked(agenda)
    .map((id) => hass?.states?.[id])
    .filter(Boolean);
const onlyLights = (agenda) => linked(agenda).length > 0 && linked(agenda).every((id) => domain(id) === "light");

export function entitiesOfKind(hass, kind) {
  const domains = KIND_DOMAINS[kind] || [];
  return Object.values(hass?.states || {}).filter((s) => domains.includes(domain(s.entity_id)));
}

export function liveIcon(agenda) {
  if (kindOf(agenda) === "on_off" && onlyLights(agenda)) return "mdi:lightbulb-outline";
  return LIVE_ICONS[kindOf(agenda)] || "mdi:information-outline";
}

export function kindIcon(agenda) {
  if (kindOf(agenda) === "on_off" && onlyLights(agenda)) return "mdi:lightbulb-outline";
  return KIND_ICONS[kindOf(agenda)] || KIND_ICONS.none;
}

const TEMP_STOPS = [
  [7, "#b0bec5"],
  [15, "#64b5f6"],
  [17, "#4fc3f7"],
  [18, "#4dd0e1"],
  [18.5, "#4db6ac"],
  [19, "#81c784"],
  [19.5, "#aed581"],
  [20, "#ffd54f"],
  [20.5, "#ffb74d"],
  [21, "#ff8a65"],
  [22, "#e57373"],
  [24, "#c62828"],
];
export const tempColor = (t) => gradient(TEMP_STOPS, t);

// setpoints are in Home Assistant's unit; the colours above are in Celsius
const fahrenheit = (hass) => hass?.config?.unit_system?.temperature === "°F";
const tempUnit = (hass) => hass?.config?.unit_system?.temperature || "°C";
const setpointColor = (hass, t) => tempColor(fahrenheit(hass) ? ((t - 32) * 5) / 9 : t);
/** Steps, slider and first value of a setpoint. */
const tempScale = (hass) =>
  fahrenheit(hass)
    ? { min: 41, max: 86, step: 1, slider: [45, 77], first: 68 }
    : { min: 5, max: 30, step: 0.5, slider: [7, 25], first: 20 };

const PRESET_COLORS = { comfort: "#ffb74d", eco: "#4dd0e1", frost: "#b0bec5", boost: "#e57373", away: "#90a4ae" };

const MODE_ORDER = ["heat", "cool", "heat_cool", "auto", "dry", "fan_only"];
const MODE_COLORS = {
  heat: "#ffb74d",
  cool: "#4fc3f7",
  heat_cool: "#81c784",
  auto: "#81c784",
  dry: "#4db6ac",
  fan_only: "#b0bec5",
};
// optional settings of a climate state: key, attribute listing the values, text
const CLIMATE_SETTINGS = [
  ["fan_mode", "fan_modes", "fan_speed"],
  ["swing_mode", "swing_modes", "swing"],
  ["swing_horizontal_mode", "swing_horizontal_modes", "swing_h"],
];
const CLIMATE_KEYS = ["hvac_mode", ...CLIMATE_SETTINGS.map(([key]) => key)];
const SETTING_COLOR = "#90caf9";
const KEEP_COLOR = "#cfd8dc";

const modeName = (T, mode) => T.hvac_modes?.[mode] || mode;
/** Mode, fan and swing chosen in a climate state, to carry over to another type. */
const climateExtras = (st) => Object.fromEntries(CLIMATE_KEYS.filter((k) => st?.[k] != null).map((k) => [k, st[k]]));

/** Values every linked device lists in this attribute, in the first one's order. */
function common(hass, agenda, attr) {
  let found = null;
  for (const s of states(hass, agenda)) {
    const values = s.attributes?.[attr] || [];
    found = found == null ? [...values] : found.filter((v) => values.includes(v));
  }
  return found || [];
}

/** Modes other than off that every linked thermostat has. */
export function climateModes(hass, agenda) {
  const rank = (m) => (MODE_ORDER.indexOf(m) + 99) % 99;
  return common(hass, agenda, "hvac_modes")
    .filter((m) => m !== "off")
    .sort((a, b) => rank(a) - rank(b));
}

/** Preset temperature, for thermostats exposing preset_temperatures (Versatile Thermostat). */
export function presetTemp(hass, agenda, preset) {
  for (const s of states(hass, agenda)) {
    const value = s.attributes?.preset_temperatures?.[`${preset}_temp`];
    if (typeof value === "number" && value > 0) return value;
  }
  return null;
}

/** Presets supported by every linked thermostat. */
export function availablePresets(hass, agenda) {
  let common = null;
  for (const s of states(hass, agenda)) {
    const modes = (s.attributes?.preset_modes || []).filter((p) => p !== "none");
    common = common == null ? modes : common.filter((p) => modes.includes(p));
  }
  const order = ["comfort", "eco", "frost", "boost", "away", "activity"];
  return (common || []).sort((a, b) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99));
}

const OPTION_COLORS = [
  "#4fc3f7",
  "#81c784",
  "#ffb74d",
  "#ba68c8",
  "#e57373",
  "#4db6ac",
  "#f06292",
  "#aed581",
  "#90a4ae",
  "#ffd54f",
];

/** Options common to every linked selector, in the first one's order. */
export function commonOptions(hass, agenda) {
  let common = null;
  for (const s of states(hass, agenda)) {
    const options = s.attributes?.options || [];
    common = common == null ? [...options] : common.filter((o) => options.includes(o));
  }
  return common || [];
}

function optionColor(hass, agenda, option) {
  const options = commonOptions(hass, agenda);
  let i = options.indexOf(option);
  if (i < 0) i = [...String(option)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return OPTION_COLORS[i % OPTION_COLORS.length];
}

/** min, max, step and unit of the first linked number. */
export function numberRange(hass, agenda) {
  const a = states(hass, agenda)[0]?.attributes || {};
  const min = typeof a.min === "number" ? a.min : 0;
  const max = typeof a.max === "number" && a.max > min ? a.max : min + 100;
  const step = typeof a.step === "number" && a.step > 0 ? a.step : 1;
  return { min, max, step, unit: a.unit_of_measurement || "" };
}

function canPosition(hass, agenda) {
  const list = states(hass, agenda);
  return list.length === 0 || list.some((s) => (s.attributes?.supported_features || 0) & 4);
}

/** Short label of a state, e.g. "20.5°", "Eco 18°", "On 60 %". */
export function stateLabel(hass, agenda, st, T, withTemp = true) {
  if (!st) return "";
  switch (st.type) {
    case "temperature": {
      const text = `${fmtNum(st.temperature, T)}°`;
      return st.hvac_mode ? `${modeName(T, st.hvac_mode)} ${text}` : text;
    }
    case "preset": {
      const name = T.presets[st.preset] || st.preset;
      const t = withTemp ? presetTemp(hass, agenda, st.preset) : null;
      const text = t != null ? `${name} ${fmtNum(t, T)}°` : name;
      return st.hvac_mode ? `${modeName(T, st.hvac_mode)} ${text}` : text;
    }
    case "mode":
      return modeName(T, st.hvac_mode);
    case "off":
      return kindOf(agenda) === "on_off" && onlyLights(agenda) ? T.light_off : T.off;
    case "on": {
      const word = onlyLights(agenda) ? T.light_on : T.on;
      return st.brightness != null ? `${word} ${st.brightness} %` : word;
    }
    case "position":
      if (st.position >= 100) return T.open;
      if (st.position <= 0) return T.closed;
      return `${st.position} %`;
    case "option":
      return String(st.option);
    case "value": {
      const { unit } = numberRange(hass, agenda);
      return `${fmtNum(st.value, T, 2)}${unit ? ` ${unit}` : ""}`;
    }
    default:
      return "";
  }
}

export function stateColor(hass, agenda, st) {
  if (!st) return null;
  switch (st.type) {
    case "off":
      return OFF_COLOR;
    case "temperature":
      return setpointColor(hass, st.temperature);
    case "preset": {
      const t = presetTemp(hass, agenda, st.preset);
      return t != null ? setpointColor(hass, t) : PRESET_COLORS[st.preset] || "#90a4ae";
    }
    case "mode":
      return MODE_COLORS[st.hvac_mode] || "#90a4ae";
    case "on":
      return st.brightness != null ? mix("#fff3c4", "#ffb300", st.brightness / 100) : "#ffc107";
    case "position":
      return mix("#455a64", "#81d4fa", st.position / 100);
    case "option":
      return optionColor(hass, agenda, st.option);
    case "value": {
      const { min, max } = numberRange(hass, agenda);
      return mix("#4fc3f7", "#ff8a65", (st.value - min) / (max - min));
    }
    default:
      return null;
  }
}

export function eventColor(hass, agenda, event) {
  return event.color || stateColor(hass, agenda, event.state) || agenda.settings.color;
}

export function eventLabel(hass, agenda, event, T) {
  return event.name || stateLabel(hass, agenda, event.state, T) || "—";
}

/** State of a new event. */
export function draftState(hass, agenda) {
  switch (kindOf(agenda)) {
    case "climate":
      return { type: "temperature", temperature: tempScale(hass).first };
    case "on_off":
      return { type: "on", brightness: null };
    case "cover":
      return { type: "position", position: 100 };
    case "select": {
      const options = commonOptions(hass, agenda);
      return options.length ? { type: "option", option: options[0] } : null;
    }
    case "number": {
      const { min } = numberRange(hass, agenda);
      const cur = Number(states(hass, agenda)[0]?.state);
      return { type: "value", value: Number.isFinite(cur) ? cur : min };
    }
    default:
      return null;
  }
}

/** What the linked devices are doing right now. */
export function liveText(hass, agenda, T) {
  const list = states(hass, agenda);
  if (!list.length) return "";
  const first = list[0];
  const a = first.attributes || {};
  switch (kindOf(agenda)) {
    case "climate": {
      const parts = [];
      if (typeof a.current_temperature === "number")
        parts.push(`${fmtNum(Math.round(a.current_temperature * 10) / 10, T)}°`);
      if (first.state === "off") parts.push(T.off.toLowerCase());
      else {
        // the mode only matters on a device that has several
        if ((a.hvac_modes || []).length > 2) parts.push(modeName(T, first.state).toLowerCase());
        if (typeof a.temperature === "number") parts.push(`→ ${fmtNum(a.temperature, T)}°`);
      }
      return parts.join(" ");
    }
    case "on_off": {
      if (list.length > 1) return T.n_on(list.filter((s) => s.state === "on").length, list.length);
      const lights = domain(first.entity_id) === "light";
      if (first.state !== "on") return lights ? T.light_off : T.off;
      const pct = lights && typeof a.brightness === "number" ? ` ${Math.round((a.brightness * 100) / 255)} %` : "";
      return `${lights ? T.light_on : T.on}${pct}`;
    }
    case "cover": {
      if (typeof a.current_position === "number")
        return stateLabel(hass, agenda, { type: "position", position: a.current_position }, T);
      if (first.state === "open") return T.open;
      if (first.state === "closed") return T.closed;
      return hass.formatEntityState?.(first) || first.state;
    }
    case "select":
      return first.state;
    case "number": {
      const n = Number(first.state);
      const { unit } = numberRange(hass, agenda);
      return Number.isFinite(n) ? `${fmtNum(n, T, 2)}${unit ? ` ${unit}` : ""}` : first.state;
    }
    default:
      return "";
  }
}

const chip = (key, label, color, active) =>
  `<button class="chip sp ${active ? "on" : ""}" data-sp="${esc(key)}" aria-pressed="${active}" style="--c:${esc(color)};--t:${esc(textColor(color))}">${active ? `<ha-icon icon="mdi:check"></ha-icon>` : ""}${esc(label)}</button>`;

function bigValue({ value, text, color, min, max, step, minus = "-", plus = "+" }) {
  return `<div class="temp">
    <button class="ic big" data-step="-1" title="${esc(minus)}"><ha-icon icon="mdi:minus"></ha-icon></button>
    <div class="temp-val" style="--c:${esc(color)}">${text}</div>
    <button class="ic big" data-step="1" title="${esc(plus)}"><ha-icon icon="mdi:plus"></ha-icon></button>
    <input type="range" class="temp-range" min="${min}" max="${max}" step="${step}" value="${value}" data-range>
  </div>`;
}

/** Mode, fan and swing chips of a climate state that is not off. */
function climateRows(hass, agenda, st, T, modes, settings) {
  const first = states(hass, agenda)[0];
  const value = (key, v) => {
    const shown = first && hass.formatEntityAttributeValue?.(first, key, v);
    if (shown && shown !== v) return shown;
    // untranslated values such as 1_up
    const text = String(v).replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const row = (title, body) => `<div class="srow"><span>${esc(title)}</span><div class="chips">${body}</div></div>`;
  let html = "";
  if (modes.length > 1) {
    // a mode without setpoint must name its mode
    let body = st.type === "mode" ? "" : chip("hvac:", T.own_mode, KEEP_COLOR, !st.hvac_mode);
    for (const m of modes) body += chip(`hvac:${m}`, modeName(T, m), MODE_COLORS[m] || "#90a4ae", st.hvac_mode === m);
    html += row(T.hvac_mode, body);
  }
  for (const [key, values, text] of settings) {
    let body = chip(`${key}:`, T.unchanged, KEEP_COLOR, st[key] == null);
    for (const v of values) body += chip(`${key}:${v}`, value(key, v), SETTING_COLOR, st[key] === v);
    html += row(T[text], body);
  }
  return html;
}

/** State chips, plus a fine-tuning control for the selected state. */
export function statePicker(hass, agenda, st, T, { allowNone, noneLabel }) {
  const kind = kindOf(agenda);
  let html = `<div class="chips">`;
  let extra = "";
  if (kind === "climate") {
    const isTemp = st?.type === "temperature";
    const scale = tempScale(hass);
    const temp = isTemp ? st.temperature : scale.first;
    const modes = climateModes(hass, agenda);
    const settings = CLIMATE_SETTINGS.map(([key, attr, text]) => [key, common(hass, agenda, attr), text]).filter(
      ([, values]) => values.length,
    );
    // air conditioners and the like; a heating-only thermostat keeps the plain picker
    const rich = modes.length > 1 || settings.length > 0;
    html += chip("temperature", isTemp ? `${fmtNum(temp, T)}°` : T.temperature, setpointColor(hass, temp), isTemp);
    for (const p of availablePresets(hass, agenda)) {
      const s = { type: "preset", preset: p };
      html += chip(
        `preset:${p}`,
        stateLabel(hass, agenda, s, T),
        stateColor(hass, agenda, s),
        st?.type === "preset" && st.preset === p,
      );
    }
    if (rich)
      html += chip("mode", T.no_setpoint, MODE_COLORS[st?.hvac_mode] || MODE_COLORS.fan_only, st?.type === "mode");
    html += chip("off", T.off, OFF_COLOR, st?.type === "off");
    if (isTemp) {
      extra = bigValue({
        value: temp,
        text: `${esc(fmtNum(temp, T))}<small>${esc(tempUnit(hass))}</small>`,
        color: setpointColor(hass, temp),
        min: scale.slider[0],
        max: scale.slider[1],
        step: scale.step,
      });
    }
    if (rich && st && st.type !== "off") extra += climateRows(hass, agenda, st, T, modes, settings);
  } else if (kind === "on_off") {
    const on = { type: "on", brightness: st?.type === "on" ? (st.brightness ?? null) : null };
    html += chip(
      "on",
      stateLabel(hass, agenda, { type: "on", brightness: null }, T),
      stateColor(hass, agenda, { type: "on" }),
      st?.type === "on",
    );
    html += chip("off", stateLabel(hass, agenda, { type: "off" }, T), OFF_COLOR, st?.type === "off");
    const lights = linked(agenda).some((id) => domain(id) === "light");
    if (st?.type === "on" && lights) {
      const b = on.brightness;
      extra = `<label class="tgl"><input type="checkbox" data-bright ${b != null ? "checked" : ""}><span></span>${esc(T.set_brightness)}</label>`;
      if (b != null) {
        extra += bigValue({
          value: b,
          text: `${b}<small>%</small>`,
          color: stateColor(hass, agenda, on),
          min: 1,
          max: 100,
          step: 1,
        });
      }
    }
  } else if (kind === "cover") {
    const pos = st?.type === "position" ? st.position : null;
    html += chip("pos:100", T.open, stateColor(hass, agenda, { type: "position", position: 100 }), pos === 100);
    html += chip("pos:0", T.closed, stateColor(hass, agenda, { type: "position", position: 0 }), pos === 0);
    if (canPosition(hass, agenda)) {
      const mid = pos != null && pos > 0 && pos < 100;
      html += chip(
        "pos:50",
        mid ? `${pos} %` : T.position,
        stateColor(hass, agenda, { type: "position", position: mid ? pos : 50 }),
        mid,
      );
      if (mid) {
        extra = bigValue({
          value: pos,
          text: `${pos}<small>%</small>`,
          color: stateColor(hass, agenda, st),
          min: 1,
          max: 99,
          step: 1,
        });
      }
    }
  } else if (kind === "select") {
    const options = commonOptions(hass, agenda);
    for (const o of options) {
      html += chip(
        `opt:${o}`,
        o,
        stateColor(hass, agenda, { type: "option", option: o }),
        st?.type === "option" && st.option === o,
      );
    }
    if (!options.length) {
      extra = `<label class="fld"><span>${esc(T.option)}</span><input class="inp" data-option value="${esc(st?.option || "")}"></label>`;
    }
  } else if (kind === "number") {
    const r = numberRange(hass, agenda);
    const value = st?.type === "value" ? st.value : r.min;
    html += chip(
      "value",
      st?.type === "value" ? stateLabel(hass, agenda, st, T) : T.value,
      stateColor(hass, agenda, { type: "value", value }),
      st?.type === "value",
    );
    if (st?.type === "value") {
      extra = bigValue({
        value,
        text: `${esc(fmtNum(value, T, 2))}${r.unit ? `<small>${esc(r.unit)}</small>` : ""}`,
        color: stateColor(hass, agenda, st),
        min: r.min,
        max: r.max,
        step: r.step,
      });
    }
  }
  if (allowNone) html += chip("none", noneLabel, "#e0e0e0", !st);
  return `${html}</div>${extra}`;
}

/** Wire a picker rendered by statePicker. `get`/`set` read and write the state. */
export function bindState(scope, { hass, agenda, T, get, set, rerender }) {
  const kind = kindOf(agenda);
  const range = () => {
    if (kind === "climate") return tempScale(hass);
    if (kind === "on_off") return { min: 1, max: 100, step: 1 };
    if (kind === "cover") return { min: 1, max: 99, step: 1 };
    return numberRange(hass, agenda);
  };
  const field = { climate: "temperature", on_off: "brightness", cover: "position", number: "value" }[kind];
  const withValue = (v) => {
    const cur = get() || {};
    if (kind === "climate") return { ...climateExtras(cur), type: "temperature", temperature: v };
    if (kind === "on_off") return { type: "on", brightness: Math.round(v) };
    if (kind === "cover") return { type: "position", position: Math.round(v) };
    return { ...cur, type: "value", value: v };
  };

  scope.querySelectorAll("[data-sp]").forEach((b) =>
    b.addEventListener("click", () => {
      const key = b.dataset.sp;
      const cur = get();
      const setting = CLIMATE_KEYS.find((k) => key.startsWith(`${k === "hvac_mode" ? "hvac" : k}:`));
      if (setting) {
        // a chosen mode, fan or swing; the first chip of a row leaves it out
        const next = { ...cur };
        const v = key.slice(key.indexOf(":") + 1);
        if (v) next[setting] = v;
        else delete next[setting];
        set(next);
      } else if (key === "none") set(null);
      else if (key === "off") set({ type: "off" });
      else if (key === "on") set({ type: "on", brightness: cur?.type === "on" ? (cur.brightness ?? null) : null });
      else if (key === "temperature")
        set({
          ...climateExtras(cur),
          type: "temperature",
          temperature: cur?.type === "temperature" ? cur.temperature : tempScale(hass).first,
        });
      else if (key === "mode")
        set({ ...climateExtras(cur), type: "mode", hvac_mode: cur?.hvac_mode || climateModes(hass, agenda)[0] });
      else if (key === "value")
        set({ type: "value", value: cur?.type === "value" ? cur.value : numberRange(hass, agenda).min });
      else if (key.startsWith("preset:")) set({ ...climateExtras(cur), type: "preset", preset: key.slice(7) });
      else if (key.startsWith("pos:")) {
        const p = Number(key.slice(4));
        const keep = p === 50 && cur?.type === "position" && cur.position > 0 && cur.position < 100;
        set({ type: "position", position: keep ? cur.position : p });
      } else if (key.startsWith("opt:")) set({ type: "option", option: key.slice(4) });
      rerender();
    }),
  );
  scope.querySelector("[data-bright]")?.addEventListener("change", (e) => {
    set({ type: "on", brightness: e.target.checked ? 100 : null });
    rerender();
  });
  scope.querySelector("[data-option]")?.addEventListener("input", (e) => {
    set(e.target.value.trim() ? { type: "option", option: e.target.value.trim() } : null);
  });
  scope.querySelectorAll("[data-step]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = range();
      const cur = Number(get()?.[field] ?? r.min);
      const next = Math.min(
        r.max,
        Math.max(r.min, Math.round((cur + Number(b.dataset.step) * r.step) / r.step) * r.step),
      );
      set(withValue(Number(next.toFixed(6))));
      rerender();
    }),
  );
  const slider = scope.querySelector("[data-range]");
  if (slider) {
    slider.addEventListener("input", () => {
      const st = withValue(Number(slider.value));
      set(st);
      const val = scope.querySelector(".temp-val");
      const unit = val.querySelector("small")?.outerHTML || "";
      val.innerHTML = `${esc(kind === "climate" || kind === "number" ? fmtNum(slider.value, T, 2) : slider.value)}${unit}`;
      val.style.setProperty("--c", stateColor(hass, agenda, st));
    });
    slider.addEventListener("change", rerender);
  }
}
