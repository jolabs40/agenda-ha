// Dashboard card: today for every agenda, one agenda's week, or the next changes.
// Clicking it opens the panel; the next changes view also skips ahead and resumes.
//
//   type: custom:agenda-card
//   view: house            # or week, or next
//   agenda: Bedroom        # week view: name of the agenda
//   agendas: [Bedroom]     # house and next views: only these agendas (optional)
//   title: Heating         # optional

const V = new URL(import.meta.url).search;
const lib = await import(`./agenda-lib.js${V}`);
const views = await import(`./agenda-views.js${V}`);

const { DAY, dayOf, esc, loadHaComponents, mondayOf, nowWall, wallDate, texts } = lib;

class AgendaCard extends HTMLElement {
  static getStubConfig() {
    return { view: "house" };
  }

  static getConfigElement() {
    return document.createElement("agenda-card-editor");
  }

  setConfig(config) {
    this._config = { view: "house", ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
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
      const steer = Boolean(this._hass.user?.is_admin || this._data.shared?.allow_users);
      if (this._config.view === "next") body = views.renderNext({ ...ctx, steer });
      else if (this._config.view === "week")
        body = `<div class="scroll">${views.renderWeek({ ...ctx, firstDay: mondayOf(now), days: 7, hourH: this._config.hour_height || 20 })}</div>`;
      else body = views.renderHouse({ ...ctx, day: dayOf(now), history: this._history });
    }
    const view = this._config.view;
    const title =
      this._config.title ?? (view === "week" ? this._agendas()[0]?.name : view === "next" ? T.next_changes : T.title);
    this.shadowRoot.innerHTML = `<style>${views.VIEW_STYLES}${CARD_STYLES}</style>
      <ha-card>${title ? `<div class="head"><ha-icon icon="mdi:calendar-month"></ha-icon>${esc(title)}</div>` : ""}
        <div class="body ${this._config.view}">${body}</div></ha-card>`;
    requestAnimationFrame(() => views.fitLabels(this.shadowRoot));
    this.shadowRoot.querySelector("ha-card").addEventListener("click", (e) => {
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
      history.pushState(null, "", "/agenda");
      window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
    });
  }
}

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
  .head ha-icon { color: var(--primary-color); --mdc-icon-size: 22px; }
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
    ];
    this._form.computeLabel = (s) =>
      ({
        view: T.card_view,
        agenda: T.agenda,
        agendas: T.card_agendas,
        title: T.card_title,
        hour_height: T.card_hour_height,
      })[s.name] || s.name;
    this._form.data = { ...this._config, view };
  }

  _changed(value) {
    const config = { ...value };
    // empty fields are left out of the YAML
    for (const key of Object.keys(config)) {
      const v = config[key];
      if (v === "" || v == null || (Array.isArray(v) && !v.length)) delete config[key];
    }
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
