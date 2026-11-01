// Shared helpers for the panel and the card.
//
// Times are naive local times in Home Assistant's zone ("2026-11-02T21:30").
// They are handled as "wall minutes" (minutes since the epoch of the UTC date
// with the same digits) so nothing depends on the browser's time zone.

const TEXTS = {
  fr: {
    title: "Agenda",
    week: "Semaine",
    house: "Maison",
    list: "Liste",
    today: "Aujourd'hui",
    all: "Tous",
    new_event: "Événement",
    new_agenda: "Nouvel agenda",
    agenda_name: "Nom de l'agenda",
    settings: "Réglages",
    support: "Soutenir Agenda sur Ko-fi",
    active: "Actif",
    paused: "Suspendu",
    now: "En ce moment",
    next: "Ensuite",
    at: "à",
    none: "Aucun",
    no_agenda: "Aucun agenda pour l'instant.",
    no_agenda_hint: "Un agenda par pièce ou par appareil : créez le premier.",
    no_event: "Aucun événement.",
    default_state: "Hors événement",
    edit_event: "Modifier l'événement",
    create_event: "Nouvel événement",
    occurrence_of: "Occurrence du",
    scope_series: "Toute la série",
    scope_once: "Ce jour seulement",
    setpoint: "Consigne",
    state: "État",
    temperature: "Température",
    name: "Nom",
    name_hint: "Facultatif : sinon l'état s'affiche",
    when: "Quand",
    all_day: "Toute la journée",
    date: "Date",
    from_date: "À partir du",
    start: "Début",
    end: "Fin",
    next_day: "le lendemain",
    repeat: "Répétition",
    once: "Une seule fois",
    daily: "Tous les jours",
    weekly: "Toutes les semaines",
    monthly: "Tous les mois",
    every: "Tous les",
    every_f: "Toutes les",
    days_unit: "jours",
    weeks_unit: "semaines",
    months_unit: "mois",
    until: "Jusqu'au",
    holidays: "Jours fériés",
    holidays_ignore: "Sans effet",
    holidays_exclude: "Sauf les jours fériés",
    holidays_only: "Seulement les jours fériés",
    exceptions: "Exceptions",
    excluded: "Jours retirés",
    included: "Jours ajoutés",
    calendar_condition: "Selon un calendrier",
    calendar_hint: "Par exemple un calendrier des vacances scolaires ou des absences.",
    calendar_exclude: "Sauf les jours où il a un événement",
    calendar_only: "Seulement les jours où il a un événement",
    add: "Ajouter",
    look: "Apparence",
    color: "Couleur",
    auto: "Auto",
    icon: "Icône",
    start_actions: "Actions de début",
    end_actions: "Actions de fin",
    actions_hint: "Exécutées au début (ou à la fin) de chaque occurrence, comme dans une automatisation.",
    note: "Note",
    enabled_event: "Événement actif",
    delete: "Supprimer",
    duplicate: "Dupliquer",
    cancel: "Annuler",
    save: "Enregistrer",
    close: "Fermer",
    move_title: "Déplacer une occurrence répétée",
    move_text: "Ce changement vaut-il pour ce jour seulement ou pour toute la série ?",
    delete_title: "Supprimer",
    delete_series_text: "Supprimer toute la série, ou seulement ce jour ?",
    delete_text: "Supprimer cet événement ?",
    delete_agenda_text: "Supprimer cet agenda et tous ses événements ?",
    kind: "Ce que commande l'agenda",
    kinds: {
      none: "Rien",
      climate: "Thermostats",
      on_off: "Marche / arrêt",
      cover: "Volets",
      select: "Sélecteur",
      number: "Valeur",
    },
    kind_hints: {
      none: "Les événements ne font que lancer leurs actions de début et de fin.",
      climate: "La consigne des événements est appliquée aux thermostats ; hors événement, celle ci-dessous.",
      other: "L'état des événements est appliqué aux appareils ; hors événement, celui ci-dessous.",
    },
    kind_change: "Changer de type efface l'état des événements existants.",
    entities: "Appareils commandés",
    no_entity: "Aucun appareil de ce type.",
    search: "Rechercher",
    resync_on_start: "Recaler les appareils au démarrage de Home Assistant",
    resync_now: "Appliquer maintenant",
    delete_agenda: "Supprimer l'agenda",
    holidays_title: "Réglages communs (tous les agendas)",
    school_calendar: "Calendrier des vacances scolaires",
    school_calendar_hint:
      "Les événements répétés peuvent alors ne s'appliquer qu'en période scolaire ou que pendant les vacances.",
    period: "Période",
    periods: { always: "Toujours", school: "Période scolaire", vacation: "Vacances scolaires" },
    vacation: "Vacances scolaires",
    country: "Pays",
    subdivision: "Région",
    ha_country: (name) => `Pays de Home Assistant (${name})`,
    no_ha_country: "Pays de Home Assistant (non défini)",
    whole_country: "Tout le pays",
    error: "Erreur",
    yaml_hint: "Liste d'actions en YAML ou JSON, comme dans une automatisation.",
    no_state: "Aucun",
    off: "Arrêt",
    on: "Marche",
    light_on: "Allumé",
    light_off: "Éteint",
    open: "Ouvert",
    closed: "Fermé",
    position: "Position",
    brightness: "Luminosité",
    set_brightness: "Régler la luminosité",
    option: "Option",
    value: "Valeur",
    n_on: (n, total) => `${n}/${total} en marche`,
    presets: {
      comfort: "Confort",
      eco: "Éco",
      frost: "Hors-gel",
      boost: "Boost",
      away: "Absent",
      activity: "Activité",
    },
    weekdays_short: ["L", "M", "M", "J", "V", "S", "D"],
    weekdays_long: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
    mon_fri: "Du lundi au vendredi",
    weekend: "Le week-end",
    every_day: "Tous les jours",
    every_n_days: (n) => `Tous les ${n} jours`,
    every_n_weeks: (n) => `Toutes les ${n} semaines`,
    every_month: (d) => `Tous les mois, le ${d}`,
    every_n_months: (n, d) => `Tous les ${n} mois, le ${d}`,
    on_day: (d) => `Le ${d}`,
    until_day: (d) => `jusqu'au ${d}`,
    except_holidays: "sauf fériés",
    only_holidays: "fériés seulement",
    except_calendar: (name) => `sauf ${name}`,
    only_calendar: (name) => `seulement ${name}`,
    school_only: "en période scolaire",
    vacation_only: "pendant les vacances",
    n_exceptions: (n) => (n === 1 ? "1 exception" : `${n} exceptions`),
  },
  en: {
    title: "Agenda",
    week: "Week",
    house: "House",
    list: "List",
    today: "Today",
    all: "All",
    new_event: "Event",
    new_agenda: "New agenda",
    agenda_name: "Agenda name",
    settings: "Settings",
    support: "Support Agenda on Ko-fi",
    active: "Active",
    paused: "Paused",
    now: "Now",
    next: "Next",
    at: "at",
    none: "None",
    no_agenda: "No agenda yet.",
    no_agenda_hint: "One agenda per room or device: create the first one.",
    no_event: "No event.",
    default_state: "Outside events",
    edit_event: "Edit event",
    create_event: "New event",
    occurrence_of: "Occurrence of",
    scope_series: "Whole series",
    scope_once: "This day only",
    setpoint: "Setpoint",
    state: "State",
    temperature: "Temperature",
    name: "Name",
    name_hint: "Optional: the state is shown otherwise",
    when: "When",
    all_day: "All day",
    date: "Date",
    from_date: "Starting",
    start: "Start",
    end: "End",
    next_day: "next day",
    repeat: "Repeat",
    once: "Once",
    daily: "Every day",
    weekly: "Every week",
    monthly: "Every month",
    every: "Every",
    every_f: "Every",
    days_unit: "days",
    weeks_unit: "weeks",
    months_unit: "months",
    until: "Until",
    holidays: "Public holidays",
    holidays_ignore: "No effect",
    holidays_exclude: "Except public holidays",
    holidays_only: "Public holidays only",
    exceptions: "Exceptions",
    excluded: "Removed days",
    included: "Added days",
    calendar_condition: "Depending on a calendar",
    calendar_hint: "For instance a calendar of school holidays or absences.",
    calendar_exclude: "Except on days it has an event",
    calendar_only: "Only on days it has an event",
    add: "Add",
    look: "Appearance",
    color: "Colour",
    auto: "Auto",
    icon: "Icon",
    start_actions: "Start actions",
    end_actions: "End actions",
    actions_hint: "Run at the start (or end) of each occurrence, as in an automation.",
    note: "Note",
    enabled_event: "Event active",
    delete: "Delete",
    duplicate: "Duplicate",
    cancel: "Cancel",
    save: "Save",
    close: "Close",
    move_title: "Move a repeated occurrence",
    move_text: "Does this change apply to this day only or to the whole series?",
    delete_title: "Delete",
    delete_series_text: "Delete the whole series, or this day only?",
    delete_text: "Delete this event?",
    delete_agenda_text: "Delete this agenda and all its events?",
    kind: "What the agenda controls",
    kinds: {
      none: "Nothing",
      climate: "Thermostats",
      on_off: "On / off",
      cover: "Covers",
      select: "Selector",
      number: "Value",
    },
    kind_hints: {
      none: "Events only run their start and end actions.",
      climate: "Event setpoints are applied to the thermostats; outside events, the one below.",
      other: "Event states are applied to the devices; outside events, the one below.",
    },
    kind_change: "Changing the type clears the state of existing events.",
    entities: "Controlled devices",
    no_entity: "No device of this type.",
    search: "Search",
    resync_on_start: "Bring devices back to the agenda when Home Assistant starts",
    resync_now: "Apply now",
    delete_agenda: "Delete agenda",
    holidays_title: "Shared settings (all agendas)",
    school_calendar: "School holiday calendar",
    school_calendar_hint: "Repeating events can then apply only during school term or only during school holidays.",
    period: "Period",
    periods: { always: "Always", school: "School term", vacation: "School holidays" },
    vacation: "School holidays",
    country: "Country",
    subdivision: "Region",
    ha_country: (name) => `Home Assistant's country (${name})`,
    no_ha_country: "Home Assistant's country (not set)",
    whole_country: "Whole country",
    error: "Error",
    yaml_hint: "List of actions in YAML or JSON, as in an automation.",
    no_state: "None",
    off: "Off",
    on: "On",
    light_on: "On",
    light_off: "Off",
    open: "Open",
    closed: "Closed",
    position: "Position",
    brightness: "Brightness",
    set_brightness: "Set the brightness",
    option: "Option",
    value: "Value",
    n_on: (n, total) => `${n}/${total} on`,
    presets: { comfort: "Comfort", eco: "Eco", frost: "Frost", boost: "Boost", away: "Away", activity: "Activity" },
    weekdays_short: ["M", "T", "W", "T", "F", "S", "S"],
    weekdays_long: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    mon_fri: "Monday to Friday",
    weekend: "Weekends",
    every_day: "Every day",
    every_n_days: (n) => `Every ${n} days`,
    every_n_weeks: (n) => `Every ${n} weeks`,
    every_month: (d) => `Monthly, on the ${d}`,
    every_n_months: (n, d) => `Every ${n} months, on the ${d}`,
    on_day: (d) => `On ${d}`,
    until_day: (d) => `until ${d}`,
    except_holidays: "except holidays",
    only_holidays: "holidays only",
    except_calendar: (name) => `except ${name}`,
    only_calendar: (name) => `only ${name}`,
    school_only: "school term only",
    vacation_only: "school holidays only",
    n_exceptions: (n) => (n === 1 ? "1 exception" : `${n} exceptions`),
  },
};

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
  return T._lang.startsWith("fr") ? s.replace(".", ",") : s;
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
      const d = new Date(start * 60000).getUTCDate();
      text = n === 1 ? T.every_month(d) : T.every_n_months(n, d);
      break;
    }
    default:
      return T.on_day(fmtDay(start, lang, { weekday: "long", day: "numeric", month: "long" }));
  }
  const extra = [];
  if (r.until) extra.push(T.until_day(fmtDay(wm(r.until), lang, { day: "numeric", month: "short", year: "numeric" })));
  if (r.holidays === "exclude") extra.push(T.except_holidays);
  if (r.holidays === "only") extra.push(T.only_holidays);
  if (r.calendar) {
    const name = friendlyName(hass, r.calendar);
    extra.push(r.calendar_mode === "only" ? T.only_calendar(name) : T.except_calendar(name));
  }
  if (r.period === "school") extra.push(T.school_only);
  if (r.period === "vacation") extra.push(T.vacation_only);
  const nx = (r.exclude || []).length + (r.include || []).length;
  if (nx) extra.push(T.n_exceptions(nx));
  return [text, ...extra].join(" · ");
}

export function timeSummary(event, T) {
  if (event.all_day) return T.all_day;
  const s = wm(event.start);
  const e = wm(event.end);
  const nd = dayOf(e) > dayOf(s) && e - dayOf(e) > 0 ? ` (${T.next_day})` : "";
  return `${wallTime(s)} → ${wallTime(e) === "00:00" ? "24:00" : wallTime(e)}${nd}`;
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
