// Dialogs: event editor, agenda settings, confirm and prompt. Each one opens in
// the panel's #dialog container and resolves a promise when closed.

const V = new URL(import.meta.url).search;
const {
  DAY,
  HOLIDAYS,
  dayOf,
  calendarName,
  esc,
  fmtDay,
  friendlyName,
  areaName,
  loadHaComponents,
  monthlyLabel,
  wall,
  wallDate,
  wallTime,
  weekday,
  wm,
} = await import(`./agenda-lib.js${V}`);

const SUN_LIMIT = 720; // minutes of offset, as on the server

/** "HH:MM" plus minutes, wrapped around the day. */
const addMinutes = (hhmm, minutes) => wallTime(wm(`2000-01-01T${hhmm}`) + minutes);
const minutesOf = (hhmm) => wm(`2000-01-01T${hhmm}`) - wm("2000-01-01T00:00");
const kinds = await import(`./agenda-kinds.js${V}`);

const SWATCHES = [
  "#ef6c00",
  "#e53935",
  "#d81b60",
  "#8e24aa",
  "#3949ab",
  "#1e88e5",
  "#00897b",
  "#43a047",
  "#c0ca33",
  "#fdd835",
  "#6d4c41",
  "#546e7a",
];

class Dialog {
  constructor(host, { title, wide = false }) {
    this.host = host; // the panel's #dialog element
    this.wide = wide;
    this.title = title;
    this.done = new Promise((resolve) => (this._resolve = resolve));
  }

  open(body, footer, headerExtra = "", closeLabel = "Close") {
    const root = document.createElement("div");
    root.className = "dlg-back";
    root.innerHTML = `<div class="dlg ${this.wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <header class="dlg-head"><h2>${esc(this.title)}</h2>${headerExtra}
        <button class="ic" data-close title="${esc(closeLabel)}"><ha-icon icon="mdi:close"></ha-icon></button></header>
      <div class="dlg-body">${body}</div>
      <footer class="dlg-foot">${footer}</footer>
      <div class="dlg-error" hidden></div>
    </div>`;
    this.root = root;
    this.host.appendChild(root);
    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.closest("[data-close]")) this.close(null);
    });
    this._key = (e) => {
      if (e.key === "Escape" && this.host.lastElementChild === root) this.close(null);
    };
    window.addEventListener("keydown", this._key);
    requestAnimationFrame(() => root.classList.add("in"));
    return root;
  }

  $(sel) {
    return this.root.querySelector(sel);
  }

  $$(sel) {
    return [...this.root.querySelectorAll(sel)];
  }

  error(message) {
    const box = this.$(".dlg-error");
    box.hidden = !message;
    box.textContent = message || "";
  }

  busy(on) {
    this.$$(".dlg-foot button").forEach((b) => (b.disabled = on));
  }

  async run(fn, T) {
    this.error("");
    this.busy(true);
    try {
      await fn();
    } catch (err) {
      this.error(`${T.error} : ${err?.message || err}`);
      this.busy(false);
    }
  }

  close(value) {
    window.removeEventListener("keydown", this._key);
    this.root?.remove();
    this._resolve(value);
  }
}

export function confirmDialog(host, { title, text, buttons }) {
  const dlg = new Dialog(host, { title });
  const footer = buttons
    .map(
      (b) =>
        `<button class="btn ${b.primary ? "primary" : ""} ${b.danger ? "danger" : ""}" data-value="${esc(b.value)}">${esc(b.label)}</button>`,
    )
    .join("");
  dlg.open(`<p class="dlg-text">${esc(text)}</p>`, `<span class="grow"></span>${footer}`);
  dlg.$$("[data-value]").forEach((b) => b.addEventListener("click", () => dlg.close(b.dataset.value)));
  return dlg.done;
}

/** On a phone, which calendars that are not agendas to show. Resolves with their ids on close. */
export function calendarsDialog(host, { T, calendars, selected }) {
  const dlg = new Dialog(host, { title: T.other_calendars });
  const rows = calendars
    .map(
      (c) =>
        `<label class="tgl xcal-row"><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id) ? "checked" : ""}><span></span><i class="dot" style="--c:${esc(c.color)}"></i>${esc(c.name)}</label>`,
    )
    .join("");
  dlg.open(
    `<p class="hint">${esc(T.other_calendars_hint)}</p><div class="xcal-list">${rows}</div>`,
    `<span class="grow"></span><button class="btn primary" data-ok>${esc(T.close)}</button>`,
  );
  const picked = () => dlg.$$(".xcal-row input:checked").map((i) => i.value);
  dlg.$("[data-ok]").addEventListener("click", () => dlg.close(picked()));
  // closing by the cross or outside keeps what was ticked as well
  const close = dlg.close.bind(dlg);
  dlg.close = (value) => close(value === null && dlg.root ? picked() : value);
  return dlg.done;
}

export function promptDialog(host, { title, label, value = "", hint = "", ok }) {
  const dlg = new Dialog(host, { title });
  dlg.open(
    `<label class="fld"><span>${esc(label)}</span><input class="inp" data-input value="${esc(value)}" autofocus>${hint ? `<p class="hint">${esc(hint)}</p>` : ""}</label>`,
    `<span class="grow"></span><button class="btn" data-close>${esc(ok.cancel)}</button><button class="btn primary" data-ok>${esc(ok.label)}</button>`,
  );
  const input = dlg.$("[data-input]");
  setTimeout(() => input.focus(), 50);
  const submit = () => input.value.trim() && dlg.close(input.value.trim());
  dlg.$("[data-ok]").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  return dlg.done;
}

/**
 * Start, change or end the absence mode. `absence` is the shared value ({until} or null),
 * `now` the wall minutes in Home Assistant's zone. Resolves with "saved" or null.
 */
export function absenceDialog(host, { T, absence, now, ws }) {
  const dlg = new Dialog(host, { title: T.absence_title });
  // by default, a week later at the next full hour
  const until = absence?.until || wall(Math.ceil((now + 7 * DAY) / 60) * 60);
  const open = Boolean(absence) && !absence.until;
  dlg.open(
    `<p class="hint">${esc(T.absence_hint)}</p>
    <label class="tgl"><input type="checkbox" data-open ${open ? "checked" : ""}><span></span>${esc(T.absence_open)}</label>
    <label class="fld" data-until-row ${open ? "hidden" : ""}><span>${esc(T.absence_until)}</span>
      <input type="datetime-local" class="inp" step="300" data-until value="${esc(until)}"></label>`,
    `${absence ? `<button class="btn danger flat" data-stop>${esc(T.absence_stop)}</button>` : ""}
    <span class="grow"></span>
    <button class="btn" data-close>${esc(T.cancel)}</button>
    <button class="btn primary" data-start>${esc(absence ? T.save : T.absence_start)}</button>`,
    "",
    T.close,
  );
  const openBox = dlg.$("[data-open]");
  openBox.addEventListener("change", () => (dlg.$("[data-until-row]").hidden = openBox.checked));
  dlg.$("[data-start]").addEventListener("click", () =>
    dlg.run(async () => {
      const value = dlg.$("[data-until]").value.slice(0, 16);
      if (!openBox.checked && (!value || wm(value) <= now)) throw new Error(T.absence_until);
      await ws({ type: "agenda/absence/set", active: true, until: openBox.checked ? null : value });
      dlg.close("saved");
    }, T),
  );
  dlg.$("[data-stop]")?.addEventListener("click", () =>
    dlg.run(async () => {
      await ws({ type: "agenda/absence/set", active: false });
      dlg.close("saved");
    }, T),
  );
  return dlg.done;
}

/** Pick the days of the same week to copy `day` to. Resolves with their wall minutes, or null. */
export function copyDayDialog(host, { T, day, firstDay }) {
  const lang = T._lang;
  const dlg = new Dialog(host, { title: T.copy_day_title(fmtDay(day, lang, { weekday: "long", day: "numeric" })) });
  const days = Array.from({ length: 7 }, (_, i) => firstDay + i * DAY);
  dlg.open(
    `<p class="hint">${esc(T.copy_day_hint)}</p>
    <div class="fld"><span>${esc(T.copy_to)}</span><div class="days">${days
      .map(
        (d) =>
          `<button class="day" data-target="${d}" ${d === day ? "disabled" : ""} title="${esc(fmtDay(d, lang, { weekday: "long", day: "numeric" }))}">${esc(T.weekdays_short[weekday(d)])}</button>`,
      )
      .join("")}</div></div>`,
    `<span class="grow"></span><button class="btn" data-close>${esc(T.cancel)}</button>
    <button class="btn primary" data-copy disabled>${esc(T.copy)}</button>`,
    "",
    T.close,
  );
  const picked = new Set();
  dlg.$$("[data-target]").forEach((b) =>
    b.addEventListener("click", () => {
      const d = Number(b.dataset.target);
      if (picked.has(d)) picked.delete(d);
      else picked.add(d);
      b.classList.toggle("on", picked.has(d));
      dlg.$("[data-copy]").disabled = !picked.size;
    }),
  );
  dlg.$("[data-copy]").addEventListener("click", () => dlg.close([...picked].sort((a, b) => a - b)));
  return dlg.done;
}

async function actionEditor(container, hass, value, onChange, T) {
  const ok = await loadHaComponents();
  container.innerHTML = "";
  if (ok) {
    const sel = document.createElement("ha-selector");
    sel.hass = hass;
    sel.selector = { action: {} };
    sel.value = value || [];
    sel.addEventListener("value-changed", (e) => {
      e.stopPropagation();
      // HA's editor shows what it is given: left alone, it falls back to the old actions
      sel.value = e.detail.value || [];
      onChange(sel.value);
    });
    container.appendChild(sel);
    // the labels of this editor come with HA's settings pages
    hass.loadFragmentTranslation?.("config");
    return (h) => (sel.hass = h);
  }
  const area = document.createElement("textarea");
  area.className = "inp code";
  area.rows = 6;
  area.placeholder = T.yaml_hint;
  area.value = value?.length ? JSON.stringify(value, null, 2) : "";
  area.addEventListener("change", () => {
    try {
      onChange(area.value.trim() ? JSON.parse(area.value) : []);
      area.classList.remove("bad");
    } catch (_e) {
      area.classList.add("bad");
    }
  });
  container.appendChild(area);
  return () => {};
}

/**
 * opts: { hass, T, agenda, agendas, event, occurrence, ws }
 *  - event: the event to edit (a copy), or a draft without id
 *  - occurrence: the occurrence clicked, if the event repeats
 * Resolves with "saved", "deleted" or null.
 */
export function eventEditor(host, opts) {
  const { T } = opts;
  let hass = opts.hass;
  let agenda = opts.agenda;
  const isNew = !opts.event.id;
  const ev = structuredClone(opts.event);
  ev.repeat = {
    freq: "none",
    interval: 1,
    weekdays: [],
    until: null,
    exclude: [],
    include: [],
    holidays: "ignore",
    calendars: [],
    calendar_mode: "exclude",
    calendar_match: "any",
    period: "always",
    monthly: "day",
    weeks: "all",
    ...(ev.repeat || {}),
  };
  // two lists here; stored as calendars, plus except_calendars when both are used
  const r0 = ev.repeat;
  const calTexts = { ...(r0.calendar_texts || {}) };
  const cal =
    r0.calendar_mode === "only"
      ? {
          only: [...r0.calendars],
          only_match: r0.calendar_match,
          except: [...(r0.except_calendars || [])],
          except_match: r0.except_match || "any",
        }
      : {
          only: [],
          only_match: "any",
          except: [...new Set([...r0.calendars, ...(r0.except_calendars || [])])],
          except_match: r0.calendar_match,
        };
  ev.start_actions = ev.start_actions || [];
  ev.end_actions = ev.end_actions || [];
  // actions run as scripts with full rights: the server takes them from admins only
  const admin = Boolean(hass.user?.is_admin);
  ev.start_sun = ev.start_sun || null;
  ev.end_sun = ev.end_sun || null;
  // conditions as the form edits them: an operator and a value
  ev.conditions = (ev.conditions || []).map((c) => {
    const op = c.above != null ? "above" : c.below != null ? "below" : c.not ? "not" : "is";
    return { entity_id: c.entity_id, op, value: String(c.above ?? c.below ?? c.state ?? "") };
  });
  ev.conditions_match = ev.conditions_match || "all";
  // sunrise and sunset of the dates shown, from the server
  const sunTimes = new Map();
  const sunAllowed = () => !ev.all_day && st.scope === "series";
  const anchorOf = (which) => (sunAllowed() ? ev[`${which}_sun`] : null);
  const loadSun = (day) => {
    if (!day || sunTimes.has(day)) return;
    sunTimes.set(day, null);
    opts
      .ws({ type: "agenda/sun", date: day })
      .then((times) => {
        sunTimes.set(day, times);
        sections.when();
      })
      .catch(() => {});
  };
  /** Time of a bound on the form's date: the sun time plus its offset, or the typed time. */
  const timeOf = (which) => {
    const f = F();
    const typed = which === "start" ? f.t1 : f.t2;
    const anchor = anchorOf(which);
    const sun = anchor && sunTimes.get(f.date)?.[anchor.event];
    if (!sun) return typed;
    let time = addMinutes(sun, Number(anchor.offset) || 0);
    if (anchor.not_before && time < anchor.not_before) time = anchor.not_before;
    if (anchor.not_after && time > anchor.not_after) time = anchor.not_after;
    return time;
  };
  const occ = opts.occurrence && ev.repeat.freq !== "none" ? opts.occurrence : null;
  const st = { scope: "series" };

  // input fields: date, times (or dates for an all-day event)
  const s = wm(ev.start);
  const e = wm(ev.end);
  // days from the start to the end; 0 leaves it to the times: the same day, or the next one
  const spanOf = (from, to) => {
    const days = (dayOf(to) - dayOf(from)) / DAY;
    return ev.all_day || days === (wallTime(to) <= wallTime(from) ? 1 : 0) ? 0 : days;
  };
  const form = {
    date: wallDate(s),
    t1: wallTime(s),
    t2: wallTime(e),
    d1: wallDate(s),
    d2: wallDate(e - (ev.all_day ? DAY : 0)),
    span: spanOf(s, e),
  };
  const occForm = occ
    ? {
        date: occ.day,
        t1: wallTime(wm(occ.start)),
        t2: wallTime(wm(occ.end)),
        d1: occ.day,
        d2: wallDate(wm(occ.end) - DAY),
        span: spanOf(wm(occ.start), wm(occ.end)),
      }
    : null;
  const F = () => (st.scope === "once" && occForm ? occForm : form);
  const endDays = () => Math.max(F().span, timeOf("end") <= timeOf("start") ? 1 : 0);

  const dlg = new Dialog(host, { title: isNew ? T.create_event : T.edit_event, wide: true });
  const agendaChip = () =>
    `<span class="dlg-agenda"><span class="dot" style="--c:${esc(agenda.settings.color)}"></span>${esc(agenda.name)}</span>`;

  const scopeBar = occ
    ? `<div class="scope">
        <span>${esc(T.occurrence_of)} ${esc(fmtDay(wm(occ.day), T._lang, { weekday: "long", day: "numeric", month: "long" }))}</span>
        <div class="seg-btn" data-scope-bar>
          <button data-scope="series" class="on">${esc(T.scope_series)}</button>
          <button data-scope="once">${esc(T.scope_once)}</button>
        </div>
      </div>`
    : "";

  const agendaSelect =
    isNew && opts.agendas.length > 1
      ? `<label class="fld"><span>Agenda</span><select class="inp" data-agenda>${opts.agendas
          .map(
            (a) =>
              `<option value="${esc(a.entry_id)}" ${a.entry_id === agenda.entry_id ? "selected" : ""}>${esc(a.name)}</option>`,
          )
          .join("")}</select></label>`
      : "";

  const body = `${scopeBar}${agendaSelect}
    <section data-sec="state"></section>
    <label class="fld"><span>${esc(T.name)}</span><input class="inp" data-f="name" value="${esc(ev.name || "")}" placeholder="${esc(T.name_hint)}"></label>
    <section data-sec="when"></section>
    <section data-sec="repeat"></section>
    <details class="more" data-sec-wrap="exceptions"><summary>${esc(T.exceptions)}<span data-count></span></summary><div data-sec="exceptions"></div></details>
    <details class="more" ${ev.conditions.length ? "open" : ""}><summary>${esc(T.conditions)}<span data-ccount></span></summary><div data-sec="conditions"></div></details>
    <details class="more"><summary>${esc(T.look)}</summary>
      <div class="look">
        <div class="fld"><span>${esc(T.color)}</span><div class="swatches" data-swatches></div></div>
        <label class="fld"><span>${esc(T.icon)}</span><input class="inp" data-f="icon" value="${esc(ev.icon || "")}" placeholder="mdi:radiator"></label>
      </div>
    </details>
    ${
      admin
        ? `<details class="more" ${ev.start_actions.length || ev.end_actions.length ? "open" : ""}><summary>${esc(T.start_actions)} / ${esc(T.end_actions)}<span data-acount></span></summary>
      <p class="hint">${esc(T.actions_hint)}</p>
      <h4>${esc(T.start_actions)}</h4><div data-actions="start_actions"></div>
      <h4>${esc(T.end_actions)}</h4><div data-actions="end_actions"></div>
    </details>`
        : ""
    }
    <details class="more" ${ev.note ? "open" : ""}><summary>${esc(T.note)}</summary>
      <textarea class="inp" rows="2" data-f="note">${esc(ev.note || "")}</textarea></details>
    <label class="tgl"><input type="checkbox" data-f="enabled" ${ev.enabled === false ? "" : "checked"}><span></span>${esc(T.enabled_event)}</label>`;

  // the state of the form, saved or not, ahead of the schedule until this occurrence ends
  const canApply = !isNew && agenda.enabled && kinds.hasStates(agenda) && (agenda.settings.entities || []).length > 0;
  const footer = `${isNew ? "" : `<button class="btn danger flat" data-del>${esc(T.delete)}</button><button class="btn flat" data-dup>${esc(T.duplicate)}</button>`}
    ${canApply ? `<button class="btn flat" data-apply-now>${esc(T.apply_now)}</button>` : ""}
    <span class="grow"></span>
    <button class="btn" data-close>${esc(T.cancel)}</button>
    <button class="btn primary" data-save>${esc(T.save)}</button>`;

  dlg.open(body, footer, agendaChip(), T.close);

  const calendars = () =>
    Object.values(hass.states)
      .filter((x) => x.entity_id.startsWith("calendar."))
      .sort((a, b) => friendlyName(hass, a.entity_id).localeCompare(friendlyName(hass, b.entity_id)));

  // sections re-render independently
  const sections = {
    state() {
      const sec = dlg.$('[data-sec="state"]');
      if (!kinds.hasStates(agenda)) {
        sec.innerHTML = "";
        return;
      }
      const title = kinds.kindOf(agenda) === "climate" ? T.setpoint : T.state;
      sec.innerHTML = `<div class="fld"><span>${esc(title)}</span>${kinds.statePicker(hass, agenda, ev.state, T, { allowNone: true, noneLabel: T.no_state })}</div>`;
      kinds.bindState(sec, {
        hass,
        agenda,
        T,
        get: () => ev.state,
        set: (v) => (ev.state = v),
        rerender: sections.state,
      });
    },
    when() {
      const sec = dlg.$('[data-sec="when"]');
      const f = F();
      const repeating = st.scope === "series" && ev.repeat.freq !== "none";
      if (anchorOf("start") || anchorOf("end")) loadSun(f.date);
      const nextDay = !ev.all_day && endDays() === 1;
      const bound = (which, label) => {
        const anchor = anchorOf(which);
        const key = which === "start" ? "t1" : "t2";
        const choice = sunAllowed()
          ? `<select class="inp" data-anchor="${which}">${["fixed", "sunrise", "sunset"]
              .map(
                (k) =>
                  `<option value="${k}" ${(anchor ? anchor.event : "fixed") === k ? "selected" : ""}>${esc(k === "fixed" ? T.time_fixed : T[k])}</option>`,
              )
              .join("")}</select>`
          : "";
        const input = anchor
          ? `<input type="number" class="inp num" step="5" min="${-SUN_LIMIT}" max="${SUN_LIMIT}" data-offset="${which}" value="${Number(anchor.offset) || 0}" title="${esc(T.offset_min)}">`
          : `<input type="time" class="inp" step="300" data-w="${key}" value="${f[key]}">`;
        const info = anchor
          ? `<small class="hint">${esc(T.sun_on(timeOf(which), fmtDay(wm(f.date), T._lang, { day: "numeric", month: "short" })))}</small>`
          : "";
        // optional clock bounds of the sun time
        const limits = anchor
          ? `<div class="sunlim">${["not_before", "not_after"]
              .map(
                (k) =>
                  `<label><span>${esc(T[k])}</span><input type="time" class="inp" step="300" data-lim="${which}:${k}" value="${esc(anchor[k] || "")}"></label>`,
              )
              .join("")}</div>`
          : "";
        return `<div class="fld sm bound"><span>${label}</span><div class="row tight">${choice}${input}</div>${info}${limits}</div>`;
      };
      sec.innerHTML = `<div class="fld"><span>${esc(T.when)}</span>
        <label class="tgl"><input type="checkbox" data-allday ${ev.all_day ? "checked" : ""}><span></span>${esc(T.all_day)}</label>
        ${
          ev.all_day
            ? `<div class="row"><label class="fld sm"><span>${esc(repeating ? T.from_date : T.start)}</span><input type="date" class="inp" data-w="d1" value="${f.d1}"></label>
               <label class="fld sm"><span>${esc(T.end)}</span><input type="date" class="inp" data-w="d2" value="${f.d2}"></label></div>`
            : `<div class="row"><label class="fld sm date"><span>${esc(repeating ? T.from_date : T.date)}</span><input type="date" class="inp" data-w="date" value="${f.date}"></label>
               <label class="fld sm date"><span>${esc(repeating ? T.first_end : T.end_date)}</span><input type="date" class="inp" data-end-date min="${f.date}" value="${wallDate(wm(f.date) + endDays() * DAY)}"></label></div>
               <div class="row bounds">${bound("start", esc(T.start))}
               ${bound("end", `${esc(T.end)}${nextDay ? ` <em>(${esc(T.next_day)})</em>` : ""}`)}</div>`
        }</div>`;
      sec.querySelector("[data-allday]").addEventListener("change", (x) => {
        ev.all_day = x.target.checked;
        sections.when();
      });
      sec.querySelectorAll("[data-w]").forEach((inp) =>
        inp.addEventListener("change", () => {
          F()[inp.dataset.w] = inp.value;
          if (inp.dataset.w === "date" && st.scope === "series" && ["weekly", "monthly"].includes(ev.repeat.freq))
            sections.repeat();
          sections.when();
        }),
      );
      sec.querySelector("[data-end-date]")?.addEventListener("change", (x) => {
        F().span = x.target.value ? Math.max(0, (wm(x.target.value) - wm(F().date)) / DAY) : 0;
        sections.when();
      });
      sec.querySelectorAll("[data-anchor]").forEach((sel) =>
        sel.addEventListener("change", () => {
          const which = sel.dataset.anchor;
          const old = ev[`${which}_sun`];
          // the time of day shown stays the same: the offset, or the typed time, follows it
          const shown = timeOf(which);
          if (sel.value === "fixed") {
            if (shown) F()[which === "start" ? "t1" : "t2"] = shown;
            ev[`${which}_sun`] = null;
          } else {
            const sun = sunTimes.get(F().date)?.[sel.value];
            let offset = old ? old.offset : 0;
            if (sun && shown) {
              offset = Math.round((minutesOf(shown) - minutesOf(sun)) / 5) * 5;
              offset = Math.max(-SUN_LIMIT, Math.min(SUN_LIMIT, offset));
            }
            ev[`${which}_sun`] = { ...(old || {}), event: sel.value, offset };
          }
          sections.when();
        }),
      );
      sec.querySelectorAll("[data-lim]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const [which, key] = inp.dataset.lim.split(":");
          const anchor = ev[`${which}_sun`];
          if (inp.value) anchor[key] = inp.value;
          else delete anchor[key];
          sections.when();
        }),
      );
      sec.querySelectorAll("[data-offset]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const value = Math.max(-SUN_LIMIT, Math.min(SUN_LIMIT, Math.round(Number(inp.value) || 0)));
          ev[`${inp.dataset.offset}_sun`].offset = value;
          sections.when();
        }),
      );
    },
    repeat() {
      const sec = dlg.$('[data-sec="repeat"]');
      if (st.scope === "once") {
        sec.innerHTML = "";
        return;
      }
      const r = ev.repeat;
      const unit = { daily: T.days_unit, weekly: T.weeks_unit, monthly: T.months_unit }[r.freq];
      const curDay = weekday(wm(form.date));
      const wds = r.weekdays.length ? r.weekdays : [curDay];
      sec.innerHTML = `<div class="fld"><span>${esc(T.repeat)}</span>
        <div class="row">
          <select class="inp" data-r="freq">
            ${["none", "daily", "weekly", "monthly"].map((f) => `<option value="${f}" ${r.freq === f ? "selected" : ""}>${esc({ none: T.once, daily: T.daily, weekly: T.weekly, monthly: T.monthly }[f])}</option>`).join("")}
          </select>
          ${r.freq !== "none" ? `<label class="inline">${esc(r.freq === "weekly" ? T.every_f : T.every)} <input type="number" min="1" max="99" class="inp num" data-r="interval" value="${r.interval || 1}"> ${esc(unit)}</label>` : ""}
        </div>
        ${
          r.freq === "weekly"
            ? `<div class="days">${T.weekdays_short.map((d, i) => `<button class="day ${wds.includes(i) ? "on" : ""}" data-wd="${i}" title="${esc(T.weekdays_long[i])}">${esc(d)}</button>`).join("")}</div>`
            : ""
        }
        ${
          r.freq !== "none"
            ? `<div class="row pairs">
                <label class="fld sm"><span>${esc(T.until)}</span><input type="date" class="inp" data-r="until" value="${r.until || ""}"></label>
                <label class="fld sm"><span>${esc(T.holidays)}</span><select class="inp" data-r="holidays">
                  ${["ignore", "exclude", "only"].map((h) => `<option value="${h}" ${r.holidays === h ? "selected" : ""}>${esc(T[`holidays_${h}`])}</option>`).join("")}
                </select></label>
                ${
                  opts.shared?.school_calendar || r.period !== "always"
                    ? `<label class="fld sm"><span>${esc(T.period)}</span><select class="inp" data-r="period">
                  ${["always", "school", "vacation"].map((p) => `<option value="${p}" ${r.period === p ? "selected" : ""}>${esc(T.periods[p])}</option>`).join("")}
                </select></label>`
                    : ""
                }
                ${
                  r.freq === "monthly"
                    ? `<label class="fld sm"><span>${esc(T.monthly_on)}</span><select class="inp" data-r="monthly">
                  ${["day", "weekday", "last_weekday"].map((m) => `<option value="${m}" ${r.monthly === m ? "selected" : ""}>${esc(monthlyLabel(wm(form.date), m, T))}</option>`).join("")}
                </select></label>`
                    : ""
                }
                ${
                  ["daily", "weekly"].includes(r.freq)
                    ? `<label class="fld sm"><span>${esc(T.weeks)}</span><select class="inp" data-r="weeks">
                  ${["all", "even", "odd"].map((w) => `<option value="${w}" ${r.weeks === w ? "selected" : ""}>${esc(T.weeks_modes[w])}</option>`).join("")}
                </select></label>`
                    : ""
                }</div>`
            : ""
        }</div>`;
      sec.querySelectorAll("[data-r]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const k = inp.dataset.r;
          r[k] =
            k === "interval" ? Math.max(1, Number(inp.value) || 1) : inp.value || (k === "until" ? null : inp.value);
          if (k === "freq") {
            if (r.freq === "weekly" && !r.weekdays.length) r.weekdays = [curDay];
            sections.repeat();
            sections.when();
            sections.exceptions();
          }
        }),
      );
      sec.querySelectorAll("[data-wd]").forEach((b) =>
        b.addEventListener("click", () => {
          const i = Number(b.dataset.wd);
          const set = new Set(r.weekdays.length ? r.weekdays : [curDay]);
          if (set.has(i)) set.delete(i);
          else set.add(i);
          if (!set.size) set.add(i);
          r.weekdays = [...set].sort();
          sections.repeat();
        }),
      );
    },
    exceptions() {
      const sec = dlg.$('[data-sec="exceptions"]');
      const wrap = dlg.$('[data-sec-wrap="exceptions"]');
      wrap.hidden = st.scope === "once" || ev.repeat.freq === "none";
      const r = ev.repeat;
      const list = (key) =>
        (r[key] || [])
          .map(
            (d) =>
              `<span class="pill">${esc(fmtDay(wm(d), T._lang, { weekday: "short", day: "numeric", month: "short", year: "numeric" }))}<button data-rm="${key}:${d}">×</button></span>`,
          )
          .join("");
      const taken = [...cal.only, ...cal.except];
      // the public holidays come first, as a calendar of their own
      const free = [{ entity_id: HOLIDAYS }, ...calendars()].filter((c) => !taken.includes(c.entity_id));
      // optional text the calendar's events must contain (in their title or description)
      const textInput = (id) =>
        id === HOLIDAYS
          ? ""
          : `<input class="inp pill-text" data-cal-text="${esc(id)}" placeholder="${esc(T.containing)}" title="${esc(T.containing_hint)}" value="${esc(calTexts[id] || "")}">`;
      const side = (key) => `<div class="calside">
          <span class="sub">${esc(key === "only" ? T.calendar_only : T.calendar_exclude)}</span>
          <div class="pills">${cal[key]
            .map(
              (id) =>
                `<span class="pill">${esc(calendarName(hass, id, T))}${textInput(id)}<button data-rm-cal="${key}:${esc(id)}">×</button></span>`,
            )
            .join("")}
            ${free.length ? `<select class="inp" data-cal="${key}"><option value="">${esc(T.add_calendar)}</option>${free.map((c) => `<option value="${esc(c.entity_id)}">${esc(calendarName(hass, c.entity_id, T))}</option>`).join("")}</select>` : ""}
          </div>
          ${cal[key].length > 1 ? `<select class="inp" data-cal-match="${key}">${["any", "all"].map((m) => `<option value="${m}" ${cal[`${key}_match`] === m ? "selected" : ""}>${esc(T[`calendar_${m}`])}</option>`).join("")}</select>` : ""}
        </div>`;
      sec.innerHTML =
        ["exclude", "include"]
          .map(
            (key) => `<div class="fld"><span>${esc(key === "exclude" ? T.excluded : T.included)}</span>
            <div class="pills">${list(key)}<span class="add"><input type="date" class="inp" data-add-date="${key}"><button class="btn flat" data-add="${key}">${esc(T.add)}</button></span></div></div>`,
          )
          .join("") +
        `<div class="fld"><span>${esc(T.calendar_condition)}</span><p class="hint">${esc(T.calendar_hint)}</p>
          ${side("only")}${side("except")}
          </div>`;
      const n = (r.exclude || []).length + (r.include || []).length + taken.length;
      dlg.$("[data-count]").textContent = n ? ` · ${n}` : "";
      sec.querySelectorAll("[data-rm]").forEach((b) =>
        b.addEventListener("click", () => {
          const [key, d] = b.dataset.rm.split(":");
          r[key] = r[key].filter((x) => x !== d);
          sections.exceptions();
        }),
      );
      sec.querySelectorAll("[data-add]").forEach((b) =>
        b.addEventListener("click", () => {
          const key = b.dataset.add;
          const v = sec.querySelector(`[data-add-date="${key}"]`).value;
          if (v && !r[key].includes(v)) r[key] = [...r[key], v].sort();
          sections.exceptions();
        }),
      );
      sec.querySelectorAll("[data-cal]").forEach((s) =>
        s.addEventListener("change", () => {
          if (s.value) cal[s.dataset.cal] = [...cal[s.dataset.cal], s.value];
          sections.exceptions();
        }),
      );
      sec.querySelectorAll("[data-rm-cal]").forEach((b) =>
        b.addEventListener("click", () => {
          const at = b.dataset.rmCal.indexOf(":");
          const key = b.dataset.rmCal.slice(0, at);
          cal[key] = cal[key].filter((id) => id !== b.dataset.rmCal.slice(at + 1));
          delete calTexts[b.dataset.rmCal.slice(at + 1)];
          sections.exceptions();
        }),
      );
      sec.querySelectorAll("[data-cal-text]").forEach((inp) =>
        inp.addEventListener("change", () => {
          const text = inp.value.trim();
          if (text) calTexts[inp.dataset.calText] = text;
          else delete calTexts[inp.dataset.calText];
        }),
      );
      sec
        .querySelectorAll("[data-cal-match]")
        .forEach((s) => s.addEventListener("change", () => (cal[`${s.dataset.calMatch}_match`] = s.value)));
    },
    conditions() {
      const sec = dlg.$('[data-sec="conditions"]');
      const rows = ev.conditions
        .map((c, i) => {
          const current = hass.states[c.entity_id];
          const states = new Set(
            [current?.state, ...(current?.attributes?.options || []), "on", "off", "home", "not_home"].filter(Boolean),
          );
          return `<div class="row tight cond" data-cond="${i}">
            <input class="inp grow" list="agenda-entities" data-c="entity_id" value="${esc(c.entity_id || "")}" placeholder="${esc(T.cond_entity)}">
            <select class="inp" data-c="op">${[
              ["is", T.cond_is],
              ["not", T.cond_is_not],
              ["above", T.cond_above],
              ["below", T.cond_below],
            ]
              .map(([v, text]) => `<option value="${v}" ${c.op === v ? "selected" : ""}>${esc(text)}</option>`)
              .join("")}</select>
            ${
              c.op === "above" || c.op === "below"
                ? `<input class="inp num" type="number" step="any" data-c="value" value="${esc(c.value)}">`
                : `<input class="inp" list="agenda-states-${i}" data-c="value" value="${esc(c.value)}" placeholder="${esc(T.state)}">`
            }
            <datalist id="agenda-states-${i}">${[...states].map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
            <button class="ic" data-cond-rm="${i}" title="${esc(T.delete)}"><ha-icon icon="mdi:close"></ha-icon></button>
          </div>`;
        })
        .join("");
      const entities = Object.keys(hass.states).sort();
      const match =
        ev.conditions.length > 1
          ? `<select class="inp" data-cmatch>${["all", "any"]
              .map(
                (v) =>
                  `<option value="${v}" ${ev.conditions_match === v ? "selected" : ""}>${esc(v === "all" ? T.cond_all : T.cond_any)}</option>`,
              )
              .join("")}</select>`
          : "";
      sec.innerHTML = `<p class="hint">${esc(T.conditions_hint)}</p>${match}${rows}
        <datalist id="agenda-entities">${entities.map((e) => `<option value="${esc(e)}">${esc(friendlyName(hass, e))}</option>`).join("")}</datalist>
        <button class="btn flat" data-cond-add><ha-icon icon="mdi:plus"></ha-icon>${esc(T.add_condition)}</button>`;
      dlg.$("[data-ccount]").textContent = ev.conditions.length ? ` · ${ev.conditions.length}` : "";
      sec.querySelectorAll("[data-cond]").forEach((row) => {
        const i = Number(row.dataset.cond);
        row.querySelectorAll("[data-c]").forEach((inp) =>
          inp.addEventListener("change", () => {
            const key = inp.dataset.c;
            ev.conditions[i][key] = inp.value.trim();
            // a number or a state: the value field changes with the operator
            if (key === "entity_id" || key === "op") sections.conditions();
          }),
        );
      });
      sec.querySelector("[data-cmatch]")?.addEventListener("change", (x) => (ev.conditions_match = x.target.value));
      sec.querySelectorAll("[data-cond-rm]").forEach((b) =>
        b.addEventListener("click", () => {
          ev.conditions.splice(Number(b.dataset.condRm), 1);
          sections.conditions();
        }),
      );
      sec.querySelector("[data-cond-add]").addEventListener("click", () => {
        ev.conditions.push({ entity_id: "", op: "is", value: "" });
        sections.conditions();
      });
    },
    swatches() {
      const box = dlg.$("[data-swatches]");
      const auto = !ev.color;
      box.innerHTML = `<button class="swatch auto ${auto ? "on" : ""}" data-color="">${esc(T.auto)}</button>${SWATCHES.map(
        (c) =>
          `<button class="swatch ${ev.color === c ? "on" : ""}" data-color="${esc(c)}" style="--c:${esc(c)}"></button>`,
      ).join("")}<input type="color" class="swatch-input" data-color-input value="${esc(ev.color || "#ef6c00")}">`;
      box.querySelectorAll("[data-color]").forEach((b) =>
        b.addEventListener("click", () => {
          ev.color = b.dataset.color || null;
          sections.swatches();
        }),
      );
      box.querySelector("[data-color-input]").addEventListener("change", (x) => {
        ev.color = x.target.value;
        sections.swatches();
      });
    },
  };

  const renderAll = () => Object.values(sections).forEach((fn) => fn());
  renderAll();

  dlg.$$("[data-f]").forEach((inp) =>
    inp.addEventListener(inp.type === "checkbox" ? "change" : "input", () => {
      ev[inp.dataset.f] = inp.type === "checkbox" ? inp.checked : inp.value;
    }),
  );
  dlg.$("[data-agenda]")?.addEventListener("change", (x) => {
    agenda = opts.agendas.find((a) => a.entry_id === x.target.value);
    dlg.$(".dlg-agenda").outerHTML = agendaChip();
    ev.state = kinds.hasStates(agenda) ? kinds.draftState(hass, agenda) : null;
    sections.state();
  });
  dlg.$("[data-scope-bar]")?.addEventListener("click", (x) => {
    const b = x.target.closest("[data-scope]");
    if (!b) return;
    st.scope = b.dataset.scope;
    dlg.$$("[data-scope]").forEach((y) => y.classList.toggle("on", y === b));
    renderAll();
  });

  const updaters = [];
  for (const key of admin ? ["start_actions", "end_actions"] : []) {
    actionEditor(
      dlg.$(`[data-actions="${key}"]`),
      hass,
      ev[key],
      (v) => {
        ev[key] = v;
        const n = ev.start_actions.length + ev.end_actions.length;
        dlg.$("[data-acount]").textContent = n ? ` · ${n}` : "";
      },
      T,
    ).then((u) => updaters.push(u));
  }
  const n0 = ev.start_actions.length + ev.end_actions.length;
  if (admin) dlg.$("[data-acount]").textContent = n0 ? ` · ${n0}` : "";

  const build = () => {
    const f = F();
    const out = structuredClone(ev);
    if (out.all_day) {
      out.start = f.d1;
      out.end = wallDate(wm(f.d2 < f.d1 ? f.d1 : f.d2) + DAY);
    } else {
      // with a sun anchor the stored time is the one of the first day, kept as a fallback
      const t1 = timeOf("start");
      const t2 = timeOf("end");
      out.start = `${f.date}T${t1}`;
      out.end = `${wallDate(wm(f.date) + endDays() * DAY)}T${t2}`;
    }
    if (!sunAllowed()) {
      out.start_sun = null;
      out.end_sun = null;
    }
    out.conditions = ev.conditions
      .filter((c) => c.entity_id && c.value !== "")
      .map((c) =>
        c.op === "above" || c.op === "below"
          ? { entity_id: c.entity_id, [c.op]: Number(c.value) }
          : { entity_id: c.entity_id, state: c.value, not: c.op === "not" },
      )
      .filter((c) => c.state != null || Number.isFinite(c.above ?? c.below));
    // "all" is the default, written only otherwise so that older versions still read the event
    if (out.conditions.length > 1 && ev.conditions_match === "any") out.conditions_match = "any";
    else delete out.conditions_match;
    if (out.repeat.freq === "weekly" && !out.repeat.weekdays.length) out.repeat.weekdays = [weekday(wm(out.start))];
    if (out.repeat.freq !== "weekly") out.repeat.weekdays = [];
    if (out.repeat.freq !== "monthly") out.repeat.monthly = "day";
    if (!["daily", "weekly"].includes(out.repeat.freq)) out.repeat.weeks = "all";
    // the second list is written only when both are used, so older versions can still read the event
    const match = (key) => (cal[key].length > 1 ? cal[`${key}_match`] : "any");
    delete out.repeat.except_calendars;
    delete out.repeat.except_match;
    const texts = Object.fromEntries(
      Object.entries(calTexts).filter(([id, text]) => text && [...cal.only, ...cal.except].includes(id)),
    );
    if (Object.keys(texts).length) out.repeat.calendar_texts = texts;
    else delete out.repeat.calendar_texts;
    if (cal.only.length) {
      Object.assign(out.repeat, { calendars: cal.only, calendar_mode: "only", calendar_match: match("only") });
      if (cal.except.length) Object.assign(out.repeat, { except_calendars: cal.except, except_match: match("except") });
    } else {
      Object.assign(out.repeat, { calendars: cal.except, calendar_mode: "exclude", calendar_match: match("except") });
    }
    out.name = (out.name || "").trim();
    out.icon = (out.icon || "").trim() || null;
    return out;
  };

  dlg.$("[data-save]").addEventListener("click", () =>
    dlg.run(async () => {
      const out = build();
      if (occ && st.scope === "once") {
        const { id, ...rest } = out;
        rest.repeat = { freq: "none" };
        await opts.ws({
          type: "agenda/event/detach",
          entry_id: agenda.entry_id,
          event_id: ev.id,
          day: occ.day,
          event: rest,
        });
      } else {
        await opts.ws({ type: "agenda/event/save", entry_id: agenda.entry_id, event: out });
      }
      dlg.close("saved");
    }, T),
  );

  const applyNow = dlg.$("[data-apply-now]");
  applyNow?.addEventListener("click", () =>
    dlg.run(async () => {
      if (!ev.state) return; // nothing to apply: no state chosen
      await opts.ws({
        type: "agenda/override",
        entry_id: agenda.entry_id,
        action: "event",
        event_id: ev.id,
        state: ev.state,
      });
      // the form stays open: it may still be saved, or left
      applyNow.disabled = true;
      applyNow.innerHTML = `<ha-icon icon="mdi:check"></ha-icon>${esc(T.apply_now)}`;
    }, T),
  );

  dlg.$("[data-dup]")?.addEventListener("click", () =>
    dlg.run(async () => {
      const out = build();
      delete out.id;
      out.name = out.name ? `${out.name} (2)` : out.name;
      await opts.ws({ type: "agenda/event/save", entry_id: agenda.entry_id, event: out });
      dlg.close("saved");
    }, T),
  );

  dlg.$("[data-del]")?.addEventListener("click", async () => {
    const choice = await confirmDialog(
      host,
      occ
        ? {
            title: T.delete_title,
            text: T.delete_series_text,
            buttons: [
              { label: T.cancel, value: "" },
              { label: T.scope_once, value: "once" },
              { label: T.scope_series, value: "series", danger: true },
            ],
          }
        : {
            title: T.delete_title,
            text: T.delete_text,
            buttons: [
              { label: T.cancel, value: "" },
              { label: T.delete, value: "series", danger: true },
            ],
          },
    );
    if (!choice) return;
    dlg.run(async () => {
      if (choice === "once") {
        await opts.ws({ type: "agenda/event/detach", entry_id: agenda.entry_id, event_id: ev.id, day: occ.day });
      } else {
        await opts.ws({ type: "agenda/event/delete", entry_id: agenda.entry_id, event_id: ev.id });
      }
      dlg.close("deleted");
    }, T);
  });

  return {
    done: dlg.done,
    setHass(h) {
      hass = h;
      updaters.forEach((u) => u(h));
    },
  };
}

const regionName = (code, lang) => {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) || code;
  } catch (_e) {
    return code;
  }
};

/** The settings shared by all agendas, in `sec`; save() writes them if they changed. */
function sharedFields(sec, { hass, T, shared, ws }) {
  const hol = {
    country: shared?.configured || null,
    subdiv: shared?.subdiv || null,
    school: shared?.school_calendar || null,
    allow: Boolean(shared?.allow_users),
    options: null,
  };
  const values = () => JSON.stringify([hol.country, hol.subdiv, hol.school, hol.allow]);
  const initial = values();
  const render = async () => {
    const lang = T._lang;
    const haCountry = shared?.ha_country;
    const country = hol.country || haCountry;
    if (!hol.options || hol.options.for !== country) {
      try {
        const res = await ws({ type: "agenda/holidays/options", country: country || null });
        hol.options = { ...res, for: country };
      } catch (_e) {
        hol.options = { countries: [], subdivisions: [], for: country };
      }
    }
    const { countries, subdivisions } = hol.options;
    const named = countries.map((c) => [c, regionName(c, lang)]).sort((a, b) => a[1].localeCompare(b[1], lang));
    sec.innerHTML = `<div class="row">
        <label class="fld sm"><span>${esc(T.country)}</span><select class="inp" data-country>
          <option value="">${esc(haCountry ? T.ha_country(regionName(haCountry, lang)) : T.no_ha_country)}</option>
          ${named.map(([c, n]) => `<option value="${esc(c)}" ${hol.country === c ? "selected" : ""}>${esc(n)}</option>`).join("")}
        </select></label>
        ${
          subdivisions.length
            ? `<label class="fld sm"><span>${esc(T.subdivision)}</span><select class="inp" data-subdiv>
          <option value="">${esc(T.whole_country)}</option>
          ${subdivisions.map((d) => `<option value="${esc(d.code)}" ${hol.subdiv === d.code ? "selected" : ""}>${esc(d.names.length ? `${d.names[d.names.length - 1]} (${d.code})` : d.code)}</option>`).join("")}
        </select></label>`
            : ""
        }
      </div>
      <label class="fld"><span>${esc(T.school_calendar)}</span><select class="inp" data-school>
        <option value="">${esc(T.none)}</option>
        ${Object.values(hass.states)
          .filter((x) => x.entity_id.startsWith("calendar."))
          .sort((a, b) => friendlyName(hass, a.entity_id).localeCompare(friendlyName(hass, b.entity_id)))
          .map(
            (c) =>
              `<option value="${esc(c.entity_id)}" ${hol.school === c.entity_id ? "selected" : ""}>${esc(friendlyName(hass, c.entity_id))}</option>`,
          )
          .join("")}
      </select></label>
      <p class="hint">${esc(T.school_calendar_hint)}</p>
      <label class="tgl"><input type="checkbox" data-allow ${hol.allow ? "checked" : ""}><span></span>${esc(T.allow_users)}</label>`;
    sec.querySelector("[data-allow]").addEventListener("change", (x) => (hol.allow = x.target.checked));
    sec.querySelector("[data-school]").addEventListener("change", (x) => (hol.school = x.target.value || null));
    sec.querySelector("[data-country]").addEventListener("change", (x) => {
      hol.country = x.target.value || null;
      hol.subdiv = null;
      render();
    });
    sec.querySelector("[data-subdiv]")?.addEventListener("change", (x) => (hol.subdiv = x.target.value || null));
  };
  render();
  return {
    async save() {
      if (values() === initial) return;
      await ws({
        type: "agenda/shared/save",
        country: hol.country,
        subdiv: hol.subdiv,
        school_calendar: hol.school,
        allow_users: hol.allow,
      });
    },
  };
}

/** The same settings on their own, from the All row of the column. */
export function sharedEditor(host, { hass, T, shared, ws }) {
  const dlg = new Dialog(host, { title: T.holidays_title, wide: true });
  dlg.open(
    `<div class="shared-f" data-sec="holidays"></div>`,
    `<span class="grow"></span><button class="btn" data-close>${esc(T.cancel)}</button><button class="btn primary" data-save>${esc(T.save)}</button>`,
    "",
    T.close,
  );
  const common = sharedFields(dlg.$('[data-sec="holidays"]'), { hass, T, shared, ws });
  dlg.$("[data-save]").addEventListener("click", () =>
    dlg.run(async () => {
      await common.save();
      dlg.close("saved");
    }, T),
  );
  return { done: dlg.done };
}

/** opts: { hass, T, agenda, shared, ws, callApi, duplicate }; shared comes from agenda/list. */
export function settingsEditor(host, { hass, T, agenda, shared, ws, callApi, duplicate }) {
  const cfg = structuredClone(agenda.settings);
  cfg.kind = cfg.kind || "none";
  cfg.entities = cfg.entities || [];
  const initialKind = cfg.kind;
  let name = agenda.name;
  let filter = "";
  cfg.follow_absence = cfg.follow_absence !== false;
  cfg.away_state = cfg.away_state ?? null;
  const dlg = new Dialog(host, { title: `${T.settings} · ${agenda.name}`, wide: true });

  const body = `<label class="fld"><span>${esc(T.name)}</span><input class="inp" data-name value="${esc(name)}"></label>
    <div class="fld"><span>${esc(T.color)}</span><div class="swatches" data-swatches></div></div>
    <section data-sec="kind"></section>
    <section data-sec="entities"></section>
    <section data-sec="default"></section>
    <label class="tgl" data-resync-row><input type="checkbox" data-resync ${cfg.resync_on_start ? "checked" : ""}><span></span>${esc(T.resync_on_start)}</label>
    <label class="fld" data-manual-row><span>${esc(T.manual_hold)}</span>
      <select class="inp" data-manual>${Object.entries(T.manual_holds)
        .map(
          ([v, text]) =>
            `<option value="${v}" ${v === (cfg.manual_hold || "next_change") ? "selected" : ""}>${esc(text)}</option>`,
        )
        .join("")}</select>
      <p class="hint">${esc(T.manual_hold_hint)}</p></label>
    <section data-sec="absence"></section>
    <details class="more"><summary>${esc(T.holidays_title)}</summary><div class="shared-f" data-sec="holidays"></div></details>`;
  const footer = `<button class="btn danger flat" data-del>${esc(T.delete)}</button>
    <button class="btn flat" data-dup>${esc(T.duplicate)}</button>
    <button class="btn flat" data-apply>${esc(T.resync_now)}</button>
    <span class="foot-end"><button class="btn" data-close>${esc(T.cancel)}</button><button class="btn primary" data-save>${esc(T.save)}</button></span>`;
  dlg.open(body, footer, "", T.close);

  const view = () => ({ ...agenda, settings: cfg });
  const sections = {
    swatches() {
      const box = dlg.$("[data-swatches]");
      box.innerHTML =
        SWATCHES.map(
          (c) =>
            `<button class="swatch ${cfg.color === c ? "on" : ""}" data-color="${esc(c)}" style="--c:${esc(c)}"></button>`,
        ).join("") + `<input type="color" class="swatch-input" data-color-input value="${esc(cfg.color)}">`;
      box.querySelectorAll("[data-color]").forEach((b) =>
        b.addEventListener("click", () => {
          cfg.color = b.dataset.color;
          sections.swatches();
        }),
      );
      box.querySelector("[data-color-input]").addEventListener("change", (x) => {
        cfg.color = x.target.value;
        sections.swatches();
      });
    },
    kind() {
      const sec = dlg.$('[data-sec="kind"]');
      const hint = T.kind_hints[cfg.kind] || T.kind_hints.other;
      sec.innerHTML = `<div class="fld"><span>${esc(T.kind)}</span><div class="kinds">${Object.keys(kinds.KIND_DOMAINS)
        .map(
          (k) =>
            `<button class="kind ${cfg.kind === k ? "on" : ""}" data-kind="${k}"><ha-icon icon="${kinds.KIND_ICONS[k]}"></ha-icon>${esc(T.kinds[k])}</button>`,
        )
        .join(
          "",
        )}</div><p class="hint">${esc(hint)}${cfg.kind !== initialKind && initialKind !== "none" ? ` <b>${esc(T.kind_change)}</b>` : ""}</p></div>`;
      sec.querySelectorAll("[data-kind]").forEach((b) =>
        b.addEventListener("click", () => {
          if (cfg.kind === b.dataset.kind) return;
          cfg.kind = b.dataset.kind;
          cfg.entities = cfg.kind === initialKind ? structuredClone(agenda.settings.entities || []) : [];
          cfg.default_state = cfg.kind === initialKind ? structuredClone(agenda.settings.default_state ?? null) : null;
          filter = "";
          sections.kind();
          sections.entities();
          sections.default();
          sections.absence();
        }),
      );
      dlg.$("[data-resync-row]").hidden = cfg.kind === "none";
      dlg.$("[data-manual-row]").hidden = cfg.kind === "none";
      dlg.$("[data-apply]").hidden = cfg.kind === "none";
    },
    entities() {
      const sec = dlg.$('[data-sec="entities"]');
      if (cfg.kind === "none") {
        sec.innerHTML = "";
        return;
      }
      sec.innerHTML = `<div class="fld"><span>${esc(T.entities)}</span>
        <input class="inp" data-filter placeholder="${esc(T.search)}" value="${esc(filter)}"><div class="clim" data-clim></div></div>`;
      sec.querySelector("[data-filter]").addEventListener("input", (x) => {
        filter = x.target.value;
        sections.list();
      });
      sections.list();
    },
    list() {
      const box = dlg.$("[data-clim]");
      if (!box) return;
      const f = filter.toLowerCase();
      const label = (s) => friendlyName(hass, s.entity_id);
      const where = (s) => areaName(hass, s.entity_id);
      const rows = kinds
        .entitiesOfKind(hass, cfg.kind)
        .sort(
          (a, b) =>
            cfg.entities.includes(b.entity_id) - cfg.entities.includes(a.entity_id) || label(a).localeCompare(label(b)),
        )
        .filter((s) => !f || `${label(s)} ${where(s)} ${s.entity_id}`.toLowerCase().includes(f));
      const one = { ...agenda, settings: { ...cfg } };
      box.innerHTML = rows.length
        ? rows
            .map((s) => {
              one.settings.entities = [s.entity_id];
              return `<label class="clim-row"><input type="checkbox" data-cl="${esc(s.entity_id)}" ${cfg.entities.includes(s.entity_id) ? "checked" : ""}>
                <span><b>${esc(label(s))}</b><small>${esc([where(s), s.entity_id].filter(Boolean).join(" · "))}</small></span>
                <em>${esc(kinds.liveText(hass, one, T))}</em></label>`;
            })
            .join("")
        : `<div class="clim-empty">${esc(T.no_entity)}</div>`;
      box.querySelectorAll("[data-cl]").forEach((c) =>
        c.addEventListener("change", () => {
          const id = c.dataset.cl;
          cfg.entities = c.checked ? [...cfg.entities, id] : cfg.entities.filter((x) => x !== id);
          sections.default();
        }),
      );
    },
    default() {
      const sec = dlg.$('[data-sec="default"]');
      if (cfg.kind === "none") {
        sec.innerHTML = "";
        return;
      }
      sec.innerHTML = `<div class="fld"><span>${esc(T.default_state)}</span>${kinds.statePicker(hass, view(), cfg.default_state, T, { allowNone: true, noneLabel: T.none })}</div>`;
      kinds.bindState(sec, {
        hass,
        agenda: view(),
        T,
        get: () => cfg.default_state,
        set: (v) => (cfg.default_state = v),
        rerender: sections.default,
      });
    },
    absence() {
      const sec = dlg.$('[data-sec="absence"]');
      const picker =
        cfg.follow_absence && cfg.kind !== "none"
          ? `<div class="fld"><span>${esc(T.away_state)}</span>${kinds.statePicker(hass, view(), cfg.away_state, T, { allowNone: true, noneLabel: T.away_default })}</div>`
          : "";
      const presence =
        !cfg.follow_absence && cfg.kind !== "none"
          ? `<label class="fld"><span>${esc(T.presence)}</span>
              <div class="row tight"><input type="number" class="inp num" min="0" max="60" step="5" data-jitter value="${Number(cfg.presence_jitter) || 0}"> min</div>
              <p class="hint">${esc(T.presence_hint)}</p></label>`
          : "";
      sec.innerHTML = `<label class="tgl"><input type="checkbox" data-follow ${cfg.follow_absence ? "checked" : ""}><span></span>${esc(T.follow_absence)}</label>${picker}${presence}`;
      sec.querySelector("[data-jitter]")?.addEventListener("change", (x) => {
        cfg.presence_jitter = Math.max(0, Math.min(60, Math.round(Number(x.target.value) || 0)));
      });
      sec.querySelector("[data-follow]").addEventListener("change", (x) => {
        cfg.follow_absence = x.target.checked;
        sections.absence();
      });
      if (picker)
        kinds.bindState(sec, {
          hass,
          agenda: view(),
          T,
          get: () => cfg.away_state,
          set: (v) => (cfg.away_state = v),
          rerender: sections.absence,
        });
    },
  };
  Object.values(sections).forEach((fn) => fn());
  const common = sharedFields(dlg.$('[data-sec="holidays"]'), { hass, T, shared, ws });

  dlg.$("[data-name]").addEventListener("input", (x) => (name = x.target.value));
  dlg.$("[data-resync]").addEventListener("change", (x) => (cfg.resync_on_start = x.target.checked));
  dlg.$("[data-manual]").addEventListener("change", (x) => (cfg.manual_hold = x.target.value));

  const save = async () => {
    await ws({
      type: "agenda/settings/save",
      entry_id: agenda.entry_id,
      name: name.trim() || agenda.name,
      settings: {
        color: cfg.color,
        icon: cfg.icon,
        kind: cfg.kind,
        entities: cfg.kind === "none" ? [] : cfg.entities,
        default_state: cfg.kind === "none" ? null : (cfg.default_state ?? null),
        resync_on_start: !!cfg.resync_on_start,
        manual_hold: cfg.manual_hold || "next_change",
        presence_jitter: cfg.kind === "none" || cfg.follow_absence ? 0 : Number(cfg.presence_jitter) || 0,
        follow_absence: !!cfg.follow_absence,
        away_state: cfg.kind === "none" ? null : (cfg.away_state ?? null),
      },
    });
    await common.save();
  };
  dlg.$("[data-save]").addEventListener("click", () =>
    dlg.run(async () => {
      await save();
      dlg.close("saved");
    }, T),
  );
  dlg.$("[data-apply]").addEventListener("click", () =>
    dlg.run(async () => {
      await save();
      await ws({ type: "agenda/resync", entry_id: agenda.entry_id });
      dlg.close("saved");
    }, T),
  );
  dlg.$("[data-dup]").addEventListener("click", () =>
    dlg.run(async () => {
      // closed without a result: the panel shows the copy itself
      if (!(await duplicate(() => dlg.close(null)))) dlg.busy(false);
    }, T),
  );
  dlg.$("[data-del]").addEventListener("click", async () => {
    const ok = await confirmDialog(host, {
      title: T.delete_agenda,
      text: T.delete_agenda_text,
      buttons: [
        { label: T.cancel, value: "" },
        { label: T.delete, value: "yes", danger: true },
      ],
    });
    if (ok)
      dlg.run(async () => {
        await callApi("DELETE", `config/config_entries/entry/${agenda.entry_id}`);
        dlg.close("deleted");
      }, T);
  });
  return { done: dlg.done, setHass: (h) => (hass = h) };
}

export const DIALOG_STYLES = `
  .dlg-back { position: fixed; inset: 0; z-index: 4; background: rgba(0,0,0,0); display: flex; align-items: center; justify-content: center;
    transition: background .18s; padding: 16px; box-sizing: border-box; }
  .dlg-back.in { background: rgba(0,0,0,.45); }
  .dlg { background: var(--card-background-color); color: var(--primary-text-color); border-radius: 18px; width: min(460px, 100%);
    max-height: calc(100vh - 32px); display: flex; flex-direction: column; box-shadow: 0 18px 50px rgba(0,0,0,.35);
    transform: translateY(12px) scale(.98); opacity: 0; transition: transform .18s, opacity .18s; }
  .dlg.wide { width: min(640px, 100%); }
  .dlg-back.in .dlg { transform: none; opacity: 1; }
  .dlg-head { display: flex; align-items: center; gap: 12px; padding: 18px 16px 8px 24px; }
  .dlg-head h2 { margin: 0; font-size: 20px; font-weight: 500; flex: 1; }
  .dlg-agenda { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; background: var(--agenda-hover); font-size: 13px; }
  .dlg-body { padding: 8px 24px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
  .dlg-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px 16px 24px; border-top: 1px solid var(--divider-color); flex-wrap: wrap; }
  .dlg-error { margin: 0 24px 16px; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, var(--error-color, #db4437) 14%, transparent); color: var(--error-color, #db4437); font-size: 13px; }
  .dlg-text { margin: 0; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }
  .xcal-list { display: flex; flex-direction: column; gap: 14px; margin-top: 14px; }
  .xcal-row .dot { margin-left: 4px; }
  .grow { flex: 1; }
  .foot-end { display: flex; gap: 8px; margin-left: auto; }
  .shared-f { display: flex; flex-direction: column; gap: 12px; }
  .fld { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .fld > span { font-size: 12px; font-weight: 600; letter-spacing: .03em; text-transform: uppercase; color: var(--secondary-text-color); }
  .fld > span em { text-transform: none; font-weight: 400; font-style: normal; color: var(--primary-color); }
  .fld.sm { flex: 1; min-width: 120px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .inp { font: inherit; color: var(--primary-text-color); background: var(--agenda-input); border: 1px solid var(--divider-color);
    border-radius: 10px; padding: 9px 11px; box-sizing: border-box; width: 100%; outline: none; color-scheme: light dark; }
  .inp:focus { border-color: var(--primary-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 20%, transparent); }
  .inp.num { width: 64px; display: inline-block; text-align: center; }
  .inp.code { font-family: var(--code-font-family, monospace); font-size: 12px; }
  .inp.bad { border-color: var(--error-color, #db4437); }
  select.inp { width: auto; min-width: 160px; }
  .inline { display: inline-flex; align-items: center; gap: 8px; color: var(--secondary-text-color); }
  .hint { margin: 0; font-size: 12.5px; color: var(--secondary-text-color); }
  .row.tight { gap: 6px; flex-wrap: nowrap; align-items: center; }
  .row.bounds { align-items: flex-start; }
  .row.pairs > .fld.sm { min-width: 200px; }
  .row.pairs select.inp { width: 100%; min-width: 0; }
  .fld.date { flex: 0 1 220px; }
  .fld.bound { min-width: 230px; }
  .pill .pill-text { width: 92px; padding: 2px 8px; font-size: 12.5px; margin: 0 2px 0 6px; height: auto; }
  .sunlim { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 4px; }
  .sunlim label { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--secondary-text-color); }
  .sunlim .inp { width: 112px; }
  .fld.bound select.inp { flex: 1 1 auto; min-width: 0; }
  .fld.bound input.inp { flex: 0 0 auto; width: auto; }
  .fld.bound .inp.num { width: 72px; }
  .cond { margin: 8px 0; }
  .cond .grow { flex: 1; min-width: 0; }
  .cond select.inp, .cond input.inp:not(.grow) { width: auto; max-width: 150px; }
  h4 { margin: 10px 0 4px; font-size: 13px; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font: inherit; display: inline-flex; align-items: center; gap: 4px; border: 2px solid transparent; border-radius: 99px; padding: 6px 14px;
    cursor: pointer; font-weight: 600; font-size: 13.5px; background: color-mix(in srgb, var(--c) 16%, var(--card-background-color));
    color: color-mix(in srgb, var(--primary-text-color) 72%, transparent); transition: transform .1s, background .15s; }
  .chip:hover { transform: translateY(-1px); background: color-mix(in srgb, var(--c) 30%, var(--card-background-color)); }
  .chip.on { background: var(--c); color: var(--t); border-color: var(--primary-text-color); padding-left: 10px;
    box-shadow: 0 0 0 2px var(--card-background-color), 0 2px 10px color-mix(in srgb, var(--c) 55%, transparent); }
  .chip ha-icon { --mdc-icon-size: 16px; }
  .chip:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 3px; }
  .temp { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px 14px; margin-top: 12px; }
  .temp-val { text-align: center; font-size: 44px; font-weight: 300; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--c) 70%, var(--primary-text-color)); }
  .temp-val small { font-size: 18px; margin-left: 2px; }
  .temp-range { grid-column: 1 / -1; width: 100%; accent-color: var(--primary-color); }
  .srow { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .srow > span { font-size: 12.5px; color: var(--secondary-text-color); }
  .srow .chips { gap: 6px; }
  .srow .chip { padding: 4px 11px; font-size: 12.5px; }
  .srow .chip.on { padding-left: 8px; }
  .ic { border: none; background: none; color: inherit; cursor: pointer; border-radius: 50%; width: 36px; height: 36px; display: inline-grid; place-items: center; }
  .ic:hover { background: var(--agenda-hover); }
  .ic.big { width: 48px; height: 48px; background: var(--agenda-hover); }
  .btn { font: inherit; font-weight: 500; border-radius: 99px; padding: 8px 18px; cursor: pointer; border: 1px solid var(--divider-color);
    background: transparent; color: var(--primary-text-color); }
  .btn:hover { background: var(--agenda-hover); }
  .btn.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.danger { color: var(--error-color, #db4437); }
  .btn.danger:not(.flat) { background: var(--error-color, #db4437); border-color: var(--error-color, #db4437); color: #fff; }
  .btn.flat { border-color: transparent; }
  .btn:disabled { opacity: .5; cursor: default; }
  .scope { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 12px; background: var(--agenda-hover); font-size: 13.5px; }
  .seg-btn { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 99px; overflow: hidden; }
  .seg-btn button { font: inherit; font-size: 13px; border: none; background: transparent; color: var(--primary-text-color); padding: 6px 12px; cursor: pointer; }
  .seg-btn button.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }
  .days { display: flex; gap: 6px; margin-top: 4px; }
  .day { font: inherit; font-weight: 600; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); cursor: pointer; }
  .day.on { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  details.more { border: 1px solid var(--divider-color); border-radius: 12px; padding: 0 14px; }
  details.more[open] { padding-bottom: 14px; }
  details.more summary { cursor: pointer; padding: 12px 0; font-weight: 500; }
  details.more summary span { color: var(--secondary-text-color); font-weight: 400; }
  details.more > div, details.more > p { margin-bottom: 8px; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .calside { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; margin-top: 4px; }
  .calside .sub { font-size: 13px; }
  .pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 4px 4px 10px; border-radius: 99px; background: var(--agenda-hover); font-size: 13px; }
  .pill button { border: none; background: none; color: inherit; cursor: pointer; font-size: 15px; padding: 0 6px; }
  .add { display: inline-flex; gap: 4px; align-items: center; }
  .add .inp { width: auto; padding: 5px 8px; }
  .look { display: flex; flex-direction: column; gap: 12px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .swatch { width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent; background: var(--c); cursor: pointer; padding: 0; }
  .swatch.on { border-color: var(--primary-text-color); box-shadow: 0 0 0 2px var(--card-background-color) inset; }
  .swatch.auto { width: auto; padding: 0 10px; background: var(--agenda-hover); color: var(--primary-text-color); font: inherit; font-size: 12px; border-radius: 99px; }
  .swatch-input { width: 32px; height: 32px; border: none; background: none; padding: 0; cursor: pointer; }
  .tgl { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; font-size: 14px; }
  .tgl input { display: none; }
  .tgl span { width: 36px; height: 20px; border-radius: 99px; background: var(--divider-color); position: relative; transition: background .15s; flex: none; }
  .tgl span::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
  .tgl input:checked + span { background: var(--primary-color); }
  .tgl input:checked + span::after { transform: translateX(16px); }
  .clim { display: flex; flex-direction: column; max-height: 240px; overflow-y: auto; border: 1px solid var(--divider-color); border-radius: 10px; }
  .clim-row { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--divider-color); }
  .clim-row:last-child { border-bottom: none; }
  .clim-row span { display: flex; flex-direction: column; min-width: 0; }
  .clim-row small { color: var(--secondary-text-color); font-size: 11.5px; }
  .clim-row em { font-style: normal; color: var(--secondary-text-color); font-variant-numeric: tabular-nums; }
  .clim-row input { accent-color: var(--primary-color); width: 18px; height: 18px; }
  .clim-row em { white-space: nowrap; }
  .clim-empty { padding: 12px; color: var(--secondary-text-color); font-size: 13px; }
  .kinds { display: flex; flex-wrap: wrap; gap: 8px; }
  .kind { font: inherit; font-size: 13.5px; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 10px; cursor: pointer;
    border: 1px solid var(--divider-color); background: transparent; color: var(--primary-text-color); }
  .kind ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .kind.on { border-color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 14%, transparent); font-weight: 600; }
  .kind.on ha-icon { color: var(--primary-color); }
  .hint b { font-weight: 600; color: var(--warning-color, #f57c00); }
  .dlg-body > section:empty { display: none; }
  [hidden] { display: none !important; }
  @media (max-width: 600px) {
    .dlg-back { padding: 0; align-items: flex-end; }
    .dlg, .dlg.wide { width: 100%; border-radius: 18px 18px 0 0; max-height: 92vh; }
  }
`;
