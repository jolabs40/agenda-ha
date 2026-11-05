// Sidebar panel. Sibling modules are imported with this module's version query
// so the browser never mixes files from two releases.

const V = new URL(import.meta.url).search;
const lib = await import(`./agenda-lib.js${V}`);
const kinds = await import(`./agenda-kinds.js${V}`);
const views = await import(`./agenda-views.js${V}`);
const dialogs = await import(`./agenda-dialogs.js${V}`);

const { DAY, dayOf, esc, mondayOf, nowWall, textColor, wall, wallDate, weekday, wm, fmtDay, fmtRange, texts } = lib;

const PREFS_KEY = "agenda-panel-prefs";
const SNAP = 15;
const LONG_PRESS_MS = 450;
// from this panel width the agendas get a column of their own, as in the Calendar panel
const WIDE = 960;

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch (_e) {
    return {};
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (_e) {
    // storage unavailable (private browsing)
  }
}

class AgendaPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    const prefs = loadPrefs();
    this._view = prefs.view || "week";
    // agendas left out of the views; older preferences name the single agenda shown instead
    this._hidden = new Set(Array.isArray(prefs.hidden) ? prefs.hidden : []);
    this._only = Array.isArray(prefs.hidden) ? null : prefs.selected;
    // calendars that are not agendas, shown for information, and their events
    this._cals = new Set(Array.isArray(prefs.calendars) ? prefs.calendars : []);
    this._ext = {};
    this._wide = false;
    this._anchor = null; // day shown (wall minutes)
    this._data = null;
    this._occ = {};
    this._skipped = {};
    this._holidays = {};
    this._vacation = {};
    this._dialogs = new Set();
    this._drag = null;

    // HA can set hass before this module is defined; the own property would then
    // shadow the setter, so stash it and replay it in connectedCallback.
    for (const prop of ["hass", "narrow", "panel", "route"]) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete this[prop];
        this._pending = { ...(this._pending || {}), [prop]: value };
      }
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this.T = texts(hass);
    if (first) this._init();
    else this._live();
    // a calendar added or removed meanwhile: the lists of other calendars follow
    const cals = Object.keys(hass.states)
      .filter((id) => id.startsWith("calendar."))
      .join();
    if (cals !== this._calKey) {
      const known = this._calKey !== undefined;
      this._calKey = cals;
      if (known && this._data) {
        this._renderSide();
        this._renderBar();
        this._renderTabs();
      }
    }
    this._dialogs.forEach((d) => d.setHass?.(hass));
  }

  get hass() {
    return this._hass;
  }

  set narrow(value) {
    this._narrow = value;
    this.shadowRoot.querySelector("[data-menu]")?.toggleAttribute("hidden", !value);
  }

  set panel(_value) {}
  set route(_value) {}

  connectedCallback() {
    if (this._pending) {
      const pending = this._pending;
      this._pending = null;
      for (const [prop, value] of Object.entries(pending)) this[prop] = value;
    }
    this._tick = setInterval(() => !this._drag && this._data && this._renderContent(), 60000);
    this._resize = () => this._data && this._renderContent();
    window.addEventListener("resize", this._resize);
    this._observer = new ResizeObserver(() => this._data && this._isWide() !== this._wide && this._renderAll());
    this._observer.observe(this);
    if (this._hass && !this._unsub) this._subscribe();
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    window.removeEventListener("resize", this._resize);
    this._observer?.disconnect();
    this._unsub?.then((u) => u()).catch(() => {});
    this._unsub = null;
  }

  async _init() {
    this.shadowRoot.innerHTML = `<style>${views.VIEW_STYLES}${dialogs.DIALOG_STYLES}${STYLES}</style>
      <div class="top">
        <button class="ic" data-menu ${this._narrow ? "" : "hidden"}><ha-icon icon="mdi:menu"></ha-icon></button>
        <ha-icon class="logo" icon="mdi:calendar-month"></ha-icon>
        <div class="title">${esc(this.T.title)}</div>
        <div class="tabs" data-tabs-top></div>
        <button class="ic" data-absence title="${esc(this.T.absence_title)}" aria-label="${esc(this.T.absence_title)}"><ha-icon icon="mdi:home-export-outline"></ha-icon></button>
      </div>
      <div class="main">
        <aside class="side" data-side hidden></aside>
        <div class="pane">
          <div class="bar" data-bar></div>
          <div class="away" data-away hidden></div>
          <div class="status" data-status></div>
          <div class="content" data-content><div class="loading"><ha-icon icon="mdi:loading"></ha-icon></div></div>
          <button class="fab" data-new-event hidden><ha-icon icon="mdi:plus"></ha-icon><span></span></button>
        </div>
      </div>
      <div id="dialog"></div>`;
    this._bind();
    this._subscribe();
    await this._load();
  }

  _subscribe() {
    this._unsub = this._hass.connection.subscribeMessage(
      () => {
        clearTimeout(this._reloadTimer);
        this._reloadTimer = setTimeout(() => this._load(), 150);
      },
      { type: "agenda/subscribe" },
    );
    this._unsub.catch(() => (this._unsub = null));
  }

  ws(msg) {
    return this._hass.callWS(msg);
  }

  get dialogHost() {
    return this.shadowRoot.getElementById("dialog");
  }

  async _load() {
    try {
      this._data = await this.ws({ type: "agenda/list" });
    } catch (err) {
      this.shadowRoot.querySelector("[data-content]").innerHTML =
        `<div class="empty"><p>${esc(this.T.error)} : ${esc(err.message || err)}</p></div>`;
      return;
    }
    const ids = this._data.agendas.map((a) => a.entry_id);
    if (this._only) {
      // a new agenda, or older preferences: that agenda alone ("all" names none)
      if (ids.includes(this._only)) this._hidden = new Set(ids.filter((id) => id !== this._only));
      this._only = null;
      this._savePrefs();
    }
    for (const id of this._hidden) if (!ids.includes(id)) this._hidden.delete(id);
    if (this._anchor == null) this._anchor = dayOf(this._now());
    await this._loadOcc();
    this._renderAll();
  }

  _range() {
    if (this._view === "house") return [this._anchor, this._anchor + DAY];
    if (this._view === "month") {
      const { start, weeks } = this._monthGrid();
      return [start, start + weeks * 7 * DAY];
    }
    const first = mondayOf(this._anchor);
    return [first, first + 7 * DAY];
  }

  /** The month containing the anchor: its first day, and the Monday-based weeks covering it. */
  _monthGrid() {
    const d = new Date(this._anchor * 60000);
    const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 60000;
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 60000;
    const start = mondayOf(first);
    return { first, month: d.getUTCMonth(), start, weeks: Math.ceil((next - start) / (7 * DAY)) };
  }

  async _loadOcc() {
    if (this._view === "list" || !this._data?.agendas.length) {
      this._occ = {};
      this._skipped = {};
      this._holidays = {};
      this._vacation = {};
      return;
    }
    const [a, b] = this._range();
    const res = await this.ws({ type: "agenda/occurrences", start: wallDate(a), end: wallDate(b) });
    this._occ = res.agendas || {};
    this._skipped = res.skipped || {};
    this._holidays = res.holidays || {};
    this._vacation = res.vacation || {};
    this._history = {};
    const tz = this._data.time_zone || this._hass.config.time_zone;
    const cals = [...this._cals].filter((id) => this._hass.states[id]);
    this._ext = cals.length ? await lib.calendarEvents(this._hass, cals, a, b, tz).catch(() => ({})) : {};
    if (this._view === "house" && this._anchor <= this._now()) {
      // the curves are a bonus: the view works without the recorder
      this._history = await lib.climateHistory((m) => this.ws(m), this._shown(), this._anchor, tz).catch(() => ({}));
    }
  }

  _now() {
    return nowWall(this._data?.time_zone || this._hass.config.time_zone);
  }

  _agenda(id) {
    return this._data.agendas.find((a) => a.entry_id === id);
  }

  _shown() {
    return this._data ? this._data.agendas.filter((a) => !this._hidden.has(a.entry_id)) : [];
  }

  /** The agenda shown alone, if only one is. */
  _single() {
    const shown = this._shown();
    return shown.length === 1 ? shown[0] : null;
  }

  /** Where a new event goes unless the editor says otherwise. */
  _target() {
    return this._single() || this._shown()[0] || this._data.agendas[0];
  }

  _show(ids) {
    this._hidden = new Set(this._data.agendas.map((a) => a.entry_id).filter((id) => !ids.includes(id)));
    this._savePrefs();
    this._renderAll();
  }

  /** Show only this agenda, or all of them when it already is the only one. */
  _solo(id) {
    const single = this._single();
    this._show(single?.entry_id === id ? this._data.agendas.map((a) => a.entry_id) : [id]);
  }

  /** A chip on a phone: from all agendas, keep this one; otherwise add or remove it, never down to none. */
  _chip(id) {
    const all = this._data.agendas.map((a) => a.entry_id);
    const shown = this._shown().map((a) => a.entry_id);
    if (id === "all" || shown.length === all.length) this._show(id === "all" ? all : [id]);
    else if (!shown.includes(id)) this._show([...shown, id]);
    else this._show(shown.length > 1 ? shown.filter((x) => x !== id) : all);
  }

  _savePrefs() {
    savePrefs({ view: this._view, hidden: [...this._hidden], calendars: [...this._cals] });
  }

  /** Calendars of Home Assistant that are not agendas: shown for information, never used. */
  _otherCalendars() {
    const own = new Set(this._data.agendas.map((a) => a.agenda_entities?.calendar));
    return Object.keys(this._hass.states)
      .filter((id) => id.startsWith("calendar.") && !own.has(id))
      .map((id) => ({ id, name: lib.friendlyName(this._hass, id), color: lib.calendarColor(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The other calendars shown, with their events. */
  _external() {
    return this._otherCalendars()
      .filter((c) => this._cals.has(c.id))
      .map((c) => ({ ...c, events: (this._ext[c.id] || []).map((e, i) => ({ ...e, i })) }));
  }

  async _showCalendars(ids) {
    this._cals = new Set(ids);
    this._savePrefs();
    await this._loadOcc();
    this._renderAll();
  }

  /** What an event of another calendar is about: it can only be read here. */
  _openExternal(el) {
    const cal = this._external().find((c) => c.id === el.dataset.xev);
    const ev = cal?.events[Number(el.dataset.xi)];
    if (!ev) return;
    const T = this.T;
    const s = wm(ev.start);
    const e = wm(ev.end);
    const day = (m) => fmtDay(m, T._lang, { weekday: "long", day: "numeric", month: "long" });
    let when = `${day(s)} ${wall(s).slice(11)}–${wall(e).slice(11)}`;
    if (ev.all_day) when = e - s > DAY ? `${day(s)} – ${day(e - DAY)}` : day(s);
    else if (dayOf(e - 1) !== dayOf(s)) when = `${day(s)} ${wall(s).slice(11)} – ${day(e)} ${wall(e).slice(11)}`;
    dialogs.confirmDialog(this.dialogHost, {
      title: ev.summary || cal.name,
      text: [`${cal.name} · ${when}`, ev.location, ev.description].filter(Boolean).join("\n\n"),
      buttons: [{ label: T.close, value: "ok", primary: true }],
    });
  }

  _isWide() {
    return this.getBoundingClientRect().width >= WIDE;
  }

  _renderAll() {
    this._wide = this._isWide();
    this.shadowRoot.querySelector(".main").classList.toggle("wide", this._wide);
    this._renderSide();
    this._renderBar();
    this._renderTabs();
    this._renderAway();
    this._renderStatus();
    this._renderFab();
    this._renderContent();
  }

  /** The floating button of the Calendar panel, bottom right. */
  _renderFab() {
    const fab = this.shadowRoot.querySelector(".fab");
    const on = Boolean(this._data?.agendas.length && this._canEdit());
    fab.hidden = !on;
    fab.querySelector("span").textContent = this.T.add_event;
    // the views leave room at their end so that it never hides their last line
    this.shadowRoot.querySelector(".pane").classList.toggle("fab-on", on);
  }

  /** A wall time, with its weekday when it is not today. */
  _at(w) {
    const n = wm(w);
    const day = dayOf(n) === dayOf(this._now()) ? "" : `${fmtDay(n, this.T._lang, { weekday: "short" })} `;
    return `${day}${wall(n).slice(11)}`;
  }

  /** What takes the agenda off its schedule now: an override, devices set by hand. */
  _offSchedule(a) {
    return lib.offSchedule(a, this.T, (w) => this._at(w));
  }

  /** Whether this user may skip ahead or resume the schedule of this agenda. */
  _canSteer(a) {
    return this._canEdit() && a.enabled && kinds.hasStates(a) && (a.settings.entities || []).length > 0;
  }

  /** One line under an agenda's name: its state now and the next change. */
  _summary(a) {
    const T = this.T;
    if (!a.enabled) return T.paused;
    if (!kinds.hasStates(a)) return "";
    const hass = this._hass;
    const parts = [a.state ? kinds.stateLabel(hass, a, a.state, T) : T.none];
    const off = this._offSchedule(a);
    if (off.length) parts.push(...off);
    else if (a.next_change) {
      const n = wm(a.next_change);
      const day = dayOf(n) === dayOf(this._now()) ? "" : `${fmtDay(n, T._lang, { weekday: "short" })} `;
      const next = a.next_state ? `${kinds.stateLabel(hass, a, a.next_state, T)} ` : "";
      parts.push(`${next}${day}${T.at} ${wall(n).slice(11)}`);
    }
    return parts.join(" · ");
  }

  _renderSide() {
    const side = this.shadowRoot.querySelector("[data-side]");
    side.hidden = !this._wide;
    if (!this._wide || !this._data) {
      side.innerHTML = "";
      return;
    }
    const T = this.T;
    const agendas = this._data.agendas;
    const shown = this._shown().length;
    const box = (state, color, text) =>
      `<span class="cb ${state}" style="--c:${esc(color)};--t:${esc(text)}">${state === "on" ? `<ha-icon icon="mdi:check"></ha-icon>` : ""}</span>`;
    const rows = agendas
      .map((a) => {
        const on = !this._hidden.has(a.entry_id);
        const color = a.settings.color;
        const alone = on && shown === 1;
        return `<div class="sa ${on ? "" : "off"} ${a.enabled ? "" : "paused"}">
          <button class="cb-btn" data-check="${esc(a.entry_id)}" role="checkbox" aria-checked="${on}" aria-label="${esc(a.name)}">${box(on ? "on" : "", color, textColor(color))}</button>
          <ha-icon class="sa-kind" icon="${esc(kinds.kindIcon(a))}" title="${esc(T.kinds[kinds.kindOf(a)] || "")}"></ha-icon>
          <button class="sa-name" data-solo="${esc(a.entry_id)}" title="${esc(alone ? T.show_all : T.show_only)}"><b>${esc(a.name)}</b><small>${esc(this._summary(a))}</small></button>
          <label class="tgl sm" title="${esc(a.enabled ? T.active : T.paused)}"><input type="checkbox" data-enabled="${esc(a.entry_id)}" ${a.enabled ? "checked" : ""}><span></span></label>
          ${this._canSteer(a) && this._offSchedule(a).length ? `<button class="ic sm keep" data-resume="${esc(a.entry_id)}" title="${esc(T.resume)}"><ha-icon icon="mdi:restore"></ha-icon></button>` : ""}
          ${this._canSteer(a) && a.next_change ? `<button class="ic sm" data-advance="${esc(a.entry_id)}" title="${esc(T.advance)}"><ha-icon icon="mdi:skip-next"></ha-icon></button>` : ""}
          ${this._isAdmin() ? `<button class="ic sm" data-settings="${esc(a.entry_id)}" title="${esc(T.settings)}"><ha-icon icon="mdi:cog-outline"></ha-icon></button>` : ""}
        </div>`;
      })
      .join("");
    const state = shown === agendas.length ? "on" : shown ? "some" : "";
    const all =
      agendas.length > 1
        ? `<div class="sa all"><button class="cb-btn" data-check-all role="checkbox" aria-checked="${state === "on"}" aria-label="${esc(T.all)}">${box(state, "var(--primary-color)", "var(--text-primary-color, #fff)")}</button>
          <span class="sa-kind"></span>
          <button class="sa-name" data-check-all><b>${esc(T.all)}</b></button></div>`
        : "";
    const others = this._otherCalendars();
    const ext = others.length
      ? `<div class="side-h">${esc(T.other_calendars)}<small>${esc(T.other_calendars_hint)}</small></div>${others
          .map((c) => {
            const on = this._cals.has(c.id);
            return `<div class="sa x ${on ? "" : "off"}">
              <button class="cb-btn" data-xcal="${esc(c.id)}" role="checkbox" aria-checked="${on}" aria-label="${esc(c.name)}">${box(on ? "on" : "", c.color, textColor(c.color))}</button>
              <ha-icon class="sa-kind" icon="mdi:calendar-outline"></ha-icon>
              <button class="sa-name" data-xcal="${esc(c.id)}" title="${esc(c.name)}"><b>${esc(c.name)}</b></button></div>`;
          })
          .join("")}`
      : "";
    side.innerHTML = `${all}${rows}
      ${this._isAdmin() ? `<button class="side-add" data-new-agenda><ha-icon icon="mdi:calendar-plus"></ha-icon>${esc(T.new_agenda)}</button>` : ""}
      ${ext}`;
  }

  _renderAway() {
    const box = this.shadowRoot.querySelector("[data-away]");
    const absence = this._data?.shared?.absence;
    const button = this.shadowRoot.querySelector(".top [data-absence]");
    button?.classList.toggle("on", Boolean(absence));
    if (button) button.hidden = !this._canEdit();
    box.hidden = !absence;
    if (!absence) return;
    const T = this.T;
    const until = absence.until
      ? `${fmtDay(wm(absence.until), T._lang, { weekday: "short", day: "numeric", month: "short" })} ${wall(wm(absence.until)).slice(11)}`
      : null;
    box.innerHTML = `<ha-icon icon="mdi:home-export-outline"></ha-icon><span>${esc(T.absence_on(until))}</span>
      ${this._canEdit() ? `<button class="btn sm" data-absence>${esc(T.absence_title)}</button><button class="btn sm" data-absence-stop>${esc(T.absence_stop)}</button>` : ""}`;
  }

  _renderTabs() {
    const T = this.T;
    const html = [
      ["week", "mdi:calendar-week", T.week],
      ["month", "mdi:calendar-month-outline", T.month],
      ["house", "mdi:home-clock-outline", T.house],
      ["list", "mdi:format-list-bulleted", T.list],
    ]
      .map(
        ([v, icon, label]) =>
          `<button class="tab ${this._view === v ? "on" : ""}" data-view="${v}" title="${esc(label)}"><ha-icon icon="${icon}"></ha-icon><span>${esc(label)}</span></button>`,
      )
      .join("");
    // in the header on a phone, next to the period on a wide screen
    const top = this.shadowRoot.querySelector("[data-tabs-top]");
    top.innerHTML = this._wide ? "" : html;
    top.hidden = this._wide;
    const bar = this.shadowRoot.querySelector(".bar [data-tabs]");
    if (bar) bar.innerHTML = this._wide ? html : "";
  }

  _renderBar() {
    const T = this.T;
    const bar = this.shadowRoot.querySelector("[data-bar]");
    if (!this._data) return;
    const agendas = this._data.agendas;
    const [a, b] = this._range();
    const notes = this._view === "house" ? [this._holidays[wallDate(a)], this._vacation[wallDate(a)]] : [];
    let label = fmtRange(a, b - DAY, T._lang);
    if (this._view === "house")
      label = [fmtDay(a, T._lang, { weekday: "long", day: "numeric", month: "long" }), ...notes.filter(Boolean)].join(
        " · ",
      );
    if (this._view === "month") label = fmtDay(this._monthGrid().first, T._lang, { month: "long", year: "numeric" });
    const nav =
      this._view !== "list" && agendas.length
        ? `<div class="nav-l">
          <button class="ic" data-nav="-1"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
          <button class="btn sm" data-nav="0">${esc(T.today)}</button>
          <button class="ic" data-nav="1"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        </div>
        <span class="range">${esc(label)}</span>`
        : "";
    if (this._wide) {
      // the agendas are in the column: one line, as in the Calendar panel
      bar.innerHTML = `<div class="nav wide">${nav || "<span></span><span></span>"}
        <div class="nav-r"><div class="tabs" data-tabs></div></div></div>`;
      return;
    }
    const all = this._shown().length === agendas.length;
    const chips = agendas
      .map((x) => {
        const on = !all && !this._hidden.has(x.entry_id);
        return `<button class="ag ${on ? "on" : ""} ${x.enabled ? "" : "paused"}" data-chip="${esc(x.entry_id)}" style="--c:${esc(x.settings.color)}">
          <span class="dot"></span>${esc(x.name)}${x.enabled ? "" : `<ha-icon icon="mdi:lock-outline"></ha-icon>`}</button>`;
      })
      .join("");
    const allChip =
      agendas.length > 1 ? `<button class="ag all ${all ? "on" : ""}" data-chip="all">${esc(T.all)}</button>` : "";
    // the other calendars, picked in a dialog: one chip for them all
    const xn = this._external().length;
    const xChip = this._otherCalendars().length
      ? `<button class="ag xpick ${xn ? "on" : ""}" data-xpick title="${esc(T.other_calendars)}" aria-label="${esc(T.other_calendars)}"><ha-icon icon="mdi:calendar-multiple"></ha-icon>${xn || ""}</button>`
      : "";
    const adds = this._isAdmin()
      ? `<button class="btn tonal" data-new-agenda title="${esc(T.new_agenda)}"><ha-icon icon="mdi:calendar-plus"></ha-icon>${esc(T.agenda)}</button>`
      : "";
    const sel = this._single();
    bar.innerHTML = `<div class="ags">${allChip}${chips}${xChip}${adds ? `<span class="adds">${adds}</span>` : ""}</div>
      ${
        sel
          ? `<div class="acts"><label class="tgl" title="${esc(sel.enabled ? T.active : T.paused)}"><input type="checkbox" data-enabled="${esc(sel.entry_id)}" ${sel.enabled ? "checked" : ""}><span></span>${esc(sel.enabled ? T.active : T.paused)}</label>
          ${this._isAdmin() ? `<button class="ic" data-settings="${esc(sel.entry_id)}" title="${esc(T.settings)}"><ha-icon icon="mdi:cog-outline"></ha-icon></button>` : ""}</div>`
          : ""
      }
      ${nav ? `<div class="nav">${nav}</div>` : ""}`;
  }

  _renderStatus() {
    const box = this.shadowRoot.querySelector("[data-status]");
    const T = this.T;
    // one agenda shown alone: its event, its devices and the buttons, which the column has no room for
    const sel = this._single();
    if (!sel || this._view === "house") {
      box.innerHTML = "";
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const parts = [];
    const hass = this._hass;
    const withState = kinds.hasStates(sel);
    if (withState) {
      const ev = sel.state_event ? sel.events.find((e) => e.id === sel.state_event) : null;
      const now = sel.state ? kinds.stateLabel(hass, sel, sel.state, T) : T.none;
      parts.push(
        `<span class="st-now">${esc(T.now)} <span class="st-chip" style="--c:${esc(kinds.stateColor(hass, sel, sel.state) || "var(--divider-color)")}">${esc(now)}</span>${ev && ev.name ? ` ${esc(ev.name)}` : ""}</span>`,
      );
      if ((sel.settings.entities || []).length) {
        parts.push(
          `<span class="st-live"><ha-icon icon="${kinds.liveIcon(sel)}"></ha-icon><span data-live="${esc(sel.entry_id)}">${esc(kinds.liveText(hass, sel, T))}</span></span>`,
        );
      }
    }
    if (sel.next_change) {
      const n = wm(sel.next_change);
      const day = dayOf(n) === dayOf(this._now()) ? "" : `${fmtDay(n, T._lang, { weekday: "short", day: "numeric" })} `;
      const nextText = withState && sel.next_state ? kinds.stateLabel(hass, sel, sel.next_state, T) : sel.next_label;
      const nextColor = withState ? kinds.stateColor(hass, sel, sel.next_state) : null;
      parts.push(
        `<span class="st-next">${esc(T.next)} ${esc(day)}${esc(T.at)} ${esc(wall(n).slice(11))}${nextText ? ` <span class="st-chip" style="--c:${esc(nextColor || "var(--divider-color)")}">${esc(nextText)}</span>` : ""}</span>`,
      );
    }
    if (!sel.enabled)
      parts.push(`<span class="st-paused"><ha-icon icon="mdi:lock-outline"></ha-icon>${esc(T.paused)}</span>`);
    const off = withState ? this._offSchedule(sel) : [];
    if (off.length)
      parts.push(
        `<span class="st-off"><ha-icon icon="mdi:hand-back-right-outline"></ha-icon>${esc(off.join(" · "))}</span>`,
      );
    if (this._canSteer(sel)) {
      const id = esc(sel.entry_id);
      parts.push(
        `<span class="st-act">${off.length ? `<button class="btn sm" data-resume="${id}"><ha-icon icon="mdi:restore"></ha-icon>${esc(T.resume)}</button>` : ""}${sel.next_change ? `<button class="btn sm" data-advance="${id}"><ha-icon icon="mdi:skip-next"></ha-icon>${esc(T.advance)}</button>` : ""}</span>`,
      );
    }
    box.innerHTML = parts.join("");
  }

  _hourHeight() {
    const content = this.shadowRoot.querySelector("[data-content]");
    const top = content.getBoundingClientRect().top;
    const avail = window.innerHeight - top - 16 - 64; // day header
    return Math.max(22, Math.min(46, Math.floor(avail / 24)));
  }

  _renderContent() {
    const box = this.shadowRoot.querySelector("[data-content]");
    const T = this.T;
    if (!this._data) return;
    if (!this._data.agendas.length) {
      box.innerHTML = `<div class="empty"><ha-icon icon="mdi:calendar-plus"></ha-icon><h3>${esc(T.no_agenda)}</h3><p>${esc(T.no_agenda_hint)}</p>
        <button class="btn primary" data-new-agenda><ha-icon icon="mdi:plus"></ha-icon>${esc(T.new_agenda)}</button></div>`;
      return;
    }
    const now = this._now();
    const ctx = {
      hass: this._hass,
      T,
      agendas: this._shown(),
      allAgendas: this._data.agendas,
      occ: this._occ,
      skipped: this._skipped,
      holidays: this._holidays,
      vacation: this._vacation,
      now,
      editable: this._canEdit(),
      external: this._view === "list" ? [] : this._external(),
    };
    const scroll = box.querySelector(".card")?.scrollTop;
    if (this._view === "week") {
      box.innerHTML = `<div class="card wk-card">${views.renderWeek({ ...ctx, firstDay: mondayOf(this._anchor), days: 7, hourH: this._hourHeight() })}</div>`;
    } else if (this._view === "month") {
      const { start, weeks, month } = this._monthGrid();
      box.innerHTML = `<div class="card mo-card">${views.renderMonth({ ...ctx, firstDay: start, weeks, month })}</div>`;
    } else if (this._view === "house") {
      box.innerHTML = `<div class="card hs-card">${views.renderHouse({ ...ctx, day: this._anchor, history: this._history })}</div>`;
    } else {
      box.innerHTML = `<div class="card ls-card">${views.renderList(ctx)}</div>`;
    }
    if (scroll) box.querySelector(".card").scrollTop = scroll;
    requestAnimationFrame(() => views.fitLabels(box));
  }

  /** Cheap refresh on every hass update. */
  _live() {
    if (!this._data) return;
    this.shadowRoot.querySelectorAll("[data-live]").forEach((el) => {
      const a = this._agenda(el.dataset.live);
      if (a) el.textContent = views.liveText(this._hass, a, this.T);
    });
  }

  _isAdmin() {
    return Boolean(this._hass?.user?.is_admin);
  }

  /** Events and the absence: admins, or everyone when the shared settings allow it. */
  _canEdit() {
    return this._isAdmin() || Boolean(this._data?.shared?.allow_users);
  }

  _bind() {
    const root = this.shadowRoot;
    root.addEventListener("click", (e) => this._onClick(e));
    root.addEventListener("change", (e) => this._onChange(e));
    root.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    // once a long press has picked a block up, the finger moves it instead of scrolling
    root.addEventListener("touchmove", (e) => this._drag?.armed && e.cancelable && e.preventDefault(), {
      passive: false,
    });
  }

  async _setView(view) {
    this._view = view;
    this._savePrefs();
    await this._loadOcc();
    this._renderAll();
  }

  async _navigate(dir) {
    const step = this._view === "house" ? DAY : 7 * DAY;
    if (dir === 0) this._anchor = dayOf(this._now());
    else if (this._view === "month") {
      const d = new Date(this._anchor * 60000);
      this._anchor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1) / 60000;
    } else this._anchor += dir * step;
    await this._loadOcc();
    this._renderAll();
  }

  async _onClick(e) {
    const t = e.target;
    if (this._suppressClick) {
      this._suppressClick = false;
      return;
    }
    if (t.closest("#dialog")) return;
    const hit = (sel) => t.closest(sel);
    let el;
    if (hit("[data-menu]")) {
      this.dispatchEvent(new Event("hass-toggle-menu", { bubbles: true, composed: true }));
    } else if ((el = hit("[data-xev]"))) {
      this._openExternal(el);
    } else if ((el = hit("[data-xcal]"))) {
      const id = el.dataset.xcal;
      this._showCalendars(this._cals.has(id) ? [...this._cals].filter((x) => x !== id) : [...this._cals, id]);
    } else if (hit("[data-xpick]")) {
      const ids = await dialogs.calendarsDialog(this.dialogHost, {
        T: this.T,
        calendars: this._otherCalendars(),
        selected: this._cals,
      });
      if (ids) this._showCalendars(ids);
    } else if ((el = hit("[data-view]"))) {
      this._setView(el.dataset.view);
    } else if ((el = hit("[data-nav]"))) {
      this._navigate(Number(el.dataset.nav));
    } else if (hit("[data-check-all]")) {
      const all = this._data.agendas.map((a) => a.entry_id);
      this._show(this._shown().length === all.length ? [] : all);
    } else if ((el = hit("[data-check]"))) {
      const id = el.dataset.check;
      const shown = this._shown().map((a) => a.entry_id);
      this._show(shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id]);
    } else if ((el = hit("[data-solo]"))) {
      this._solo(el.dataset.solo);
    } else if ((el = hit("[data-chip]"))) {
      this._chip(el.dataset.chip);
    } else if ((el = hit("[data-select]"))) {
      // a name in the house view: that agenda's week
      const id = el.dataset.select;
      this._hidden = new Set(this._data.agendas.map((a) => a.entry_id).filter((x) => x !== id));
      this._setView("week");
    } else if (hit("[data-absence-stop]")) {
      await this._try(() => this.ws({ type: "agenda/absence/set", active: false }));
      await this._load();
    } else if (hit("[data-absence]")) {
      if (!this._canEdit()) return;
      const result = await dialogs.absenceDialog(this.dialogHost, {
        T: this.T,
        absence: this._data.shared.absence,
        now: this._now(),
        ws: (m) => this.ws(m),
      });
      if (result) await this._load();
    } else if (hit("[data-new-agenda]")) {
      this._newAgenda();
    } else if ((el = hit("[data-settings]"))) {
      this._openSettings(el.dataset.settings);
    } else if ((el = hit("[data-advance]"))) {
      this._try(() => this.ws({ type: "agenda/override", entry_id: el.dataset.advance, action: "next" }));
    } else if ((el = hit("[data-resume]"))) {
      this._try(() => this.ws({ type: "agenda/override", entry_id: el.dataset.resume, action: "resume" }));
    } else if (hit("[data-new-event]")) {
      const now = this._now();
      const start = Math.ceil((now + 1) / 60) * 60;
      this._openNew(this._target(), start);
    } else if ((el = hit("[data-toggle]"))) {
      e.stopPropagation();
      const agenda = this._agenda(el.dataset.entry);
      const event = structuredClone(agenda.events.find((x) => x.id === el.dataset.toggle));
      event.enabled = event.enabled === false;
      await this._try(() => this.ws({ type: "agenda/event/save", entry_id: agenda.entry_id, event }));
    } else if ((el = hit("[data-edit]"))) {
      const agenda = this._agenda(el.dataset.entry);
      this._openEvent(
        agenda,
        agenda.events.find((x) => x.id === el.dataset.edit),
        null,
      );
    } else if ((el = hit(".seg[data-event], .mo-ev[data-event]"))) {
      this._openOccurrence(el);
    } else if ((el = hit("[data-ghost]"))) {
      // a day the series does not run: only the series can be edited
      const agenda = this._agenda(el.dataset.entry);
      const event = agenda?.events.find((x) => x.id === el.dataset.ghost);
      if (event) this._openEvent(agenda, event, null);
    } else if ((el = hit("[data-copy-day]"))) {
      await this._copyDay(Number(el.dataset.copyDay));
    } else if ((el = hit("[data-mo-day]"))) {
      this._anchor = Number(el.dataset.moDay);
      this._setView("week");
    } else if ((el = hit(".seg[data-gap-day]"))) {
      if (!this._canEdit()) return;
      const track = el.closest(".hs-track");
      const r = track.getBoundingClientRect();
      const minute = Math.round((((e.clientX - r.left) / r.width) * DAY) / 30) * 30;
      this._openNew(this._agenda(el.dataset.entry), Number(el.dataset.gapDay) + Math.min(minute, DAY - 60));
    }
  }

  async _onChange(e) {
    if (e.target.matches("[data-enabled]")) {
      const entry = e.target.dataset.enabled;
      await this._try(() => this.ws({ type: "agenda/set_enabled", entry_id: entry, enabled: e.target.checked }));
    }
  }

  async _try(fn) {
    try {
      return await fn();
    } catch (err) {
      await dialogs.confirmDialog(this.dialogHost, {
        title: this.T.error,
        text: err.message || String(err),
        buttons: [{ label: this.T.close, value: "ok", primary: true }],
      });
      await this._load();
      return null;
    }
  }

  _track(handle) {
    this._dialogs.add(handle);
    handle.done.then(async (result) => {
      this._dialogs.delete(handle);
      if (result) await this._load();
    });
  }

  /**
   * Copy a day of the week shown to other days of that week: weekly series gain the
   * weekdays, other occurrences are duplicated as one-off events.
   */
  async _copyDay(day) {
    if (!this._canEdit()) return;
    const firstDay = mondayOf(this._anchor);
    const targets = await dialogs.copyDayDialog(this.dialogHost, { T: this.T, day, firstDay });
    if (!targets?.length) return;
    const iso = wallDate(day);
    await this._try(async () => {
      for (const agenda of this._shown()) {
        const occs = (this._occ[agenda.entry_id] || []).filter((o) => o.day === iso);
        const done = new Set();
        for (const occ of occs) {
          const event = agenda.events.find((x) => x.id === occ.event_id);
          if (!event || done.has(event.id)) continue;
          done.add(event.id);
          const r = event.repeat || {};
          const byRule = !(r.include || []).includes(iso);
          if (r.freq === "weekly" && byRule) {
            const ev = structuredClone(event);
            const base = ev.repeat.weekdays?.length ? ev.repeat.weekdays : [weekday(wm(ev.start))];
            ev.repeat.weekdays = [...new Set([...base, ...targets.map((d) => weekday(d))])].sort();
            await this.ws({ type: "agenda/event/save", entry_id: agenda.entry_id, event: ev });
          } else if (!(r.freq === "daily" && (r.interval || 1) === 1 && byRule)) {
            for (const target of targets) {
              const { id, ...copy } = structuredClone(event);
              copy.repeat = { freq: "none" };
              copy.start = wall(wm(occ.start) + target - day);
              copy.end = wall(wm(occ.end) + target - day);
              if (copy.all_day) {
                copy.start = copy.start.slice(0, 10);
                copy.end = copy.end.slice(0, 10);
              }
              await this.ws({ type: "agenda/event/save", entry_id: agenda.entry_id, event: copy });
            }
          }
        }
      }
      await this._load();
    });
  }

  _openOccurrence(el) {
    const agenda = this._agenda(el.dataset.entry);
    const event = agenda?.events.find((x) => x.id === el.dataset.event);
    if (!event) return;
    this._openEvent(agenda, event, { day: el.dataset.day, start: el.dataset.start, end: el.dataset.end });
  }

  _openEvent(agenda, event, occurrence) {
    if (!this._canEdit()) return;
    this._track(
      dialogs.eventEditor(this.dialogHost, {
        hass: this._hass,
        T: this.T,
        agenda,
        agendas: this._data.agendas,
        event,
        occurrence,
        shared: this._data.shared,
        ws: (m) => this.ws(m),
      }),
    );
  }

  _openNew(agenda, startMinute) {
    if (!agenda || !this._canEdit()) return;
    const draft = {
      name: "",
      start: wall(startMinute),
      end: wall(startMinute + 60),
      all_day: false,
      enabled: true,
      repeat: { freq: "none" },
      state: kinds.hasStates(agenda) ? kinds.draftState(this._hass, agenda) : null,
      color: null,
    };
    this._openEvent(agenda, draft, null);
  }

  _openSettings(id) {
    const agenda = this._agenda(id);
    if (!agenda || !this._isAdmin()) return;
    this._track(
      dialogs.settingsEditor(this.dialogHost, {
        hass: this._hass,
        T: this.T,
        agenda,
        shared: this._data.shared,
        ws: (m) => this.ws(m),
        callApi: (method, path, body) => this._hass.callApi(method, path, body),
      }),
    );
  }

  async _newAgenda() {
    if (!this._isAdmin()) return;
    const T = this.T;
    const name = await dialogs.promptDialog(this.dialogHost, {
      title: T.new_agenda,
      label: T.agenda_name,
      ok: { label: T.save, cancel: T.cancel },
    });
    if (!name) return;
    await this._try(async () => {
      const flow = await this._hass.callApi("POST", "config/config_entries/flow", {
        handler: "agenda",
        show_advanced_options: false,
      });
      const res = await this._hass.callApi("POST", `config/config_entries/flow/${flow.flow_id}`, { name });
      if (res.type !== "create_entry") throw new Error(res.reason || res.errors?.name || "failed");
      const id = res.result?.entry_id;
      this._only = id || null;
      // the entry sets itself up in the background: wait until the agenda is listed
      for (let i = 0; id && i < 20; i++) {
        const list = await this.ws({ type: "agenda/list" });
        if (list.agendas.some((a) => a.entry_id === id)) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await this._load();
      // a new agenda does nothing until it knows what it controls
      if (id) this._openSettings(id);
    });
  }

  _onPointerDown(e) {
    const block = e.target.closest(".ev");
    const col = e.target.closest(".wk-col");
    // a ghost or another calendar's event is neither dragged nor a free slot: the click opens it
    if (!col || e.button !== 0 || !this._canEdit() || e.target.closest("[data-ghost], [data-xev]")) return;
    const cols = this.shadowRoot.querySelector(".wk-cols");
    const colW = cols.getBoundingClientRect().width / 7;
    const hourH = parseFloat(getComputedStyle(this.shadowRoot.querySelector(".wk")).getPropertyValue("--hour-h"));
    if (!block) {
      // empty slot: create on release, without dragging
      const startX = e.clientX;
      const startY = e.clientY;
      const up = (u) => {
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (u.type === "pointercancel" || Math.hypot(u.clientX - startX, u.clientY - startY) > 6) return;
        const r = col.getBoundingClientRect();
        const minute = Math.floor((((u.clientY - r.top) / hourH) * 60) / 30) * 30;
        this._openNew(this._target(), Number(col.dataset.colDay) + Math.max(0, Math.min(minute, DAY - 60)));
      };
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      return;
    }
    const mode = e.target.closest("[data-resize]") ? "resize" : "move";
    const touch = e.pointerType === "touch";
    this._drag = {
      el: block,
      mode,
      touch,
      x0: e.clientX,
      y0: e.clientY,
      colW,
      hourH,
      h0: block.getBoundingClientRect().height,
      moved: false,
      dm: 0,
      dd: 0,
      allDay: block.dataset.allday === "1",
    };
    if (touch) {
      // a long press picks the block up; a quick swipe still scrolls the page
      const d = this._drag;
      d.timer = setTimeout(() => {
        if (this._drag !== d || d.cancelled) return;
        d.armed = true;
        d.el.classList.add("armed");
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
    }
    const move = (m) => this._onDragMove(m);
    const up = (u) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this._onDragEnd(u);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  _onDragMove(e) {
    const d = this._drag;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (d.touch && !d.armed) {
      // moving before the long press is a scroll: no dragging, and no opening
      if (Math.hypot(dx, dy) > 10) {
        d.cancelled = true;
        clearTimeout(d.timer);
      }
      return;
    }
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) {
      d.moved = true;
      d.el.classList.add("dragging");
      d.tip = document.createElement("div");
      d.tip.className = "drag-tip";
      this.shadowRoot.appendChild(d.tip);
    }
    d.dm = d.allDay ? 0 : Math.round(((dy / d.hourH) * 60) / SNAP) * SNAP;
    d.dd = d.mode === "move" ? Math.round(dx / d.colW) : 0;
    const start = wm(d.el.dataset.start);
    const end = wm(d.el.dataset.end);
    let ns = start;
    let ne = end;
    if (d.mode === "move") {
      d.el.style.transform = `translate(${d.dd * d.colW}px, ${(d.dm / 60) * d.hourH}px)`;
      ns = start + d.dd * DAY + d.dm;
      ne = end + d.dd * DAY + d.dm;
    } else {
      d.dm = Math.max(d.dm, SNAP - (end - start));
      d.el.style.height = `${Math.max(8, d.h0 + (d.dm / 60) * d.hourH)}px`;
      ne = end + d.dm;
    }
    const lang = this.T._lang;
    d.tip.textContent = d.allDay
      ? fmtDay(ns, lang, { weekday: "long", day: "numeric" })
      : `${fmtDay(ns, lang, { weekday: "short" })} ${wall(ns).slice(11)} – ${wall(ne).slice(11)}`;
    d.tip.style.left = `${e.clientX + 14}px`;
    d.tip.style.top = `${e.clientY + 14}px`;
  }

  async _onDragEnd(e) {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    clearTimeout(d.timer);
    d.el.classList.remove("armed");
    d.tip?.remove();
    if (e.type === "pointercancel" || d.cancelled) {
      d.el.classList.remove("dragging");
      d.el.style.transform = "";
      return;
    }
    if (!d.moved) {
      this._suppressClick = true;
      setTimeout(() => (this._suppressClick = false), 0);
      this._openOccurrence(d.el);
      return;
    }
    this._suppressClick = true;
    setTimeout(() => (this._suppressClick = false), 0);
    const delta = d.mode === "move" ? d.dd * DAY + d.dm : 0;
    const deltaEnd = d.mode === "move" ? delta : d.dm;
    if (!delta && !deltaEnd) {
      this._renderContent();
      return;
    }
    await this._commitMove(d.el.dataset, delta, deltaEnd, d.allDay, d.dm);
  }

  async _commitMove(data, delta, deltaEnd, allDay, dm = 0) {
    const T = this.T;
    const agenda = this._agenda(data.entry);
    const event = agenda.events.find((x) => x.id === data.event);
    const repeating = (event.repeat?.freq || "none") !== "none";
    const occStart = wm(data.start);
    const occEnd = wm(data.end);
    const newStart = occStart + delta;
    const newEnd = occEnd + deltaEnd;
    const fmt = (m) => (allDay ? wallDate(m) : wall(m));
    let scope = "series";
    if (repeating) {
      scope = await dialogs.confirmDialog(this.dialogHost, {
        title: T.move_title,
        text: T.move_text,
        buttons: [
          { label: T.cancel, value: "" },
          { label: T.scope_once, value: "once" },
          { label: T.scope_series, value: "series", primary: true },
        ],
      });
    }
    if (!scope) {
      this._renderContent();
      return;
    }
    await this._try(async () => {
      if (scope === "once") {
        const { id, ...rest } = structuredClone(event);
        rest.repeat = { freq: "none" };
        rest.start = fmt(newStart);
        rest.end = fmt(newEnd);
        // the detached day keeps the times it was dropped at
        rest.start_sun = null;
        rest.end_sun = null;
        await this.ws({
          type: "agenda/event/detach",
          entry_id: agenda.entry_id,
          event_id: event.id,
          day: data.day,
          event: rest,
        });
      } else {
        const ev = structuredClone(event);
        ev.start = fmt(wm(ev.start) + delta);
        ev.end = fmt(wm(ev.end) + deltaEnd);
        // a bound that follows the sun moves by its offset
        const offset = (anchor) => ({ ...anchor, offset: Math.max(-720, Math.min(720, (anchor.offset || 0) + dm)) });
        if (ev.start_sun && delta) ev.start_sun = offset(ev.start_sun);
        if (ev.end_sun && deltaEnd) ev.end_sun = offset(ev.end_sun);
        const shift = (dayOf(newStart) - dayOf(occStart)) / DAY;
        if (repeating && shift) {
          const r = ev.repeat;
          if (r.weekdays?.length) r.weekdays = r.weekdays.map((w) => (((w + shift) % 7) + 7) % 7).sort();
          const mv = (s) => wallDate(wm(s) + shift * DAY);
          r.exclude = (r.exclude || []).map(mv);
          r.include = (r.include || []).map(mv);
          if (r.until) r.until = mv(r.until);
        }
        await this.ws({ type: "agenda/event/save", entry_id: agenda.entry_id, event: ev });
      }
      await this._load();
    });
  }
}

const STYLES = `
  :host {
    /* the element holding a custom panel grows with it: the screen sets the height */
    display: flex; flex-direction: column; height: 100vh; height: 100dvh; box-sizing: border-box;
    background: var(--primary-background-color); color: var(--primary-text-color);
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif));
    --agenda-line: color-mix(in srgb, var(--divider-color) 75%, transparent);
    --agenda-today: color-mix(in srgb, var(--primary-color) 5%, transparent);
    --agenda-now: var(--error-color, #db4437);
    --agenda-hover: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
    --agenda-track: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    --agenda-input: color-mix(in srgb, var(--primary-text-color) 3%, var(--card-background-color));
    --agenda-holiday: var(--error-color, #db4437);
    --agenda-vacation: #43a047;
  }
  [hidden] { display: none !important; }
  ha-icon { --mdc-icon-size: 20px; }
  .top { display: flex; align-items: center; gap: 10px; min-height: var(--header-height, 56px); padding: 0 12px 0 16px; box-sizing: border-box;
    background: var(--app-header-background-color, var(--primary-background-color)); color: var(--app-header-text-color, var(--primary-text-color));
    border-bottom: var(--app-header-border-bottom, 1px solid var(--divider-color)); }
  .top .logo { color: var(--primary-color); }
  .title { font-size: 20px; font-weight: 400; margin-right: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .top > :not(.title) { flex-shrink: 0; }
  .tabs { display: flex; gap: 4px; background: var(--agenda-hover); padding: 4px; border-radius: 99px; }
  .tab { font: inherit; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent; color: inherit;
    padding: 6px 14px; border-radius: 99px; cursor: pointer; }
  .tab ha-icon { --mdc-icon-size: 18px; }
  .tab.on { background: var(--card-background-color); color: var(--primary-color); font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
  .main { flex: 1; min-height: 0; display: flex; }
  .pane { flex: 1; min-width: 0; display: flex; flex-direction: column; container: pane / inline-size; position: relative; isolation: isolate; }
  .fab { position: absolute; right: 24px; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); z-index: 3; display: inline-flex; align-items: center; gap: 10px;
    height: 52px; padding: 0 24px 0 18px; border: none; border-radius: 99px; font: inherit; font-size: 15px; font-weight: 500; cursor: pointer;
    background: var(--primary-color); color: var(--text-primary-color, #fff);
    box-shadow: 0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px rgba(0,0,0,.14), 0 1px 18px rgba(0,0,0,.12); }
  .fab:hover { filter: brightness(1.08); }
  .fab:focus-visible { outline: 2px solid var(--primary-text-color); outline-offset: 3px; }
  .fab ha-icon { --mdc-icon-size: 24px; }
  .fab-on .card:not(.hs-card)::after { content: ""; display: block; height: 92px; }
  .side { flex: none; width: 288px; box-sizing: border-box; display: flex; flex-direction: column; gap: 2px; padding: 12px 8px;
    overflow-y: auto; border-right: 1px solid var(--divider-color); }
  .sa { display: flex; align-items: center; gap: 2px; padding: 2px 4px 2px 0; border-radius: 10px; }
  .sa:hover { background: var(--agenda-hover); }
  .sa.all { margin-bottom: 4px; }
  .cb-btn { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border: none; background: none; padding: 0; cursor: pointer; }
  .cb { width: 18px; height: 18px; box-sizing: border-box; border-radius: 4px; border: 2px solid var(--c); display: grid; place-items: center; color: var(--t); }
  .cb.on { background: var(--c); }
  .cb.some::after { content: ""; width: 8px; height: 2px; border-radius: 1px; background: var(--c); }
  .cb ha-icon { --mdc-icon-size: 14px; }
  .sa-kind { flex: none; width: 18px; display: flex; margin-right: 6px; --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .sa.off .sa-kind { opacity: .5; }
  .sa-name { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; font: inherit; text-align: left;
    border: none; background: none; color: inherit; padding: 4px 0; cursor: pointer; }
  .sa-name b { font-weight: 500; font-size: 14.5px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sa-name small { font-size: 12px; line-height: 1.35; color: var(--secondary-text-color); max-width: 100%; font-variant-numeric: tabular-nums; }
  .sa-name small:empty { display: none; }
  .sa.off .sa-name { opacity: .5; }
  .sa.paused small { color: var(--warning-color, #f57c00); }
  .sa .tgl { flex: none; }
  .sa .ic.sm { flex: none; width: 30px; height: 30px; opacity: 0; transition: opacity .15s; }
  .sa:hover .ic.sm, .sa .ic.sm:focus-visible, .sa .ic.sm.keep { opacity: .75; }
  .sa .ic.sm ha-icon { --mdc-icon-size: 18px; }
  @media (hover: none) { .sa .ic.sm { opacity: .6; } }
  .tgl.sm span { width: 28px; height: 16px; }
  .tgl.sm span::after { width: 12px; height: 12px; }
  .tgl.sm input:checked + span::after { transform: translateX(12px); }
  .side-add { margin-top: 6px; display: flex; align-items: center; gap: 12px; font: inherit; font-size: 14px; font-weight: 500; padding: 9px 10px;
    border: none; border-radius: 10px; background: none; color: var(--primary-color); cursor: pointer; text-align: left; }
  .side-add:hover { background: var(--agenda-hover); }
  .side-h { display: flex; flex-direction: column; gap: 1px; margin: 16px 10px 4px; font-size: 12px; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--secondary-text-color); }
  .side-h small { font-size: 11.5px; font-weight: 400; letter-spacing: 0; text-transform: none; }
  .ag.xpick { --c: var(--primary-color); padding: 6px 11px; gap: 4px; }
  .ag.xpick ha-icon { --mdc-icon-size: 17px; opacity: .85; }
  .bar { display: flex; align-items: center; gap: 8px 6px; flex-wrap: wrap; padding: 12px 16px 6px; }
  /* chips, buttons and the agenda's switch share the lines; the navigation gets its own */
  .ags { display: contents; }
  .ag { font: inherit; font-size: 14px; display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 99px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); transition: background .15s, border-color .15s; }
  .ag .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .ag ha-icon { --mdc-icon-size: 15px; opacity: .7; }
  .ag:hover { border-color: var(--c, var(--primary-color)); }
  .ag.on { background: color-mix(in srgb, var(--c, var(--primary-color)) 18%, var(--card-background-color)); border-color: var(--c, var(--primary-color)); font-weight: 600; }
  .ag.paused { opacity: .6; }
  .adds { display: inline-flex; gap: 6px; margin-left: 6px; }
  .adds .btn { padding: 5px 14px; }
  .adds ha-icon { --mdc-icon-size: 18px; }
  .nav { display: flex; align-items: center; justify-content: center; gap: 4px; flex-basis: 100%; margin-top: 2px; }
  .nav-l { display: flex; align-items: center; gap: 4px; }
  .nav.wide { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; margin: 0; }
  .nav.wide .range { font-size: 20px; font-weight: 400; margin: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @container pane (max-width: 900px) {
    .nav.wide .tab span { display: none; }
    .nav.wide .tab { padding: 6px 9px; }
    .nav.wide .range { font-size: 17px; }
  }
  .nav-r { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }
  .range { margin-left: 8px; font-size: 16px; font-weight: 500; }
  .range::first-letter { text-transform: uppercase; }
  .acts { display: flex; align-items: center; gap: 8px; margin-left: auto; padding-left: 12px; }
  .status { display: flex; align-items: center; gap: 8px 18px; flex-wrap: wrap; padding: 2px 18px 10px; font-size: 13.5px; color: var(--secondary-text-color); }
  .status b { color: var(--primary-text-color); }
  .st-now, .st-next, .st-live, .st-off, .st-act { display: inline-flex; align-items: center; gap: 6px; }
  .st-off { color: var(--warning-color, #f57c00); }
  .st-off ha-icon, .st-act ha-icon { --mdc-icon-size: 16px; }
  .st-act { flex-wrap: wrap; }
  .st-act .btn { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; }
  .st-chip { display: inline-block; padding: 1px 9px; border-radius: 99px; font-weight: 700; color: #1f1f1f;
    background: color-mix(in srgb, var(--c) 80%, transparent); }
  .st-live { font-variant-numeric: tabular-nums; }
  .st-live ha-icon { --mdc-icon-size: 16px; }
  .st-paused { display: inline-flex; align-items: center; gap: 4px; color: var(--warning-color, #f57c00); font-weight: 500; }
  .st-paused ha-icon { --mdc-icon-size: 16px; }
  .content { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 16px 16px; position: relative; z-index: 0; isolation: isolate; }
  .card { flex: 1; min-height: 0; overflow: auto; background: var(--card-background-color); border-radius: var(--ha-card-border-radius, 12px);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color)); box-shadow: var(--ha-card-box-shadow, none); }
  .hs-card { flex: none; padding: 12px 16px 16px; }
  .ls-card { padding: 4px 12px; }
  .loading, .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 48px 16px; text-align: center; color: var(--secondary-text-color); }
  .empty ha-icon { --mdc-icon-size: 56px; color: var(--primary-color); opacity: .8; }
  .empty h3 { margin: 8px 0 0; color: var(--primary-text-color); font-weight: 500; }
  .empty p { margin: 0 0 12px; }
  .loading ha-icon { animation: spin 1s linear infinite; --mdc-icon-size: 32px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .btn { font: inherit; font-weight: 500; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; border-radius: 99px; padding: 7px 16px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
  .btn.sm { padding: 5px 12px; }
  .btn.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .btn.primary ha-icon { --mdc-icon-size: 18px; }
  .btn.tonal { color: var(--primary-color); border-color: color-mix(in srgb, var(--primary-color) 55%, transparent);
    background: color-mix(in srgb, var(--primary-color) 12%, var(--card-background-color)); }
  .btn:hover { filter: brightness(1.05); }
  .ic { border: none; background: none; color: inherit; cursor: pointer; border-radius: 50%; width: 36px; height: 36px; display: inline-grid; place-items: center; }
  .ic:hover { background: var(--agenda-hover); }
  [data-absence].on { color: var(--warning-color, #f57c00); }
  .away { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 16px 8px; padding: 8px 14px; border-radius: 12px;
    background: color-mix(in srgb, var(--warning-color, #f57c00) 14%, var(--card-background-color));
    border: 1px solid color-mix(in srgb, var(--warning-color, #f57c00) 45%, transparent); font-size: 14px; font-weight: 500; }
  .away ha-icon { color: var(--warning-color, #f57c00); }
  .away span { margin-right: auto; }
  .tgl { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; }
  .tgl input { display: none; }
  .tgl span { width: 36px; height: 20px; border-radius: 99px; background: var(--divider-color); position: relative; transition: background .15s; }
  .tgl span::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
  .tgl input:checked + span { background: var(--primary-color); }
  .tgl input:checked + span::after { transform: translateX(16px); }
  @media (max-width: 700px) {
    .tab span { display: none; }
    .tab { padding: 6px 8px; }
    .top { gap: 6px; padding: 0 6px 0 8px; }
    .top .ic { width: 32px; height: 32px; }
    .title { font-size: 18px; }
    .bar { padding: 10px 12px 4px; }
    .content { padding: 0 8px 8px; }
    .hs { --name-w: 78px; }
    .hs-name small { display: none; }
    .hs-name b { font-size: 14px; }
    .hs-ticks span:nth-child(even) { display: none; }
  }
  @media (max-width: 700px) {
    .fab { right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); height: 48px; padding: 0 20px 0 14px; font-size: 14px; }
  }
  @media (max-width: 400px) {
    .top .logo { display: none; }
    .range { font-size: 14.5px; margin-left: 4px; }
  }
`;

if (!customElements.get("agenda-panel")) customElements.define("agenda-panel", AgendaPanel);
