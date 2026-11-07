import "./style.css";
import { store, loadLocal, type Tool } from "./store";
import { initCanvas, setTool, zoomBy, zoomToFit, view, cancelInteraction, deleteActiveAnchor, insertImageNode, isTyping, finishPen } from "./canvas";
import { initPanels } from "./panels";
import { closeTextEditor, isEditingText, openTextEditor } from "./textedit";
import { copySelection, deleteSelection, duplicate, groupSelection, moveSelection, paste, ungroupSelection } from "./ops";
import { newDoc, newImage, uid } from "./model";
import { importAffinity } from "./io/afimport";
import { buildAffinityScript } from "./io/affinityExport";
import { download, exportSvg, parseNative, printPdf, saveNative } from "./io/export";
import type { PdfOptions } from "./io/pdfexport";
// pdf-lib et fontkit sont lourds : chargés seulement pour l'export PDF
const pdfModule = () => import("./io/pdfexport");
import { canLinkFiles, linkLocalImage, linkUrlImage, resolveLinks } from "./assets";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;

// ------------------------------------------------------------------ outils

const TOOLS: [Tool, string, string, string][] = [
  ["select", "V", "Sélection", "M4 2l14 9-6 1.5 3.5 7-2.6 1.3-3.5-7L4 18z"],
  ["node", "A", "Nœuds", "M5 3l13 8-6 1 3 6-2 1-3-6-5 4z M3 19h4v2H3z"],
  ["pen", "P", "Plume", "M12 2l6 10-6 10-6-10z M12 8v6 M3 22h18"],
  ["rect", "M", "Rectangle", "M4 5h16v14H4z"],
  ["ellipse", "E", "Ellipse", "M12 5c5 0 9 3 9 7s-4 7-9 7-9-3-9-7 4-7 9-7z"],
  ["line", "L", "Ligne", "M4 20L20 4"],
  ["text", "T", "Texte", "M5 5h14v3M12 5v14M9 19h6"],
  ["hand", "H", "Main", "M8 13V5a1.5 1.5 0 013 0v6-8a1.5 1.5 0 013 0v8-6a1.5 1.5 0 013 0v9c0 4-3 7-6.5 7S7 18 5 15l-2-3a1.5 1.5 0 012.5-1.5z"],
];

function buildToolbar() {
  const tb = $("#toolbar");
  tb.innerHTML = TOOLS.map(([t, k, label, d]) => `<button data-tool="${t}" title="${label} (${k})"><svg viewBox="0 0 24 24"><path d="${d}"/></svg></button>`).join("")
    + `<button data-cmd="image" title="Insérer une image"><svg viewBox="0 0 24 24"><path d="M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M15 9a1.5 1.5 0 100-.01"/></svg></button>`;
  tb.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool as Tool)));
  tb.querySelector<HTMLElement>('[data-cmd="image"]')!.onclick = (e) => imageMenu(e.currentTarget as HTMLElement);
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
      const { doc, report } = await importAffinity(await f.arrayBuffer(), f.name);
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
  open: async () => { const f = await pickFile(".af,.afdesign,.afpub,.afphoto,.json,.fiche"); if (f) await openFile(f); },
  save: () => { saveNative(store.doc); store.markSaved(); },
  pdf: () => pdfDialog(),
  print: () => printPdf(store.doc, [previewVars()]),
  svg: () => exportSvg(store.doc, store.pageIndex, previewVars()),
  affinity: async () => {
    status("Préparation du script Affinity…");
    const js = await buildAffinityScript(store.doc, previewVars());
    download(`${store.doc.name.replace(/[\\/:*?"<>|]+/g, "_")}.affinity.js`, js, "text/javascript");
    status("Script Affinity téléchargé : exécutez-le dans Affinity pour obtenir un .af natif.");
  },
  undo: () => store.undo(),
  redo: () => store.redo(),
  fit: () => zoomToFit(),
  zin: () => zoomBy(1.25),
  zout: () => zoomBy(0.8),
  z100: () => zoomBy((96 / store.doc.dpi) / view.zoom),
};

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
    el.innerHTML = store.tabs.map((t, i) => {
      const name = (i === store.activeTab ? store.doc : t.doc).name.replace(/</g, "&lt;");
      return `<div class="tab ${i === store.activeTab ? "on" : ""}" data-i="${i}" title="${name}"><span class="nm">${name}</span>${store.isDirty(i) ? `<span class="dot" title="Modifié depuis le dernier enregistrement">●</span>` : ""}<button data-x="${i}" title="Fermer">×</button></div>`;
    }).join("") + `<button class="tab-new" title="Nouveau document (onglet)">＋</button>`;
    el.querySelectorAll<HTMLElement>(".tab").forEach((t) => (t.onclick = (e) => {
      const x = (e.target as HTMLElement).dataset.x;
      closeTextEditor();
      if (x !== undefined) {
        const i = +x;
        const name = store.tabs[i]?.doc.name ?? "";
        if (store.isDirty(i) && !confirm(`Fermer « ${name} » ? Les modifications non enregistrées en .fiche.json seront perdues.`)) return;
        store.closeTab(i);
      } else store.switchTab(+t.dataset.i!);
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
  const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (arrows[k]) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * (store.doc.dpi / 25.4); // 1 mm, 10 mm avec Maj
    moveSelection(arrows[k][0] * step, arrows[k][1] * step);
    return;
  }
  const t = TOOLS.find(([, key]) => key.toLowerCase() === k);
  if (t) setTool(t[0]);
}

// ------------------------------------------------------------------ démarrage

async function start() {
  buildToolbar();
  buildTopbar();
  const saved = await loadLocal();
  const docs = (saved?.docs ?? []).filter((d) => d?.format === "fichestudio" && d.pages?.length);
  if (docs.length) store.restoreTabs(docs, saved!.active);
  else store.load(newDoc());
  initCanvas($("#stage"));
  initPanels();
  window.addEventListener("keydown", onKey);
  // glisser-déposer : .af, .fiche.json, images
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
  document.addEventListener("pdf-dialog", (e) => pdfDialog(!!(e as CustomEvent).detail?.series));
  // onglets Calques / Bibliothèque
  document.querySelectorAll<HTMLElement>("#left .tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll<HTMLElement>("#left .tabs button").forEach((x) => x.classList.toggle("on", x === b));
    $("#layers").hidden = b.dataset.tab !== "layers";
    $("#library").hidden = b.dataset.tab !== "library";
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
