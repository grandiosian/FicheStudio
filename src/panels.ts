// Panneaux latéraux : pages, calques, propriétés, disposition, données.
import { store } from "./store";
import { selectionBoxes, render as renderCanvas, zoomToFit, frameNode } from "./canvas";
import {
  newLayer, newPage, uid, walk, NONE, solid, sectionRects, masterAreas, nextSheetName, SHEET_KINDS, type SheetKind,
  type Paint, type Paragraph, type Run, type SceneNode, type ShapeNode, type TextNode, type Page, type GroupNode,
} from "./model";
import { mul, rotateAt, rotationOf, scaleAt, translate, boxOfPoints, type Box } from "./geom";
import {
  alignSelection, arrange, convertToCurves, deleteSelection, distribute, duplicate, groupSelection,
  maskSelection, transformNode, ungroupSelection, cloneNode,
} from "./ops";
import { isEditingText, styleCommand, insertAtCaret } from "./textedit";
import { findVars, parseCsv, SCHEMES } from "./templates";
import { refreshCompetences } from "./competences";
import { renderPage } from "./render";
import { charteMasters, makeTable, applyTemplate, templateFor, TEMPLATES, TEMPLATE_PREFIX } from "./charte";
import { variantOf, PREFS, palette, TEXT_STYLES, applyTextStyle } from "./charte";
import { atelierMaster, builtinItems, deleteItem, emptyMaster, instantiate, saveItem, userItems, assetsOf, type LibItem } from "./library";
import { embedAsset, relinkImage, canLinkFiles } from "./assets";
import { viewCenter } from "./canvas";
import { layerPagesDialog, layerKind } from "./layerpages";
import { inv } from "./geom";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// conversions d'unités
const toMm = (px: number) => (px / store.doc.dpi) * 25.4;
const fromMm = (mm: number) => (mm * store.doc.dpi) / 25.4;
const toPt = (px: number) => (px / store.doc.dpi) * 72;
const fromPt = (pt: number) => (pt * store.doc.dpi) / 72;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

const FONTS = ["Arial", "Arial Narrow", "Arial Black", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Comic Sans MS", "Avenir Next", "Futura", "Gill Sans", "Open Sans", "Roboto", "Montserrat", "Lato", "OpenDyslexic"];

export function initPanels() {
  // pendant un réglage en direct (sélecteur de couleur), le panneau ne bouge pas
  store.on((why) => { if (why !== "live") refresh(); });
  document.addEventListener("textedit", () => refreshProps());
  refresh();
}

function refresh() {
  refreshPages();
  refreshLayers();
  refreshLibrary();
  refreshCompetences(insertNodes);
  refreshProps();
  refreshData();
}

// ------------------------------------------------------------------ pages

function goPage(i: number) {
  store.editingMaster = null;
  store.pageIndex = i; store.selection = []; store.scope = null; store.activeLayer = null;
  store.emit("change");
}

/** Nouvelle feuille : même format, mêmes parties, même gabarit (barres haut/bas ajoutées d'office). */
function nextPage(cur: Page, kind: SheetKind = cur.kind ?? "fiche"): Page {
  const p = newPage(cur.width, cur.height, nextSheetName(store.doc.pages, kind));
  p.kind = kind;
  p.sections = cur.sections; p.split = cur.split; p.master = cur.master; p.masterMode = cur.masterMode; p.background = cur.background;
  p.fields = { ...(cur.fields ?? {}) };
  // charte : découpe seulement sur les feuilles d'atelier, gabarit selon le type, couleur d'étiquette du calque
  if (kind !== "fiche") p.sections = 1;
  for (const l of p.layers) l.tag ??= SHEET_KINDS[kind].tag;
  // document à la charte : le modèle est copié dans le calque de la nouvelle feuille
  if (store.doc.charte) {
    if (p.master && isCharteMaster(p.master)) p.master = null;
    for (const l of p.layers) applyTemplate(l, templateFor(kind), kind);
  }
  return p;
}

const isCharteMaster = (id: string) => !!store.doc.masters.find((m) => m.id === id && m.name.startsWith("Charte · "));

/** Type de feuille d'un calque de page, d'après son nom (P01, R02, E01…) ou la feuille. */
function kindOfLayer(l: GroupNode, page: Page): SheetKind {
  const k = layerKind(l.name);
  const of: Record<string, SheetKind> = { peda: "peda", prof: "prof", page: "fiche", ressource: "ressource", synthese: "synthese", eval: "eval", evalres: "evalres" };
  return of[k] ?? page.kind ?? "fiche";
}

/** Copie les modèles de la charte dans chaque calque de page ; les gabarits de la charte sont retirés. */
function copyCharteToLayers() {
  let n = 0;
  store.commit(() => {
    const d = store.doc;
    d.charte ??= PREFS.variante;
    let first = true;
    for (const p of d.pages) {
      if (p.master && isCharteMaster(p.master)) p.master = null;
      for (const l of p.layers) {
        const kind = kindOfLayer(l, p);
        applyTemplate(l, templateFor(kind, first && kind === "fiche"), kind);
        if (kind === "fiche") first = false;
        l.tag ??= SHEET_KINDS[kind].tag;
        n++;
      }
      if ((p.kind ?? "fiche") !== "fiche") p.sections = 1;
    }
    d.masters = d.masters.filter((m) => !m.name.startsWith("Charte · "));
  }, "doc");
  document.dispatchEvent(new CustomEvent("status", { detail: `Modèle de la charte copié dans ${n} calque(s) (groupe « ${TEMPLATE_PREFIX}… », verrouillé).` }));
}

function refreshPages() {
  const el = $("#pages");
  const ms = store.doc.masters;
  el.innerHTML = `
    <div class="panel-head"><h3>Feuilles</h3>
      <button data-a="add" title="Ajouter une feuille : fiche, ressource, évaluation… (même gabarit et même découpage)">＋ ▾</button>
      <button data-a="dup" title="Dupliquer la feuille">⧉</button>
      <button data-a="del" title="Supprimer la feuille">🗑</button>
      <button data-a="l2p" title="Calques → feuilles : faire une feuille de chaque calque choisi" ${store.editingMaster ? "disabled" : ""}>⇉</button></div>
    <ol class="page-list">${store.doc.pages.map((p, i) => `<li class="${!store.editingMaster && i === store.pageIndex ? "on" : ""}" data-i="${i}"><span class="num">${i + 1}</span><span class="kind-tag k-${p.kind ?? "fiche"}" title="${SHEET_KINDS[p.kind ?? "fiche"].label}">${SHEET_KINDS[p.kind ?? "fiche"].prefix}</span><span class="nm">${esc(p.name)}</span><span class="badge">${(p.sections ?? 1) > 1 ? `✂${p.sections}` : ""}${p.master ? " ▤" : ""}</span></li>`).join("")}</ol>
    <div class="panel-head sub"><h3>Gabarits</h3>
      <button data-a="m-charte" title="Copier le modèle de la charte dans chaque calque de page (1re feuille, feuille d'atelier, ressource, synthèse, évaluation selon le nom du calque : P01, R01, S01, E01…)">＋ Charte</button>
      <button data-a="m-atelier" title="Nouveau gabarit « Atelier » (barres haut et bas)">＋ Atelier</button>
      <button data-a="m-empty" title="Nouveau gabarit vide">＋</button></div>
    <ul class="page-list">${ms.map((m) => `<li class="${store.editingMaster === m.id ? "on" : ""}" data-m="${m.id}"><span class="num">▤</span><span class="nm">${esc(m.name)}</span>
      <span class="badge">${store.doc.pages.filter((p) => p.master === m.id).length} f.</span><button data-a="m-del" title="Supprimer le gabarit">✕</button></li>`).join("") || `<li class="empty">Aucun gabarit : les barres du haut et du bas d'un gabarit s'ajoutent à chaque feuille.</li>`}</ul>`;
  el.querySelectorAll<HTMLElement>("li[data-i]").forEach((li) => {
    li.onclick = () => goPage(+li.dataset.i!);
    li.ondblclick = () => {
      const p = store.doc.pages[+li.dataset.i!];
      const name = prompt("Nom de la feuille (sert aussi à nommer les PDF)", p.name);
      if (name) store.commit(() => { p.name = name; });
    };
  });
  el.querySelectorAll<HTMLElement>("li[data-m]").forEach((li) => {
    li.onclick = (e) => {
      const id = li.dataset.m!;
      if ((e.target as HTMLElement).dataset.a === "m-del") {
        const m = ms.find((x) => x.id === id)!;
        if (!confirm(`Supprimer le gabarit « ${m.name} » ? Les feuilles qui l'utilisent n'auront plus de barres.`)) return;
        store.commit(() => {
          store.doc.masters = store.doc.masters.filter((x) => x.id !== id);
          store.doc.pages.forEach((p) => { if (p.master === id) p.master = null; });
          if (store.editingMaster === id) store.editingMaster = null;
        });
        return;
      }
      store.editingMaster = id; store.selection = []; store.scope = null; store.activeLayer = null;
      store.emit("change");
    };
    li.ondblclick = () => {
      const m = ms.find((x) => x.id === li.dataset.m)!;
      const name = prompt("Nom du gabarit", m.name);
      if (name) store.commit(() => { m.name = name; });
    };
  });
  const cur = () => store.doc.pages[store.pageIndex];
  el.querySelector<HTMLElement>('[data-a="l2p"]')!.onclick = () => layerPagesDialog((msg) => document.dispatchEvent(new CustomEvent("status", { detail: msg })));
  el.querySelector<HTMLElement>('[data-a="add"]')!.onclick = (e) => {
    // menu des types de feuille
    document.querySelector(".pop-menu")?.remove();
    const m = document.createElement("div");
    m.className = "pop-menu menu-body";
    m.innerHTML = (Object.keys(SHEET_KINDS) as SheetKind[]).map((k) =>
      `<button data-k="${k}"><span class="kind-tag k-${k}">${SHEET_KINDS[k].prefix}</span> ${SHEET_KINDS[k].label}<small>nom ${nextSheetName(store.doc.pages, k)}, en-tête « ${SHEET_KINDS[k].entete} »</small></button>`).join("");
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    m.style.left = `${r.left}px`; m.style.top = `${r.bottom + 4}px`;
    document.body.appendChild(m);
    m.onclick = (ev) => {
      const k = (ev.target as HTMLElement).closest("button")?.dataset.k as SheetKind | undefined;
      m.remove();
      if (!k) return;
      store.commit(() => {
        store.doc.pages.splice(store.pageIndex + 1, 0, nextPage(cur(), k));
        store.pageIndex++; store.editingMaster = null; store.selection = [];
      });
    };
    setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target as Node)) { m.remove(); document.removeEventListener("click", off); } }), 0);
  };
  el.querySelector<HTMLElement>('[data-a="dup"]')!.onclick = () => store.commit(() => {
    const c = structuredClone(cur());
    c.id = uid("p");
    c.name += " (copie)";
    c.layers = c.layers.map((l) => cloneNode(l));
    store.doc.pages.splice(store.pageIndex + 1, 0, c);
    store.pageIndex++; store.editingMaster = null;
  });
  el.querySelector<HTMLElement>('[data-a="del"]')!.onclick = () => {
    if (store.doc.pages.length < 2 || !confirm(`Supprimer « ${cur().name} » ?`)) return;
    store.commit(() => { store.doc.pages.splice(store.pageIndex, 1); store.pageIndex = Math.max(0, store.pageIndex - 1); store.selection = []; });
  };
  const addMaster = (atelier: boolean) => {
    const p = cur();
    const r = sectionRects(p)[0];
    const m = atelier ? atelierMaster(r.w, r.h) : emptyMaster(r.w, r.h);
    store.commit(() => {
      store.doc.masters.push(m);
      // appliqué aux feuilles sans gabarit, sauf celles qui portent plusieurs feuilles en calques
      // (fichiers Affinity P01, R01… : le gabarit passerait sous chacun des calques)
      store.doc.pages.forEach((x) => { if (!x.master && x.layers.length <= 1) x.master = m.id; });
    });
  };
  el.querySelector<HTMLElement>('[data-a="m-atelier"]')!.onclick = () => addMaster(true);
  el.querySelector<HTMLElement>('[data-a="m-charte"]')!.onclick = () => copyCharteToLayers();
  el.querySelector<HTMLElement>('[data-a="m-empty"]')!.onclick = () => addMaster(false);
}

// ------------------------------------------------------------------ calques

/** Menu contextuel d'un calque ou d'un objet du panneau Calques. */
function layerMenu(x: number, y: number, node: SceneNode, isLayer: boolean) {
  document.querySelector(".pop-menu")?.remove();
  const m = document.createElement("div");
  m.className = "pop-menu menu-body";
  const g = node.type === "group" ? node : null;
  const tpl = isLayer && g ? g.children.find((c) => c.name.startsWith(TEMPLATE_PREFIX)) : undefined;
  const kind = isLayer && g ? kindOfLayer(g, store.page) : "fiche";
  m.innerHTML = `<button data-m="zoom">Zoom au plus près</button>
    ${g ? `<button data-m="selall">Sélectionner le contenu</button>` : ""}
    <button data-m="rename">Renommer…</button>
    <button data-m="eye">${node.visible ? "Masquer" : "Afficher"}</button>
    <button data-m="lock">${node.locked ? "Déverrouiller" : "Verrouiller"}</button>
    ${isLayer ? `<hr><div class="menu-title">Modèle de la charte</div>${TEMPLATES.map((t, i) => `<button data-tpl="${i}">${tpl?.name === TEMPLATE_PREFIX + t ? "✓ " : ""}${t}</button>`).join("")}
      ${tpl ? `<button data-m="untpl">Retirer le modèle</button>` : ""}` : ""}`;
  document.body.appendChild(m);
  m.style.left = `${Math.min(x, innerWidth - m.offsetWidth - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - m.offsetHeight - 8)}px`;
  const close = () => { m.remove(); document.removeEventListener("mousedown", off); };
  const off = (ev: MouseEvent) => { if (!m.contains(ev.target as Node)) close(); };
  setTimeout(() => document.addEventListener("mousedown", off), 0);
  m.onclick = (ev) => {
    const b = (ev.target as HTMLElement).closest("button");
    if (!b) return;
    close();
    const a = b.dataset.m;
    if (a === "zoom") frameNode(node.id);
    else if (a === "selall" && g) {
      if (isLayer) { store.activeLayer = g.id; store.scope = null; }
      store.select(g.children.filter((c) => !c.locked && c.visible).map((c) => c.id));
    } else if (a === "rename") { const name = prompt("Nom", node.name); if (name) store.commit(() => { node.name = name; }); }
    else if (a === "eye") store.commit(() => { node.visible = !node.visible; });
    else if (a === "lock") store.commit(() => { node.locked = !node.locked; });
    else if (a === "untpl" && g) store.commit(() => { g.children = g.children.filter((c) => !c.name.startsWith(TEMPLATE_PREFIX)); });
    else if (b.dataset.tpl && g) store.commit(() => { applyTemplate(g, +b.dataset.tpl!, kind); store.doc.charte ??= PREFS.variante; });
  };
}

const svgIcon = (d: string) => `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const EYE_ON = svgIcon(`<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>`);
const EYE_OFF = svgIcon(`<path d="M2 6.5c1.2 1.6 3.3 3 6 3s4.8-1.4 6-3"/><path d="M4.2 8.7 3 10.3M8 9.5v1.8M11.8 8.7l1.2 1.6"/>`);
const LOCK_ON = svgIcon(`<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`);
const LOCK_OFF = svgIcon(`<rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>`);

/** Œil / cadenas : appuyer puis glisser sur d'autres lignes applique le même état (une seule annulation). */
let toggleDrag: { key: "visible" | "locked"; value: boolean } | null = null;
function toggleTo(id: string, key: "visible" | "locked", value: boolean) {
  const node = store.page.layers.find((l) => l.id === id) ?? store.find(id)?.node;
  if (!node || node[key] === value) return;
  store.live(`toggle:${key}`, () => { node[key] = value; });
  const btn = document.querySelector<HTMLElement>(`#layers li[data-id="${id}"] [data-a="${key === "visible" ? "eye" : "lock"}"]`);
  if (btn) {
    btn.innerHTML = key === "visible" ? (value ? EYE_ON : EYE_OFF) : value ? LOCK_ON : LOCK_OFF;
    btn.classList.toggle(key === "visible" ? "off" : "on", key === "visible" ? !value : value);
    btn.closest("li")!.classList.toggle("hidden", key === "visible" && !value);
  }
}
document.addEventListener("mouseup", () => { if (toggleDrag) { toggleDrag = null; store.endLive(); } });

const ICON: Record<string, string> = { group: "▣", shape: "◆", path: "✎", text: "T", image: "🖼" };
const STEP_ICON = `<span class="step-ic" title="Étape de correction">⏵</span>`;
const expanded = new Set<string>(); // replié par défaut : un document importé compte des milliers d'objets

function refreshLayers() {
  const el = $("#layers");
  for (const id of store.selection) {
    let f = store.find(id);
    while (f) { expanded.add(f.parent.id); f = store.find(f.parent.id); }
    const layer = store.page.layers.find((l) => { let hit = false; walkIds(l, (x) => { if (x === id) hit = true; }); return hit; });
    if (layer) expanded.add(layer.id);
  }
  const sel = new Set(store.selection);
  const active = store.layer().id;
  const rows: string[] = [];
  const row = (n: SceneNode, depth: number, isLayer: boolean) => {
    const kids = n.type === "group" ? [...n.children].reverse() : [];
    const hasKids = kids.length > 0 || (n.type === "group" && !!n.mask);
    rows.push(`<li class="${sel.has(n.id) ? "sel" : ""} ${isLayer ? "layer" : ""} ${isLayer && n.id === active ? "active" : ""} ${n.visible ? "" : "hidden"}" data-id="${n.id}" style="--d:${depth};--row-tag:${n.tag ?? "transparent"}">
      <button class="tw" data-a="tw">${hasKids ? (expanded.has(n.id) ? "▾" : "▸") : ""}</button>
      <button class="eye ${n.visible ? "" : "off"}" data-a="eye" title="${n.visible ? "Masquer" : "Afficher"} (glisser pour plusieurs)">${n.visible ? EYE_ON : EYE_OFF}</button>
      <button class="lock ${n.locked ? "on" : ""}" data-a="lock" title="${n.locked ? "Déverrouiller" : "Verrouiller"} (glisser pour plusieurs)">${n.locked ? LOCK_ON : LOCK_OFF}</button>
      ${isLayer || n.type === "group" ? `<button class="tag" data-a="tag" title="Couleur du calque / groupe" style="--tag:${n.tag ?? "transparent"}"></button>` : ""}
      <span class="ic">${isLayer ? (n.type === "group" && n.anchor && n.anchor !== "none" ? (n.anchor === "top" ? "⤒" : "⤓") : "≡") : n.type === "group" && n.mask ? "◐" : ICON[n.type]}</span>
      <span class="nm">${esc(n.name || "")}</span>${n.step ? STEP_ICON : ""}</li>`);
    if (hasKids && expanded.has(n.id)) {
      for (const k of kids) row(k, depth + 1, false);
      if (n.type === "group" && n.mask) row(n.mask, depth + 1, false);
    }
  };
  for (const l of [...store.page.layers].reverse()) row(l, 0, true);
  el.innerHTML = `
    <div class="panel-head"><h3>Calques</h3>
      <button data-a="new" title="Nouveau calque">＋</button>
      <button data-a="up" title="Monter">▲</button>
      <button data-a="down" title="Descendre">▼</button>
      <button data-a="dellayer" title="Supprimer le calque actif">🗑</button></div>
    <ul class="tree">${rows.join("")}</ul>`;
  el.querySelectorAll<HTMLElement>("li").forEach((li) => {
    const id = li.dataset.id!;
    const isLayer = li.classList.contains("layer");
    li.querySelectorAll<HTMLElement>('[data-a="eye"], [data-a="lock"]').forEach((btn) => {
      const key = btn.dataset.a === "eye" ? "visible" : "locked";
      btn.onmousedown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const node = isLayer ? store.page.layers.find((l) => l.id === id) : store.find(id)?.node;
        if (!node) return;
        toggleDrag = { key, value: !node[key] };
        toggleTo(id, key, toggleDrag.value);
      };
      btn.onmouseenter = () => { if (toggleDrag?.key === key) toggleTo(id, key, toggleDrag.value); };
      btn.ondblclick = (e) => e.stopPropagation(); // pas de cadrage en cliquant vite sur l'œil
    });
    li.oncontextmenu = (e) => {
      e.preventDefault();
      const node = isLayer ? store.page.layers.find((l) => l.id === id) : store.find(id)?.node;
      if (node) layerMenu(e.clientX, e.clientY, node, isLayer);
    };
    li.onclick = (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
      const node = isLayer ? store.page.layers.find((l) => l.id === id)! : store.find(id)?.node;
      if (!node) return;
      if (a === "tw") { expanded.has(id) ? expanded.delete(id) : expanded.add(id); refreshLayers(); return; }
      if (a === "eye" || a === "lock") return; // géré à l'appui (voir onmousedown)
      if (a === "tag") { tagPicker(e.target as HTMLElement, node.tag ?? null, (c) => store.commit(() => { node.tag = c; })); return; }
      if (isLayer) { store.activeLayer = id; store.selection = []; store.emit("selection"); refreshLayers(); return; }
      const f = store.find(id);
      store.scope = f && !store.page.layers.includes(f.parent) ? f.parent.id : null;
      store.select(e.shiftKey ? [...new Set([...store.selection, id])] : [id]);
    };
    li.ondblclick = (e) => {
      const node = isLayer ? store.page.layers.find((l) => l.id === id)! : store.find(id)?.node;
      if (!node) return;
      // double-clic : cadrer l'élément ; ⌥ double-clic : renommer
      if (!e.altKey) { frameNode(id); return; }
      const name = prompt("Nom", node.name);
      if (name !== null) store.commit(() => { node.name = name; });
    };
  });
  const L = () => store.page.layers.findIndex((l) => l.id === store.layer().id);
  el.querySelector<HTMLElement>('[data-a="new"]')!.onclick = () => store.commit(() => {
    const l = newLayer(`Calque ${store.page.layers.length + 1}`);
    store.page.layers.splice(L() + 1, 0, l);
    store.activeLayer = l.id;
  });
  el.querySelector<HTMLElement>('[data-a="up"]')!.onclick = () => store.selection.length ? arrange("up") : store.commit(() => {
    const i = L(), ls = store.page.layers;
    if (i < ls.length - 1) [ls[i], ls[i + 1]] = [ls[i + 1], ls[i]];
  });
  el.querySelector<HTMLElement>('[data-a="down"]')!.onclick = () => store.selection.length ? arrange("down") : store.commit(() => {
    const i = L(), ls = store.page.layers;
    if (i > 0) [ls[i], ls[i - 1]] = [ls[i - 1], ls[i]];
  });
  el.querySelector<HTMLElement>('[data-a="dellayer"]')!.onclick = () => {
    if (store.page.layers.length < 2) return;
    const l = store.layer();
    if (!confirm(`Supprimer le calque « ${l.name} » et son contenu ?`)) return;
    store.commit(() => { store.page.layers = store.page.layers.filter((x) => x !== l); store.activeLayer = null; store.selection = []; });
  };
}

const TAGS = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#95a5a6"];
function tagPicker(anchor: HTMLElement, cur: string | null, set: (c: string | null) => void) {
  document.querySelector(".tag-pop")?.remove();
  const pop = document.createElement("div");
  pop.className = "tag-pop";
  pop.innerHTML = TAGS.map((c) => `<button style="background:${c}" data-c="${c}" class="${c === cur ? "on" : ""}"></button>`).join("") + `<button data-c="" title="Aucune">✕</button>`;
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${r.left}px`; pop.style.top = `${r.bottom + 4}px`;
  document.body.appendChild(pop);
  pop.onclick = (e) => {
    const c = (e.target as HTMLElement).dataset.c;
    if (c !== undefined) set(c || null);
    pop.remove();
  };
  setTimeout(() => document.addEventListener("click", function off(ev) { if (!pop.contains(ev.target as Node)) { pop.remove(); document.removeEventListener("click", off); } }), 0);
}

function walkIds(n: SceneNode, fn: (id: string) => void) {
  fn(n.id);
  if (n.type === "group") { n.children.forEach((c) => walkIds(c, fn)); if (n.mask) walkIds(n.mask, fn); }
}

// ------------------------------------------------------------------ bibliothèque

let userLib: LibItem[] = [];
userItems().then((l) => { userLib = l; refreshLibrary(); });

function placeItem(item: LibItem): { M: [number, number, number, number, number, number] } {
  // partie de feuille sous le centre de la vue
  const c = viewCenter();
  const rects = store.editingMaster ? [{ x: 0, y: 0, w: store.page.width, h: store.page.height }] : sectionRects(store.page);
  const r = rects.find((q) => c.x >= q.x && c.x < q.x + q.w && c.y >= q.y && c.y < q.y + q.h) ?? rects[0];
  const s = r.w / 2480;
  const { x, y, from } = item.place;
  if (from === "top") return { M: [s, 0, 0, s, r.x + x * s, r.y + y * s] };
  if (from === "bottom") return { M: [s, 0, 0, s, r.x + x * s, r.y + r.h - y * s] };
  return { M: [s, 0, 0, s, r.x + x * s, c.y] };
}

/** Insère des objets construits à la volée (compétences…), au centre de la vue. */
export function insertNodes(name: string, nodes: SceneNode[], x: number) {
  insertItem({ id: uid(), name, kind: "objects", place: { x, y: 0, from: "center" }, nodes, assets: {} });
}
export const refreshCompetencesPanel = () => refreshCompetences(insertNodes);

function insertItem(item: LibItem) {
  store.commit(() => {
    const nodes = instantiate(item, store.doc);
    const { M } = placeItem(item);
    if (item.kind === "layer") {
      const l = newLayer(item.name);
      if (store.editingMaster) l.anchor = item.place.from === "bottom" ? "bottom" : "top";
      l.children = nodes.map((n) => { n.transform = mulM(M, n.transform); return n; });
      store.page.layers.push(l);
      store.activeLayer = l.id;
      store.selection = [];
      return;
    }
    const layer = store.drawLayer();
    const L = store.cumulative(layer);
    const ids: string[] = [];
    for (const n of nodes) {
      n.transform = mulM(inv(L), mulM(M, n.transform));
      layer.children.push(n);
      ids.push(n.id);
    }
    store.selection = ids;
  });
}

const mulM = (m: number[], n: number[]): [number, number, number, number, number, number] =>
  [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

async function saveSelectionToLibrary(kind: "objects" | "layer") {
  let nodes: SceneNode[];
  let name: string;
  if (kind === "layer") {
    const l = store.layer();
    nodes = l.children.map((n) => ({ ...structuredClone(n), transform: mulM(store.cumulative(l), n.transform) }));
    name = l.name;
  } else {
    const sel = store.selected();
    if (!sel.length) return;
    nodes = sel.map((n) => ({ ...structuredClone(n), transform: mulM(store.parentCumulative(n.id), n.transform) }));
    name = sel.length === 1 ? sel[0].name : "Bloc";
  }
  const label = prompt("Nom du bloc dans la bibliothèque", name);
  if (!label) return;
  // origine du bloc : coin haut-gauche de sa boîte, sur une feuille de 2480 px
  const boxes = [...selectionBoxes().values()];
  let x0 = 0, y0 = 0;
  if (kind === "objects" && boxes.length) { x0 = Math.min(...boxes.map((b) => b.x)); y0 = Math.min(...boxes.map((b) => b.y)); }
  const s = 2480 / sectionRects(store.page)[0].w;
  for (const n of nodes) n.transform = mulM([s, 0, 0, s, -x0 * s, -y0 * s], n.transform);
  const fromBottom = kind === "objects" && y0 > store.page.height / 2;
  const item: LibItem = {
    id: uid("lib"), name: label, kind, nodes, assets: assetsOf(nodes, store.doc),
    place: kind === "layer" ? { x: 0, y: 0, from: "top" } : fromBottom ? { x: x0 * s, y: (store.page.height - y0) * s, from: "bottom" } : { x: x0 * s, y: y0 * s, from: "top" },
  };
  await saveItem(item);
  userLib = await userItems();
  refreshLibrary();
}

function refreshLibrary() {
  const el = document.querySelector<HTMLElement>("#library");
  if (!el) return;
  const items = [...builtinItems(variantOf(store.doc)), ...userLib];
  el.innerHTML = `<div class="panel-head"><h3>Bibliothèque</h3>
      <button data-a="save-sel" title="Ajouter la sélection à la bibliothèque">＋ Sélection</button>
      <button data-a="save-layer" title="Enregistrer le calque actif comme modèle">＋ Calque</button></div>
    <ul class="lib">${items.map((it) => `<li data-id="${it.id}" title="Cliquer pour insérer${it.place.from === "top" ? " (en haut de la partie)" : it.place.from === "bottom" ? " (en bas de la partie)" : ""}">
      <span class="ic">${it.kind === "layer" ? "≡" : it.place.from === "top" ? "⤒" : it.place.from === "bottom" ? "⤓" : "◆"}</span><span class="nm">${esc(it.name)}</span>
      ${it.builtin ? "" : `<button data-a="lib-del" title="Retirer de la bibliothèque">✕</button>`}</li>`).join("")}</ul>
    <p class="hint">Les blocs utilisent les variables <code>{{atelier}}</code>, <code>{{séquence}}</code>, <code>{{feuille}}</code>, <code>{{niveau}}</code> : réglez-les dans Document quand rien n'est sélectionné.</p>`;
  el.querySelectorAll<HTMLElement>("li[data-id]").forEach((li) => {
    li.onclick = async (e) => {
      const it = items.find((x) => x.id === li.dataset.id)!;
      if ((e.target as HTMLElement).dataset.a === "lib-del") {
        if (!confirm(`Retirer « ${it.name} » de la bibliothèque ?`)) return;
        await deleteItem(it.id); userLib = await userItems(); refreshLibrary(); return;
      }
      insertItem(it);
    };
  });
  el.querySelector<HTMLElement>('[data-a="save-sel"]')!.onclick = () => saveSelectionToLibrary("objects");
  el.querySelector<HTMLElement>('[data-a="save-layer"]')!.onclick = () => saveSelectionToLibrary("layer");
}

// ------------------------------------------------------------------ propriétés

function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  return boxOfPoints(boxes.flatMap((b) => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]));
}

const field = (label: string, key: string, value: string, attrs = "") =>
  `<label class="fld"><span>${label}</span><input data-k="${key}" value="${esc(value)}" ${attrs}></label>`;

function paintEditor(prefix: string, p: Paint, allowNone = true) {
  const type = p.type;
  const color = p.type === "solid" ? p.color : p.type !== "none" ? p.stops[0]?.color ?? "#000000" : "#000000";
  const color2 = p.type === "linear" || p.type === "radial" ? p.stops[p.stops.length - 1]?.color ?? "#ffffff" : "#ffffff";
  const op = p.type === "solid" ? p.opacity : 1;
  return `<div class="paint">
    <select data-k="${prefix}.type">${allowNone ? `<option value="none" ${type === "none" ? "selected" : ""}>Aucun</option>` : ""}
      <option value="solid" ${type === "solid" ? "selected" : ""}>Uni</option>
      <option value="linear" ${type === "linear" ? "selected" : ""}>Dégradé</option></select>
    ${type !== "none" ? `<input type="color" data-k="${prefix}.color" value="${color}">` : ""}
    ${type === "linear" ? `<input type="color" data-k="${prefix}.color2" value="${color2}"><input class="sm" data-k="${prefix}.angle" value="${p.type === "linear" ? p.angle : 0}" title="Angle (°)">` : ""}
    ${type === "solid" ? `<input class="sm" data-k="${prefix}.opacity" value="${Math.round(op * 100)}" title="Opacité (%)">` : ""}
  </div>`;
}

function setPaint(old: Paint, key: string, v: string): Paint {
  const color = old.type === "solid" ? old.color : old.type !== "none" ? old.stops[0]?.color ?? "#2f57a1" : "#2f57a1";
  switch (key) {
    case "type":
      if (v === "none") return NONE;
      if (v === "solid") return solid(color);
      return { type: "linear", angle: 0, stops: [{ offset: 0, color, opacity: 1 }, { offset: 1, color: "#ffffff", opacity: 1 }] };
    case "color":
      if (old.type === "solid") return { ...old, color: v };
      if (old.type === "linear" || old.type === "radial") return { ...old, stops: [{ ...old.stops[0], color: v }, ...old.stops.slice(1)] };
      return solid(v);
    case "color2":
      if (old.type === "linear" || old.type === "radial") return { ...old, stops: [...old.stops.slice(0, -1), { ...old.stops[old.stops.length - 1], color: v }] };
      return old;
    case "angle": return old.type === "linear" ? { ...old, angle: +v || 0 } : old;
    case "opacity": return old.type === "solid" ? { ...old, opacity: Math.max(0, Math.min(1, (+v || 0) / 100)) } : old;
  }
  return old;
}

function firstRun(t: TextNode): Run { return t.paragraphs[0]?.runs[0] ?? { text: "", font: "Arial", size: 50, weight: 400, italic: false, underline: false, color: "#000000", opacity: 1 }; }

function refreshProps() {
  const el = $("#props");
  const nodes = store.selected();
  const editing = isEditingText();
  if (!nodes.length) { el.innerHTML = docProps(); bindDocProps(el); if (!store.editingMaster) tableTool(el, true); return; }
  const boxes = [...selectionBoxes().values()];
  const b = unionBox(boxes) ?? { x: 0, y: 0, w: 0, h: 0 };
  const one = nodes.length === 1 ? nodes[0] : null;
  const vec = nodes.filter((n) => n.type === "shape" || n.type === "path") as (ShapeNode | Extract<SceneNode, { type: "path" }>)[];
  const texts = nodes.filter((n) => n.type === "text") as TextNode[];
  const rot = one ? (rotationOf(mul(store.parentCumulative(one.id), one.transform)) * 180) / Math.PI : 0;
  const parts: string[] = [];
  parts.push(`<section><h4>${one ? esc(one.name || one.type) : `${nodes.length} objets`}</h4>
    <div class="grid2">${field("X (mm)", "x", n1(toMm(b.x)))}${field("Y (mm)", "y", n1(toMm(b.y)))}
    ${field("L (mm)", "w", n1(toMm(b.w)))}${field("H (mm)", "h", n1(toMm(b.h)))}
    ${one ? field("Rotation (°)", "rot", n1(rot)) : ""}${field("Opacité (%)", "op", String(Math.round((one?.opacity ?? 1) * 100)))}</div>
    <label class="chk" title="En présentation, l'objet est masqué au départ puis révélé pas à pas (→ ou Espace)"><input type="checkbox" data-k="step" ${nodes.every((n) => n.step) ? "checked" : ""}> Étape de correction (présentation)</label></section>`);
  if (vec.length) {
    const v = vec[0];
    const dashKind = !v.stroke.dash ? "solid" : v.stroke.dash[0] < 0.5 ? "dot" : "dash";
    parts.push(`<section><h4>Remplissage</h4>${paintEditor("fill", v.fill)}${swatches("fill")}
      <label class="chk"><input type="checkbox" data-k="bindfill" ${v.bind?.fill === "couleur_niveau" ? "checked" : ""}> Couleur du niveau de classe (pastille)</label></section>
      <section><h4>Contour</h4>${paintEditor("stroke", v.stroke.paint)}${swatches("stroke")}
      <div class="grid2">${field("Épaisseur (pt)", "sw", n1(toPt(v.stroke.width)))}
      <label class="fld"><span>Style</span><select data-k="dash">
        <option value="solid" ${dashKind === "solid" ? "selected" : ""}>Plein</option>
        <option value="dash" ${dashKind === "dash" ? "selected" : ""}>Tirets</option>
        <option value="dot" ${dashKind === "dot" ? "selected" : ""}>Pointillés</option></select></label></div></section>`);
    if (one?.type === "shape") {
      parts.push(`<section><h4>Forme</h4><div class="grid2">
        <label class="fld"><span>Type</span><select data-k="kind">${(["rect", "ellipse", "triangle", "diamond", "arrow"] as const).map((k) => `<option value="${k}" ${one.kind === k ? "selected" : ""}>${{ rect: "Rectangle", ellipse: "Ellipse", triangle: "Triangle", diamond: "Losange", arrow: "Flèche" }[k]}</option>`).join("")}</select></label>
        ${one.kind === "rect" ? field("Coins (mm)", "radius", n1(toMm(one.radius[0]))) : ""}</div>
        <button data-act="curves">Convertir en courbes</button></section>`);
    }
  }
  if (one?.type === "image") {
    const a = store.doc.assets[one.asset];
    const src = !a ? "?" : a.data ? "intégrée au document" : a.link?.kind === "url" ? `liée : ${a.link.url}` : `liée : ${a.link?.path ?? a.name}`;
    parts.push(`<section><h4>Image</h4><p class="hint">${esc(a?.name ?? "")} — ${esc(src)}</p>
      <div class="btnrow wrap">${a && !a.data ? `<button data-act="img-embed" title="Copier l'image dans le document">Intégrer</button>` : ""}
      ${canLinkFiles() ? `<button data-act="img-relink" title="Choisir le fichier lié (copie ou nouvel emplacement)">Relier…</button>` : ""}
      <button data-act="img-size" title="Revenir aux proportions d'origine">Proportions d'origine</button></div></section>`);
  }
  if (texts.length || editing) {
    const r = texts.length ? firstRun(texts[0]) : null;
    const p = texts[0]?.paragraphs[0];
    parts.push(`<section class="keep-editor"><h4>Texte${editing ? " — sélection" : ""}</h4>
      <label class="fld wide"><span>Style de la charte</span><select data-k="tstyle"><option value="">—</option>${TEXT_STYLES.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("")}</select></label>
      <label class="fld wide"><span>Police</span><input list="fontlist" data-k="font" value="${esc(r?.font ?? "Arial")}"></label>
      <datalist id="fontlist">${FONTS.map((f) => `<option value="${f}">`).join("")}</datalist>
      <div class="grid2">${field("Corps (pt)", "fsize", n1(toPt(r?.size ?? 50)))}<label class="fld"><span>Couleur</span><input type="color" data-k="fcolor" value="${r?.color ?? "#000000"}"></label>
      </div>${swatches("fcolor")}<div class="grid2">
      ${field("Interligne (×)", "lh", String(Math.round((p?.lineHeight ?? 1) * 100) / 100))}
      <label class="fld"><span>Titre numéroté</span><select data-k="level">${[0, 1, 2, 3].map((l) => `<option value="${l}" ${(p?.level ?? 0) === l ? "selected" : ""}>${l ? `Niveau ${l}` : "Texte courant"}</option>`).join("")}</select></label>
      ${field("Espace avant (pt)", "sb", n1(toPt(p?.spaceBefore ?? 0)))}${field("Espace après (pt)", "sa", n1(toPt(p?.spaceAfter ?? 0)))}
      ${field("Retrait gauche (mm)", "li", n1(toMm(p?.leftIndent ?? 0)))}${field("Retrait 1re ligne (mm)", "fi", n1(toMm(p?.firstIndent ?? 0)))}</div>
      <div class="btnrow">
        <button data-act="bold" class="${r && r.weight >= 600 ? "on" : ""}" title="Gras"><b>G</b></button>
        <button data-act="italic" class="${r?.italic ? "on" : ""}" title="Italique"><i>I</i></button>
        <button data-act="underline" class="${r?.underline ? "on" : ""}" title="Souligné"><u>S</u></button>
        <span class="sep"></span>
        ${(["left", "center", "right", "justify"] as const).map((a) => `<button data-act="al-${a}" class="${p?.align === a ? "on" : ""}" title="${{ left: "Gauche", center: "Centré", right: "Droite", justify: "Justifié" }[a]}">${{ left: "⇤", center: "↔", right: "⇥", justify: "☰" }[a]}</button>`).join("")}
      </div></section>`);
  }
  parts.push(`<section><h4>Disposition</h4>
    <div class="btnrow">${(["l", "c", "r", "t", "m", "b"] as const).map((m) => `<button data-align="${m}" title="${{ l: "Aligner à gauche", c: "Centrer horizontalement", r: "Aligner à droite", t: "Aligner en haut", m: "Centrer verticalement", b: "Aligner en bas" }[m]}">${{ l: "⫷", c: "⫼", r: "⫸", t: "⊤", m: "⊝", b: "⊥" }[m]}</button>`).join("")}</div>
    <div class="btnrow"><button data-act="dist-h" title="Répartir horizontalement">⇹</button><button data-act="dist-v" title="Répartir verticalement">⇳</button>
      <span class="sep"></span><button data-act="front" title="Premier plan">⤒</button><button data-act="up" title="Avancer">↑</button><button data-act="down" title="Reculer">↓</button><button data-act="back" title="Arrière-plan">⤓</button></div>
    <div class="btnrow wrap"><button data-act="group">Grouper</button><button data-act="ungroup">Dissocier</button><button data-act="mask" title="La forme du dessus découpe les autres">Masquer</button>
      <button data-act="dup">Dupliquer</button><button data-act="del">Supprimer</button></div>
    <p class="hint">${nodes.length === 1 ? "Un seul objet : alignement sur la page." : "Plusieurs objets : alignement sur la sélection."}</p></section>`);
  el.innerHTML = parts.join("");
  bindProps(el, nodes, b);
  tableTool(el, false);
}

// ------------------------------------------------------------------ tableau

const tableOpts = { rows: 4, cols: 3, header: true, headerCol: false, widthMm: 193.4, cellHmm: 8 };

// ------------------------------------------------------------------ modèles et blocs (barre d'outils)

/** Vignette SVG de nœuds, rendus avec les variables du document ; cadrée sur leur contenu sauf si page. */
function thumb(nodes: SceneNode[], page?: { w: number; h: number }): string {
  const layer = newLayer("aperçu");
  layer.children = nodes;
  // sans fond de page : la boîte englobante des blocs se limite à leur contenu
  const fake = { ...newPage(page?.w ?? 2480, page?.h ?? 3508, "aperçu"), background: null, layers: [layer], sections: 1 } as Page;
  const { defs, body } = renderPage(store.doc, fake, { cutMarks: false });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${page ? `viewBox="0 0 ${page.w} ${page.h}"` : ""} preserveAspectRatio="xMidYMid meet"><defs>${defs}</defs>${page ? `<rect width="${page.w}" height="${page.h}" fill="#fff"/>` : ""}${body}</svg>`;
  return svg;
}

/** Cadre les vignettes de blocs sur leur boîte englobante, une fois dans le document. */
function fitThumbs(root: HTMLElement) {
  root.querySelectorAll<SVGSVGElement>(".tpl-card.block svg").forEach((svg) => {
    try {
      const b = svg.getBBox();
      const pad = Math.max(b.width, b.height) * 0.04 + 4;
      svg.setAttribute("viewBox", `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
    } catch { /* pas encore affichée */ }
  });
}

/** Barre d'outils › Modèles : modèles de page à copier dans le calque actif, titres et blocs de la charte. */
export function templatePicker(anchor: HTMLElement) {
  document.querySelector(".pop-menu")?.remove();
  const m = document.createElement("div");
  m.className = "pop-menu menu-body tpl-picker";
  const masters = charteMasters();
  const layer = store.layer();
  const kind = kindOfLayer(layer, store.page);
  const current = layer.children.find((c) => c.name.startsWith(TEMPLATE_PREFIX))?.name;
  const items = builtinItems(variantOf(store.doc)).filter((it) => it.name.startsWith("Charte · "));
  const headings = items.filter((it) => /titre de niveau/.test(it.name));
  const blocks = items.filter((it) => !/titre de niveau/.test(it.name));
  const card = (cls: string, attr: string, svg: string, label: string, on = false) =>
    `<button class="tpl-card ${cls} ${on ? "on" : ""}" ${attr} title="${esc(label)}">${svg}<span>${esc(label)}</span></button>`;
  m.innerHTML = `<div class="tpl-head"><b>Modèles de la charte</b><span class="spacer"></span><input type="search" placeholder="Filtrer…" class="tpl-filter"></div>
    <div class="tpl-scroll">
    <div class="menu-title">Modèle de page → calque « ${esc(layer.name)} »${current ? " (remplace le modèle en place)" : ""}</div>
    <div class="tpl-grid pages">${masters.map((ms, i) => card("page", `data-tpl="${i}"`, thumb(ms.layers.flatMap((l) => l.children), { w: ms.width, h: ms.height }), TEMPLATES[i], current === TEMPLATE_PREFIX + TEMPLATES[i] || (!current && i === templateFor(kind)))).join("")}</div>
    <div class="menu-title">Titres · ${esc(variantOf(store.doc).label)}</div>
    <div class="tpl-grid">${headings.map((it) => card("block", `data-it="${it.id}"`, thumb(structuredClone(it.nodes)), it.name.replace(/^Charte · /, ""))).join("")}</div>
    <div class="menu-title">Blocs</div>
    <div class="tpl-grid">${blocks.map((it) => card("block", `data-it="${it.id}"`, thumb(structuredClone(it.nodes)), it.name.replace(/^Charte · /, ""))).join("")}</div>
    </div>`;
  const r = anchor.getBoundingClientRect();
  m.style.left = `${r.right + 6}px`;
  document.body.appendChild(m);
  m.style.top = `${Math.max(8, Math.min(r.top, innerHeight - m.offsetHeight - 8))}px`;
  requestAnimationFrame(() => fitThumbs(m));
  const close = () => { m.remove(); document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc_); };
  const off = (e: MouseEvent) => { if (!m.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const esc_ = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  setTimeout(() => { document.addEventListener("mousedown", off); document.addEventListener("keydown", esc_); }, 0);
  const filter = m.querySelector<HTMLInputElement>(".tpl-filter")!;
  filter.oninput = () => {
    const q = filter.value.toLowerCase();
    m.querySelectorAll<HTMLElement>(".tpl-card").forEach((c) => { c.hidden = !!q && !c.title.toLowerCase().includes(q); });
  };
  filter.focus();
  m.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".tpl-card");
    if (!b) return;
    close();
    if (b.dataset.tpl) {
      const i = +b.dataset.tpl;
      store.commit(() => { applyTemplate(store.layer(), i, kind); store.doc.charte ??= PREFS.variante; });
      document.dispatchEvent(new CustomEvent("status", { detail: `Modèle « ${TEMPLATES[i]} » copié dans le calque « ${layer.name} ».` }));
    } else {
      const it = items.find((x) => x.id === b.dataset.it);
      if (it) insertItem(it);
    }
  };
}

/** Barre d'outils › Tableau : grille à survoler pour choisir rangées × colonnes, puis clic. */
export function tablePicker(anchor: HTMLElement) {
  document.querySelector(".pop-menu")?.remove();
  const o = tableOpts, R = 10, C = 8;
  const m = document.createElement("div");
  m.className = "pop-menu menu-body table-picker";
  m.innerHTML = `<div class="menu-title">Tableau <span class="tp-size">${o.rows} × ${o.cols}</span></div>
    <div class="tp-grid" style="grid-template-columns:repeat(${C},18px)">${Array.from({ length: R * C }, (_, i) => `<span data-r="${Math.floor(i / C) + 1}" data-c="${(i % C) + 1}"></span>`).join("")}</div>
    <label class="chk"><input type="checkbox" data-t="header" ${o.header ? "checked" : ""}> Rangée de titre</label>
    <label class="chk"><input type="checkbox" data-t="headerCol" ${o.headerCol ? "checked" : ""}> Colonne de titre</label>
    <p class="hint">Largeur ${n1(o.widthMm)} mm, cases de ${n1(o.cellHmm)} mm : réglables dans Propriétés › Tableau.</p>`;
  const r = anchor.getBoundingClientRect();
  m.style.left = `${r.right + 6}px`; m.style.top = `${r.top}px`;
  document.body.appendChild(m);
  const cells = [...m.querySelectorAll<HTMLElement>(".tp-grid span")];
  const show = (rr: number, cc: number) => {
    cells.forEach((c) => c.classList.toggle("on", +c.dataset.r! <= rr && +c.dataset.c! <= cc));
    m.querySelector(".tp-size")!.textContent = `${rr} × ${cc}`;
  };
  show(o.rows, o.cols);
  cells.forEach((c) => {
    c.onmouseenter = () => show(+c.dataset.r!, +c.dataset.c!);
    c.onclick = () => {
      o.rows = +c.dataset.r!; o.cols = +c.dataset.c!;
      close();
      const t = makeTable({ rows: o.rows, cols: o.cols, header: o.header, headerCol: o.headerCol, width: fromMm(o.widthMm), cellH: fromMm(o.cellHmm) });
      insertNodes(t.name, [t], 141);
    };
  });
  m.querySelectorAll<HTMLInputElement>("input[data-t]").forEach((i) => (i.onchange = () => { o[i.dataset.t as "header" | "headerCol"] = i.checked; }));
  const close = () => { m.remove(); document.removeEventListener("mousedown", off); };
  const off = (e: MouseEvent) => { if (!m.contains(e.target as Node) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener("mousedown", off), 0);
}

/** Section « Tableau » du panneau Propriétés : insère un tableau à la charte. */
function tableTool(el: HTMLElement, top: boolean) {
  const o = tableOpts;
  const sec = document.createElement("section");
  sec.className = "table-tool";
  sec.innerHTML = `<h4>Tableau</h4>
    <div class="grid2">${field("Rangées", "rows", String(o.rows))}${field("Colonnes", "cols", String(o.cols))}
    ${field("Largeur (mm)", "widthMm", n1(o.widthMm))}${field("Hauteur des cases (mm)", "cellHmm", n1(o.cellHmm))}</div>
    <label class="chk"><input type="checkbox" data-t="header" ${o.header ? "checked" : ""}> Rangée de titre</label>
    <label class="chk"><input type="checkbox" data-t="headerCol" ${o.headerCol ? "checked" : ""}> Colonne de titre</label>
    <button class="primary" data-t="add">＋ Ajouter le tableau</button>
    <p class="hint">Calques : un dossier « Tableau », une rangée par groupe, chaque case = rectangle + texte. En-têtes bleu clair, contours bleus (charte).</p>`;
  if (top) el.prepend(sec); else el.append(sec);
  // les champs de saisie réutilisent field() : on les relit par leur data-k, sans passer par bindProps
  sec.querySelectorAll<HTMLInputElement>("[data-k]").forEach((inp) => {
    inp.onchange = () => {
      const v = parseFloat(inp.value.replace(",", "."));
      const k = inp.dataset.k as "rows" | "cols" | "widthMm" | "cellHmm";
      if (!isNaN(v) && v > 0) o[k] = k === "rows" || k === "cols" ? Math.min(40, Math.round(v)) : v;
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") inp.blur(); };
  });
  sec.querySelectorAll<HTMLInputElement>('input[data-t]').forEach((c) => (c.onchange = () => { o[c.dataset.t as "header" | "headerCol"] = c.checked; }));
  sec.querySelector<HTMLElement>('[data-t="add"]')!.onclick = () => {
    sec.querySelectorAll<HTMLInputElement>("[data-k]").forEach((i) => i.onchange?.(new Event("change")));
    const t = makeTable({ rows: o.rows, cols: o.cols, header: o.header, headerCol: o.headerCol, width: fromMm(o.widthMm), cellH: fromMm(o.cellHmm) });
    insertNodes(t.name, [t], 141);
  };
}

/** Nuancier de la charte sous un sélecteur de couleur. */
function swatches(target: "fill" | "stroke" | "fcolor") {
  return `<div class="swatches" data-swfor="${target}" title="Couleurs de la charte">${palette().map((c) => `<button data-sw="${c.hex}" style="background:${c.hex}" title="${esc(c.name)}"></button>`).join("")}</div>`;
}

/** Branche un sélecteur de couleur sur le mode « en direct ». */
function liveColor(inp: HTMLInputElement, key: string) {
  const apply = inp.onchange as (() => void) | null;
  if (!apply) return;
  inp.oninput = () => {
    liveKey = key;
    try { apply(); } finally { liveKey = null; }
  };
  inp.onchange = () => { if (store.isLive()) store.endLive(); else apply(); };
}

/** Modification normale, ou « en direct » pendant qu'on fait glisser un sélecteur de couleur. */
let liveKey: string | null = null;
function mutate(fn: () => void) {
  if (liveKey) store.live(liveKey, fn); else store.commit(fn);
}

function applyToVectors(fn: (n: ShapeNode | Extract<SceneNode, { type: "path" }>) => void) {
  mutate(() => { for (const n of store.selected()) if (n.type === "shape" || n.type === "path") fn(n); });
}

function applyToParas(fn: (p: Paragraph) => void) {
  mutate(() => { for (const n of store.selected()) walk([n], (x) => { if (x.type === "text") x.paragraphs.forEach(fn); }); });
}

function applyToRuns(fn: (r: Run) => void) {
  mutate(() => {
    for (const n of store.selected()) {
      const targets: TextNode[] = [];
      walk([n], (x) => { if (x.type === "text") targets.push(x); });
      for (const t of targets) for (const p of t.paragraphs) for (const r of p.runs) fn(r);
    }
  });
}

function bindProps(el: HTMLElement, nodes: SceneNode[], b: Box) {
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-k]").forEach((inp) => {
    inp.onchange = () => {
      const k = inp.dataset.k!, v = inp.value;
      const num = parseFloat(v.replace(",", "."));
      if (["x", "y", "w", "h"].includes(k) && !isNaN(num)) {
        const val = fromMm(num);
        let M = translate(0, 0);
        if (k === "x") M = translate(val - b.x, 0);
        if (k === "y") M = translate(0, val - b.y);
        if (k === "w" && b.w > 0) M = scaleAt(val / b.w, 1, { x: b.x, y: b.y });
        if (k === "h" && b.h > 0) M = scaleAt(1, val / b.h, { x: b.x, y: b.y });
        store.commit(() => { for (const n of nodes) transformNode(n, M, store.parentCumulative(n.id), k === "w" || k === "h"); });
      } else if (k === "rot" && !isNaN(num)) {
        const n = nodes[0];
        const cur = (rotationOf(mul(store.parentCumulative(n.id), n.transform)) * 180) / Math.PI;
        const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        store.commit(() => transformNode(n, rotateAt(((num - cur) * Math.PI) / 180, c), store.parentCumulative(n.id), false));
      } else if (k === "step") {
        store.commit(() => { for (const n of nodes) n.step = (inp as HTMLInputElement).checked || undefined; });
      } else if (k === "op" && !isNaN(num)) {
        store.commit(() => { for (const n of nodes) n.opacity = Math.max(0, Math.min(1, num / 100)); });
      } else if (k.startsWith("fill.")) applyToVectors((n) => { n.fill = setPaint(n.fill, k.slice(5), v); });
      else if (k.startsWith("stroke.")) applyToVectors((n) => {
        n.stroke.paint = setPaint(n.stroke.paint, k.slice(7), v);
        if (n.stroke.paint.type !== "none" && n.stroke.width === 0) n.stroke.width = fromPt(1);
      });
      else if (k === "sw" && !isNaN(num)) applyToVectors((n) => { n.stroke.width = fromPt(num); if (num > 0 && n.stroke.paint.type === "none") n.stroke.paint = solid("#1e2a44"); });
      else if (k === "dash") applyToVectors((n) => { n.stroke.dash = v === "dash" ? [3, 2] : v === "dot" ? [0.01, 2] : null; n.stroke.cap = v === "dot" ? "round" : n.stroke.cap; });
      else if (k === "kind") applyToVectors((n) => { if (n.type === "shape") n.kind = v as ShapeNode["kind"]; });
      else if (k === "radius" && !isNaN(num)) applyToVectors((n) => { if (n.type === "shape") n.radius = [fromMm(num), fromMm(num), fromMm(num), fromMm(num)]; });
      else if (k === "font") { if (!styleCommand("font", v)) applyToRuns((r) => { r.font = v; }); }
      else if (k === "fsize" && !isNaN(num)) { if (!styleCommand("size", String(fromPt(num)))) applyToRuns((r) => { r.size = fromPt(num); }); }
      else if (k === "fcolor") { if (!styleCommand("color", v)) applyToRuns((r) => { r.color = v; }); }
      else if (k === "lh" && !isNaN(num)) applyToParas((p) => { p.lineHeight = num; });
      else if (k === "level") { if (!styleCommand("level", v)) applyToParas((p) => { p.level = +v as Paragraph["level"]; }); }
      else if (k === "sb" && !isNaN(num)) applyToParas((p) => { p.spaceBefore = fromPt(num); });
      else if (k === "sa" && !isNaN(num)) applyToParas((p) => { p.spaceAfter = fromPt(num); });
      else if (k === "li" && !isNaN(num)) applyToParas((p) => { p.leftIndent = fromMm(num); });
      else if (k === "fi" && !isNaN(num)) applyToParas((p) => { p.firstIndent = fromMm(num); });
      else if (k === "tstyle") { const st = TEXT_STYLES.find((s) => s.id === v); if (st) applyToParas((p) => applyTextStyle(p, st)); }
      else if (k === "bindfill") applyToVectors((n) => { n.bind = (inp as HTMLInputElement).checked ? { ...n.bind, fill: "couleur_niveau" } : { ...n.bind, fill: undefined }; });
    };
    if (inp.tagName === "INPUT" && (inp as HTMLInputElement).type !== "color") inp.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") inp.blur(); });
    // couleurs : application en direct pendant le glisser, un seul niveau d'annulation à la fin
    if ((inp as HTMLInputElement).type === "color" && !isEditingText()) liveColor(inp as HTMLInputElement, `${inp.dataset.k}:${store.selection.join(",")}`);
  });
  el.querySelectorAll<HTMLElement>("[data-sw]").forEach((btn) => {
    btn.onmousedown = (e) => { if (isEditingText()) e.preventDefault(); };
    btn.onclick = () => {
      const hex = btn.dataset.sw!, t = btn.closest<HTMLElement>("[data-swfor]")!.dataset.swfor;
      if (t === "fill") applyToVectors((n) => { n.fill = solid(hex); });
      else if (t === "stroke") applyToVectors((n) => { n.stroke.paint = solid(hex); if (n.stroke.width === 0) n.stroke.width = fromPt(1); });
      else if (!styleCommand("color", hex)) applyToRuns((r) => { r.color = hex; });
    };
  });
  el.querySelectorAll<HTMLElement>("[data-align]").forEach((btn) => {
    btn.onclick = () => alignSelection(selectionBoxes(), btn.dataset.align as "l", store.selection.length === 1 ? { x: 0, y: 0, w: store.page.width, h: store.page.height } : null);
  });
  el.querySelectorAll<HTMLElement>("[data-act]").forEach((btn) => {
    btn.onmousedown = (e) => { if (isEditingText()) e.preventDefault(); }; // garder la sélection de texte
    btn.onclick = () => {
      const a = btn.dataset.act!;
      const textActs: Record<string, () => void> = {
        bold: () => { if (!styleCommand("bold")) applyToRuns((r) => { r.weight = r.weight >= 600 ? 400 : 700; }); },
        italic: () => { if (!styleCommand("italic")) applyToRuns((r) => { r.italic = !r.italic; }); },
        underline: () => { if (!styleCommand("underline")) applyToRuns((r) => { r.underline = !r.underline; }); },
      };
      if (textActs[a]) return textActs[a]();
      if (a.startsWith("al-")) {
        const al = a.slice(3) as "left";
        if (!styleCommand("align", al)) store.commit(() => { for (const n of store.selected()) walk([n], (x) => { if (x.type === "text") x.paragraphs.forEach((p) => { p.align = al; }); }); });
        return;
      }
      ({
        "dist-h": () => distribute(selectionBoxes(), "h"), "dist-v": () => distribute(selectionBoxes(), "v"),
        front: () => arrange("front"), back: () => arrange("back"), up: () => arrange("up"), down: () => arrange("down"),
        group: groupSelection, ungroup: ungroupSelection, mask: maskSelection, dup: duplicate, del: deleteSelection, curves: convertToCurves,
        "img-embed": async () => { const n = nodes[0]; if (n.type !== "image") return; store.checkpoint(); await embedAsset(store.doc, n.asset); store.emit("change"); },
        "img-relink": async () => { const n = nodes[0]; if (n.type !== "image") return; store.checkpoint(); await relinkImage(store.doc, n.asset); store.emit("change"); },
        "img-size": () => { const n = nodes[0]; if (n.type !== "image") return; const a = store.doc.assets[n.asset]; if (a?.w && a.h) store.commit(() => { n.h = (n.w * a.h!) / a.w!; }); },
      } as Record<string, () => void>)[a]?.();
    };
  });
}

// ------------------------------------------------------------------ document (rien de sélectionné)

const PRESETS: [string, number, number][] = [["A4 portrait", 210, 297], ["A4 paysage", 297, 210], ["A3 portrait", 297, 420], ["A5 portrait", 148, 210], ["A5 paysage", 210, 148], ["Diapositive 16:9", 338.67, 190.5]];

function docProps() {
  const d = store.doc;
  if (store.editingMaster) {
    const m = d.masters.find((x) => x.id === store.editingMaster)!;
    return `<section><h4>Gabarit « ${esc(m.name)} »</h4>
      <p class="hint">Ce que vous dessinez ici est ajouté à <b>chaque partie</b> des feuilles qui utilisent ce gabarit. Les calques « Haut » restent collés en haut de la partie, les calques « Bas » en bas ; la largeur s'adapte à la partie.</p>
      ${m.layers.map((l) => `<label class="fld wide"><span>Calque « ${esc(l.name)} »</span><select data-m="anchor" data-l="${l.id}">
        <option value="top" ${l.anchor === "top" ? "selected" : ""}>Collé en haut</option><option value="bottom" ${l.anchor === "bottom" ? "selected" : ""}>Collé en bas</option><option value="none" ${!l.anchor || l.anchor === "none" ? "selected" : ""}>Libre</option></select></label>`).join("")}
      <button class="primary" data-m="done">Terminer la modification du gabarit</button></section>${varsHelp()}`;
  }
  const p = store.page;
  const levels = Object.keys(d.levelColors);
  return `<section><h4>Document</h4>
    <label class="fld wide"><span>Nom du document</span><input data-d="name" value="${esc(d.name)}"></label>
    <div class="grid2"><label class="fld"><span>Atelier {{atelier}}</span><input data-f="atelier" value="${esc(d.fields.atelier ?? "")}"></label>
      <label class="fld"><span>Séquence {{séquence}}</span><input data-f="séquence" value="${esc(d.fields["séquence"] ?? "")}" placeholder="AT SEQ 01 SEANCE 02"></label>
      <label class="fld"><span>Niveau {{niveau}}</span><select data-f="niveau">${levels.map((l) => `<option value="${l}" ${d.fields.niveau === l ? "selected" : ""}>${l}e</option>`).join("")}</select></label>
      <label class="fld"><span>Pastille du ${esc(d.fields.niveau ?? "")}e</span><input type="color" data-lc="${esc(d.fields.niveau ?? "5")}" value="${d.levelColors[d.fields.niveau ?? "5"] ?? "#fcca30"}"></label></div>
    <p class="hint">${d.dpi} ppp · ${d.pages.length} feuille(s)</p></section>
    <section><h4>Numérotation des titres</h4>
    <label class="fld wide"><span>Nomenclature</span><select data-n="scheme">${(Object.keys(SCHEMES) as (keyof typeof SCHEMES)[]).map((k) => `<option value="${k}" ${d.numbering.scheme === k ? "selected" : ""}>${SCHEMES[k].label}</option>`).join("")}</select></label>
    <p class="hint">Exemple : ${esc(SCHEMES[d.numbering.scheme].example)}${d.numbering.suffixes ? ` — variante de charte « ${esc(variantOf(d).label)} » (menu Charte › Variantes)` : ""}</p>
    <div class="grid2"><label class="fld"><span>Recommencer</span><select data-n="restart">
        <option value="doc" ${d.numbering.restart === "doc" ? "selected" : ""}>Jamais (tout le document)</option>
        <option value="page" ${d.numbering.restart === "page" ? "selected" : ""}>À chaque feuille</option>
        <option value="section" ${d.numbering.restart === "section" ? "selected" : ""}>À chaque partie</option></select></label>
      <label class="fld"><span>Après le numéro</span><select data-n="suffix">${[[" ", "espace"], [". ", "point"], [") ", "parenthèse"], [" – ", "tiret"], ["\t", "tabulation"]].map(([v, l]) => `<option value="${esc(v)}" ${d.numbering.suffix === v.replace("\\t", "\t") ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <p class="hint">Sélectionnez un texte puis choisissez « Titre numéroté : niveau 1, 2 ou 3 ».</p></section>
    <section><h4>Feuille « ${esc(p.name)} »</h4>
    <label class="fld wide"><span>Nom de la feuille (nom du PDF)</span><input data-p="name" value="${esc(p.name)}"></label>
    <label class="fld wide"><span>Type de feuille <code>{{entete}}</code></span><select data-p="kind">${(Object.keys(SHEET_KINDS) as SheetKind[]).map((k) => `<option value="${k}" ${(p.kind ?? "fiche") === k ? "selected" : ""}>${SHEET_KINDS[k].prefix} · ${SHEET_KINDS[k].label} — ${SHEET_KINDS[k].entete}</option>`).join("")}</select></label>
    <label class="fld wide"><span>Format</span><select data-d="preset"><option value="">Personnalisé</option>${PRESETS.map(([n, w, h]) => `<option value="${w}x${h}" ${Math.abs(toMm(p.width) - w) < 0.6 && Math.abs(toMm(p.height) - h) < 0.6 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
    <div class="grid2"><label class="fld"><span>Largeur (mm)</span><input data-d="pw" value="${n1(toMm(p.width))}"></label><label class="fld"><span>Hauteur (mm)</span><input data-d="ph" value="${n1(toMm(p.height))}"></label>
      <label class="fld"><span>Découpage</span><select data-p="sections">
        <option value="1" ${(p.sections ?? 1) === 1 ? "selected" : ""}>Pleine page</option>
        <option value="2" ${p.sections === 2 ? "selected" : ""}>2 parties ✂</option>
        <option value="3" ${p.sections === 3 ? "selected" : ""}>3 parties ✂</option></select></label>
      <label class="fld"><span>Sens</span><select data-p="split" ${(p.sections ?? 1) === 1 ? "disabled" : ""}>
        <option value="h" ${p.split !== "v" ? "selected" : ""}>Empilées</option><option value="v" ${p.split === "v" ? "selected" : ""}>Côte à côte</option></select></label>
      <label class="fld"><span>Gabarit</span><select data-p="master"><option value="">Aucun</option>${d.masters.map((m) => `<option value="${m.id}" ${p.master === m.id ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select></label>
      <label class="fld"><span>Gabarit posé</span><select data-p="masterMode" ${(p.sections ?? 1) === 1 || !p.master ? "disabled" : ""}>
        <option value="sheet" ${p.masterMode !== "each" ? "selected" : ""}>Une fois (titre en haut)</option>
        <option value="each" ${p.masterMode === "each" ? "selected" : ""}>Dans chaque partie</option></select></label>
      <label class="fld"><span>Fond</span><input type="color" data-d="bg" value="${p.background ?? "#ffffff"}"></label></div>
    <label class="fld wide"><span>Séquence de cette feuille (vide = celle du document)</span><input data-pf="séquence" value="${esc(p.fields?.["séquence"] ?? "")}"></label>
    <label class="chk"><input type="checkbox" data-d="allpages"> Appliquer format, découpage et gabarit à toutes les feuilles</label>
    ${p.master ? `<button data-p="detach" title="Copier les barres du gabarit dans la feuille pour les modifier ici">Détacher le gabarit sur cette feuille</button>` : ""}</section>
    ${varsHelp()}
    <section><h4>Raccourcis</h4><p class="hint">V sélection · A nœuds · P plume · M rectangle · E ellipse · L ligne · T texte · H main<br>
    Espace + glisser : déplacer la vue · Ctrl/⌘ + molette : zoom · double-clic : entrer dans un groupe / éditer un texte<br>
    ⌘Z annuler · ⌘⇧Z rétablir · ⌘D dupliquer · ⌘G grouper · ⌘⇧G dissocier · flèches : décaler (⇧ ×10)</p></section>`;
}

const varsHelp = () => `<section><h4>Variables automatiques</h4><p class="hint"><code>{{atelier}}</code> <code>{{séquence}}</code> <code>{{niveau}}</code> <code>{{feuille}}</code> (01, 02… ou 01a/01b par partie) <code>{{partie}}</code> <code>{{page}}</code> <code>{{pages}}</code> <code>{{nom_feuille}}</code> <code>{{document}}</code> <code>{{date}}</code>, plus les colonnes du CSV.</p></section>`;

function bindDocProps(el: HTMLElement) {
  const d = store.doc;
  const all = () => (el.querySelector('[data-d="allpages"]') as HTMLInputElement | null)?.checked ?? false;
  const pages = () => (all() ? d.pages : [store.page]);
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-d]").forEach((inp) => {
    inp.onchange = () => {
      const k = inp.dataset.d!, v = inp.value;
      if (k === "name") store.commit(() => { d.name = v || "Sans titre"; });
      if (k === "preset" && v) { const [w, h] = v.split("x").map(Number); store.commit(() => pages().forEach((p) => { p.width = Math.round(fromMm(w)); p.height = Math.round(fromMm(h)); })); zoomToFit(); }
      if (k === "pw" || k === "ph") { const num = parseFloat(v.replace(",", ".")); if (num > 0) store.commit(() => pages().forEach((p) => { p[k === "pw" ? "width" : "height"] = Math.round(fromMm(num)); })); }
      if (k === "bg") mutate(() => pages().forEach((p) => { p.background = v; }));
    };
  });
  const bg = el.querySelector<HTMLInputElement>('[data-d="bg"]');
  if (bg) liveColor(bg, "bg");
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-f]").forEach((inp) => {
    inp.onchange = () => store.commit(() => { d.fields[inp.dataset.f!] = inp.value; });
  });
  el.querySelectorAll<HTMLInputElement>("[data-lc]").forEach((inp) => {
    inp.onchange = () => mutate(() => { d.levelColors[inp.dataset.lc!] = inp.value; });
    liveColor(inp, `lc:${inp.dataset.lc}`);
  });
  el.querySelectorAll<HTMLSelectElement>("[data-n]").forEach((inp) => {
    inp.onchange = () => store.commit(() => {
      const k = inp.dataset.n as "scheme" | "restart" | "suffix";
      (d.numbering as unknown as Record<string, string>)[k] = k === "suffix" ? inp.value.replace("\\t", "\t") : inp.value;
      // réglage manuel : on quitte les séparateurs propres à la variante de charte
      if (k !== "restart") { delete d.numbering.suffixes; delete d.numbering.prefix1; }
    });
  });
  el.querySelectorAll<HTMLInputElement>("[data-pf]").forEach((inp) => {
    inp.onchange = () => store.commit(() => {
      const p = store.page;
      p.fields ??= {};
      if (inp.value) p.fields[inp.dataset.pf!] = inp.value; else delete p.fields[inp.dataset.pf!];
    });
  });
  el.querySelectorAll<HTMLElement>("[data-p]").forEach((inp) => {
    const k = inp.dataset.p!;
    if (k === "detach") { inp.onclick = () => detachMaster(); return; }
    (inp as HTMLInputElement).onchange = () => {
      const v = (inp as HTMLInputElement).value;
      store.commit(() => {
        for (const p of k === "name" || k === "kind" ? [store.page] : pages()) {
          if (k === "name") p.name = v || p.name;
          if (k === "sections") p.sections = +v as 1 | 2 | 3;
          if (k === "split") p.split = v as "h" | "v";
          if (k === "master") p.master = v || null;
          if (k === "masterMode") p.masterMode = v as "sheet" | "each";
          if (k === "kind") p.kind = v as SheetKind;
        }
      });
    };
  });
  el.querySelectorAll<HTMLElement>("[data-m]").forEach((inp) => {
    if (inp.dataset.m === "done") { inp.onclick = () => { store.editingMaster = null; store.selection = []; store.emit("change"); }; return; }
    (inp as HTMLSelectElement).onchange = () => {
      const m = d.masters.find((x) => x.id === store.editingMaster)!;
      const l = m.layers.find((x) => x.id === inp.dataset.l);
      if (l) store.commit(() => { l.anchor = (inp as HTMLSelectElement).value as "top"; });
    };
  });
}

/** Copie les calques du gabarit dans la feuille (une fois par partie) et retire le gabarit. */
function detachMaster() {
  const p = store.page;
  const m = store.doc.masters.find((x) => x.id === p.master);
  if (!m) return;
  store.commit(() => {
    const areas = masterAreas(p);
    areas.forEach(({ rect: r, section: si }) => {
      for (const l of m.layers) {
        const s = r.w / m.width;
        const ty = l.anchor === "bottom" ? r.y + r.h - m.height * s : r.y;
        const c = cloneNode(l);
        c.name = `${l.name}${areas.length > 1 ? ` – partie ${si + 1}` : ""}`;
        c.anchor = undefined;
        c.transform = mulM([s, 0, 0, s, r.x, ty], c.transform);
        // variables de la partie figées ({{feuille}} 01a…)
        p.layers.unshift(c);
      }
    });
    p.master = null;
  });
}

// ------------------------------------------------------------------ données (publipostage)

function refreshData() {
  const el = $("#data");
  const d = store.doc.data;
  const vars = findVars(store.doc);
  const row = store.previewRow;
  el.innerHTML = `<div class="panel-head"><h3>Données &amp; série</h3><button data-a="csv" title="Importer un fichier CSV">Importer CSV</button></div>
    ${d.columns.length ? `<p class="hint">${d.rows.length} ligne(s). Cliquez une colonne pour l'insérer dans le texte en cours d'édition.</p>
    <div class="chips">${d.columns.map((c) => `<button class="chip ${vars.includes(c) ? "used" : ""}" data-col="${esc(c)}">{{${esc(c)}}}</button>`).join("")}</div>
    <div class="rownav"><button data-a="prev">◀</button><label class="chk"><input type="checkbox" data-a="preview" ${row !== null ? "checked" : ""}> Aperçu</label>
      <span>${row !== null ? `${row + 1} / ${d.rows.length}` : "—"}</span><button data-a="next">▶</button></div>
    <button class="primary" data-a="series">PDF de la série (${d.rows.length} exemplaire${d.rows.length > 1 ? "s" : ""})…</button>`
    : `<p class="hint">Écrivez des variables comme <code>{{prénom}}</code> dans vos textes, puis importez un CSV (export Pronote, tableur…) dont l'en-tête porte les mêmes noms : une fiche par ligne.</p>`}
    ${vars.length ? `<p class="hint">Variables du document : ${vars.map((v) => `<code class="${d.columns.includes(v) ? "ok" : "missing"}">${esc(v)}</code>`).join(" ")}</p>` : ""}`;
  el.querySelector<HTMLElement>('[data-a="csv"]')!.onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".csv,.tsv,.txt,text/csv";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      let text = new TextDecoder("utf-8").decode(buf);
      if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf); // exports Excel français
      const parsed = parseCsv(text);
      store.commit(() => { store.doc.data = parsed; store.previewRow = parsed.rows.length ? 0 : null; });
    };
    inp.click();
  };
  el.querySelectorAll<HTMLElement>("[data-col]").forEach((c) => {
    c.onmousedown = (e) => e.preventDefault();
    c.onclick = () => {
      const t = `{{${c.dataset.col}}}`;
      if (!insertAtCaret(t)) { navigator.clipboard?.writeText(t); c.classList.add("copied"); setTimeout(() => c.classList.remove("copied"), 900); }
    };
  });
  const nav = (d2: number) => { if (!d.rows.length) return; store.previewRow = ((store.previewRow ?? -d2) + d2 + d.rows.length) % d.rows.length; renderCanvas(); refreshData(); };
  el.querySelector<HTMLElement>('[data-a="prev"]')?.addEventListener("click", () => nav(-1));
  el.querySelector<HTMLElement>('[data-a="next"]')?.addEventListener("click", () => nav(1));
  el.querySelector<HTMLInputElement>('[data-a="preview"]')?.addEventListener("change", (e) => {
    store.previewRow = (e.target as HTMLInputElement).checked && d.rows.length ? 0 : null; renderCanvas(); refreshData();
  });
  el.querySelector<HTMLElement>('[data-a="series"]')?.addEventListener("click", () => document.dispatchEvent(new CustomEvent("pdf-dialog", { detail: { series: true } })));
}

