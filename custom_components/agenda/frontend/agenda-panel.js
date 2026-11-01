// Sidebar panel. Sibling modules are imported with this module's version query
// so the browser never mixes files from two releases.

const V = new URL(import.meta.url).search;
const lib = await import(`./agenda-lib.js${V}`);
const kinds = await import(`./agenda-kinds.js${V}`);
const views = await import(`./agenda-views.js${V}`);
const dialogs = await import(`./agenda-dialogs.js${V}`);

const { DAY, dayOf, esc, mondayOf, nowWall, wall, wallDate, wm, fmtDay, fmtRange, texts } = lib;

const PREFS_KEY = "agenda-panel-prefs";
const SNAP = 15;

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
    this._selected = prefs.selected || null;
    this._anchor = null; // day shown (wall minutes)
    this._data = null;
    this._occ = {};
    this._holidays = {};
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
    if (this._hass && !this._unsub) this._subscribe();
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    window.removeEventListener("resize", this._resize);
    this._unsub?.then((u) => u()).catch(() => {});
    this._unsub = null;
  }

  async _init() {
    this.shadowRoot.innerHTML = `<style>${views.VIEW_STYLES}${dialogs.DIALOG_STYLES}${STYLES}</style>
      <div class="top">
        <button class="ic" data-menu ${this._narrow ? "" : "hidden"}><ha-icon icon="mdi:menu"></ha-icon></button>
        <ha-icon class="logo" icon="mdi:calendar-month"></ha-icon>
        <div class="title">${esc(this.T.title)}</div>
        <div class="tabs" data-tabs></div>
      </div>
      <div class="bar" data-bar></div>
      <div class="status" data-status></div>
      <div class="content" data-content><div class="loading"><ha-icon icon="mdi:loading"></ha-icon></div></div>
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
    if (this._selected !== "all" && !ids.includes(this._selected)) this._selected = ids[0] || null;
    if (this._anchor == null) this._anchor = dayOf(this._now());
    await this._loadOcc();
    this._renderAll();
  }

  _range() {
    if (this._view === "house") return [this._anchor, this._anchor + DAY];
    const first = mondayOf(this._anchor);
    return [first, first + 7 * DAY];
  }

  async _loadOcc() {
    if (this._view === "list" || !this._data?.agendas.length) {
      this._occ = {};
      this._holidays = {};
      return;
    }
    const [a, b] = this._range();
    const res = await this.ws({ type: "agenda/occurrences", start: wallDate(a), end: wallDate(b) });
    this._occ = res.agendas || {};
    this._holidays = res.holidays || {};
  }

  _now() {
    return nowWall(this._data?.time_zone || this._hass.config.time_zone);
  }

  _agenda(id) {
    return this._data.agendas.find((a) => a.entry_id === id);
  }

  _shown() {
    if (!this._data) return [];
    if (this._view === "house" || this._selected === "all") return this._data.agendas;
    const a = this._agenda(this._selected);
    return a ? [a] : [];
  }

  _savePrefs() {
    savePrefs({ view: this._view, selected: this._selected });
  }

  _renderAll() {
    this._renderTabs();
    this._renderBar();
    this._renderStatus();
    this._renderContent();
  }

  _renderTabs() {
    const T = this.T;
    this.shadowRoot.querySelector("[data-tabs]").innerHTML = [
      ["week", "mdi:calendar-week", T.week],
      ["house", "mdi:home-clock-outline", T.house],
      ["list", "mdi:format-list-bulleted", T.list],
    ]
      .map(
        ([v, icon, label]) =>
          `<button class="tab ${this._view === v ? "on" : ""}" data-view="${v}"><ha-icon icon="${icon}"></ha-icon><span>${esc(label)}</span></button>`,
      )
      .join("");
  }

  _renderBar() {
    const T = this.T;
    const bar = this.shadowRoot.querySelector("[data-bar]");
    if (!this._data) return;
    const agendas = this._data.agendas;
    const chips = agendas
      .map((a) => {
        const on = this._selected === a.entry_id;
        return `<button class="ag ${on ? "on" : ""} ${a.enabled ? "" : "paused"}" data-select="${esc(a.entry_id)}" style="--c:${a.settings.color}">
          <span class="dot"></span>${esc(a.name)}${a.enabled ? "" : `<ha-icon icon="mdi:lock-outline"></ha-icon>`}</button>`;
      })
      .join("");
    const allChip =
      agendas.length > 1 && this._view !== "house"
        ? `<button class="ag all ${this._selected === "all" ? "on" : ""}" data-select="all">${esc(T.all)}</button>`
        : "";
    const [a, b] = this._range();
    const holiday = this._view === "house" ? this._holidays[wallDate(a)] : null;
    const label =
      this._view === "house"
        ? `${fmtDay(a, T._lang, { weekday: "long", day: "numeric", month: "long" })}${holiday ? ` · ${holiday}` : ""}`
        : fmtRange(a, b - DAY, T._lang);
    const sel = this._selected !== "all" ? this._agenda(this._selected) : null;
    bar.innerHTML = `<div class="ags">${allChip}${chips}
        <button class="ag add" data-new-agenda title="${esc(T.new_agenda)}"><ha-icon icon="mdi:plus"></ha-icon></button></div>
      ${
        this._view !== "list" && agendas.length
          ? `<div class="nav">
        <button class="ic" data-nav="-1"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
        <button class="btn sm" data-nav="0">${esc(T.today)}</button>
        <button class="ic" data-nav="1"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        <span class="range">${esc(label)}</span></div>`
          : ""
      }
      <div class="acts">
        ${
          sel
            ? `<label class="tgl" title="${esc(sel.enabled ? T.active : T.paused)}"><input type="checkbox" data-enabled ${sel.enabled ? "checked" : ""}><span></span>${esc(sel.enabled ? T.active : T.paused)}</label>
          <button class="ic" data-settings title="${esc(T.settings)}"><ha-icon icon="mdi:cog-outline"></ha-icon></button>`
            : ""
        }
        ${agendas.length ? `<button class="btn primary" data-new-event><ha-icon icon="mdi:plus"></ha-icon>${esc(T.new_event)}</button>` : ""}
      </div>`;
  }

  _renderStatus() {
    const box = this.shadowRoot.querySelector("[data-status]");
    const T = this.T;
    const sel = this._selected !== "all" ? this._agenda(this._selected) : null;
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
        `<span class="st-now">${esc(T.now)} <span class="st-chip" style="--c:${kinds.stateColor(hass, sel, sel.state) || "var(--divider-color)"}">${esc(now)}</span>${ev && ev.name ? ` ${esc(ev.name)}` : ""}</span>`,
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
        `<span class="st-next">${esc(T.next)} ${esc(day)}${esc(T.at)} ${esc(wall(n).slice(11))}${nextText ? ` <span class="st-chip" style="--c:${nextColor || "var(--divider-color)"}">${esc(nextText)}</span>` : ""}</span>`,
      );
    }
    if (!sel.enabled)
      parts.push(`<span class="st-paused"><ha-icon icon="mdi:lock-outline"></ha-icon>${esc(T.paused)}</span>`);
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
      occ: this._occ,
      holidays: this._holidays,
      now,
      editable: this._isAdmin(),
    };
    const scroll = box.querySelector(".card")?.scrollTop;
    if (this._view === "week") {
      box.innerHTML = `<div class="card wk-card">${views.renderWeek({ ...ctx, firstDay: mondayOf(this._anchor), days: 7, hourH: this._hourHeight() })}</div>`;
    } else if (this._view === "house") {
      box.innerHTML = `<div class="card hs-card">${views.renderHouse({ ...ctx, day: this._anchor })}</div>`;
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

  _bind() {
    const root = this.shadowRoot;
    root.addEventListener("click", (e) => this._onClick(e));
    root.addEventListener("change", (e) => this._onChange(e));
    root.addEventListener("pointerdown", (e) => this._onPointerDown(e));
  }

  async _setView(view) {
    this._view = view;
    if (view === "house" && this._selected === "all") this._selected = this._data.agendas[0]?.entry_id || null;
    this._savePrefs();
    await this._loadOcc();
    this._renderAll();
  }

  async _navigate(dir) {
    const step = this._view === "house" ? DAY : 7 * DAY;
    this._anchor = dir === 0 ? dayOf(this._now()) : this._anchor + dir * step;
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
    } else if ((el = hit("[data-view]"))) {
      this._setView(el.dataset.view);
    } else if ((el = hit("[data-nav]"))) {
      this._navigate(Number(el.dataset.nav));
    } else if ((el = hit("[data-select]"))) {
      this._selected = el.dataset.select;
      this._savePrefs();
      if (this._view === "house") this._setView("week");
      else this._renderAll();
    } else if (hit("[data-new-agenda]")) {
      this._newAgenda();
    } else if (hit("[data-settings]")) {
      this._openSettings();
    } else if (hit("[data-new-event]")) {
      const agenda = this._selected !== "all" ? this._agenda(this._selected) : this._data.agendas[0];
      const now = this._now();
      const start = Math.ceil((now + 1) / 60) * 60;
      this._openNew(agenda, start);
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
    } else if ((el = hit(".seg[data-event]"))) {
      this._openOccurrence(el);
    } else if ((el = hit(".seg[data-gap-day]"))) {
      if (!this._isAdmin()) return;
      const track = el.closest(".hs-track");
      const r = track.getBoundingClientRect();
      const minute = Math.round((((e.clientX - r.left) / r.width) * DAY) / 30) * 30;
      this._openNew(this._agenda(el.dataset.entry), Number(el.dataset.gapDay) + Math.min(minute, DAY - 60));
    }
  }

  async _onChange(e) {
    if (e.target.matches("[data-enabled]")) {
      const sel = this._agenda(this._selected);
      await this._try(() => this.ws({ type: "agenda/set_enabled", entry_id: sel.entry_id, enabled: e.target.checked }));
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

  _openOccurrence(el) {
    const agenda = this._agenda(el.dataset.entry);
    const event = agenda?.events.find((x) => x.id === el.dataset.event);
    if (!event) return;
    this._openEvent(agenda, event, { day: el.dataset.day, start: el.dataset.start, end: el.dataset.end });
  }

  _openEvent(agenda, event, occurrence) {
    if (!this._isAdmin()) return;
    this._track(
      dialogs.eventEditor(this.dialogHost, {
        hass: this._hass,
        T: this.T,
        agenda,
        agendas: this._data.agendas,
        event,
        occurrence,
        ws: (m) => this.ws(m),
      }),
    );
  }

  _openNew(agenda, startMinute) {
    if (!agenda || !this._isAdmin()) return;
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

  _openSettings() {
    const agenda = this._agenda(this._selected);
    if (!agenda || !this._isAdmin()) return;
    this._track(
      dialogs.settingsEditor(this.dialogHost, {
        hass: this._hass,
        T: this.T,
        agenda,
        holidays: this._data.holidays,
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
      this._selected = res.result?.entry_id || this._selected;
      this._savePrefs();
      setTimeout(() => this._load(), 800);
    });
  }

  _onPointerDown(e) {
    const block = e.target.closest(".ev");
    const col = e.target.closest(".wk-col");
    if (!col || e.button !== 0 || !this._isAdmin()) return;
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
        const agenda = this._selected !== "all" ? this._agenda(this._selected) : this._data.agendas[0];
        this._openNew(agenda, Number(col.dataset.colDay) + Math.max(0, Math.min(minute, DAY - 60)));
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
    if (d.touch) {
      // on touch, let the page scroll: no dragging, and no opening after a move
      if (Math.hypot(dx, dy) > 10) d.cancelled = true;
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
    await this._commitMove(d.el.dataset, delta, deltaEnd, d.allDay);
  }

  async _commitMove(data, delta, deltaEnd, allDay) {
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
    display: flex; flex-direction: column; height: 100%; box-sizing: border-box;
    background: var(--primary-background-color); color: var(--primary-text-color);
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif));
    --agenda-line: color-mix(in srgb, var(--divider-color) 75%, transparent);
    --agenda-today: color-mix(in srgb, var(--primary-color) 5%, transparent);
    --agenda-now: var(--error-color, #db4437);
    --agenda-hover: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
    --agenda-track: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    --agenda-input: color-mix(in srgb, var(--primary-text-color) 3%, var(--card-background-color));
    --agenda-holiday: var(--error-color, #db4437);
  }
  [hidden] { display: none !important; }
  ha-icon { --mdc-icon-size: 20px; }
  .top { display: flex; align-items: center; gap: 10px; min-height: var(--header-height, 56px); padding: 0 12px 0 16px; box-sizing: border-box;
    background: var(--app-header-background-color, var(--primary-background-color)); color: var(--app-header-text-color, var(--primary-text-color));
    border-bottom: var(--app-header-border-bottom, 1px solid var(--divider-color)); }
  .top .logo { color: var(--primary-color); }
  .title { font-size: 20px; font-weight: 400; margin-right: auto; }
  .tabs { display: flex; gap: 4px; background: var(--agenda-hover); padding: 4px; border-radius: 99px; }
  .tab { font: inherit; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; border: none; background: transparent; color: inherit;
    padding: 6px 14px; border-radius: 99px; cursor: pointer; }
  .tab ha-icon { --mdc-icon-size: 18px; }
  .tab.on { background: var(--card-background-color); color: var(--primary-color); font-weight: 500; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
  .bar { display: flex; align-items: center; gap: 12px 18px; flex-wrap: wrap; padding: 12px 16px 6px; }
  .ags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .ag { font: inherit; font-size: 14px; display: inline-flex; align-items: center; gap: 7px; padding: 6px 13px; border-radius: 99px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); transition: background .15s, border-color .15s; }
  .ag .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
  .ag ha-icon { --mdc-icon-size: 15px; opacity: .7; }
  .ag:hover { border-color: var(--c, var(--primary-color)); }
  .ag.on { background: color-mix(in srgb, var(--c, var(--primary-color)) 18%, var(--card-background-color)); border-color: var(--c, var(--primary-color)); font-weight: 600; }
  .ag.paused { opacity: .6; }
  .ag.add { padding: 6px 8px; }
  .nav { display: flex; align-items: center; gap: 4px; }
  .range { margin-left: 8px; font-size: 16px; font-weight: 500; }
  .range::first-letter { text-transform: uppercase; }
  .acts { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .status { display: flex; align-items: center; gap: 8px 18px; flex-wrap: wrap; padding: 2px 18px 10px; font-size: 13.5px; color: var(--secondary-text-color); }
  .status b { color: var(--primary-text-color); }
  .st-now, .st-next, .st-live { display: inline-flex; align-items: center; gap: 6px; }
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
  .btn:hover { filter: brightness(1.05); }
  .ic { border: none; background: none; color: inherit; cursor: pointer; border-radius: 50%; width: 36px; height: 36px; display: inline-grid; place-items: center; }
  .ic:hover { background: var(--agenda-hover); }
  .tgl { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; }
  .tgl input { display: none; }
  .tgl span { width: 36px; height: 20px; border-radius: 99px; background: var(--divider-color); position: relative; transition: background .15s; }
  .tgl span::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0,0,0,.3); }
  .tgl input:checked + span { background: var(--primary-color); }
  .tgl input:checked + span::after { transform: translateX(16px); }
  @media (max-width: 700px) {
    .tab span { display: none; }
    .title { font-size: 18px; }
    .bar { padding: 10px 12px 4px; }
    .content { padding: 0 8px 8px; }
    .acts { margin-left: 0; }
    .hs { --name-w: 78px; }
    .hs-name small { display: none; }
    .hs-name b { font-size: 14px; }
    .hs-ticks span:nth-child(even) { display: none; }
  }
`;

if (!customElements.get("agenda-panel")) customElements.define("agenda-panel", AgendaPanel);
