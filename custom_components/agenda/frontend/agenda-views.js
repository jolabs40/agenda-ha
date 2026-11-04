// Week, house and list views, shared by the panel and the card. They return
// HTML; the panel handles interaction through data-* attributes.

const V = new URL(import.meta.url).search;
const {
  DAY,
  dayOf,
  effectiveTimeline,
  HOLIDAYS,
  calendarName,
  esc,
  fmtDay,
  repeatSummary,
  splitByDay,
  stack,
  textColor,
  timeSummary,
  wallDate,
  wallTime,
  wm,
} = await import(`./agenda-lib.js${V}`);
const { eventColor, eventLabel, hasStates, liveIcon, liveText, stateColor, stateLabel } = await import(
  `./agenda-kinds.js${V}`
);

export { liveText };

const pct = (minutes) => `${((minutes / DAY) * 100).toFixed(4)}%`;
const hhmm = (m) => (m === DAY ? "24:00" : wallTime(m));

function occData(agenda, occ) {
  return `data-entry="${esc(agenda.entry_id)}" data-event="${esc(occ.event_id)}" data-day="${esc(occ.day)}" data-start="${esc(occ.start)}" data-end="${esc(occ.end)}" data-allday="${occ.all_day ? 1 : 0}"`;
}

/** Hide labels that do not fit their block. */
export function fitLabels(root) {
  root.querySelectorAll(".seg span, .gap span").forEach((span) => {
    span.style.visibility = "";
    const box = span.parentElement;
    if (span.offsetWidth > box.clientWidth - 4 || span.offsetHeight > box.clientHeight)
      span.style.visibility = "hidden";
  });
  root.querySelectorAll(".ev, .ghost").forEach((ev) => {
    const sub = ev.querySelector(".ev-sub");
    if (sub) sub.style.display = ev.clientHeight < 34 ? "none" : "";
    const cond = ev.querySelector(".ev-cond");
    if (cond) {
      cond.style.display = "";
      if (cond.offsetTop + cond.offsetHeight > ev.clientHeight) cond.style.display = "none";
    }
  });
}

/**
 * ctx: { hass, T, agendas, allAgendas, occ: {entry_id: [occ]}, skipped: {entry_id: [occ with reason]},
 *        holidays: {day: name}, vacation: {day: name}, firstDay, days, now, hourH, editable }
 * allAgendas names the agendas used as condition calendars, shown or not.
 */
export function renderWeek(ctx) {
  const { hass, T, agendas, firstDay, days, now, hourH, editable } = ctx;
  const lang = T._lang;
  const single = agendas.length === 1 ? agendas[0] : null;
  const today = dayOf(now);
  const dayList = Array.from({ length: days }, (_, i) => firstDay + i * DAY);

  const holidays = ctx.holidays || {};
  const vacation = ctx.vacation || {};
  const head = dayList
    .map((d, i) => {
      const isToday = d === today;
      const holiday = holidays[wallDate(d)];
      const school = vacation[wallDate(d)];
      const onVacation = school !== undefined;
      // name the school holidays once, on their first day in view
      const vacationStarts = onVacation && (i === 0 || vacation[wallDate(d - DAY)] === undefined);
      const tip = [holiday, onVacation ? school || T.vacation : null].filter(Boolean).join(" · ");
      let note = "";
      if (holiday) note = `<span class="wk-hol">${esc(holiday)}</span>`;
      else if (vacationStarts) note = `<span class="wk-vac">${esc(school || T.vacation)}</span>`;
      return `<div class="wk-day ${isToday ? "today" : ""} ${holiday ? "holiday" : ""} ${onVacation ? "vacation" : ""}" ${tip ? `title="${esc(tip)}"` : ""}>
        ${editable && days === 7 ? `<button class="wk-copy" data-copy-day="${d}" title="${esc(T.copy_day)}"><ha-icon icon="mdi:content-copy"></ha-icon></button>` : ""}
        <span class="wk-dname">${esc(fmtDay(d, lang, { weekday: "short" }))}</span>
        <span class="wk-dnum">${esc(fmtDay(d, lang, { day: "numeric" }))}</span>
        ${note}
      </div>`;
    })
    .join("");

  const hours = Array.from(
    { length: 24 },
    (_, h) => `<div class="wk-h"><span>${h ? `${String(h).padStart(2, "0")}:00` : ""}</span></div>`,
  ).join("");

  // pieces per day, all agendas together; ghosts are the days a calendar condition removes
  const perDay = Object.fromEntries(dayList.map((d) => [d, []]));
  const ghosts = Object.fromEntries(dayList.map((d) => [d, []]));
  for (const agenda of agendas) {
    const byId = Object.fromEntries(agenda.events.map((e) => [e.id, e]));
    for (const [occs, into] of [
      [ctx.occ[agenda.entry_id], perDay],
      [ctx.skipped?.[agenda.entry_id], ghosts],
    ]) {
      const split = splitByDay(occs || [], firstDay, days);
      for (const d of dayList) {
        for (const piece of split[d]) {
          const event = byId[piece.occ.event_id];
          if (event) into[d].push({ ...piece, agenda, event });
        }
      }
    }
  }
  const timeOf = (occ) => {
    const end = wallTime(wm(occ.end));
    return occ.all_day ? T.all_day : `${wallTime(wm(occ.start))}–${end === "00:00" ? "24:00" : end}`;
  };
  // the calendars a repeating event depends on: + only their days, - except their days
  const all = ctx.allAgendas || agendas;
  const names = Object.fromEntries(all.map((a) => [a.agenda_entities?.calendar, a.name]));
  const colors = Object.fromEntries(all.map((a) => [a.agenda_entities?.calendar, a.settings.color]));
  const nameOf = (id) => names[id] || calendarName(hass, id, T);
  const colorOf = (id) => (id === HOLIDAYS ? "var(--agenda-holiday)" : colors[id] || "currentColor");
  const conditions = (event) => {
    const r = event.repeat || {};
    if (!r.freq || r.freq === "none") return [];
    const only = r.calendar_mode === "only";
    return [
      ...(r.calendars || []).map((id) => [only, id]),
      ...(only ? r.except_calendars || [] : []).map((id) => [false, id]),
    ];
  };
  // the calendar with something that day gets its colour around it: what runs or skips the event
  const condHtml = (event, occ) => {
    const list = conditions(event);
    if (!list.length) return "";
    const busy = occ.busy || [];
    const items = list.map(([plus, id]) => {
      const hit = busy.includes(id) ? ` class="hit" style="--k:${esc(colorOf(id))}"` : "";
      return `<span${hit}><ha-icon icon="mdi:${plus ? "plus" : "minus"}"></ha-icon><em>${esc(nameOf(id))}</em></span>`;
    });
    return `<div class="ev-cond">${items.join("")}</div>`;
  };
  const condText = (event) =>
    conditions(event)
      .map(([plus, id]) => `${plus ? "+" : "-"} ${nameOf(id)}`)
      .join(", ");
  const mainLabel = (agenda, event) =>
    hasStates(agenda) && event.state ? stateLabel(hass, agenda, event.state, T) : eventLabel(hass, agenda, event, T);

  const cols = dayList
    .map((d) => {
      let html = "";
      // show the default state in the gaps when a single agenda is displayed
      if (single && hasStates(single) && single.settings.default_state) {
        const st = single.settings.default_state;
        const color = stateColor(hass, single, st);
        const label = stateLabel(hass, single, st, T);
        const occs = (ctx.occ[single.entry_id] || []).filter((o) => {
          const e = single.events.find((x) => x.id === o.event_id);
          return e && e.state;
        });
        for (const seg of effectiveTimeline(single, occs, d, d + DAY, true)) {
          if (seg.occ) continue;
          const h = seg.to - seg.from;
          html += `<div class="gap" style="top:${pct(seg.from - d)};height:${pct(h)};--c:${esc(color)}" data-gap-day="${d}">
            ${h >= 45 ? `<span>${esc(label)}</span>` : ""}</div>`;
        }
      }
      for (const g of ghosts[d]) {
        const { agenda, event, occ } = g;
        const h = g.to - g.from;
        const r = event.repeat || {};
        const only = occ.reason === "only";
        const ids = (only || r.calendar_mode !== "only" ? r.calendars : r.except_calendars) || [];
        const why = `${only ? T.calendar_only : T.calendar_exclude} (${ids.map(nameOf).join(", ")})`;
        const tip = [single ? "" : agenda.name, eventLabel(hass, agenda, event, T), timeOf(occ), T.skipped, why];
        const short = (h / 60) * hourH < 40;
        const cond = short ? "" : condHtml(event, occ);
        html += `<div class="ghost ${short ? "short" : ""} ${g.first ? "" : "cont"} ${g.last ? "" : "open"}"
            style="top:${pct(g.from)};height:${pct(h)};--c:${esc(eventColor(hass, agenda, event))}"
            data-entry="${esc(agenda.entry_id)}" data-ghost="${esc(event.id)}" title="${esc(tip.filter(Boolean).join(" · "))}">
          <div class="ev-main">${esc(mainLabel(agenda, event))}</div>
          ${short ? "" : `<div class="ev-sub">${esc(T.skipped)}</div>`}${cond}
        </div>`;
      }
      for (const p of stack(perDay[d])) {
        const { agenda, event, occ } = p;
        const color = eventColor(hass, agenda, event);
        const tc = event.text_color || textColor(color);
        const h = p.to - p.from;
        const main = mainLabel(agenda, event);
        const subName = hasStates(agenda) && event.state && event.name ? event.name : "";
        const prefix = single ? "" : agenda.name;
        const time = timeOf(occ);
        const short = (h / 60) * hourH < 40;
        const indent = Math.min(p.depth, 3) * 14;
        html += `<div class="ev ${short ? "short" : ""} ${occ.all_day ? "allday" : ""} ${p.first ? "" : "cont"} ${p.last ? "" : "open"}"
            style="top:${pct(p.from)};height:${pct(h)};left:calc(${indent}% + 2px);z-index:${2 + p.depth};--c:${esc(color)};--t:${esc(tc)};--a:${esc(agenda.settings.color)}"
            ${occData(agenda, occ)} title="${esc([prefix, eventLabel(hass, agenda, event, T), time, condText(event)].filter(Boolean).join(" · "))}">
          ${event.icon ? `<ha-icon icon="${esc(event.icon)}"></ha-icon>` : ""}
          <div class="ev-main">${esc(main)}</div>
          ${short ? "" : `<div class="ev-sub">${esc([prefix, subName, time].filter(Boolean).join(" · "))}</div>${condHtml(event, occ)}`}
          ${editable && !occ.all_day && p.last ? `<div class="ev-resize" data-resize="1"></div>` : ""}
        </div>`;
      }
      if (d === today) {
        html += `<div class="now" style="top:${pct(now - d)}"></div>`;
      }
      return `<div class="wk-col ${d === today ? "today" : ""}" data-col-day="${d}">${html}</div>`;
    })
    .join("");

  return `<div class="wk" style="--hour-h:${hourH}px;--days:${days}">
    <div class="wk-head"><div class="wk-corner"></div>${head}</div>
    <div class="wk-body">
      <div class="wk-hours">${hours}</div>
      <div class="wk-cols">${cols}</div>
    </div>
  </div>`;
}

/**
 * ctx: { hass, T, agendas, occ, holidays, vacation, firstDay, weeks, month, now }
 * `month` is the 0-11 month shown; days of the other months are dimmed.
 */
export function renderMonth(ctx) {
  const { hass, T, agendas, firstDay, weeks, month, now } = ctx;
  const lang = T._lang;
  const today = dayOf(now);
  const days = weeks * 7;
  const holidays = ctx.holidays || {};
  const vacation = ctx.vacation || {};
  const single = agendas.length === 1;

  // each occurrence is listed on the day it starts, or on the first day shown
  const perDay = {};
  for (const agenda of agendas) {
    const byId = Object.fromEntries(agenda.events.map((e) => [e.id, e]));
    const split = splitByDay(ctx.occ[agenda.entry_id] || [], firstDay, days);
    for (const [d, pieces] of Object.entries(split)) {
      for (const piece of pieces) {
        const event = byId[piece.occ.event_id];
        if (event && (piece.first || Number(d) === firstDay))
          (perDay[d] ||= []).push({ agenda, event, occ: piece.occ });
      }
    }
  }

  const head = Array.from(
    { length: 7 },
    (_, i) => `<div class="mo-wd">${esc(fmtDay(firstDay + i * DAY, lang, { weekday: "short" }))}</div>`,
  ).join("");
  const cells = Array.from({ length: days }, (_, i) => {
    const d = firstDay + i * DAY;
    const iso = wallDate(d);
    const items = (perDay[d] || []).sort((a, b) => wm(a.occ.start) - wm(b.occ.start));
    const shown = items.length > 4 ? items.slice(0, 3) : items;
    const chips = shown
      .map(({ agenda, event, occ }) => {
        const color = eventColor(hass, agenda, event);
        const label =
          hasStates(agenda) && event.state
            ? stateLabel(hass, agenda, event.state, T)
            : eventLabel(hass, agenda, event, T);
        const time = occ.all_day ? "" : wallTime(wm(occ.start));
        const tip = [single ? "" : agenda.name, eventLabel(hass, agenda, event, T), time].filter(Boolean).join(" · ");
        return `<div class="mo-ev" ${occData(agenda, occ)} style="--c:${esc(color)};--t:${esc(textColor(color))}" title="${esc(tip)}">
          ${time ? `<b>${time}</b>` : ""}<span>${esc(label)}</span></div>`;
      })
      .join("");
    const more =
      items.length > shown.length
        ? `<div class="mo-more">${esc(T.more_events(items.length - shown.length))}</div>`
        : "";
    const outside = new Date(d * 60000).getUTCMonth() !== month;
    const note = holidays[iso] ? `<span class="mo-hol">${esc(holidays[iso])}</span>` : "";
    return `<div class="mo-day ${outside ? "out" : ""} ${d === today ? "today" : ""} ${holidays[iso] ? "holiday" : ""} ${vacation[iso] !== undefined ? "vacation" : ""}"
        title="${esc([holidays[iso], vacation[iso] !== undefined ? vacation[iso] || T.vacation : ""].filter(Boolean).join(" · "))}">
      <div class="mo-top"><button class="mo-num" data-mo-day="${d}">${esc(fmtDay(d, lang, { day: "numeric" }))}</button>${note}</div>
      ${chips}${more}
    </div>`;
  }).join("");
  return `<div class="mo" style="--weeks:${weeks}"><div class="mo-head">${head}</div><div class="mo-grid">${cells}</div></div>`;
}

/** ctx: { hass, T, agendas, occ, day, now } */
export function renderHouse(ctx) {
  const { hass, T, agendas, day, now } = ctx;
  const ticks = [0, 3, 6, 9, 12, 15, 18, 21, 24]
    .map((h) => `<span style="left:${pct(h * 60)}">${String(h).padStart(2, "0")}h</span>`)
    .join("");
  const isToday = dayOf(now) === day;

  const rows = agendas
    .map((agenda) => {
      const occs = ctx.occ[agenda.entry_id] || [];
      const withState = hasStates(agenda);
      const segs = effectiveTimeline(agenda, occs, day, day + DAY, withState);
      const segHtml = segs
        .map((seg) => {
          const w = seg.to - seg.from;
          let color;
          let label;
          let cls = "seg";
          let data = `data-entry="${esc(agenda.entry_id)}" data-gap-day="${day}" data-gap-from="${seg.from}"`;
          if (seg.occ) {
            color = eventColor(hass, agenda, seg.event);
            label =
              withState && seg.event.state
                ? stateLabel(hass, agenda, seg.event.state, T, false)
                : eventLabel(hass, agenda, seg.event, T);
            data = occData(agenda, seg.occ);
          } else if (withState && agenda.settings.default_state) {
            color = stateColor(hass, agenda, agenda.settings.default_state);
            label = stateLabel(hass, agenda, agenda.settings.default_state, T, false);
            cls += " gap";
          } else {
            cls += " empty";
            color = "transparent";
            label = "";
          }
          const tip = `${hhmm(seg.from - day)}–${hhmm(seg.to - day)}${label ? " · " + label : ""}`;
          return `<div class="${cls}" style="left:${pct(seg.from - day)};width:${pct(w)};--c:${esc(color)};--t:${esc(textColor(color))}" ${data} title="${esc(tip)}">
            ${w >= 75 && label ? `<span>${esc(label)}</span>` : ""}</div>`;
        })
        .join("");
      return `<div class="hs-row ${agenda.enabled ? "" : "paused"}">
        <div class="hs-name" data-select="${esc(agenda.entry_id)}">
          <span class="dot" style="--c:${esc(agenda.settings.color)}"></span>
          <div><b>${esc(agenda.name)}</b><small><ha-icon icon="${liveIcon(agenda)}"></ha-icon><span data-live="${esc(agenda.entry_id)}">${esc(liveText(hass, agenda, T))}</span></small></div>
        </div>
        <div class="hs-track">${segHtml}${isToday ? `<div class="now v" style="left:${pct(now - day)}"></div>` : ""}</div>
      </div>`;
    })
    .join("");

  return `<div class="hs">
    <div class="hs-scale"><div class="hs-name"></div><div class="hs-ticks">${ticks}</div></div>
    ${rows}
  </div>`;
}

/** ctx: { hass, T, agendas, editable } */
export function renderList(ctx) {
  const { hass, T, agendas, editable } = ctx;
  return agendas
    .map((agenda) => {
      const events = [...agenda.events].sort((a, b) => {
        const ta = a.all_day ? -1 : wm(a.start) - dayOf(wm(a.start));
        const tb = b.all_day ? -1 : wm(b.start) - dayOf(wm(b.start));
        return ta - tb || (a.name || "").localeCompare(b.name || "");
      });
      const rows = events.length
        ? events
            .map((event) => {
              const color = eventColor(hass, agenda, event);
              const main =
                hasStates(agenda) && event.state
                  ? stateLabel(hass, agenda, event.state, T)
                  : eventLabel(hass, agenda, event, T);
              const name = hasStates(agenda) && event.state ? event.name : "";
              return `<div class="li ${event.enabled === false ? "off" : ""}" data-edit="${esc(event.id)}" data-entry="${esc(agenda.entry_id)}">
                <span class="sw" style="--c:${esc(color)};--t:${esc(textColor(color))}">${esc(main)}</span>
                <div class="li-text">
                  <b>${esc(timeSummary(event, T))}</b>${name ? ` <span class="li-name">${esc(name)}</span>` : ""}
                  <small>${esc(repeatSummary(event, T, hass))}</small>
                </div>
                ${
                  editable
                    ? `<button class="ic li-toggle" data-toggle="${esc(event.id)}" data-entry="${esc(agenda.entry_id)}" title="${esc(T.enabled_event)}">
                  <ha-icon icon="${event.enabled === false ? "mdi:eye-off-outline" : "mdi:eye-outline"}"></ha-icon></button>`
                    : ""
                }
              </div>`;
            })
            .join("")
        : `<div class="li-empty">${esc(T.no_event)}</div>`;
      const def =
        hasStates(agenda) && agenda.settings.default_state
          ? `<div class="li-default"><span class="sw" style="--c:${esc(stateColor(hass, agenda, agenda.settings.default_state))};--t:#1f1f1f">${esc(stateLabel(hass, agenda, agenda.settings.default_state, T))}</span><small>${esc(T.default_state)}</small></div>`
          : "";
      return `<section class="ls">
        <header><span class="dot" style="--c:${esc(agenda.settings.color)}"></span><b>${esc(agenda.name)}</b>${def}</header>
        ${rows}
      </section>`;
    })
    .join("");
}

export const VIEW_STYLES = `
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); flex: none; }

  /* ---- week ---- */
  .wk { --gutter: 46px; display: flex; flex-direction: column; min-width: calc(var(--gutter) + var(--days) * 78px); }
  .wk-head { display: grid; grid-template-columns: var(--gutter) repeat(var(--days), 1fr); position: sticky; top: 0; z-index: 20;
    background: var(--card-background-color); border-bottom: 1px solid var(--divider-color); }
  .wk-day { display: flex; flex-direction: column; align-items: center; padding: 6px 0 8px; gap: 2px; color: var(--secondary-text-color); }
  .wk-dname { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
  .wk-dnum { font-size: 20px; font-weight: 500; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; color: var(--primary-text-color); }
  .wk-day.today .wk-dname { color: var(--primary-color); font-weight: 600; }
  .wk-day.today .wk-dnum { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .wk-day { min-width: 0; position: relative; }
  .wk-copy { position: absolute; top: 4px; right: 4px; width: 26px; height: 26px; display: grid; place-items: center; border: none; border-radius: 50%;
    background: none; color: var(--secondary-text-color); cursor: pointer; opacity: 0; transition: opacity .15s; }
  .wk-copy ha-icon { --mdc-icon-size: 15px; }
  .wk-day:hover .wk-copy, .wk-copy:focus-visible { opacity: .8; }
  .wk-copy:hover { background: var(--agenda-hover); opacity: 1; }
  @media (hover: none) { .wk-copy { opacity: .55; } }
  .wk-hol { font-size: 10px; line-height: 1.2; color: var(--agenda-holiday); max-width: calc(100% - 6px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wk-day.holiday .wk-dname { color: var(--agenda-holiday); }
  .wk-day.vacation { box-shadow: inset 0 -3px 0 var(--agenda-vacation); }
  .wk-vac { font-size: 10px; line-height: 1.2; color: var(--agenda-vacation); max-width: calc(100% - 6px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wk-body { display: grid; grid-template-columns: var(--gutter) 1fr; position: relative; }
  .wk-hours .wk-h { height: var(--hour-h); position: relative; }
  .wk-hours .wk-h span { position: absolute; top: -7px; right: 6px; font-size: 10.5px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .wk-cols { display: grid; grid-template-columns: repeat(var(--days), 1fr); height: calc(var(--hour-h) * 24); }
  .wk-col { position: relative; border-left: 1px solid var(--divider-color);
    background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--hour-h) - 1px), var(--agenda-line) calc(var(--hour-h) - 1px), var(--agenda-line) var(--hour-h));
    cursor: copy; }
  .wk-col.today { background-color: var(--agenda-today); }
  .ev { position: absolute; right: 2px; box-sizing: border-box; border-radius: 6px; padding: 3px 6px; overflow: hidden;
    background: var(--c); color: var(--t); cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: auto;
    box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 3px 0 0 rgba(0,0,0,.12); transition: box-shadow .15s, filter .15s; }
  .ev:hover { box-shadow: 0 3px 10px rgba(0,0,0,.28), inset 3px 0 0 rgba(0,0,0,.12); filter: saturate(1.08); }
  .ev.cont { border-top-left-radius: 0; border-top-right-radius: 0; }
  .ev.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .ev ha-icon { --mdc-icon-size: 15px; position: absolute; top: 3px; right: 4px; opacity: .8; }
  .ev-main { font-weight: 700; font-size: 14px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev-sub { font-size: 11px; line-height: 1.25; opacity: .85; white-space: normal; overflow: hidden; }
  .ev.short { display: flex; align-items: center; padding-top: 0; padding-bottom: 0; }
  .ev.short .ev-main { font-size: 12px; }
  .ev.armed { outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .ev.dragging { opacity: .85; box-shadow: 0 8px 22px rgba(0,0,0,.35); z-index: 50 !important; cursor: grabbing; transition: none; }
  .ev-resize { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; cursor: ns-resize; }
  .ev-resize::after { content: ""; position: absolute; left: 50%; bottom: 2px; width: 18px; margin-left: -9px; height: 3px; border-radius: 2px; background: currentColor; opacity: 0; transition: opacity .15s; }
  .ev:hover .ev-resize::after { opacity: .45; }
  .gap { position: absolute; left: 2px; right: 2px; border-radius: 6px; box-sizing: border-box;
    background: color-mix(in srgb, var(--c) 16%, transparent); border: 1px dashed color-mix(in srgb, var(--c) 55%, transparent);
    pointer-events: none; }
  .gap span { display: block; padding: 3px 6px; font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--c) 60%, var(--primary-text-color)); }
  .ghost { position: absolute; left: 2px; right: 2px; z-index: 1; box-sizing: border-box; border-radius: 6px; padding: 3px 6px; overflow: hidden;
    border: 1px dashed color-mix(in srgb, var(--c) 70%, transparent); cursor: pointer;
    background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--c) 20%, transparent) 0 5px, transparent 5px 10px);
    color: color-mix(in srgb, var(--c) 55%, var(--primary-text-color)); }
  .ghost:hover { background-color: color-mix(in srgb, var(--c) 10%, transparent); }
  .ghost .ev-main { font-size: 13px; font-weight: 600; text-decoration: line-through; }
  .ev-cond { display: flex; flex-wrap: wrap; gap: 3px 4px; margin-top: 4px; font-size: 11px; font-weight: 700; line-height: 1.4; }
  .ev-cond span { display: inline-flex; align-items: center; gap: 1px; white-space: nowrap; padding: 0 7px 0 3px; border-radius: 99px;
    background: color-mix(in srgb, currentColor 15%, transparent); max-width: 100%; box-sizing: border-box; }
  .ev-cond em { font-style: normal; overflow: hidden; text-overflow: ellipsis; }
  .ev-cond span { border: 2px solid transparent; }
  .ev-cond span.hit { border-color: var(--k); }
  .ev .ev-cond ha-icon, .ghost .ev-cond ha-icon { --mdc-icon-size: 13px; position: static; opacity: 1; }
  .ghost.short { display: flex; align-items: center; padding-top: 0; padding-bottom: 0; }
  .ghost.short .ev-main { font-size: 12px; }
  .ghost.cont { border-top-left-radius: 0; border-top-right-radius: 0; border-top-style: none; }
  .ghost.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; border-bottom-style: none; }
  .now { position: absolute; left: -1px; right: 0; height: 2px; background: var(--agenda-now); z-index: 30; pointer-events: none; }
  .now::before { content: ""; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--agenda-now); }
  .now.v { top: 0; bottom: 0; width: 2px; height: auto; left: auto; }
  .now.v::before { left: -4px; top: -5px; }
  .drag-tip { position: fixed; z-index: 1000; pointer-events: none; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: var(--primary-text-color); color: var(--card-background-color); box-shadow: 0 2px 8px rgba(0,0,0,.3); }

  /* ---- month ---- */
  .mo { display: flex; flex-direction: column; height: 100%; min-height: calc(var(--weeks) * 92px + 32px); min-width: 560px; }
  .mo-head { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 1px solid var(--divider-color); }
  .mo-wd { padding: 8px 0; text-align: center; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); }
  .mo-grid { flex: 1; display: grid; grid-template-columns: repeat(7, 1fr); grid-template-rows: repeat(var(--weeks), minmax(92px, 1fr)); }
  .mo-day { min-width: 0; padding: 4px 4px 6px; border-right: 1px solid var(--agenda-line); border-bottom: 1px solid var(--agenda-line);
    display: flex; flex-direction: column; gap: 3px; overflow: hidden; }
  .mo-day:nth-child(7n) { border-right: none; }
  .mo-day.out { background: var(--agenda-track); }
  .mo-day.out .mo-num { opacity: .45; }
  .mo-day.today { background: var(--agenda-today); }
  .mo-day.vacation { box-shadow: inset 0 -3px 0 var(--agenda-vacation); }
  .mo-top { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .mo-num { font: inherit; font-size: 13px; font-weight: 600; border: none; background: none; color: var(--primary-text-color); cursor: pointer;
    min-width: 24px; height: 24px; border-radius: 12px; padding: 0 6px; flex: none; }
  .mo-num:hover { background: var(--agenda-hover); }
  .mo-day.today .mo-num { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .mo-day.holiday .mo-num { color: var(--agenda-holiday); }
  .mo-day.today.holiday .mo-num { color: var(--text-primary-color, #fff); }
  .mo-hol { font-size: 10px; color: var(--agenda-holiday); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mo-ev { display: flex; gap: 5px; align-items: baseline; padding: 1px 6px; border-radius: 5px; font-size: 12px; line-height: 1.5;
    background: var(--c); color: var(--t); cursor: pointer; white-space: nowrap; overflow: hidden; }
  .mo-ev b { font-weight: 600; font-variant-numeric: tabular-nums; flex: none; }
  .mo-ev span { overflow: hidden; text-overflow: ellipsis; }
  .mo-more { font-size: 11.5px; color: var(--secondary-text-color); padding: 0 6px; }

  /* ---- house ---- */
  .hs { --name-w: 190px; display: flex; flex-direction: column; gap: 10px; padding: 8px 4px 4px; }
  .hs-scale, .hs-row { display: grid; grid-template-columns: var(--name-w) 1fr; align-items: center; gap: 12px; }
  .hs-ticks { position: relative; height: 16px; }
  .hs-ticks span { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .hs-ticks span:first-child { transform: none; }
  .hs-ticks span:last-child { transform: translateX(-100%); }
  .hs-name { display: flex; align-items: center; gap: 10px; min-width: 0; cursor: pointer; }
  .hs-name div { display: flex; flex-direction: column; min-width: 0; }
  .hs-name b { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hs-name small { color: var(--secondary-text-color); font-size: 12px; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 3px; white-space: nowrap; overflow: hidden; }
  .hs-name small ha-icon { --mdc-icon-size: 13px; opacity: .7; flex: none; }
  .hs-name small:has(span:empty) { display: none; }
  .hs-row .dot { width: 12px; height: 12px; }
  .hs-row.paused { opacity: .5; }
  .hs-track { position: relative; height: 46px; border-radius: 10px; overflow: hidden; background: var(--agenda-track);
    background-image: repeating-linear-gradient(to right, transparent 0, transparent calc(100% / 8 - 1px), var(--agenda-line) calc(100% / 8 - 1px), var(--agenda-line) calc(100% / 8)); }
  .seg { position: absolute; top: 0; bottom: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
    background: var(--c); color: var(--t); border-right: 1px solid rgba(255,255,255,.35); cursor: pointer; overflow: hidden; transition: filter .15s; }
  .seg:hover { filter: brightness(1.06) saturate(1.1); }
  .seg span { font-weight: 700; font-size: 13px; white-space: nowrap; padding: 0 4px; }
  .seg.gap { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--primary-text-color); }
  .seg.gap span { font-weight: 500; opacity: .75; }
  .seg.empty { cursor: copy; border: none; }

  /* ---- list ---- */
  .ls { padding: 4px 0 12px; }
  .ls header { display: flex; align-items: center; gap: 10px; padding: 10px 8px; font-size: 16px; }
  .li-default { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--secondary-text-color); }
  .li { display: grid; grid-template-columns: 96px 1fr auto; align-items: center; gap: 14px; padding: 8px; border-radius: 10px; cursor: pointer; }
  .li:hover { background: var(--agenda-hover); }
  .li.off { opacity: .45; }
  .sw { display: inline-flex; align-items: center; justify-content: center; min-height: 30px; padding: 2px 10px; border-radius: 8px;
    background: var(--c); color: var(--t); font-weight: 700; font-size: 13px; text-align: center; box-sizing: border-box; }
  .li .sw { width: 96px; }
  .li-text { display: flex; flex-direction: column; min-width: 0; }
  .li-text b { font-weight: 600; font-variant-numeric: tabular-nums; }
  .li-name { color: var(--secondary-text-color); }
  .li-text small { color: var(--secondary-text-color); font-size: 12.5px; }
  .li-empty { padding: 8px 12px 16px; color: var(--secondary-text-color); }
`;
