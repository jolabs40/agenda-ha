// Read-only dashboard card: today for every agenda, or one agenda's week.
// Clicking it opens the panel.
//
//   type: custom:agenda-card
//   view: house            # or week
//   agenda: Bedroom        # week view: name of the agenda
//   agendas: [Bedroom]     # house view: only these agendas (optional)
//   title: Heating         # optional

const V = new URL(import.meta.url).search;
const lib = await import(`./agenda-lib.js${V}`);
const views = await import(`./agenda-views.js${V}`);

const { DAY, dayOf, esc, mondayOf, nowWall, wallDate, texts } = lib;

class AgendaCard extends HTMLElement {
  static getStubConfig() {
    return { view: "house" };
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
      const now = nowWall(this._data.time_zone);
      const first = this._config.view === "week" ? mondayOf(now) : dayOf(now);
      const days = this._config.view === "week" ? 7 : 1;
      const res = await this._hass.callWS({
        type: "agenda/occurrences",
        start: wallDate(first),
        end: wallDate(first + days * DAY),
      });
      this._occ = res.agendas || {};
      this._holidays = res.holidays || {};
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
        occ: this._occ || {},
        holidays: this._holidays || {},
        now,
        editable: false,
      };
      body =
        this._config.view === "week"
          ? `<div class="scroll">${views.renderWeek({ ...ctx, firstDay: mondayOf(now), days: 7, hourH: this._config.hour_height || 20 })}</div>`
          : views.renderHouse({ ...ctx, day: dayOf(now) });
    }
    const title = this._config.title ?? (this._config.view === "week" ? this._agendas()[0]?.name : T.title);
    this.shadowRoot.innerHTML = `<style>${views.VIEW_STYLES}${CARD_STYLES}</style>
      <ha-card>${title ? `<div class="head"><ha-icon icon="mdi:calendar-month"></ha-icon>${esc(title)}</div>` : ""}
        <div class="body ${this._config.view}">${body}</div></ha-card>`;
    requestAnimationFrame(() => views.fitLabels(this.shadowRoot));
    this.shadowRoot.querySelector("ha-card").addEventListener("click", () => {
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

if (!customElements.get("agenda-card")) customElements.define("agenda-card", AgendaCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "agenda-card",
  name: "Agenda",
  description: "The day of every room, or the week of one agenda, in colours.",
  preview: false,
});
