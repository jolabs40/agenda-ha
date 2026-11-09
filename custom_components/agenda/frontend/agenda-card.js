// Dashboard card: today for every agenda, one agenda's week, or the next changes.
// Clicking it opens the panel; the next changes view also skips ahead and resumes,
// and every view starts and ends the absence mode.
//
//   type: custom:agenda-card
//   view: house            # or week, or next
//   agenda: Bedroom        # week view: name of the agenda
//   agendas: [Bedroom]     # house and next views: only these agendas (optional)
//   title: Heating         # optional
//   absence: false         # no absence button nor banner (optional)

const V = new URL(import.meta.url).search;
const lib = await import(`./agenda-lib.js${V}`);
const views = await import(`./agenda-views.js${V}`);

const { DAY, dayOf, esc, fmtDay, loadHaComponents, mondayOf, nowWall, wall, wallDate, wm, texts } = lib;

class AgendaCard extends HTMLElement {
  static getStubConfig() {
    return { view: "house" };
  }

  static getConfigElement() {
    return document.createElement("agenda-card-editor");
  }

  setConfig(config) {
    this._config = { view: "house", ...config };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>${views.VIEW_STYLES}${CARD_STYLES}</style><ha-card></ha-card>`;
      this.shadowRoot.querySelector("ha-card").addEventListener("click", (e) => this._onClick(e));
    }
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    this.T = texts(hass);
    if (first) {
      this._subscribe();
      this._load();
    } else {
      this.shadowRoot?.querySelectorAll("[data-live]").forEach((el) => {
        const a = this._data?.agendas.find((x) => x.entry_id === el.dataset.live);
        if (a) el.textContent = views.liveText(hass, a, this.T);
      });
    }
  }

  constructor() {
    super();
    for (const prop of ["hass", "config"]) {
      if (Object.prototype.hasOwnProperty.call(this, prop)) {
        const value = this[prop];
        delete this[prop];
        this._pending = { ...(this._pending || {}), [prop]: value };
      }
    }
  }

  connectedCallback() {
    if (this._pending?.hass) {
      const h = this._pending.hass;
      this._pending = null;
      this.hass = h;
    }
    this._tick = setInterval(() => this._render(), 60000);
    if (this._hass && !this._unsub) {
      this._subscribe();
      this._load();
    }
  }

  disconnectedCallback() {
    clearInterval(this._tick);
    this._unsub?.then((u) => u()).catch(() => {});
    this._unsub = null;
  }

  getCardSize() {
    if (this._config?.view === "next") return 1 + this._agendas().length;
    return this._config?.view === "week" ? 10 : 4;
  }

  _subscribe() {
    this._unsub = this._hass.connection.subscribeMessage(
      () => {
        clearTimeout(this._t);
        this._t = setTimeout(() => this._load(), 200);
      },
      { type: "agenda/subscribe" },
    );
    this._unsub.catch(() => (this._unsub = null));
  }

  _agendas() {
    const all = this._data?.agendas || [];
    if (this._config.view !== "week") {
      const only = this._config.agendas;
      return only ? all.filter((a) => only.includes(a.name) || only.includes(a.entry_id)) : all;
    }
    const want = this._config.agenda;
    const a = all.find((x) => x.name === want || x.entry_id === want) || all[0];
    return a ? [a] : [];
  }

  async _load() {
    try {
      this._data = await this._hass.callWS({ type: "agenda/list" });
      if (this._config.view === "next") {
        this._error = null;
        this._render();
        return;
      }
      const now = nowWall(this._data.time_zone);
      const first = this._config.view === "week" ? mondayOf(now) : dayOf(now);
      const days = this._config.view === "week" ? 7 : 1;
      const res = await this._hass.callWS({
        type: "agenda/occurrences",
        start: wallDate(first),
        end: wallDate(first + days * DAY),
      });
      this._occ = res.agendas || {};
      this._skipped = res.skipped || {};
      this._holidays = res.holidays || {};
      this._vacation = res.vacation || {};
      this._history =
        this._config.view === "week"
          ? {}
          : await lib
              .climateHistory((m) => this._hass.callWS(m), this._agendas(), first, this._data.time_zone)
              .catch(() => ({}));
      this._error = null;
    } catch (err) {
      this._error = err.message || String(err);
    }
    this._render();
  }

  /** Events and the absence, as in the panel: admins, or everyone when the shared settings allow it. */
  _canEdit() {
    return Boolean(this._hass?.user?.is_admin || this._data?.shared?.allow_users);
  }

  _awayHtml(T) {
    const absence = this._data?.shared?.absence;
    if (!absence || this._config.absence === false) return "";
    const until = absence.until
      ? `${fmtDay(wm(absence.until), T._lang, { weekday: "short", day: "numeric", month: "short" })} ${wall(wm(absence.until)).slice(11)}`
      : null;
    return `<div class="away"><ha-icon icon="mdi:home-export-outline"></ha-icon><span>${esc(T.absence_on(until))}</span>
      ${this._canEdit() ? `<button data-absence-stop>${esc(T.absence_stop)}</button>` : ""}</div>`;
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const T = this.T || texts(this._hass);
    let body;
    if (this._error) body = `<div class="msg">${esc(this._error)}</div>`;
    else if (!this._data) body = `<div class="msg">…</div>`;
    else if (!this._data.agendas.length) body = `<div class="msg">${esc(T.no_agenda)}</div>`;
    else {
      const now = nowWall(this._data.time_zone);
      const ctx = {
        hass: this._hass,
        T,
        agendas: this._agendas(),
        allAgendas: this._data.agendas,
        occ: this._occ || {},
        skipped: this._skipped || {},
        holidays: this._holidays || {},
        vacation: this._vacation || {},
        now,
        editable: false,
      };
      // the same rights as editing events in the panel
      const steer = this._canEdit();
      if (this._config.view === "next") body = views.renderNext({ ...ctx, steer });
      else if (this._config.view === "week")
        body = `<div class="scroll">${views.renderWeek({ ...ctx, firstDay: mondayOf(now), days: 7, hourH: this._config.hour_height || 20 })}</div>`;
      else body = views.renderHouse({ ...ctx, day: dayOf(now), history: this._history });
    }
    const view = this._config.view;
    const title =
      this._config.title ?? (view === "week" ? this._agendas()[0]?.name : view === "next" ? T.next_changes : T.title);
    const away = Boolean(this._data?.shared?.absence);
    const awayButton =
      this._data && this._config.absence !== false && this._canEdit()
        ? `<button class="ic ${away ? "on" : ""}" data-absence title="${esc(T.absence_title)}" aria-label="${esc(T.absence_title)}">
            <ha-icon icon="mdi:home-export-outline"></ha-icon></button>`
        : "";
    const head =
      title || awayButton
        ? `<div class="head">${title ? `<ha-icon icon="mdi:calendar-month"></ha-icon><span>${esc(title)}</span>` : ""}${awayButton}</div>`
        : "";
    this.shadowRoot.querySelector("ha-card").innerHTML =
      `${head}${this._data ? this._awayHtml(T) : ""}<div class="body ${this._config.view}">${body}</div>`;
    requestAnimationFrame(() => views.fitLabels(this.shadowRoot));
  }

  async _onClick(e) {
    const button = e.target.closest("[data-advance], [data-resume]");
    if (button) {
      const action = button.dataset.advance ? "next" : "resume";
      const id = button.dataset.advance || button.dataset.resume;
      button.disabled = true;
      this._hass
        .callWS({ type: "agenda/override", entry_id: id, action })
        .catch((err) => (this._error = err.message || String(err)))
        .finally(() => this._load());
      return;
    }
    if (e.target.closest("[data-absence-stop]")) {
      await this._hass
        .callWS({ type: "agenda/absence/set", active: false })
        .catch((err) => (this._error = err.message || String(err)));
      this._load();
      return;
    }
    if (e.target.closest("[data-absence]")) {
      if (await this._absenceDialog()) this._load();
      return;
    }
    // the banner is not a way into the panel
    if (e.target.closest(".away")) return;
    history.pushState(null, "", "/agenda");
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  /** The panel's absence window, on the page itself: a dashboard can clip what a card holds. */
  async _absenceDialog() {
    const dialogs = await import(`./agenda-dialogs.js${V}`);
    const holder = document.createElement("div");
    const root = holder.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${DIALOG_HOST_STYLES}${dialogs.DIALOG_STYLES}</style><div></div>`;
    document.body.appendChild(holder);
    try {
      return await dialogs.absenceDialog(root.lastElementChild, {
        T: this.T,
        absence: this._data.shared.absence,
        now: nowWall(this._data.time_zone),
        ws: (m) => this._hass.callWS(m),
      });
    } finally {
      holder.remove();
    }
  }
}

const DIALOG_HOST_STYLES = `
  :host {
    color: var(--primary-text-color);
    font-family: var(--ha-font-family-body, var(--paper-font-body1_-_font-family, Roboto, sans-serif));
    --agenda-hover: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
    --agenda-input: color-mix(in srgb, var(--primary-text-color) 3%, var(--card-background-color));
  }
  [hidden] { display: none !important; }
  ha-icon { --mdc-icon-size: 20px; }
`;

const CARD_STYLES = `
  :host {
    --agenda-line: color-mix(in srgb, var(--divider-color) 75%, transparent);
    --agenda-today: color-mix(in srgb, var(--primary-color) 5%, transparent);
    --agenda-now: var(--error-color, #db4437);
    --agenda-hover: color-mix(in srgb, var(--primary-text-color) 7%, transparent);
    --agenda-track: color-mix(in srgb, var(--primary-text-color) 5%, transparent);
    --agenda-holiday: var(--error-color, #db4437);
    --agenda-vacation: #43a047;
  }
  ha-card { cursor: pointer; overflow: hidden; }
  .head { display: flex; align-items: center; gap: 10px; padding: 14px 16px 4px; font-size: 18px; font-weight: 500; }
  .head > ha-icon { color: var(--primary-color); --mdc-icon-size: 22px; }
  .head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .head .ic { margin: -6px -8px -6px auto; flex: none; border: none; background: none; color: var(--secondary-text-color); cursor: pointer;
    border-radius: 50%; width: 40px; height: 40px; display: inline-grid; place-items: center; }
  .head .ic:hover { background: var(--agenda-hover); }
  .head .ic.on { color: var(--warning-color, #f57c00); }
  .head .ic ha-icon { --mdc-icon-size: 22px; }
  .away { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; margin: 8px 12px 4px; padding: 8px 12px; border-radius: 12px;
    background: color-mix(in srgb, var(--warning-color, #f57c00) 14%, var(--card-background-color));
    border: 1px solid color-mix(in srgb, var(--warning-color, #f57c00) 45%, transparent); font-size: 14px; font-weight: 500; cursor: default; }
  .away ha-icon { color: var(--warning-color, #f57c00); --mdc-icon-size: 20px; }
  .away span { margin-right: auto; }
  .away button { font: inherit; font-size: 13px; font-weight: 500; border-radius: 99px; padding: 5px 12px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color); }
  .away button:hover { background: var(--agenda-hover); }
  .body { padding: 4px 12px 14px; }
  .body.week { padding: 4px 0 0; }
  .scroll { overflow-x: auto; }
  .hs { --name-w: 150px; }
  .msg { padding: 16px; color: var(--secondary-text-color); }
  .ev, .seg { cursor: pointer; }
  .wk-col { cursor: pointer; }
  @media (max-width: 500px) { .hs { --name-w: 84px; } .hs-name small { display: none; } }
`;

/** The card's settings in the dashboard editor, with Home Assistant's own form. */
class AgendaCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
    else if (this._form) this._form.hass = hass;
  }

  async _load() {
    try {
      const data = await this._hass.callWS({ type: "agenda/list" });
      this._names = data.agendas.map((a) => a.name);
    } catch (_err) {
      this._names = [];
    }
    await loadHaComponents();
    await Promise.race([customElements.whenDefined("ha-form"), new Promise((r) => setTimeout(r, 5000))]);
    this._render();
  }

  _render() {
    if (!this._hass || !this._config || !this._names || !customElements.get("ha-form")) return;
    const T = texts(this._hass);
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.addEventListener("value-changed", (e) => this._changed(e.detail.value));
      this.replaceChildren(this._form);
    }
    const view = this._config.view || "house";
    const options = this._names.map((name) => ({ value: name, label: name }));
    const views = [
      ["house", T.house],
      ["week", T.week],
      ["next", T.next_changes],
    ].map(([value, label]) => ({ value, label }));
    this._form.hass = this._hass;
    this._form.schema = [
      { name: "view", selector: { select: { mode: "dropdown", options: views } } },
      view === "week"
        ? { name: "agenda", selector: { select: { mode: "dropdown", options } } }
        : { name: "agendas", selector: { select: { multiple: true, options } } },
      { name: "title", selector: { text: {} } },
      ...(view === "week" ? [{ name: "hour_height", selector: { number: { min: 12, max: 60, mode: "box" } } }] : []),
      { name: "absence", selector: { boolean: {} } },
    ];
    this._form.computeLabel = (s) =>
      ({
        view: T.card_view,
        agenda: T.agenda,
        agendas: T.card_agendas,
        title: T.card_title,
        hour_height: T.card_hour_height,
        absence: T.card_absence,
      })[s.name] || s.name;
    this._form.data = { ...this._config, view, absence: this._config.absence !== false };
  }

  _changed(value) {
    const config = { ...value };
    // empty fields are left out of the YAML
    for (const key of Object.keys(config)) {
      const v = config[key];
      if (v === "" || v == null || (Array.isArray(v) && !v.length)) delete config[key];
    }
    // shown unless turned off: only false is written
    if (config.absence !== false) delete config.absence;
    if (config.view === "week") delete config.agendas;
    else {
      delete config.agenda;
      delete config.hour_height;
    }
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
    this._render();
  }
}

if (!customElements.get("agenda-card")) customElements.define("agenda-card", AgendaCard);
if (!customElements.get("agenda-card-editor")) customElements.define("agenda-card-editor", AgendaCardEditor);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "agenda-card",
  name: "Agenda",
  description: "The day of every room, the week of one agenda, or what changes next.",
  preview: false,
});
