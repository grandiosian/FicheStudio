// Référentiel de compétences de technologie (cycle 4, 5e-4e-3e) : consultation, recherche,
// et insertion des pastilles de compétence et des attendus dans la feuille.
import referentiel from "./data/referentiel.json";
import { store } from "./store";
import { walk, newParagraph, uid, type SceneNode, type TextNode } from "./model";
import { applyTextStyle, competencePill, themeColor, TEXT_STYLES } from "./charte";

export interface Sub { code: string; abbr: string; title: string; niveaux: Record<string, string[]>; connaissances: string[] }
interface Comp { code: string; abbr: string; title: string; subs: Sub[] }
interface Theme { code: string; abbr: string; title: string; competences: Comp[] }
const THEMES = (referentiel as { themes: Theme[] }).themes;

let level = "";       // "" = tous les niveaux
let query = "";
let onlyTagged = false; // n'afficher que les compétences attribuées à des calques
let viewMode: "ref" | "layers" = "ref"; // référentiel complet, ou regroupement des calques par compétence
const open = new Set<string>();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Codes de compétence déjà présents dans le document (textes et noms d'objets). */
function usedCodes(): Set<string> {
  const used = new Set<string>();
  const scan = (s: string) => { for (const m of s.matchAll(/T[123]C\d{2}/g)) used.add(m[0]); };
  for (const p of store.doc.pages) walk(p.layers, (n) => {
    scan(n.name);
    for (const c of n.comp ?? []) used.add(c);
    if (n.type === "text") for (const para of n.paragraphs) for (const r of para.runs) scan(r.text);
  });
  return used;
}

function attendusText(s: Sub): TextNode {
  const corps = TEXT_STYLES.find((t) => t.id === "corps")!, puce = TEXT_STYLES.find((t) => t.id === "puce")!;
  const lv = level ? [level] : Object.keys(s.niveaux);
  const paras = [newParagraph([{ text: `${s.code} – ${s.title}`, font: "Arial Narrow", size: 0, weight: 700, italic: false, underline: false, color: "#2f57a1", opacity: 1 }])];
  applyTextStyle(paras[0], corps);
  paras[0].runs[0].weight = 700;
  for (const l of lv) for (const a of s.niveaux[l] ?? []) {
    const p = newParagraph([{ text: lv.length > 1 ? `${a} (${l}e)` : a, font: "Arial Narrow", size: 0, weight: 400, italic: false, underline: false, color: "#2f57a1", opacity: 1 }]);
    applyTextStyle(p, puce);
    paras.push(p);
  }
  return {
    id: uid(), name: `Attendus ${s.code}`, visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0], type: "text",
    frame: { x: 0, y: 0, w: 2284, h: 78 * paras.length }, paragraphs: paras,
  };
}

/** Va à un élément marqué : sa feuille, puis calque actif (calque) ou sélection (groupe, objet), et cadrage. */
let frame: (id: string) => void = () => {};
export function setFramer(f: (id: string) => void) { frame = f; }
function goTo(pageIndex: number, id: string) {
  store.editingMaster = null;
  if (store.pageIndex !== pageIndex) { store.pageIndex = pageIndex; store.selection = []; store.scope = null; }
  const layer = store.page.layers.find((l) => l.id === id);
  if (layer) { store.activeLayer = id; store.selection = []; layer.visible = true; }
  else {
    const f = store.find(id);
    if (f) {
      // un calque masqué cacherait l'élément
      const top = store.page.layers.find((l) => { let hit = false; walk([l], (x) => { if (x.id === id) hit = true; }); return hit; });
      if (top) { top.visible = true; store.activeLayer = top.id; }
      store.selection = [id];
    }
  }
  store.emit("change");
  requestAnimationFrame(() => frame(id));
}

export function refreshCompetences(insert: (name: string, nodes: SceneNode[], x: number) => void) {
  const el = document.querySelector<HTMLElement>("#competences");
  if (!el || el.hidden) return;
  const used = usedCodes();
  const q = norm(query);
  const match = (s: Sub) => !q || norm(`${s.code} ${s.abbr} ${s.title} ${Object.values(s.niveaux).flat().join(" ")} ${s.connaissances.join(" ")}`).includes(q);
  const counts = new Map(ALL_SUBS.map((s) => [s.code, taggedNodes(s.code)]));
  const visible = (s: Sub) => match(s) && (!level || (s.niveaux[level]?.length ?? 0) > 0) && (!onlyTagged || counts.get(s.code)!.length > 0);
  const total = ALL_SUBS.filter(visible).length;
  const usedSubs = ALL_SUBS.filter((s) => counts.get(s.code)!.length);
  const modeBar = `<div class="cp-mode" role="tablist">
      <button data-mode="ref" class="${viewMode === "ref" ? "on" : ""}">📚 Référentiel</button>
      <button data-mode="layers" class="${viewMode === "layers" ? "on" : ""}">🗂 Calques par compétence <b>${usedSubs.length}</b></button></div>
    ${isolated ? `<div class="cp-isolated"><span>Isolée :</span><span class="code" style="--th:${themeColor(isolated)}">${isolated}</span><button data-c="unisolate">👁 Tout afficher</button></div>` : ""}`;
  if (viewMode === "layers") {
    el.innerHTML = `<div class="panel-head"><h3>Compétences</h3></div>${modeBar}
      <div class="comp-tree cp-groups">${usedSubs.length ? THEMES.map((t) => {
        const subs = usedSubs.filter((s) => s.code.startsWith(t.code));
        if (!subs.length) return "";
        return `<section class="cp-theme" style="--th:${themeColor(t.code)}"><header><span class="cp-tcode">${t.code}</span><span class="cp-tabbr">${esc(t.abbr)}</span></header>
          ${subs.map((s) => {
            const list = counts.get(s.code)!, on = isolated === s.code;
            return `<div class="cp-group ${on ? "on" : ""}">
              <div class="cp-gh"><span class="code">${s.code}</span><span class="nm">${esc(s.title)}</span></div>
              <button class="cp-iso ${on ? "on" : ""}" data-iso="${s.code}">${on ? "👁 Tout afficher" : (list.length > 1 ? `👁 Isoler ces ${list.length} éléments` : "👁 Isoler cet élément")}</button>
              <ul class="iso-list">${list.map((x) => `<li data-pi="${x.pageIndex}" data-id="${x.node.id}" title="Aller à cet élément"><span class="pg">${esc(store.doc.pages[x.pageIndex].name)}</span>${esc([...x.path, x.node.name].join(" › "))}</li>`).join("")}</ul></div>`;
          }).join("")}</section>`;
      }).join("") : `<div class="cp-empty"><b>Aucune compétence attribuée</b><p>Clic droit sur un calque ou un groupe › <b>Compétences…</b> (ou Propriétés › Compétences › Choisir…) pour lui associer des compétences. Elles se regroupent ensuite ici.</p></div>`}</div>`;
    el.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => (b.onclick = () => { viewMode = b.dataset.mode as typeof viewMode; refreshCompetences(insert); }));
    el.querySelector<HTMLElement>('[data-c="unisolate"]')?.addEventListener("click", () => setIsolated(null));
    el.querySelectorAll<HTMLElement>("[data-iso]").forEach((b) => (b.onclick = () => setIsolated(isolated === b.dataset.iso ? null : b.dataset.iso!)));
    el.querySelectorAll<HTMLElement>(".iso-list li").forEach((li) => (li.onclick = () => goTo(+li.dataset.pi!, li.dataset.id!)));
    return;
  }
  el.innerHTML = `<div class="panel-head"><h3>Compétences</h3><span class="cp-total">${total} / ${ALL_SUBS.length}</span></div>${modeBar}
    <div class="cp-tools">
      <input type="search" placeholder="Rechercher un code ou un mot…" value="${esc(query)}" data-c="q">
      <div class="cp-seg" role="group" aria-label="Niveau">${[["", "Tous"], ["5", "5e"], ["4", "4e"], ["3", "3e"]].map(([v, l]) => `<button data-lvb="${v}" class="${level === v ? "on" : ""} ${v ? `lv${v}` : ""}">${l}</button>`).join("")}</div>
      <label class="chk"><input type="checkbox" data-c="only" ${onlyTagged ? "checked" : ""}> Seulement celles attribuées à des calques</label>
    </div>
    <div class="comp-tree">${THEMES.map((t) => {
      const comps = t.competences.map((c) => ({ c, subs: c.subs.filter(visible) })).filter((x) => x.subs.length);
      if (!comps.length) return "";
      return `<section class="cp-theme" style="--th:${themeColor(t.code)}">
        <header><span class="cp-tcode">${t.code}</span><span class="cp-tabbr">${esc(t.abbr)}</span><span class="cp-ttitle">${esc(t.title)}</span></header>
        ${comps.map(({ c, subs }) => `<div class="cp-comp"><div class="cp-ch"><b>${c.code}</b>${esc(c.title)}</div>${subs.map((s) => {
          const isOpen = open.has(s.code) || !!q;
          const lv = level ? [level] : ["5", "4", "3"];
          const n = counts.get(s.code)!.length;
          return `<div class="sub ${used.has(s.code) ? "used" : ""} ${isOpen ? "open" : ""}" data-s="${s.code}">
            <div class="sh"><span class="tw">${isOpen ? "▾" : "▸"}</span><span class="code">${s.code}</span><span class="nm">${esc(s.title)}</span>
              ${used.has(s.code) ? `<span class="ok" title="Déjà utilisée dans le document">✓</span>` : ""}
              ${n ? `<button data-c="iso" class="iso ${isolated === s.code ? "on" : ""}" title="${isolated === s.code ? "Tout réafficher" : "Isoler les calques et groupes de cette compétence"}">👁 ${n} calque${n > 1 ? "s" : ""}</button>` : ""}
              <span class="acts"><button data-c="pill" title="Insérer la pastille de compétence (marge gauche)">◉</button><button data-c="att" title="Insérer les attendus${level ? ` de ${level}e` : ""} en liste à puces">≡</button></span></div>
            ${isolated === s.code ? `<ul class="iso-list">${counts.get(s.code)!.map((t) => `<li data-pi="${t.pageIndex}" data-id="${t.node.id}" title="Aller à cet élément"><span class="pg">${esc(store.doc.pages[t.pageIndex].name)}</span>${esc([...t.path, t.node.name].join(" › "))}</li>`).join("")}</ul>` : ""}
            ${isOpen ? `<div class="sd">${lv.map((l) => (s.niveaux[l]?.length ? `<div class="lv"><span class="lvb lv${l}">${l}e</span><ul>${s.niveaux[l].map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : "")).join("")}
              ${s.connaissances.length ? `<details><summary>Connaissances (${s.connaissances.length})</summary><ul>${s.connaissances.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></details>` : ""}</div>` : ""}
          </div>`;
        }).join("")}</div>`).join("")}</section>`;
    }).join("") || `<p class="hint">Aucune compétence ne correspond.</p>`}</div>
    <p class="hint cp-legend"><b>◉</b> pastille (marge gauche) · <b>≡</b> attendus · <b>👁 n calques</b> isoler les calques de la compétence · <b class="okc">✓</b> déjà dans le document</p>`;
  el.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => (b.onclick = () => { viewMode = b.dataset.mode as typeof viewMode; refreshCompetences(insert); }));
  el.querySelector<HTMLElement>('[data-c="unisolate"]')?.addEventListener("click", () => setIsolated(null));
  const qi = el.querySelector<HTMLInputElement>('[data-c="q"]')!;
  qi.oninput = () => { query = qi.value; const pos = qi.selectionStart; refreshCompetences(insert); const n = document.querySelector<HTMLInputElement>('#competences [data-c="q"]'); n?.focus(); n?.setSelectionRange(pos, pos); };
  el.querySelector<HTMLInputElement>('[data-c="only"]')!.onchange = (e) => { onlyTagged = (e.target as HTMLInputElement).checked; refreshCompetences(insert); };
  el.querySelectorAll<HTMLElement>(".iso-list li").forEach((li) => (li.onclick = () => goTo(+li.dataset.pi!, li.dataset.id!)));
  el.querySelectorAll<HTMLElement>("[data-lvb]").forEach((b) => (b.onclick = () => { level = b.dataset.lvb!; refreshCompetences(insert); }));
  el.querySelectorAll<HTMLElement>(".sub").forEach((div) => {
    const s = THEMES.flatMap((t) => t.competences.flatMap((c) => c.subs)).find((x) => x.code === div.dataset.s)!;
    div.querySelector<HTMLElement>(".sh")!.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-c]")?.dataset.c;
      if (c === "pill") return insert(`Compétence ${s.code}`, [competencePill(s.code, s.title)], 8);
      if (c === "att") return insert(`Attendus ${s.code}`, [attendusText(s)], 141);
      if (c === "iso") return setIsolated(isolated === s.code ? null : s.code);
      if (open.has(s.code)) open.delete(s.code); else open.add(s.code);
      refreshCompetences(insert);
    };
  });
}

// ------------------------------------------------------------------ compétences attribuées aux calques

const ALL_SUBS = THEMES.flatMap((t) => t.competences.flatMap((c) => c.subs));
export const subByCode = (code: string) => ALL_SUBS.find((s) => s.code === code);

/** Calques, groupes et objets portant une compétence, sur toutes les feuilles. */
export function taggedNodes(code: string): { pageIndex: number; node: SceneNode; path: string[] }[] {
  const out: { pageIndex: number; node: SceneNode; path: string[] }[] = [];
  store.doc.pages.forEach((p, pi) => {
    const visit = (n: SceneNode, path: string[]) => {
      if (n.comp?.includes(code)) out.push({ pageIndex: pi, node: n, path });
      if (n.type === "group") n.children.forEach((c) => visit(c, [...path, n.name]));
    };
    p.layers.forEach((l) => visit(l, []));
  });
  return out;
}

/** Compétence isolée dans l'éditeur (le reste est estompé). */
export let isolated: string | null = null;
export function setIsolated(code: string | null) {
  isolated = code;
  // la compétence n'est pas sur cette feuille : on va à la première feuille qui la porte
  if (code && !isolateIds(store.page.layers)?.size) {
    const first = taggedNodes(code)[0];
    if (first) { store.editingMaster = null; store.pageIndex = first.pageIndex; store.selection = []; store.scope = null; }
  }
  const hit = code ? store.page.layers.find((l) => isolateIds([l])?.size) : null;
  if (hit) store.activeLayer = hit.id;
  const stage = document.querySelector<HTMLElement>("#stage");
  let b = document.querySelector<HTMLElement>("#isolate-banner");
  if (code && stage) {
    if (!b) { b = document.createElement("div"); b.id = "isolate-banner"; stage.appendChild(b); }
    const s = subByCode(code);
    b.innerHTML = `<span class="code" style="background:${themeColor(code)}">${code}</span> ${esc(s?.title ?? "")} — seuls les calques qui la contiennent sont affichés <button>Tout afficher</button>`;
    b.querySelector("button")!.onclick = () => setIsolated(null);
  } else b?.remove();
  store.emit("change");
}

/** Isolement : on n'affiche que les calques (de la feuille) qui contiennent la compétence,
 *  en entier ; tous les autres calques sont masqués. */
export function isolateIds(layers: SceneNode[]): Set<string> | null {
  if (!isolated) return null;
  const keep = new Set<string>();
  const all = (n: SceneNode) => { keep.add(n.id); if (n.type === "group") n.children.forEach(all); };
  const has = (n: SceneNode): boolean => !!n.comp?.includes(isolated!) || (n.type === "group" && n.children.some(has));
  for (const l of layers) if (has(l)) all(l);
  return keep;
}

/** Fenêtre de choix des compétences d'un calque, d'un groupe ou d'un objet. */
export function compPicker(node: SceneNode) {
  document.querySelector(".modal")?.remove();
  const chosen = new Set(node.comp ?? []);
  let q = "", lv = level;
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<form class="modal-card wide comp-picker"><h3>Compétences de « ${esc(node.name)} »</h3>
    <div class="comp-filters"><input type="search" placeholder="Rechercher (code, mot…)" data-c="q">
      <select data-c="lv"><option value="">Tous niveaux</option>${["5", "4", "3"].map((l) => `<option value="${l}" ${lv === l ? "selected" : ""}>${l}e</option>`).join("")}</select></div>
    <div class="cp-list"></div>
    <p class="hint cp-count"></p>
    <div class="btnrow end"><button type="button" data-k="clear">Tout décocher</button><span class="spacer"></span><button type="button" data-k="cancel">Annuler</button><button type="submit" class="primary-inline">Enregistrer</button></div></form>`;
  document.body.appendChild(box);
  const list = box.querySelector<HTMLElement>(".cp-list")!;
  const count = () => { box.querySelector(".cp-count")!.textContent = chosen.size ? `${chosen.size} compétence(s) : ${[...chosen].sort().join(", ")}` : "Aucune compétence."; };
  const draw = () => {
    const nq = norm(q);
    list.innerHTML = THEMES.map((t) => {
      const subs = t.competences.flatMap((c) => c.subs).filter((s) => (!lv || (s.niveaux[lv]?.length ?? 0) > 0)
        && (!nq || norm(`${s.code} ${s.abbr} ${s.title} ${Object.values(s.niveaux).flat().join(" ")}`).includes(nq)));
      if (!subs.length) return "";
      return `<div class="cp-theme" style="--th:${themeColor(t.code)}"><div class="th"><b>${t.code}</b> ${esc(t.abbr)} · ${esc(t.title)}</div>
        ${subs.map((s) => `<label class="cp-sub"><input type="checkbox" value="${s.code}" ${chosen.has(s.code) ? "checked" : ""}><span class="code" style="--th:${themeColor(s.code)}">${s.code}</span><span>${esc(s.title)}</span></label>`).join("")}</div>`;
    }).join("") || `<p class="hint">Aucune compétence ne correspond.</p>`;
    list.querySelectorAll<HTMLInputElement>("input").forEach((i) => (i.onchange = () => { if (i.checked) chosen.add(i.value); else chosen.delete(i.value); count(); }));
  };
  draw(); count();
  const qi = box.querySelector<HTMLInputElement>('[data-c="q"]')!;
  qi.oninput = () => { q = qi.value; draw(); };
  qi.focus();
  box.querySelector<HTMLSelectElement>('[data-c="lv"]')!.onchange = (e) => { lv = (e.target as HTMLSelectElement).value; draw(); };
  box.querySelector<HTMLElement>('[data-k="clear"]')!.onclick = () => { chosen.clear(); draw(); count(); };
  box.querySelector<HTMLElement>('[data-k="cancel"]')!.onclick = () => box.remove();
  box.onkeydown = (e) => { if (e.key === "Escape") box.remove(); };
  box.querySelector("form")!.onsubmit = (e) => {
    e.preventDefault();
    store.commit(() => { node.comp = chosen.size ? [...chosen].sort() : undefined; });
    box.remove();
  };
}
