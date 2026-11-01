// Week, house and list views, shared by the panel and the card. They return
// HTML; the panel handles interaction through data-* attributes.

const V = new URL(import.meta.url).search;
const {
  DAY,
  dayOf,
  effectiveTimeline,
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
  root.querySelectorAll(".ev").forEach((ev) => {
    const sub = ev.querySelector(".ev-sub");
    if (sub) sub.style.display = ev.clientHeight < 34 ? "none" : "";
  });
}

/**
 * ctx: { hass, T, agendas, occ: {entry_id: [occ]}, holidays: {day: name}, vacation: {day: name},
 *        firstDay, days, now, hourH, editable }
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

  // pieces per day, all agendas together
  const perDay = Object.fromEntries(dayList.map((d) => [d, []]));
  for (const agenda of agendas) {
    const byId = Object.fromEntries(agenda.events.map((e) => [e.id, e]));
    const split = splitByDay(ctx.occ[agenda.entry_id] || [], firstDay, days);
    for (const d of dayList) {
      for (const piece of split[d]) {
        const event = byId[piece.occ.event_id];
        if (event) perDay[d].push({ ...piece, agenda, event });
      }
    }
  }

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
          html += `<div class="gap" style="top:${pct(seg.from - d)};height:${pct(h)};--c:${color}" data-gap-day="${d}">
            ${h >= 45 ? `<span>${esc(label)}</span>` : ""}</div>`;
        }
      }
      for (const p of stack(perDay[d])) {
        const { agenda, event, occ } = p;
        const color = eventColor(hass, agenda, event);
        const tc = event.text_color || textColor(color);
        const h = p.to - p.from;
        const main =
          hasStates(agenda) && event.state
            ? stateLabel(hass, agenda, event.state, T)
            : eventLabel(hass, agenda, event, T);
        const subName = hasStates(agenda) && event.state && event.name ? event.name : "";
        const prefix = single ? "" : agenda.name;
        const endTime = wallTime(wm(occ.end));
        const time = occ.all_day ? T.all_day : `${wallTime(wm(occ.start))}–${endTime === "00:00" ? "24:00" : endTime}`;
        const short = (h / 60) * hourH < 40;
        const indent = Math.min(p.depth, 3) * 14;
        html += `<div class="ev ${short ? "short" : ""} ${occ.all_day ? "allday" : ""} ${p.first ? "" : "cont"} ${p.last ? "" : "open"}"
            style="top:${pct(p.from)};height:${pct(h)};left:calc(${indent}% + 2px);z-index:${2 + p.depth};--c:${color};--t:${tc};--a:${agenda.settings.color}"
            ${occData(agenda, occ)} title="${esc(`${prefix ? prefix + " · " : ""}${eventLabel(hass, agenda, event, T)} · ${time}`)}">
          ${event.icon ? `<ha-icon icon="${esc(event.icon)}"></ha-icon>` : ""}
          <div class="ev-main">${esc(main)}</div>
          ${short ? "" : `<div class="ev-sub">${esc([prefix, subName, time].filter(Boolean).join(" · "))}</div>`}
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
          return `<div class="${cls}" style="left:${pct(seg.from - day)};width:${pct(w)};--c:${color};--t:${textColor(color)}" ${data} title="${esc(tip)}">
            ${w >= 75 && label ? `<span>${esc(label)}</span>` : ""}</div>`;
        })
        .join("");
      return `<div class="hs-row ${agenda.enabled ? "" : "paused"}">
        <div class="hs-name" data-select="${esc(agenda.entry_id)}">
          <span class="dot" style="--c:${agenda.settings.color}"></span>
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
                <span class="sw" style="--c:${color};--t:${textColor(color)}">${esc(main)}</span>
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
          ? `<div class="li-default"><span class="sw" style="--c:${stateColor(hass, agenda, agenda.settings.default_state)};--t:#1f1f1f">${esc(stateLabel(hass, agenda, agenda.settings.default_state, T))}</span><small>${esc(T.default_state)}</small></div>`
          : "";
      return `<section class="ls">
        <header><span class="dot" style="--c:${agenda.settings.color}"></span><b>${esc(agenda.name)}</b>${def}</header>
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
  .wk-day { min-width: 0; }
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
    background: var(--c); color: var(--t); cursor: pointer; user-select: none; touch-action: auto;
    box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 3px 0 0 rgba(0,0,0,.12); transition: box-shadow .15s, filter .15s; }
  .ev:hover { box-shadow: 0 3px 10px rgba(0,0,0,.28), inset 3px 0 0 rgba(0,0,0,.12); filter: saturate(1.08); }
  .ev.cont { border-top-left-radius: 0; border-top-right-radius: 0; }
  .ev.open { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .ev ha-icon { --mdc-icon-size: 15px; position: absolute; top: 3px; right: 4px; opacity: .8; }
  .ev-main { font-weight: 700; font-size: 14px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ev-sub { font-size: 11px; line-height: 1.25; opacity: .85; white-space: normal; overflow: hidden; }
  .ev.short { display: flex; align-items: center; padding-top: 0; padding-bottom: 0; }
  .ev.short .ev-main { font-size: 12px; }
  .ev.dragging { opacity: .85; box-shadow: 0 8px 22px rgba(0,0,0,.35); z-index: 50 !important; cursor: grabbing; transition: none; }
  .ev-resize { position: absolute; left: 0; right: 0; bottom: 0; height: 8px; cursor: ns-resize; }
  .ev-resize::after { content: ""; position: absolute; left: 50%; bottom: 2px; width: 18px; margin-left: -9px; height: 3px; border-radius: 2px; background: currentColor; opacity: 0; transition: opacity .15s; }
  .ev:hover .ev-resize::after { opacity: .45; }
  .gap { position: absolute; left: 2px; right: 2px; border-radius: 6px; box-sizing: border-box;
    background: color-mix(in srgb, var(--c) 16%, transparent); border: 1px dashed color-mix(in srgb, var(--c) 55%, transparent);
    pointer-events: none; }
  .gap span { display: block; padding: 3px 6px; font-size: 11px; font-weight: 600; color: color-mix(in srgb, var(--c) 60%, var(--primary-text-color)); }
  .now { position: absolute; left: -1px; right: 0; height: 2px; background: var(--agenda-now); z-index: 30; pointer-events: none; }
  .now::before { content: ""; position: absolute; left: -5px; top: -4px; width: 10px; height: 10px; border-radius: 50%; background: var(--agenda-now); }
  .now.v { top: 0; bottom: 0; width: 2px; height: auto; left: auto; }
  .now.v::before { left: -4px; top: -5px; }
  .drag-tip { position: fixed; z-index: 1000; pointer-events: none; padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
    background: var(--primary-text-color); color: var(--card-background-color); box-shadow: 0 2px 8px rgba(0,0,0,.3); }

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
