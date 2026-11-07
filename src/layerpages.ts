// Calques -> feuilles : dans les fichiers d'atelier, chaque fiche est un calque d'une même
// page A4 (P01… pages, R01… ressources, FichePeda, PROF…). On en fait des feuilles séparées
// en ne gardant que celles qui intéressent.
import { store, assetTrash } from "./store";
import { newDoc, uid, walk, type Doc, type GroupNode, type Page, type SceneNode } from "./model";
import { cloneNode } from "./ops";

export interface LayerPagesOptions {
  layerIds: string[];
  corrections: "keep" | "hidden" | "remove"; // sous-calques « _Corr » (corrigés)
  removeSource: boolean;
  pruneAssets: boolean;
  target: "this" | "newTab";
}

/** Catégorie d'un calque d'après son nom (convention des ateliers). */
export function layerKind(name: string): "page" | "ressource" | "autre" {
  const n = name.toUpperCase();
  if (/(^|[_\s-])P\d{1,3}([_\s-]|$)/.test(n) || /(^|[_\s-])E\d{1,3}([_\s-]|$)/.test(n)) return "page";
  if (/(^|[_\s-])R\d{1,3}([_\s-]|$)/.test(n) || /RESSOURCE/.test(n)) return "ressource";
  return "autre";
}

const isCorrection = (n: SceneNode) => n.type === "group" && /(_|\s|^)corr(ig[ée])?(_|\s|$)/i.test(n.name);

/** Nom court de la feuille : « AT_Radar_P03 » -> « P03 » quand un préfixe commun existe. */
function shortNames(names: string[]): string[] {
  if (names.length < 2) return names;
  let pre = names[0];
  for (const n of names) while (!n.startsWith(pre)) pre = pre.slice(0, -1);
  pre = pre.slice(0, pre.lastIndexOf("_") + 1);
  return pre.length >= 3 ? names.map((n) => n.slice(pre.length) || n) : names;
}

/** Garde seulement les images encore utilisées (pages et gabarits). */
export function pruneAssets(doc: Doc): number {
  const used = new Set<string>();
  for (const p of [...doc.pages, ...doc.masters]) walk(p.layers, (n) => { if (n.type === "image") used.add(n.asset); });
  let removed = 0;
  for (const k of Object.keys(doc.assets)) if (!used.has(k)) { assetTrash[k] = doc.assets[k]; delete doc.assets[k]; removed++; }
  return removed;
}

function buildPages(src: Page, layers: GroupNode[], opts: LayerPagesOptions): Page[] {
  const names = shortNames(layers.map((l) => l.name));
  return layers.map((l, i) => {
    const layer = cloneNode(l);
    layer.visible = true;
    layer.isLayer = true;
    const prune = (g: GroupNode) => {
      g.children = g.children.filter((c) => !(opts.corrections === "remove" && isCorrection(c)));
      for (const c of g.children) {
        if (isCorrection(c)) c.visible = opts.corrections === "keep";
        if (c.type === "group") prune(c);
      }
    };
    prune(layer);
    return {
      ...structuredClone({ ...src, layers: [] }),
      id: uid("p"),
      name: names[i],
      layers: [layer],
      fields: { ...(src.fields ?? {}) },
    };
  });
}

/** Convertit les calques choisis de la feuille courante. Renvoie un résumé. */
export function layersToPages(opts: LayerPagesOptions): string {
  const src = store.page;
  const layers = src.layers.filter((l) => opts.layerIds.includes(l.id));
  if (!layers.length) return "Aucun calque choisi.";
  const pages = buildPages(src, layers, opts);
  if (opts.target === "newTab") {
    const d = store.doc;
    const nd: Doc = {
      ...newDoc(`${d.name} (sélection)`),
      dpi: d.dpi, masters: structuredClone(d.masters), fields: { ...d.fields }, levelColors: { ...d.levelColors },
      numbering: { ...d.numbering }, assets: structuredClone(d.assets), pages,
    };
    nd.fields.atelier = d.fields.atelier ?? d.name;
    const removed = opts.pruneAssets ? pruneAssets(nd) : 0;
    store.openTab(nd);
    return `${pages.length} feuille(s) dans un nouvel onglet${removed ? `, ${removed} image(s) inutilisée(s) retirée(s)` : ""}.`;
  }
  let removed = 0;
  store.commit(() => {
    const i = store.doc.pages.indexOf(src);
    store.doc.pages.splice(i + 1, 0, ...pages);
    if (opts.removeSource) store.doc.pages.splice(i, 1);
    if (opts.pruneAssets) removed = pruneAssets(store.doc);
    store.pageIndex = opts.removeSource ? i : i + 1;
    store.selection = [];
    store.activeLayer = null;
  }, "doc");
  return `${pages.length} feuille(s) créée(s)${opts.removeSource ? ", feuille d'origine retirée" : ""}${removed ? `, ${removed} image(s) inutilisée(s) retirée(s)` : ""}.`;
}

// ------------------------------------------------------------------ boîte de dialogue

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function layerPagesDialog(done: (msg: string) => void) {
  document.querySelector(".modal")?.remove();
  const page = store.page;
  const layers = [...page.layers];
  const kinds = layers.map((l) => layerKind(l.name));
  const label = { page: "Page", ressource: "Ressource", autre: "Autre" };
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<form class="modal-card wide">
    <h3>Calques → feuilles</h3>
    <p class="hint">Chaque calque coché devient une feuille, nommée d'après le calque. Les calques sont pris dans l'ordre du document.</p>
    <div class="btnrow wrap">
      <button type="button" data-q="page">Pages (P…, E…)</button><button type="button" data-q="ressource">Ressources (R…)</button>
      <button type="button" data-q="visible">Calques visibles</button><button type="button" data-q="all">Tout</button><button type="button" data-q="none">Aucun</button></div>
    <ul class="layer-pick">${layers.map((l, i) => {
      let objs = 0; walk(l.children, () => { objs++; });
      return `<li><label><input type="checkbox" value="${l.id}" ${kinds[i] !== "autre" ? "checked" : ""}>
        <span class="kind k-${kinds[i]}">${label[kinds[i]]}</span><span class="nm">${esc(l.name)}</span>
        <small>${l.visible ? "" : "masqué · "}${objs} objet(s)</small></label></li>`;
    }).join("")}</ul>
    <fieldset><legend>Options</legend>
      <label>Corrigés (sous-calques « _Corr ») :
        <select name="corr"><option value="hidden">gardés, masqués</option><option value="keep">gardés, visibles</option><option value="remove">retirés</option></select></label>
      <label><input type="checkbox" name="prune" checked> Retirer les images qui ne servent plus <small>allège le fichier</small></label>
      <label><input type="radio" name="target" value="this" checked> Dans ce document</label>
      <label class="indent"><input type="checkbox" name="remove" checked> Retirer la feuille d'origine</label>
      <label><input type="radio" name="target" value="newTab"> Dans un nouvel onglet <small>le document d'origine reste intact</small></label>
    </fieldset>
    <div class="btnrow end"><span class="count"></span><span class="spacer"></span><button type="button" data-k="cancel">Annuler</button><button type="submit" class="primary-inline">Créer les feuilles</button></div>
  </form>`;
  document.body.appendChild(box);
  const f = box.querySelector("form")!;
  const checks = [...f.querySelectorAll<HTMLInputElement>(".layer-pick input")];
  const count = () => { box.querySelector(".count")!.textContent = `${checks.filter((c) => c.checked).length} calque(s) choisi(s)`; };
  checks.forEach((c) => (c.onchange = count));
  count();
  f.querySelectorAll<HTMLElement>("[data-q]").forEach((b) => (b.onclick = () => {
    const q = b.dataset.q!;
    // un 2e clic sur « Pages » ou « Ressources » décoche le groupe
    const allOn = checks.every((c, j) => kinds[j] !== q || c.checked);
    checks.forEach((c, i) => {
      if (q === "all") c.checked = true;
      else if (q === "none") c.checked = false;
      else if (q === "visible") c.checked = layers[i].visible;
      else if (kinds[i] === q) c.checked = !allOn;
    });
    count();
  }));
  box.querySelector<HTMLElement>('[data-k="cancel"]')!.onclick = () => box.remove();
  f.onsubmit = (e) => {
    e.preventDefault();
    const ids = checks.filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return;
    const msg = layersToPages({
      layerIds: ids,
      corrections: (f.elements.namedItem("corr") as HTMLSelectElement).value as LayerPagesOptions["corrections"],
      removeSource: (f.elements.namedItem("remove") as HTMLInputElement).checked,
      pruneAssets: (f.elements.namedItem("prune") as HTMLInputElement).checked,
      target: (f.elements.namedItem("target") as RadioNodeList).value as LayerPagesOptions["target"],
    });
    box.remove();
    done(msg);
  };
}
