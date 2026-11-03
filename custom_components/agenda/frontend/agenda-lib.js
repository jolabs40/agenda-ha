// Shared helpers for the panel and the card.
//
// Times are naive local times in Home Assistant's zone ("2026-11-02T21:30").
// They are handled as "wall minutes" (minutes since the epoch of the UTC date
// with the same digits) so nothing depends on the browser's time zone.

const V = new URL(import.meta.url).search;
const { TEXTS } = await import(`./agenda-texts.js${V}`);

export function texts(hass) {
  const lang = (hass?.locale?.language || hass?.language || "en").slice(0, 2);
  return { ...TEXTS.en, ...(TEXTS[lang] || {}), _lang: hass?.locale?.language || hass?.language || "en" };
}

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function friendlyName(hass, entityId) {
  return hass?.states?.[entityId]?.attributes?.friendly_name || entityId;
}

export const DAY = 1440;

export function wm(text) {
  const [d, t] = text.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = (t || "00:00").split(":").map(Number);
  return Date.UTC(y, mo - 1, da, h, mi) / 60000;
}

const pad = (n) => String(n).padStart(2, "0");

export function wallDate(m) {
  const d = new Date(m * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function wallTime(m) {
  const d = new Date(m * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function wall(m) {
  return `${wallDate(m)}T${wallTime(m)}`;
}

export const dayOf = (m) => Math.floor(m / DAY) * DAY;
export const weekday = (m) => (new Date(m * 60000).getUTCDay() + 6) % 7; // Monday = 0
export const mondayOf = (m) => dayOf(m) - weekday(m) * DAY;

/** Wall minutes "now" in Home Assistant's time zone. */
export function nowWall(timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return wm(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`);
}

export function fmtDay(m, lang, opts = { weekday: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(lang, { ...opts, timeZone: "UTC" }).format(new Date(m * 60000));
}

export function fmtRange(start, end, lang) {
  const f = (m, o) => fmtDay(m, lang, o);
  const sameMonth = wallDate(start).slice(0, 7) === wallDate(end).slice(0, 7);
  return sameMonth
    ? `${f(start, { day: "numeric" })} – ${f(end, { day: "numeric", month: "long", year: "numeric" })}`
    : `${f(start, { day: "numeric", month: "short" })} – ${f(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function fmtNum(value, T, digits = 1) {
  const n = Number(value);
  const s = Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.?0+$/, "");
  return /^(fr|de|nl)/.test(T._lang) ? s.replace(".", ",") : s;
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => "#" + c.map((v) => pad(Math.round(v).toString(16))).join("");

/** Colour between two hex colours, k in [0, 1]. */
export function mix(a, b, k) {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const t = Math.max(0, Math.min(1, k));
  return rgbHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Colour along stops [[value, colour], ...] sorted by value. */
export function gradient(stops, value) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (value <= v1) {
      const [v0, c0] = stops[i - 1];
      return mix(c0, c1, (value - v0) / (v1 - v0));
    }
  }
  return stops[stops.length - 1][1];
}

export const OFF_COLOR = "#9e9e9e";

export function textColor(bg) {
  if (!bg || bg[0] !== "#" || bg.length !== 7) return "#212121";
  const [r, g, b] = hexRgb(bg).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.32 ? "#1f1f1f" : "#ffffff";
}

/**
 * Split occurrences into pieces per day, for the week grid.
 * Returns { [dayInMinutes]: [{occ, from, to, first, last}] } where from/to are
 * minutes within the day (0..1440).
 */
export function splitByDay(occs, firstDay, nDays) {
  const out = {};
  for (let i = 0; i < nDays; i++) out[firstDay + i * DAY] = [];
  for (const occ of occs) {
    const s = wm(occ.start);
    const e = wm(occ.end);
    for (let d = dayOf(s); d < e; d += DAY) {
      if (!(d in out)) continue;
      const from = Math.max(s, d) - d;
      const to = Math.min(e, d + DAY) - d;
      if (to > from) out[d].push({ occ, from, to, first: s >= d, last: e <= d + DAY });
    }
  }
  return out;
}

/** Stack overlapping pieces; the latest start goes on top, since it wins. */
export function stack(pieces) {
  const sorted = [...pieces].sort((a, b) => wm(a.occ.start) - wm(b.occ.start) || wm(b.occ.end) - wm(a.occ.end));
  const placed = [];
  for (const p of sorted) {
    const under = placed.filter((q) => q.from < p.to && p.from < q.to);
    p.depth = under.length ? Math.max(...under.map((q) => q.depth)) + 1 : 0;
    placed.push(p);
  }
  return placed;
}

/**
 * Effective timeline of an agenda over [from, to) (wall minutes): the event in
 * charge at each moment, gaps left to the default state.
 * `withState` keeps only events carrying a state (agendas that control devices).
 * Returns [{from, to, occ|null, event|null}].
 */
export function effectiveTimeline(agenda, occs, from, to, withState) {
  const byId = Object.fromEntries(agenda.events.map((e) => [e.id, e]));
  const cuts = new Set([from, to]);
  const spans = occs.map((o) => ({ occ: o, s: wm(o.start), e: wm(o.end), event: byId[o.event_id] }));
  for (const sp of spans) {
    if (sp.s > from && sp.s < to) cuts.add(sp.s);
    if (sp.e > from && sp.e < to) cuts.add(sp.e);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const active = spans.filter((sp) => sp.event && sp.s <= a && a < sp.e);
    const candidates = withState ? active.filter((sp) => sp.event.state) : active;
    let win = null;
    for (const sp of candidates) {
      if (!win || sp.s > win.s || (sp.s === win.s && sp.e - sp.s < win.e - win.s)) win = sp;
    }
    const last = out[out.length - 1];
    if (last && last.occ === (win ? win.occ : null)) last.to = b;
    else out.push({ from: a, to: b, occ: win ? win.occ : null, event: win ? win.event : null });
  }
  return out;
}

export function repeatSummary(event, T, hass) {
  const r = event.repeat || {};
  const lang = T._lang;
  const start = wm(event.start);
  const n = r.interval || 1;
  let text;
  switch (r.freq || "none") {
    case "daily":
      text = n === 1 ? T.every_day : T.every_n_days(n);
      break;
    case "weekly": {
      const days = [...(r.weekdays?.length ? r.weekdays : [weekday(start)])].sort();
      let list;
      if (days.length === 7) list = T.every_day;
      else if (days.join() === "0,1,2,3,4") list = T.mon_fri;
      else if (days.join() === "5,6") list = T.weekend;
      else list = days.map((d) => T.weekdays_long[d]).join(", ");
      text = n === 1 ? list : `${T.every_n_weeks(n)} : ${list}`;
      break;
    }
    case "monthly": {
      const what = monthlyLabel(start, r.monthly, T);
      text = n === 1 ? T.every_month_on(what) : T.every_n_months_on(n, what);
      break;
    }
    default:
      return T.on_day(fmtDay(start, lang, { weekday: "long", day: "numeric", month: "long" }));
  }
  const extra = [];
  if (r.until) extra.push(T.until_day(fmtDay(wm(r.until), lang, { day: "numeric", month: "short", year: "numeric" })));
  if (r.holidays === "exclude") extra.push(T.except_holidays);
  if (r.holidays === "only") extra.push(T.only_holidays);
  const calendarList = (ids, match) => {
    const names = ids.map((id) => friendlyName(hass, id));
    const last = names.pop();
    const word = match === "all" ? T.list_and : T.list_or;
    return names.length ? `${names.join(", ")} ${word} ${last}` : last;
  };
  if (r.calendars?.length) {
    const list = calendarList(r.calendars, r.calendar_match);
    extra.push(r.calendar_mode === "only" ? T.only_calendar(list) : T.except_calendar(list));
  }
  if (r.except_calendars?.length) extra.push(T.except_calendar(calendarList(r.except_calendars, r.except_match)));
  if (r.period === "school") extra.push(T.school_only);
  if (r.period === "vacation") extra.push(T.vacation_only);
  if (r.weeks === "even") extra.push(T.even_weeks);
  if (r.weeks === "odd") extra.push(T.odd_weeks);
  const nx = (r.exclude || []).length + (r.include || []).length;
  if (nx) extra.push(T.n_exceptions(nx));
  if (event.conditions?.length) extra.push(T.n_conditions(event.conditions.length));
  return [text, ...extra].join(" · ");
}

/** "le 12", "le 2e lundi", "le dernier vendredi", for a monthly repetition starting on `start`. */
export function monthlyLabel(start, mode, T) {
  const d = new Date(start * 60000).getUTCDate();
  const wd = T.weekdays_long[weekday(start)];
  if (mode === "weekday") return T.monthly_modes.weekday(T.ranks[Math.floor((d - 1) / 7)], wd);
  if (mode === "last_weekday") return T.monthly_modes.last_weekday(wd);
  return T.monthly_modes.day(d);
}

/** "coucher du soleil - 15 min" */
export function sunLabel(anchor, T) {
  const off = Number(anchor.offset) || 0;
  const name = T.sun_short[anchor.event] || anchor.event;
  return off ? `${name} ${off > 0 ? "+" : "-"} ${Math.abs(off)} min` : name;
}

export function timeSummary(event, T) {
  if (event.all_day) return T.all_day;
  const s = wm(event.start);
  const e = wm(event.end);
  const nd = dayOf(e) > dayOf(s) && e - dayOf(e) > 0 ? ` (${T.next_day})` : "";
  const from = event.start_sun ? sunLabel(event.start_sun, T) : wallTime(s);
  const to = event.end_sun ? sunLabel(event.end_sun, T) : wallTime(e) === "00:00" ? "24:00" : wallTime(e);
  return `${from} → ${to}${nd}`;
}

/** ha-selector is lazy-loaded by the frontend; opening a card editor pulls it in. */
let haLoading = null;
export function loadHaComponents() {
  if (customElements.get("ha-selector")) return Promise.resolve(true);
  if (!haLoading) {
    haLoading = (async () => {
      try {
        const helpers = await window.loadCardHelpers?.();
        const card = await helpers?.createCardElement({ type: "tile", entity: "sun.sun" });
        await card?.constructor?.getConfigElement?.();
      } catch (_err) {
        // fall back to the YAML editor
      }
      await Promise.race([customElements.whenDefined("ha-selector"), new Promise((r) => setTimeout(r, 5000))]);
      return Boolean(customElements.get("ha-selector"));
    })();
  }
  return haLoading;
}
