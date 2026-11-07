import "./style.css";
import { store, loadLocal, type Tool } from "./store";
import { enterIsolation, exitIsolation, isIsolated } from "./canvas";
import { initCanvas, setTool, zoomBy, zoomToFit, zoomToWidth, view, cancelInteraction, deleteActiveAnchor, insertImageNode, isTyping, finishPen } from "./canvas";
import { loadCharteInit, prefsDialog } from "./prefs";
import { hasCharteMasters, updateCharteMasters } from "./charte";
import { openPresentSpace, initPresentSpace } from "./presentspace";
import { docBrowser } from "./docbrowser";
import { showCharte, checkCharteDialog, variantDialog } from "./charteview";
import { initPanels, refreshCompetencesPanel, tablePicker, templatePicker, copyCharteToLayers } from "./panels";
import { closeTextEditor, isEditingText, openTextEditor } from "./textedit";
import { copySelection, deleteSelection, duplicate, groupSelection, moveSelection, paste, ungroupSelection } from "./ops";
import { newDoc, newImage, uid } from "./model";
import { renderPage } from "./render";
import { importAffinity } from "./io/afimport";
import { buildAffinityScript } from "./io/affinityExport";
import { download, exportSvg, parseNative, printPdf, saveNative } from "./io/export";
import type { PdfOptions } from "./io/pdfexport";
// pdf-lib et fontkit sont lourds : chargés seulement pour l'export PDF
const pdfModule = () => import("./io/pdfexport");
import { canLinkFiles, linkLocalImage, linkUrlImage, resolveLinks } from "./assets";
import { layerPagesDialog } from "./layerpages";
import { startPresentation, isPresenting } from "./present";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

// ------------------------------------------------------------------ outils

// Barre d'outils : groupes séparés (sélection · dessin · texte · insertion), icônes au trait de 24 px
type TBItem = { tool?: Tool; cmd?: string; key?: string; label: string; d: string };
const TOOL_GROUPS: { name: string; items: TBItem[] }[] = [
  { name: "Sélection", items: [
    { tool: "select", key: "V", label: "Sélection", d: "M5.5 3.5 18 10.6l-5.4 1.5-3.1 5.6z M12.6 12.1l4.6 4.6" },
    { tool: "node", key: "A", label: "Nœuds (modifier les points)", d: "M5 3.5 15.5 9.3l-4.5 1.3-2.6 4.6z M14.5 14.5h5v5h-5z M5 20.5h0" },
    { tool: "hand", key: "H", label: "Main (déplacer la vue)", d: "M8 12.5V6a1.4 1.4 0 0 1 2.8 0v5 M10.8 10.5V4.6a1.4 1.4 0 0 1 2.8 0v5.9 M13.6 10.5V5.8a1.4 1.4 0 0 1 2.8 0v5.7 M16.4 11.5V8.6a1.4 1.4 0 0 1 2.8 0V14c0 4-2.8 7-6.6 7-2.6 0-4.2-1.2-5.6-3.3L4.6 14a1.5 1.5 0 0 1 2.4-1.8l1 1.3" },
  ] },
  { name: "Dessin", items: [
    { tool: "pen", key: "P", label: "Plume (courbes)", d: "M12 3.5 17 12l-5 8.5L7 12z M12 3.5v7 M12 12.6a1.1 1.1 0 1 0 0 .01 M4 21h16" },
    { tool: "line", key: "L", label: "Ligne", d: "M5.5 18.5 18.5 5.5 M5.5 18.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0 M18.5 5.5m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0" },
    { tool: "rect", key: "M", label: "Rectangle", d: "M6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9A2.5 2.5 0 0 1 6.5 5z" },
    { tool: "ellipse", key: "E", label: "Ellipse", d: "M12 5c4.7 0 8.5 3.1 8.5 7s-3.8 7-8.5 7-8.5-3.1-8.5-7 3.8-7 8.5-7z" },
  ] },
  { name: "Texte", items: [
    { tool: "text", key: "T", label: "Texte", d: "M5 7V4.5h14V7 M12 4.5v15 M9 19.5h6" },
  ] },
  { name: "Insertion", items: [
    { cmd: "templates", label: "Modèles et blocs de la charte", d: "M5 4h14a1 1 0 0 1 1 1v3.5H4V5a1 1 0 0 1 1-1z M4 11.5h7.5V20H5a1 1 0 0 1-1-1z M14.5 11.5H20V19a1 1 0 0 1-1 1h-4.5z" },
    { cmd: "table", label: "Tableau à la charte", d: "M5 4.5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z M4 9.5h16 M4 14.5h16 M9.5 4.5v15 M14.5 4.5v15" },
    { cmd: "image", label: "Image", d: "M5 4.5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z M4 16l4.5-4.5 4 4 2.5-2.5 5 5 M15.5 9a1.5 1.5 0 1 0 0 .01" },
  ] },
];

function buildToolbar() {
  const tb = $("#toolbar");
  const btn = (it: TBItem) => `<button ${it.tool ? `data-tool="${it.tool}"` : `data-cmd="${it.cmd}"`} title="${it.label}${it.key ? ` — ${it.key}` : ""}" aria-label="${it.label}">
    <svg viewBox="0 0 24 24"><path d="${it.d}"/></svg>${it.key ? `<span class="k">${it.key}</span>` : ""}</button>`;
  tb.innerHTML = TOOL_GROUPS.map((g) => `<div class="tb-group" role="group" aria-label="${g.name}">${g.items.map(btn).join("")}</div>`).join(`<div class="tb-sep"></div>`);
  tb.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
  tb.querySelector<HTMLElement>('[data-cmd="image"]')!.onclick = (e) => imageMenu(e.currentTarget as HTMLElement);
  tb.querySelector<HTMLElement>('[data-cmd="templates"]')!.onclick = (e) => templatePicker(e.currentTarget as HTMLElement);
  tb.querySelector<HTMLElement>('[data-cmd="table"]')!.onclick = (e) => tablePicker(e.currentTarget as HTMLElement);
  const sync = () => tb.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === store.tool));
  store.on(sync);
  sync();
}

// ------------------------------------------------------------------ fichiers

function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file"; i.accept = accept;
    i.onchange = () => res(i.files?.[0] ?? null);
    i.click();
  });
}

async function openFile(f: File) {
  status(`Ouverture de ${f.name}…`);
  try {
    if (/\.(af|afdesign|afpub|afphoto)$/i.test(f.name)) {
      const { doc, report } = await importAffinity(await f.arrayBuffer(), f.name, { dir: (f as File & { fsDir?: string }).fsDir });
      if (!doc.pages.length) throw new Error("aucune page trouvée");
      store.openTab(doc);
      checkLinks();
      const w = Object.entries(report.warnings);
      status(`${f.name} importé${w.length ? ` — non repris : ${w.map(([k, n]) => `${k} (${n})`).join(", ")}` : ""}`);
    } else {
      store.openTab(parseNative(await f.text()));
      status(`${f.name} ouvert`);
      checkLinks();
    }
    zoomToFit();
  } catch (e) {
    console.error(e);
    status(`Impossible d'ouvrir ${f.name} : ${(e as Error).message}`, true);
  }
}

async function pickImage() {
  const f = await pickFile("image/*");
  if (f) await addImageFile(f);
}

/** Insérer une image : intégrée (copiée dans le document) ou liée (référence externe enregistrée). */
function imageMenu(anchor: HTMLElement) {
  document.querySelector(".pop-menu")?.remove();
  const m = document.createElement("div");
  m.className = "pop-menu menu-body";
  m.innerHTML = `<button data-k="embed">Intégrer une image…<small>copiée dans le document</small></button>
    <button data-k="file" ${canLinkFiles() ? "" : "disabled"}>Lier une image du disque…<small>${canLinkFiles() ? "le document garde seulement la référence" : "non disponible dans ce navigateur (Chrome, Edge)"}</small></button>
    <button data-k="url">Lier une image par URL…<small>image en ligne (https://…)</small></button>`;
  const r = anchor.getBoundingClientRect();
  m.style.left = `${r.right + 6}px`; m.style.top = `${r.top}px`;
  document.body.appendChild(m);
  m.onclick = async (e) => {
    const k = (e.target as HTMLElement).closest("button")?.dataset.k;
    m.remove();
    try {
      if (k === "embed") await pickImage();
      if (k === "file") { const r2 = await linkLocalImage(store.doc); if (r2) insertImageNode(newImage(r2.key, r2.w, r2.h, r2.name)); status(`Image liée : ${r2?.name}`); }
      if (k === "url") {
        const url = prompt("Adresse de l'image (https://…)");
        if (url) { const r2 = await linkUrlImage(store.doc, url.trim()); insertImageNode(newImage(r2.key, r2.w, r2.h, r2.name)); status(`Image liée : ${url}`); }
      }
    } catch (err) { if ((err as Error).name !== "AbortError") status(`Image : ${(err as Error).message}`, true); }
  };
  setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target as Node)) { m.remove(); document.removeEventListener("click", off); } }), 0);
}

/** Les images liées à des fichiers du disque demandent une autorisation par session. */
async function checkLinks(interactive = false) {
  const blocked = await resolveLinks(store.doc, interactive);
  if (blocked) {
    status(`${blocked} image(s) liée(s) attendent votre autorisation.`, false, { label: "Autoriser l'accès", run: () => checkLinks(true) });
  } else if (interactive) { status("Images liées accessibles."); }
  store.emit("change");
}

// ------------------------------------------------------------------ PDF intelligent

function pdfDialog(series = false) {
  document.querySelector(".modal")?.remove();
  const d = store.doc;
  const multi = d.pages.some((p) => (p.sections ?? 1) > 1);
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<form class="modal-card">
    <h3>Exporter en PDF</h3>
    <fieldset><legend>Découpage des fichiers</legend>
      <label><input type="radio" name="split" value="single" checked> Un seul PDF avec toutes les feuilles <small>pour l'impression</small></label>
      <label><input type="radio" name="split" value="sheet"> Un PDF par feuille <small>nommé d'après la feuille</small></label>
      <label ${multi ? "" : "class=\"dim\""}><input type="radio" name="split" value="section" ${multi ? "" : "disabled"}> Un PDF par partie de feuille <small>${multi ? "chaque partie découpée à son format" : "aucune feuille découpée"}</small></label>
    </fieldset>
    <fieldset><legend>Contenu</legend>
      <label><input type="checkbox" name="series" ${series ? "checked" : ""} ${d.data.rows.length ? "" : "disabled"}> Un exemplaire par ligne de données <small>${d.data.rows.length ? `${d.data.rows.length} ligne(s) du CSV` : "aucun CSV importé"}</small></label>
      <label><input type="checkbox" name="cut" checked> Lignes de découpe entre les parties</label>
      <label><input type="checkbox" name="fonts" checked> Intégrer les polices de l'ordinateur <small>Chrome/Edge le demandent une fois</small></label>
      <div class="fontrow"><span class="fontlist">Polices…</span><button type="button" data-k="addfonts" title="Ajouter des fichiers .ttf / .otf (ex. /System/Library/Fonts/Supplemental/Arial Narrow.ttf)">Ajouter des polices…</button></div>
    </fieldset>
    <label class="fld wide"><span>Nom des fichiers</span><input name="pattern" value="{document}"></label>
    <p class="hint">Champs : {document} {nom_feuille} {feuille} {partie} {atelier} {séquence} {niveau} et les colonnes du CSV (ex. {prénom}).</p>
    <label class="chk"><input type="checkbox" name="zip" checked> Regrouper plusieurs fichiers dans un ZIP</label>
    <p class="progress"></p>
    <div class="btnrow end"><button type="button" data-k="print" title="Impression directe par le navigateur">Imprimer…</button><span class="spacer"></span>
      <button type="button" data-k="cancel">Annuler</button><button type="submit" class="primary-inline">Exporter</button></div>
  </form>`;
  document.body.appendChild(box);
  const f = box.querySelector("form")!;
  const pat = f.elements.namedItem("pattern") as HTMLInputElement;
  const defaults: Record<string, string> = { single: "{document}", sheet: "{document} - {nom_feuille}", section: "{document} - {nom_feuille} - partie {partie}" };
  f.querySelectorAll<HTMLInputElement>('input[name="split"], input[name="series"]').forEach((r) => (r.onchange = () => {
    const split = (f.elements.namedItem("split") as RadioNodeList).value;
    const ser = (f.elements.namedItem("series") as HTMLInputElement).checked && split !== "single";
    const col = d.data.columns[0];
    pat.value = defaults[split] + (ser && col ? ` - {${col}}` : "");
  }));
  box.querySelector<HTMLElement>('[data-k="cancel"]')!.onclick = () => box.remove();
  const showFonts = async () => {
    const rep = await (await pdfModule()).fontReport(d);
    box.querySelector<HTMLElement>(".fontlist")!.innerHTML = rep.map((r) => `<span class="${r.ok ? "ok" : "missing"}" title="${r.ok ? "disponible" : "non trouvée : ajoutez le fichier ou autorisez les polices de l'ordinateur"}">${r.ok ? "✓" : "?"} ${r.font}</span>`).join(" ") || "aucun texte";
  };
  showFonts();
  box.querySelector<HTMLElement>('[data-k="addfonts"]')!.onclick = () => {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = true; i.accept = ".ttf,.otf";
    i.onchange = async () => {
      const added = await (await pdfModule()).addUserFonts(Array.from(i.files ?? []));
      box.querySelector<HTMLElement>(".progress")!.textContent = `Polices ajoutées : ${added.join(", ")}`;
      showFonts();
    };
    i.click();
  };
  box.querySelector<HTMLElement>('[data-k="print"]')!.onclick = () => {
    const ser = (f.elements.namedItem("series") as HTMLInputElement).checked;
    box.remove();
    printPdf(d, ser ? d.data.rows : [previewVars()]);
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const opts: PdfOptions = {
      split: (f.elements.namedItem("split") as RadioNodeList).value as PdfOptions["split"],
      series: (f.elements.namedItem("series") as HTMLInputElement).checked,
      pattern: pat.value || "{document}",
      zip: (f.elements.namedItem("zip") as HTMLInputElement).checked,
      cutMarks: (f.elements.namedItem("cut") as HTMLInputElement).checked,
      systemFonts: (f.elements.namedItem("fonts") as HTMLInputElement).checked,
    };
    const prog = box.querySelector<HTMLElement>(".progress")!;
    f.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      const warns = await (await pdfModule()).exportPdf(d, opts, (m) => (prog.textContent = m));
      box.remove();
      status(`PDF exporté${warns.length ? ` — ${warns.join(" ; ")}` : "."}`, false);
    } catch (err) {
      console.error(err);
      prog.textContent = `Erreur : ${(err as Error).message}`;
      f.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  };
}

async function addImageFile(f: File) {
  const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(f); });
  const img = new Image();
  img.src = data;
  await img.decode();
  const key = uid("a");
  store.doc.assets[key] = { mime: f.type, data, name: f.name };
  insertImageNode(newImage(key, img.naturalWidth, img.naturalHeight, f.name));
}

const previewVars = () => (store.previewRow !== null ? store.doc.data.rows[store.previewRow] ?? null : null);

const ACTIONS: Record<string, () => void | Promise<void>> = {
  new: () => { closeTextEditor(); store.openTab(newDoc()); },
  open: async () => { const f = await pickFile(".fstudio,.af,.afdesign,.afpub,.afphoto,.json,.fiche"); if (f) await openFile(f); },
  save: () => { saveNative(store.doc); store.markSaved(); },
  pdf: () => pdfDialog(),
  pdfseries: () => pdfDialog(true),
  print: () => printPdf(store.doc, [previewVars()]),
  svg: () => exportSvg(store.doc, store.pageIndex, previewVars()),
  affinity: async () => {
    status("Préparation du script Affinity…");
    const js = await buildAffinityScript(store.doc, previewVars());
    download(`${store.doc.name.replace(/[\\/:*?"<>|]+/g, "_")}.affinity.js`, js, "text/javascript");
    status("Script Affinity téléchargé : exécutez-le dans Affinity pour obtenir un .af natif.");
  },
  present: () => { closeTextEditor(); store.editingMaster = null; startPresentation(); },
  presentmenu: () => { closeTextEditor(); store.editingMaster = null; openPresentSpace(); },
  docs: () => docBrowser(openFile),
  l2p: () => { if (!store.editingMaster) layerPagesDialog((msg) => status(msg)); },
  charte: () => showCharte(),
  chartecheck: () => checkCharteDialog(),
  chartevariant: () => variantDialog(),
  chartecopy: () => copyCharteToLayers(),
  charteprefs: () => prefsDialog((update) => {
    if (update && hasCharteMasters(store.doc)) store.commit(() => { updateCharteMasters(store.doc); }, "doc");
  }),
  undo: () => store.undo(),
  redo: () => store.redo(),
  fit: () => zoomToFit(),
  zoommenu: () => {
    document.querySelector(".pop-menu")?.remove();
    const btn = $("#zoom");
    const m = document.createElement("div");
    m.className = "pop-menu menu-body";
    // pourcentage affiché = taille réelle à l'écran (96 ppp CSS)
    const real = (z: number) => (96 / store.doc.dpi) * z;
    m.innerHTML = `<button data-z="fit">Ajuster à la fenêtre <kbd>⌘0</kbd></button><button data-z="width">Pleine largeur</button><hr>`
      + [0.25, 0.5, 0.75, 1, 1.5, 2, 4].map((z) => `<button data-z="${z}">${Math.round(z * 100)} %</button>`).join("");
    const r = btn.getBoundingClientRect();
    m.style.left = `${r.left}px`; m.style.top = `${r.bottom + 4}px`;
    document.body.appendChild(m);
    m.onclick = (e) => {
      const z = (e.target as HTMLElement).closest("button")?.dataset.z;
      m.remove();
      if (z === "fit") zoomToFit();
      else if (z === "width") zoomToWidth();
      else if (z) zoomBy(real(+z) / view.zoom);
    };
    setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target as Node)) { m.remove(); document.removeEventListener("click", off); } }), 0);
  },
  zin: () => zoomBy(1.25),
  zout: () => zoomBy(0.8),
  z100: () => zoomBy((96 / store.doc.dpi) / view.zoom),
};

// ------------------------------------------------------------------ onglets de documents

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** Nom lisible : « AT_Les-objets-connectes-du-quotidien-2 » -> « Les objets connectes du quotidien 2 ». */
const shortName = (n: string) => n.replace(/^(AT|EVAL|FICHE)[_-]+/i, "").replace(/[_-]+/g, " ").trim() || n;
/** Pastille de couleur d'après le type de la première feuille (atelier, ressource, évaluation…). */
const tabIcon = (d: { pages: { kind?: string }[] }) => {
  const k = d.pages[0]?.kind ?? "fiche";
  const c: Record<string, string> = { fiche: "#118eff", ressource: "#ff8c00", evalres: "#ff8c00", eval: "#ff4f44", synthese: "#cb64ff", peda: "#ffdc00", prof: "#ffdc00" };
  return `<i style="background:${c[k] ?? "#118eff"}"></i>`;
};
function closeTabAsk(i: number) {
  const name = (i === store.activeTab ? store.doc : store.tabs[i]?.doc)?.name ?? "";
  if (store.isDirty(i) && !confirm(`Fermer « ${name} » ? Les modifications non enregistrées (fichier .fstudio) seront perdues.`)) return;
  store.closeTab(i);
}

/** Aperçu au survol d'un onglet : la feuille affichée dans ce document, son nom complet, ses feuilles. */
let peekTimer = 0;
function peekSoon(tab: HTMLElement, i: number) {
  clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => peekShow(tab, i), 320);
}
function peekHide() { clearTimeout(peekTimer); document.querySelector("#tab-peek")?.remove(); }
function peekShow(tab: HTMLElement, i: number) {
  const t = store.tabs[i];
  if (!t) return;
  const active = i === store.activeTab;
  const doc = active ? store.doc : t.doc;
  const pi = Math.min(active ? store.pageIndex : t.pageIndex, doc.pages.length - 1);
  const page = doc.pages[pi];
  let svg = "";
  try {
    const { defs, body } = renderPage(doc, page, { cutMarks: false });
    svg = `<svg viewBox="0 0 ${page.width} ${page.height}" preserveAspectRatio="xMidYMid meet"><defs>${defs}</defs>${body}</svg>`;
  } catch { /* aperçu indisponible */ }
  let p = document.querySelector<HTMLElement>("#tab-peek");
  if (!p) { p = document.createElement("div"); p.id = "tab-peek"; document.body.appendChild(p); }
  p.innerHTML = `<div class="tp-thumb">${svg}</div><div class="tp-info"><b>${esc(doc.name)}</b>
    <span>${doc.pages.length} feuille(s) · ${esc(page.name)}${active ? " · document affiché" : ""}</span>
    ${store.isDirty(i) ? `<span class="tp-dirty">● modifications non enregistrées</span>` : ""}</div>`;
  const r = tab.getBoundingClientRect();
  p.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 268))}px`;
  p.style.top = `${r.bottom + 6}px`;
}

/** Liste de tous les documents ouverts (utile quand les onglets sont nombreux). */
function tabList(anchor: HTMLElement) {
  document.querySelector(".pop-menu")?.remove();
  const m = document.createElement("div");
  m.className = "pop-menu menu-body tab-menu";
  m.innerHTML = store.tabs.map((t, i) => {
    const d = i === store.activeTab ? store.doc : t.doc;
    return `<button data-i="${i}" class="${i === store.activeTab ? "on" : ""}"><span class="ti">${tabIcon(d)}</span><span class="nm">${esc(shortName(d.name))}<small>${esc(d.name)} · ${d.pages.length} feuille(s)${store.isDirty(i) ? " · ● modifié" : ""}</small></span><span class="x" data-x="${i}" title="Fermer">×</span></button>`;
  }).join("");
  const r = anchor.getBoundingClientRect();
  document.body.appendChild(m);
  m.style.top = `${r.bottom + 4}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
  const close = () => { m.remove(); document.removeEventListener("mousedown", off); };
  const off = (e: MouseEvent) => { if (!m.contains(e.target as Node) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener("mousedown", off), 0);
  m.onclick = (e) => {
    const t = e.target as HTMLElement;
    const x = t.closest<HTMLElement>("[data-x]");
    const b = t.closest<HTMLElement>("[data-i]");
    close();
    if (x) closeTabAsk(+x.dataset.x!);
    else if (b) { closeTextEditor(); store.switchTab(+b.dataset.i!); }
  };
}

function buildTopbar() {
  document.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
    b.onclick = () => { b.closest("details")?.removeAttribute("open"); ACTIONS[b.dataset.act!]?.(); };
  });
  document.addEventListener("view", () => { $("#zoom").textContent = `${Math.round(view.zoom * (store.doc.dpi / 96) * 100)} %`; });
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details[open]").forEach((d) => { if (!d.contains(e.target as Node)) d.removeAttribute("open"); });
  });
  const tabs = () => {
    document.title = `${store.doc.name} — FicheStudio`;
    const el = $("#tabs");
    el.innerHTML = `<div class="tabs-row">${store.tabs.map((t, i) => {
      const d = i === store.activeTab ? store.doc : t.doc;
      return `<div class="tab ${i === store.activeTab ? "on" : ""}" data-i="${i}" aria-label="${esc(d.name)}"><span class="ti">${tabIcon(d)}</span><span class="nm">${esc(shortName(d.name))}</span>${store.isDirty(i) ? `<span class="dot" title="Modifié depuis le dernier enregistrement">●</span>` : ""}<button data-x="${i}" title="Fermer (clic du milieu)">×</button></div>`;
    }).join("")}</div><button class="tab-list" title="Tous les documents ouverts">▾ ${store.tabs.length}</button><button class="tab-new" title="Nouveau document (onglet)">＋</button>`;
    el.querySelectorAll<HTMLElement>(".tab").forEach((t) => {
      t.onmouseenter = () => peekSoon(t, +t.dataset.i!);
      t.onmouseleave = () => peekHide();
      t.onauxclick = (e) => { if (e.button === 1) { e.preventDefault(); closeTabAsk(+t.dataset.i!); } };
    });
    el.querySelector<HTMLElement>(".tab-list")!.onclick = (e) => tabList(e.currentTarget as HTMLElement);
    el.querySelector<HTMLElement>(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.querySelectorAll<HTMLElement>(".tab").forEach((t) => (t.onclick = (e) => {
      const x = (e.target as HTMLElement).dataset.x;
      closeTextEditor();
      peekHide();
      if (x !== undefined) closeTabAsk(+x);
      else store.switchTab(+t.dataset.i!);
    }));
    el.querySelector<HTMLElement>(".tab-new")!.onclick = () => ACTIONS.new();
  };
  store.on(tabs);
  tabs();
  // exemples : fichiers du dossier samples/ (listés par le serveur de développement)
  const fileMenu = document.querySelector<HTMLDetailsElement>("details.menu")!;
  fileMenu.addEventListener("toggle", async () => {
    if (!fileMenu.open) return;
    const box = $("#samples-list");
    let list: string[] = [];
    try { list = await (await fetch("__samples")).json(); } catch { /* version publiée : pas de liste */ }
    box.innerHTML = list.length
      ? list.map((f) => `<button data-sample="${f.replace(/"/g, "&quot;")}">${f.replace(/</g, "&lt;")}</button>`).join("")
      : `<small class="none">Dossier samples/ vide ou indisponible (exemples accessibles avec « npm run dev »).</small>`;
    box.querySelectorAll<HTMLElement>("[data-sample]").forEach((b) => (b.onclick = async () => {
      fileMenu.open = false;
      const name = b.dataset.sample!;
      const blob = await (await fetch(`samples/${encodeURIComponent(name)}`)).blob();
      await openFile(new File([blob], name));
    }));
  });
}

let statusTimer = 0;
function status(msg: string, error = false, action?: { label: string; run: () => void }) {
  const s = $("#status");
  s.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = action.run;
    s.append(" ", b);
  }
  s.classList.toggle("err", error);
  clearTimeout(statusTimer);
  if (!action) statusTimer = window.setTimeout(() => (s.textContent = ""), error ? 12000 : 8000);
}

// ------------------------------------------------------------------ clavier

function onKey(e: KeyboardEvent) {
  if (isPresenting()) return;
  if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) { e.preventDefault(); ACTIONS.present(); return; }
  if (isEditingText() || isTyping()) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === "z") { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
  if (mod && k === "y") { e.preventDefault(); store.redo(); return; }
  if (mod && k === "s") { e.preventDefault(); saveNative(store.doc); store.markSaved(); return; }
  if (mod && k === "o") { e.preventDefault(); ACTIONS.open(); return; }
  if (mod && k === "p") { e.preventDefault(); ACTIONS.pdf(); return; }
  if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
  if (mod && k === "c") { copySelection(); return; }
  if (mod && k === "x") { copySelection(); deleteSelection(); return; }
  if (mod && k === "v") { paste(); return; }
  if (mod && k === "g") { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
  if (mod && k === "a") { e.preventDefault(); store.select(store.layer().children.filter((c) => c.visible && !c.locked).map((c) => c.id)); return; }
  if (mod && (k === "=" || k === "+")) { e.preventDefault(); zoomBy(1.25); return; }
  if (mod && k === "-") { e.preventDefault(); zoomBy(0.8); return; }
  if (mod && k === "0") { e.preventDefault(); zoomToFit(); return; }
  if (mod) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (!deleteActiveAnchor()) deleteSelection(); return; }
  if (e.key === "Escape") {
    if (isIsolated() && !store.selection.length && !cancelInteraction()) { exitIsolation(); return; }
    if (!cancelInteraction()) {
      if (!store.selection.length && store.editingMaster) { store.editingMaster = null; store.emit("change"); }
      else store.select([]);
    }
    setTool("select");
    return;
  }
  if (e.key === "Enter") {
    if (store.tool === "pen") { finishPen(); return; }
    const n = store.selected()[0];
    if (n?.type === "text") { e.preventDefault(); openTextEditor(n.id); }
    return;
  }
  // I : vue isolée de la sélection (ou du calque actif), I à nouveau pour revenir à la vue complète
  if (k === "i" && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (isIsolated()) exitIsolation(); else enterIsolation(store.selection.length ? store.selection : [store.layer().id]);
    return;
  }
  const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k]) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (store.doc.dpi / 25.4); // 1 mm, 10 mm avec Maj
    moveSelection(arrows[k][0] * step, arrows[k][1] * step);
    return;
  }
  const t = TOOL_GROUPS.flatMap((g) => g.items).find((it) => it.tool && it.key?.toLowerCase() === k);
  if (t?.tool) setTool(t.tool);
}

// ------------------------------------------------------------------ panneaux redimensionnables

function initResizers() {
  const LIMITS = { left: [170, 520, 230], right: [240, 600, 300] } as const;
  const set = (side: "left" | "right", w: number) => {
    const [min, max] = LIMITS[side];
    w = Math.round(Math.max(min, Math.min(max, w)));
    document.body.style.setProperty(`--${side}-w`, `${w}px`);
    try { localStorage.setItem(`fs-${side}-w`, String(w)); } catch { /* stockage indisponible */ }
    place();
  };
  // poignées hors des panneaux (dont le contenu déborde masqué), posées sur leur bordure
  const handles: [HTMLElement, HTMLElement, "left" | "right"][] = [];
  const place = () => {
    for (const [h, panel, side] of handles) {
      const r = panel.getBoundingClientRect();
      Object.assign(h.style, { top: `${r.top}px`, height: `${r.height}px`, left: `${(side === "left" ? r.right : r.left) - 4}px` });
    }
  };
  window.addEventListener("resize", place);
  for (const side of ["left", "right"] as const) {
    try { const v = localStorage.getItem(`fs-${side}-w`); if (v) set(side, +v); } catch { /* idem */ }
    const panel = $(`#${side}`);
    const h = document.createElement("div");
    h.className = "resizer";
    h.title = "Glisser pour élargir · double-clic : largeur par défaut";
    document.body.appendChild(h);
    handles.push([h, panel, side]);
    h.onpointerdown = (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      h.classList.add("drag");
      document.body.classList.add("resizing");
      const x0 = e.clientX, w0 = panel.getBoundingClientRect().width;
      h.onpointermove = (ev) => set(side, side === "left" ? w0 + ev.clientX - x0 : w0 - (ev.clientX - x0));
      h.onpointerup = () => {
        h.onpointermove = null;
        h.classList.remove("drag");
        document.body.classList.remove("resizing");
        window.dispatchEvent(new Event("resize"));
        zoomToFit(); // la page reste entièrement visible
      };
    };
    h.ondblclick = () => { set(side, LIMITS[side][2]); window.dispatchEvent(new Event("resize")); zoomToFit(); };
  }
  requestAnimationFrame(place);
}

// ------------------------------------------------------------------ démarrage

async function start() {
  buildToolbar();
  buildTopbar();
  initPresentSpace(openFile);
  await loadCharteInit(); // préférences de la charte avant de créer ou restaurer les documents
  const saved = await loadLocal();
  const docs = (saved?.docs ?? []).filter((d) => d?.format === "fichestudio" && d.pages?.length);
  if (docs.length) store.restoreTabs(docs, saved!.active);
  else store.load(newDoc());
  initCanvas($("#stage"));
  initPanels();
  window.addEventListener("keydown", onKey);
  // glisser-déposer : .af, .fstudio (ou ancien .fiche.json), images
  const stage = $("#stage");
  stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("drop"); });
  stage.addEventListener("dragleave", () => stage.classList.remove("drop"));
  stage.addEventListener("drop", async (e) => {
    e.preventDefault();
    stage.classList.remove("drop");
    for (const f of Array.from(e.dataTransfer?.files ?? [])) {
      if (f.type.startsWith("image/")) await addImageFile(f);
      else await openFile(f);
    }
  });
  window.addEventListener("beforeunload", () => closeTextEditor());
  initResizers();
  document.addEventListener("pdf-dialog", (e) => pdfDialog(!!(e as CustomEvent).detail?.series));
  document.addEventListener("status", (e) => status(String((e as CustomEvent).detail)));
  // onglets Calques / Compétences (la bibliothèque est dans la fenêtre Modèles)
  document.querySelectorAll<HTMLElement>("#left .tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll<HTMLElement>("#left .tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("#layers").hidden = b.dataset.tab !== "layers";
    $("#competences").hidden = b.dataset.tab !== "competences";
    if (b.dataset.tab === "competences") refreshCompetencesPanel();
  }));
  // bandeau du mode gabarit
  store.on(() => {
    const banner = $("#master-banner");
    const m = store.doc.masters.find((x) => x.id === store.editingMaster);
    banner.hidden = !m;
    if (m) banner.innerHTML = `Modification du gabarit <b>${m.name.replace(/</g, "&lt;")}</b> — ajouté à chaque partie des feuilles qui l'utilisent. <button>Terminer</button>`;
    banner.querySelector("button")?.addEventListener("click", () => { store.editingMaster = null; store.emit("change"); });
  });
  checkLinks();
  status("Prêt. Glissez un fichier .af ou une image sur la page.");
}

start();

// accès de débogage (développement uniquement)
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__fs = { store, ops: { moveSelection }, view, zoomBy, applyZoom: (z: number, x: number, y: number) => { view.zoom = z; view.x = x; view.y = y; zoomBy(1); } };
