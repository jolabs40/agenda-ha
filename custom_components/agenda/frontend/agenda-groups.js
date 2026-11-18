// Groups of agendas in the panel: in the column, a line per group to fold it, show or hide
// all of it, show it alone or rename it; on a phone, a chip per group. A group is only a
// name that agendas share in their settings.

const V = new URL(import.meta.url).search;
const { esc, groupOf, groupsOf } = await import(`./agenda-lib.js${V}`);

const ids = (agendas) => agendas.map((a) => a.entry_id);
const members = (p, group) => ids(p._data.agendas.filter((a) => groupOf(a) === group));

/** Whether the agendas shown are this group and nothing else. */
function alone(p, group) {
  const mine = members(p, group);
  const shown = ids(p._shown());
  return shown.length === mine.length && mine.every((id) => shown.includes(id));
}

/** The rows of the column, in the order of the agendas: each group under its own line, where
 *  its name falls among them. */
export function columnRows(p, row, box) {
  const agendas = p._data.agendas;
  return agendas
    .map((a, i) => {
      const group = groupOf(a);
      if (!group) return row(a);
      let head = "";
      if (i === 0 || groupOf(agendas[i - 1]) !== group) {
        const mine = agendas.filter((b) => groupOf(b) === group);
        const on = mine.filter((b) => !p._hidden.has(b.entry_id)).length;
        head = groupLine(p, group, mine.length, on, box);
      }
      return head + (p._folded.has(group) ? "" : row(a));
    })
    .join("");
}

function groupLine(p, group, count, on, box) {
  const T = p.T;
  const state = on === count ? "on" : on ? "some" : "";
  const folded = p._folded.has(group);
  const g = esc(group);
  const name =
    p._renaming === group
      ? `<input class="grp-input" data-group-name value="${g}" aria-label="${esc(T.rename_group)}">`
      : `<button class="grp-name" data-solo-group="${g}" title="${esc(`${group}\n${alone(p, group) ? T.show_all : T.show_only}`)}"><b>${g}</b><small>${count}</small></button>`;
  return `<div class="sa grp ${on ? "" : "off"}">
    <button class="grp-fold" data-fold="${g}" aria-expanded="${!folded}" title="${esc(folded ? T.unfold : T.fold)}"><ha-icon icon="mdi:chevron-${folded ? "right" : "down"}"></ha-icon></button>
    <button class="cb-btn" data-check-group="${g}" role="checkbox" aria-checked="${state === "on"}" aria-label="${g}">${box(state, "var(--primary-color)", "var(--text-primary-color, #fff)")}</button>
    ${name}
    ${p._isAdmin() && p._renaming !== group ? `<button class="ic sm" data-rename-group="${g}" title="${esc(T.rename_group)}"><ha-icon icon="mdi:pencil-outline"></ha-icon></button>` : ""}
  </div>`;
}

/** A chip per group on a phone, before the agendas: it shows that group alone. */
export function groupChips(p, all) {
  return groupsOf(p._data.agendas)
    .map(
      (group) =>
        `<button class="ag grp ${!all && alone(p, group) ? "on" : ""}" data-chip-group="${esc(group)}"><ha-icon icon="mdi:folder-outline"></ha-icon>${esc(group)}</button>`,
    )
    .join("");
}

/** A click on the line or the chip of a group; true when it was one. */
export function groupClick(p, hit) {
  let el;
  if ((el = hit("[data-fold]"))) {
    const group = el.dataset.fold;
    if (!p._folded.delete(group)) p._folded.add(group);
    p._savePrefs();
    p._renderSide();
  } else if ((el = hit("[data-check-group]"))) {
    const mine = members(p, el.dataset.checkGroup);
    const shown = ids(p._shown());
    const all = mine.every((id) => shown.includes(id));
    p._show(all ? shown.filter((id) => !mine.includes(id)) : [...new Set([...shown, ...mine])]);
  } else if ((el = hit("[data-solo-group]") || hit("[data-chip-group]"))) {
    const group = el.dataset.soloGroup ?? el.dataset.chipGroup;
    p._show(alone(p, group) ? ids(p._data.agendas) : members(p, group));
  } else if ((el = hit("[data-rename-group]"))) {
    p._renaming = el.dataset.renameGroup;
    p._renderSide();
  } else return false;
  return true;
}

/** Before the column is drawn again: what was typed in a group's name, whose field no longer counts. */
export function typedName(p, side) {
  p._renameToken = {};
  return side.querySelector("[data-group-name]")?.value;
}

/** After the column is drawn: Enter or leaving the field renames the group, Escape gives up. */
export function editName(p, side, typed) {
  const input = side.querySelector("[data-group-name]");
  if (!input) return;
  const token = p._renameToken;
  if (typed !== undefined) input.value = typed;
  const finish = (keep) => {
    if (token !== p._renameToken) return;
    p._renameToken = null;
    rename(p, p._renaming, keep ? input.value.trim() : "");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  if (typed === undefined) input.select();
}

async function rename(p, group, name) {
  p._renaming = null;
  if (!name || name === group) {
    p._renderSide();
    return;
  }
  if (p._folded.delete(group)) {
    p._folded.add(name);
    p._savePrefs();
  }
  await p._try(() => p.ws({ type: "agenda/group/rename", group, name }));
  await p._load();
}

export const GROUP_STYLES = `
  .sa.grp { margin-top: 6px; }
  .sa.in { margin-left: 24px; }
  .sa.in + .sa:not(.in), .sa.grp + .sa:not(.in):not(.grp) { margin-top: 6px; }
  .grp-fold { flex: none; width: 24px; height: 36px; display: grid; place-items: center; border: none; background: none; padding: 0; cursor: pointer;
    color: var(--secondary-text-color); --mdc-icon-size: 20px; }
  .grp-name { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; font: inherit; border: none; background: none; color: inherit;
    padding: 4px 0; cursor: pointer; text-align: left; }
  .grp-name b { font-size: 12.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--secondary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .grp-name small { font-size: 12px; color: var(--secondary-text-color); }
  .sa.grp.off .grp-name { opacity: .5; }
  /* renaming is asked for from this line: seen without hovering it, as the settings of an agenda */
  .sa.grp:not(:hover) .ic.sm { opacity: .6; }
  .grp-input { flex: 1; min-width: 0; font: inherit; font-size: 14px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--primary-color);
    background: var(--card-background-color); color: var(--primary-text-color); }
`;
