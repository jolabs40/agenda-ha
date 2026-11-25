// Pausing an agenda: until a given time, when it resumes by itself, or until turned back on.

const V = new URL(import.meta.url).search;
const { DAY, esc, wall, wm } = await import(`./agenda-lib.js${V}`);
const { Dialog } = await import(`./agenda-dialogs.js${V}`);

/** `now` is the wall minutes in Home Assistant's zone. Resolves with "saved", or null when let go. */
export function pauseDialog(host, { T, agenda, now, ws }) {
  const dlg = new Dialog(host, { title: T.pause_title(agenda.name) });
  // the next day, at the next full hour
  const until = wall(Math.ceil((now + DAY) / 60) * 60);
  dlg.open(
    `<p class="hint">${esc(T.pause_hint)}</p>
    <label class="tgl"><input type="checkbox" data-open><span></span>${esc(T.pause_open)}</label>
    <label class="fld" data-until-row><span>${esc(T.absence_until)}</span>
      <input type="datetime-local" class="inp" step="300" data-until value="${esc(until)}"></label>`,
    `<span class="grow"></span>
    <button class="btn" data-close>${esc(T.cancel)}</button>
    <button class="btn primary" data-pause>${esc(T.pause_start)}</button>`,
    "",
    T.close,
  );
  const openBox = dlg.$("[data-open]");
  openBox.addEventListener("change", () => (dlg.$("[data-until-row]").hidden = openBox.checked));
  dlg.$("[data-pause]").addEventListener("click", () =>
    dlg.run(async () => {
      const value = dlg.$("[data-until]").value.slice(0, 16);
      if (!openBox.checked && (!value || wm(value) <= now)) throw new Error(T.absence_until);
      await ws({
        type: "agenda/set_enabled",
        entry_id: agenda.entry_id,
        enabled: false,
        resume_at: openBox.checked ? null : value,
      });
      dlg.close("saved");
    }, T),
  );
  return dlg.done;
}
