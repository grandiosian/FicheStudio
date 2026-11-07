// Réimport du fichier Affinity d'origine dans le document ouvert : le contenu venu d'Affinity est
// remplacé par un import neuf (le lecteur .af progresse), ce qui a été ajouté dans FicheStudio est
// gardé — calques et éléments créés après l'import, compétences, étapes, étiquettes, visibilité,
// gabarits et réglages du document.
import { importAffinity } from "./io/afimport";
import { walk, type Doc, type GroupNode, type Page, type SceneNode } from "./model";
import { assetTrash, store } from "./store";

const AF = /\.(af|afdesign|afpub|afphoto)$/i;

/** Date de création d'un élément, lue dans son identifiant (préfixe + Date.now() en base 36). */
function idTime(id: string): number {
  const t = parseInt(id.replace(/^[a-z]/, "").slice(0, 8), 36);
  return Number.isFinite(t) ? t : 0;
}

/** Moment de l'import d'un ancien document (sans « source ») : le plus ancien identifiant. */
function importTime(doc: Doc): number {
  if (doc.source?.importedAt) return doc.source.importedAt;
  let t = Infinity;
  for (const p of doc.pages) walk(p.layers, (n) => { const v = idTime(n.id); if (v > 1e12 && v < t) t = v; });
  return t === Infinity ? Date.now() : t;
}

/** Fichier .af d'origine : dossier connu, sinon dossier local de l'explorateur de documents, sinon on le demande. */
async function findSource(doc: Doc, pick: () => Promise<File | null>): Promise<File | null> {
  const local = async (root: string, rel: string) => {
    const r = await fetch(`__localdocs/file?root=${encodeURIComponent(root)}&rel=${encodeURIComponent(rel)}`).catch(() => null);
    if (!r?.ok) return null;
    const f = new File([await r.blob()], rel.split("/").pop()!) as File & { fsDir?: string };
    f.fsDir = `${root}/${rel}`.replace(/\/[^/]*$/, "");
    return f;
  };
  if (doc.source?.dir) {
    const f = await local(doc.source.dir, doc.source.name);
    if (f) return f;
  }
  let root = "";
  try { root = localStorage.getItem("fichestudio.localDir") ?? ""; } catch { /* rien */ }
  if (root) {
    const r = await fetch(`__localdocs/list?root=${encodeURIComponent(root)}`).then((x) => x.json()).catch(() => null);
    const want = (doc.source?.name ?? "").toLowerCase();
    const hit = (r?.files as { name: string; path: string }[] | undefined)?.find((e) =>
      AF.test(e.name) && (e.name.toLowerCase() === want || e.name.replace(AF, "") === doc.name));
    if (hit) {
      const f = await local(r.root, hit.path + hit.name);
      if (f) return f;
    }
  }
  return pick();
}

/** Reporte sur l'élément réimporté ce qu'on lui a ajouté dans FicheStudio, et y remet les éléments créés après l'import. */
function carry(from: SceneNode, to: SceneNode, after: number): number {
  if (from.comp?.length) to.comp = [...from.comp];
  if (from.step) to.step = true;
  if (from.tag) to.tag = from.tag;
  to.visible = from.visible;
  to.locked = from.locked;
  if (from.type !== "group" || to.type !== "group") return 0;
  if (from.isLayer) { to.isLayer = true; if (from.anchor) to.anchor = from.anchor; }
  const pool = [...to.children];
  let kept = 0;
  from.children.forEach((c, i) => {
    if (idTime(c.id) > after) { to.children.splice(Math.min(i, to.children.length), 0, c); kept++; return; }
    const k = pool.findIndex((o) => o.name === c.name && o.type === c.type);
    if (k >= 0) { kept += carry(c, pool[k], after); pool.splice(k, 1); }
  });
  return kept;
}

/** Fusion : feuilles et calques réimportés, appariés par position et par nom. */
export function mergeReimport(old: Doc, fresh: Doc): { pages: Page[]; kept: number } {
  const after = importTime(old) + 60_000; // créé plus d'une minute après l'import : ajouté à la main
  let kept = 0;
  const pages = fresh.pages.map((np, i) => {
    const op = old.pages[i];
    if (!op) return np;
    const pool = [...np.layers];
    const layers: GroupNode[] = [...np.layers];
    op.layers.forEach((l, j) => {
      if (idTime(l.id) > after) { layers.splice(Math.min(j, layers.length), 0, l); kept++; return; }
      const k = pool.findIndex((o) => o.name === l.name);
      if (k >= 0) { kept += carry(l, pool[k], after); pool.splice(k, 1); }
    });
    return { ...np, layers, id: op.id, name: op.name, sections: op.sections, split: op.split, master: op.master, masterMode: op.masterMode, fields: op.fields };
  });
  // feuilles ajoutées dans FicheStudio
  for (const p of old.pages.slice(fresh.pages.length)) { pages.push(p); kept++; }
  return { pages, kept };
}

/** Réimporte le document actif ; renvoie un message pour la barre d'état. */
export async function reimportAffinity(pick: () => Promise<File | null>): Promise<string> {
  const old = store.doc;
  const file = await findSource(old, pick);
  if (!file) return "Réimport annulé.";
  if (!AF.test(file.name)) return "Choisissez un fichier Affinity (.af).";
  if (!confirm(`Réimporter « ${old.name} » depuis ${file.name} ?\n\nLe contenu venu d'Affinity est remplacé par un import à jour (les retouches faites sur ces éléments sont perdues). Vos calques et éléments ajoutés, compétences, étapes, gabarits et réglages sont gardés. ⌘Z pour revenir.`)) return "Réimport annulé.";
  const { doc: fresh } = await importAffinity(await file.arrayBuffer(), file.name, { dir: (file as File & { fsDir?: string }).fsDir });
  const { pages, kept } = mergeReimport(old, fresh);
  // images : celles du nouvel import + celles encore utilisées par les éléments gardés
  const used = new Set<string>();
  for (const p of pages) walk(p.layers, (n) => { if (n.type === "image") used.add(n.asset); });
  store.commit(() => {
    // (les images retirées passent à la corbeille du magasin : ⌘Z les retrouve)
    for (const k of Object.keys(old.assets)) if (!used.has(k)) { assetTrash[k] = old.assets[k]; delete old.assets[k]; }
    Object.assign(old.assets, fresh.assets);
    old.pages = pages;
    old.source = fresh.source;
    store.pageIndex = Math.min(store.pageIndex, pages.length - 1);
    store.selection = []; store.scope = null; store.activeLayer = null;
  }, "doc");
  return `« ${old.name} » réimporté depuis ${file.name}${kept ? ` — ${kept} élément(s) ajouté(s) dans FicheStudio conservé(s)` : ""} (⌘Z pour revenir).`;
}
