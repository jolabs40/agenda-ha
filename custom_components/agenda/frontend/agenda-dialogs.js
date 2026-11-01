// Dialogs: event editor, agenda settings, confirm and prompt. Each one opens in
// the panel's #dialog container and resolves a promise when closed.

const V = new URL(import.meta.url).search;
const { DAY, esc, fmtDay, friendlyName, loadHaComponents, wallDate, wallTime, weekday, wm } = await import(
  `./agenda-lib.js${V}`
);
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

export function promptDialog(host, { title, label, value = "", ok }) {
  const dlg = new Dialog(host, { title });
  dlg.open(
    `<label class="fld"><span>${esc(label)}</span><input class="inp" data-input value="${esc(value)}" autofocus></label>`,
    `<span class="grow"></span><button class="btn" data-close>${esc(ok.cancel)}</button><button class="btn primary" data-ok>${esc(ok.label)}</button>`,
  );
  const input = dlg.$("[data-input]");
  setTimeout(() => input.focus(), 50);
  const submit = () => input.value.trim() && dlg.close(input.value.trim());
  dlg.$("[data-ok]").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
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
      onChange(e.detail.value || []);
    });
    container.appendChild(sel);
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
    calendar: null,
    calendar_mode: "exclude",
    ...(ev.repeat || {}),
  };
  ev.start_actions = ev.start_actions || [];
  ev.end_actions = ev.end_actions || [];
  const occ = opts.occurrence && ev.repeat.freq !== "none" ? opts.occurrence : null;
  const st = { scope: "series" };

  // input fields: date, times (or dates for an all-day event)
  const s = wm(ev.start);
  const e = wm(ev.end);
  const form = {
    date: wallDate(s),
    t1: wallTime(s),
    t2: wallTime(e),
    d1: wallDate(s),
    d2: wallDate(e - (ev.all_day ? DAY : 0)),
  };
  const occForm = occ
    ? {
        date: occ.day,
        t1: wallTime(wm(occ.start)),
        t2: wallTime(wm(occ.end)),
        d1: occ.day,
        d2: wallDate(wm(occ.end) - DAY),
      }
    : null;
  const F = () => (st.scope === "once" && occForm ? occForm : form);

  const dlg = new Dialog(host, { title: isNew ? T.create_event : T.edit_event, wide: true });
  const agendaChip = () =>
    `<span class="dlg-agenda"><span class="dot" style="--c:${agenda.settings.color}"></span>${esc(agenda.name)}</span>`;

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
    <details class="more"><summary>${esc(T.look)}</summary>
      <div class="look">
        <div class="fld"><span>${esc(T.color)}</span><div class="swatches" data-swatches></div></div>
        <label class="fld"><span>${esc(T.icon)}</span><input class="inp" data-f="icon" value="${esc(ev.icon || "")}" placeholder="mdi:radiator"></label>
      </div>
    </details>
    <details class="more" ${ev.start_actions.length || ev.end_actions.length ? "open" : ""}><summary>${esc(T.start_actions)} / ${esc(T.end_actions)}<span data-acount></span></summary>
      <p class="hint">${esc(T.actions_hint)}</p>
      <h4>${esc(T.start_actions)}</h4><div data-actions="start_actions"></div>
      <h4>${esc(T.end_actions)}</h4><div data-actions="end_actions"></div>
    </details>
    <details class="more" ${ev.note ? "open" : ""}><summary>${esc(T.note)}</summary>
      <textarea class="inp" rows="2" data-f="note">${esc(ev.note || "")}</textarea></details>
    <label class="tgl"><input type="checkbox" data-f="enabled" ${ev.enabled === false ? "" : "checked"}><span></span>${esc(T.enabled_event)}</label>`;

  const footer = `${isNew ? "" : `<button class="btn danger flat" data-del>${esc(T.delete)}</button><button class="btn flat" data-dup>${esc(T.duplicate)}</button>`}
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
      const nextDay = !ev.all_day && f.t2 <= f.t1;
      sec.innerHTML = `<div class="fld"><span>${esc(T.when)}</span>
        <label class="tgl"><input type="checkbox" data-allday ${ev.all_day ? "checked" : ""}><span></span>${esc(T.all_day)}</label>
        ${
          ev.all_day
            ? `<div class="row"><label class="fld sm"><span>${esc(repeating ? T.from_date : T.start)}</span><input type="date" class="inp" data-w="d1" value="${f.d1}"></label>
               <label class="fld sm"><span>${esc(T.end)}</span><input type="date" class="inp" data-w="d2" value="${f.d2}"></label></div>`
            : `<div class="row"><label class="fld sm"><span>${esc(repeating ? T.from_date : T.date)}</span><input type="date" class="inp" data-w="date" value="${f.date}"></label>
               <label class="fld sm"><span>${esc(T.start)}</span><input type="time" class="inp" step="300" data-w="t1" value="${f.t1}"></label>
               <label class="fld sm"><span>${esc(T.end)}${nextDay ? ` <em>(${esc(T.next_day)})</em>` : ""}</span><input type="time" class="inp" step="300" data-w="t2" value="${f.t2}"></label></div>`
        }</div>`;
      sec.querySelector("[data-allday]").addEventListener("change", (x) => {
        ev.all_day = x.target.checked;
        sections.when();
      });
      sec.querySelectorAll("[data-w]").forEach((inp) =>
        inp.addEventListener("change", () => {
          F()[inp.dataset.w] = inp.value;
          if (
            inp.dataset.w === "date" &&
            st.scope === "series" &&
            ev.repeat.freq === "weekly" &&
            !ev.repeat.weekdays.length
          )
            sections.repeat();
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
            ? `<div class="row">
                <label class="fld sm"><span>${esc(T.until)}</span><input type="date" class="inp" data-r="until" value="${r.until || ""}"></label>
                <label class="fld sm"><span>${esc(T.holidays)}</span><select class="inp" data-r="holidays">
                  ${["ignore", "exclude", "only"].map((h) => `<option value="${h}" ${r.holidays === h ? "selected" : ""}>${esc(T[`holidays_${h}`])}</option>`).join("")}
                </select></label></div>`
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
      const cals = calendars();
      sec.innerHTML =
        ["exclude", "include"]
          .map(
            (key) => `<div class="fld"><span>${esc(key === "exclude" ? T.excluded : T.included)}</span>
            <div class="pills">${list(key)}<span class="add"><input type="date" class="inp" data-add-date="${key}"><button class="btn flat" data-add="${key}">${esc(T.add)}</button></span></div></div>`,
          )
          .join("") +
        `<div class="fld"><span>${esc(T.calendar_condition)}</span><p class="hint">${esc(T.calendar_hint)}</p>
          <div class="row">
            <select class="inp" data-cal><option value="">${esc(T.none)}</option>${cals
              .map(
                (c) =>
                  `<option value="${esc(c.entity_id)}" ${r.calendar === c.entity_id ? "selected" : ""}>${esc(friendlyName(hass, c.entity_id))}</option>`,
              )
              .join("")}</select>
            ${r.calendar ? `<select class="inp" data-cal-mode>${["exclude", "only"].map((m) => `<option value="${m}" ${r.calendar_mode === m ? "selected" : ""}>${esc(T[`calendar_${m}`])}</option>`).join("")}</select>` : ""}
          </div></div>`;
      const n = (r.exclude || []).length + (r.include || []).length + (r.calendar ? 1 : 0);
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
      sec.querySelector("[data-cal]").addEventListener("change", (x) => {
        r.calendar = x.target.value || null;
        sections.exceptions();
      });
      sec.querySelector("[data-cal-mode]")?.addEventListener("change", (x) => (r.calendar_mode = x.target.value));
    },
    swatches() {
      const box = dlg.$("[data-swatches]");
      const auto = !ev.color;
      box.innerHTML = `<button class="swatch auto ${auto ? "on" : ""}" data-color="">${esc(T.auto)}</button>${SWATCHES.map(
        (c) => `<button class="swatch ${ev.color === c ? "on" : ""}" data-color="${c}" style="--c:${c}"></button>`,
      ).join("")}<input type="color" class="swatch-input" data-color-input value="${ev.color || "#ef6c00"}">`;
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
  for (const key of ["start_actions", "end_actions"]) {
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
  dlg.$("[data-acount]").textContent = n0 ? ` · ${n0}` : "";

  const build = () => {
    const f = F();
    const out = structuredClone(ev);
    if (out.all_day) {
      out.start = f.d1;
      out.end = wallDate(wm(f.d2 < f.d1 ? f.d1 : f.d2) + DAY);
    } else {
      out.start = `${f.date}T${f.t1}`;
      const endDay = f.t2 <= f.t1 ? wallDate(wm(f.date) + DAY) : f.date;
      out.end = `${endDay}T${f.t2}`;
    }
    if (out.repeat.freq === "weekly" && !out.repeat.weekdays.length) out.repeat.weekdays = [weekday(wm(out.start))];
    if (out.repeat.freq !== "weekly") out.repeat.weekdays = [];
    if (!out.repeat.calendar) out.repeat.calendar = null;
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

/** opts: { hass, T, agenda, holidays, ws, callApi }; holidays comes from agenda/list. */
export function settingsEditor(host, { hass, T, agenda, holidays, ws, callApi }) {
  const cfg = structuredClone(agenda.settings);
  cfg.kind = cfg.kind || "none";
  cfg.entities = cfg.entities || [];
  const initialKind = cfg.kind;
  let name = agenda.name;
  let filter = "";
  const hol = { country: holidays?.configured || null, subdiv: holidays?.subdiv || null, options: null };
  const holInitial = JSON.stringify([hol.country, hol.subdiv]);
  const dlg = new Dialog(host, { title: `${T.settings} · ${agenda.name}`, wide: true });

  const body = `<label class="fld"><span>${esc(T.name)}</span><input class="inp" data-name value="${esc(name)}"></label>
    <div class="fld"><span>${esc(T.color)}</span><div class="swatches" data-swatches></div></div>
    <section data-sec="kind"></section>
    <section data-sec="entities"></section>
    <section data-sec="default"></section>
    <label class="tgl" data-resync-row><input type="checkbox" data-resync ${cfg.resync_on_start ? "checked" : ""}><span></span>${esc(T.resync_on_start)}</label>
    <details class="more"><summary>${esc(T.holidays_title)}</summary><div data-sec="holidays"></div></details>`;
  const footer = `<button class="btn danger flat" data-del>${esc(T.delete_agenda)}</button>
    <button class="btn flat" data-apply>${esc(T.resync_now)}</button><span class="grow"></span>
    <button class="btn" data-close>${esc(T.cancel)}</button><button class="btn primary" data-save>${esc(T.save)}</button>`;
  dlg.open(body, footer, "", T.close);

  const view = () => ({ ...agenda, settings: cfg });
  const sections = {
    swatches() {
      const box = dlg.$("[data-swatches]");
      box.innerHTML =
        SWATCHES.map(
          (c) => `<button class="swatch ${cfg.color === c ? "on" : ""}" data-color="${c}" style="--c:${c}"></button>`,
        ).join("") + `<input type="color" class="swatch-input" data-color-input value="${cfg.color}">`;
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
        }),
      );
      dlg.$("[data-resync-row]").hidden = cfg.kind === "none";
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
      const label = (s) => s.attributes.friendly_name || s.entity_id;
      const rows = kinds
        .entitiesOfKind(hass, cfg.kind)
        .sort(
          (a, b) =>
            cfg.entities.includes(b.entity_id) - cfg.entities.includes(a.entity_id) || label(a).localeCompare(label(b)),
        )
        .filter((s) => !f || `${label(s)} ${s.entity_id}`.toLowerCase().includes(f));
      const one = { ...agenda, settings: { ...cfg } };
      box.innerHTML = rows.length
        ? rows
            .map((s) => {
              one.settings.entities = [s.entity_id];
              return `<label class="clim-row"><input type="checkbox" data-cl="${esc(s.entity_id)}" ${cfg.entities.includes(s.entity_id) ? "checked" : ""}>
                <span><b>${esc(label(s))}</b><small>${esc(s.entity_id)}</small></span>
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
    async holidays() {
      const sec = dlg.$('[data-sec="holidays"]');
      const lang = T._lang;
      const haCountry = holidays?.ha_country;
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
            ${named.map(([c, n]) => `<option value="${c}" ${hol.country === c ? "selected" : ""}>${esc(n)}</option>`).join("")}
          </select></label>
          ${
            subdivisions.length
              ? `<label class="fld sm"><span>${esc(T.subdivision)}</span><select class="inp" data-subdiv>
            <option value="">${esc(T.whole_country)}</option>
            ${subdivisions.map((d) => `<option value="${esc(d.code)}" ${hol.subdiv === d.code ? "selected" : ""}>${esc(d.names.length ? `${d.names[d.names.length - 1]} (${d.code})` : d.code)}</option>`).join("")}
          </select></label>`
              : ""
          }
        </div>`;
      sec.querySelector("[data-country]").addEventListener("change", (x) => {
        hol.country = x.target.value || null;
        hol.subdiv = null;
        sections.holidays();
      });
      sec.querySelector("[data-subdiv]")?.addEventListener("change", (x) => (hol.subdiv = x.target.value || null));
    },
  };
  Object.values(sections).forEach((fn) => fn());

  dlg.$("[data-name]").addEventListener("input", (x) => (name = x.target.value));
  dlg.$("[data-resync]").addEventListener("change", (x) => (cfg.resync_on_start = x.target.checked));

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
      },
    });
    if (JSON.stringify([hol.country, hol.subdiv]) !== holInitial) {
      await ws({ type: "agenda/holidays/save", country: hol.country, subdiv: hol.subdiv });
    }
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
  .dlg-text { margin: 0; line-height: 1.5; }
  .grow { flex: 1; }
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
  h4 { margin: 10px 0 4px; font-size: 13px; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font: inherit; border: 2px solid transparent; border-radius: 99px; padding: 6px 14px; cursor: pointer; font-weight: 600; font-size: 13.5px;
    background: color-mix(in srgb, var(--c) 28%, var(--card-background-color)); color: var(--primary-text-color); transition: transform .1s, background .15s; }
  .chip:hover { transform: translateY(-1px); }
  .chip.on { background: var(--c); color: var(--t); border-color: color-mix(in srgb, var(--c) 60%, #000); box-shadow: 0 2px 8px color-mix(in srgb, var(--c) 45%, transparent); }
  .temp { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px 14px; margin-top: 12px; }
  .temp-val { text-align: center; font-size: 44px; font-weight: 300; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--c) 70%, var(--primary-text-color)); }
  .temp-val small { font-size: 18px; margin-left: 2px; }
  .temp-range { grid-column: 1 / -1; width: 100%; accent-color: var(--primary-color); }
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
