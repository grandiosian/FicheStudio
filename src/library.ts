// Bibliothèque de blocs réutilisables (barres d'atelier, pastilles, titres numérotés…)
// et gabarits prédéfinis. Les blocs personnels sont gardés dans le navigateur (IndexedDB).
import {
  defaultStroke, newGroup, newLayer, newParagraph, newShape, NONE, solid, uid, walk,
  type Asset, type Doc, type GroupNode, type Master, type Run, type SceneNode, type TextNode,
} from "./model";
import { charteBlocks, CUT, type CharteVariant } from "./charte";

export interface LibItem {
  id: string;
  name: string;
  kind: "objects" | "layer";
  /** Placement sur une feuille de 2480 px de large : y mesuré depuis le haut ou le bas de la partie. */
  place: { x: number; y: number; from: "top" | "bottom" | "center" };
  nodes: SceneNode[];
  assets: Record<string, Asset>;
  builtin?: boolean;
}

const BLUE = "#2f57a1", BAND = "#c9d4f4", INK = "#10213f";
const run = (text: string, font: string, size: number, color = BLUE, weight = 400): Run =>
  ({ text, font, size, weight, italic: false, underline: false, color, opacity: 1 });

function textBox(x: number, y: number, w: number, h: number, runs: Run[][], align: "left" | "center" | "right" = "left", name = "Texte"): TextNode {
  return {
    id: uid(), name, visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0], type: "text",
    frame: { x, y, w, h }, paragraphs: runs.map((r) => newParagraph(r, align)),
  };
}

/** Pastille ronde dont la couleur suit le niveau de la classe ({{niveau}}). */
function pastille(x: number, y: number, d: number): SceneNode[] {
  const c = newShape("ellipse", x, y, d, d);
  c.name = "Pastille"; c.fill = solid("#fcca30"); c.stroke = defaultStroke(0); c.bind = { fill: "couleur_niveau" };
  const size = d * 0.56;
  const t = textBox(x, y + d / 2 - size * 0.358, d, size, [[run("{{niveau}}", "Arial Black", size, INK, 900)]], "center", "Niveau");
  return [c, t];
}

function band(x: number, y: number, w: number, h: number, r: number, name = "Bandeau") {
  const b = newShape("rect", x, y, w, h);
  b.name = name; b.fill = solid(BAND); b.stroke = defaultStroke(0); b.radius = [r, r, r, r];
  return b;
}

function topBar(): SceneNode[] {
  return [
    band(60, 45, 2360, 75, 37),
    textBox(110, 67, 1250, 60, [[run("{{entete}} - {{atelier}}", "Arial Black", 42, BLUE, 900)]], "left", "Titre de l'atelier"),
    textBox(1150, 70, 1050, 50, [[run("{{séquence}} - Feuille {{feuille}}", "Arial", 34, BLUE)]], "right", "Séquence et feuille"),
    ...pastille(2290, 25, 115),
  ];
}

function bottomBar(): SceneNode[] {
  // repère local : haut du bandeau en y = 0
  const t = textBox(95, 8, 670, 60, [
    [run("{{entete}} - {{atelier}}", "Arial Black", 22, BLUE, 900)],
    [run("FIN Feuille {{feuille}}", "Arial", 22, BLUE, 700), run(" - {{séquence}}", "Arial", 22, BLUE)],
  ], "left", "Fin de feuille");
  return [band(0, 0, 780, 70, 12), ...pastille(18, 7, 56), t];
}

const translateNodes = (nodes: SceneNode[], dx: number, dy: number) => {
  for (const n of nodes) { n.transform = [n.transform[0], n.transform[1], n.transform[2], n.transform[3], n.transform[4] + dx, n.transform[5] + dy]; }
  return nodes;
};

function heading(level: 1 | 2 | 3): SceneNode[] {
  const size = level === 1 ? 62.5 : level === 2 ? 52 : 46;
  const t = textBox(0, 0, 2200, size * 1.4, [[run(level === 1 ? "Titre de la partie" : level === 2 ? "Question" : "Sous-question", "Arial Narrow", size, BLUE, level < 3 ? 700 : 400)]], "left", `Titre ${level}`);
  t.paragraphs[0].level = level;
  return [t];
}

function answerLines(n = 4): SceneNode[] {
  const out: SceneNode[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: uid(), name: "Ligne de réponse", visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0],
      type: "path", subpaths: [{ closed: false, points: [{ x: 0, y: i * 80 }, { x: 2200, y: i * 80 }] }],
      fill: NONE, stroke: { paint: solid(BLUE), width: 4, dash: [0.01, 3], cap: "round", join: "round" },
    });
  }
  return [newGroup(out, "Lignes de réponse")];
}

function consigne(): SceneNode[] {
  const b = band(0, 0, 2200, 170, 30, "Encadré");
  b.fill = solid("#eef1f7"); b.stroke = defaultStroke(5, BLUE);
  const t = textBox(40, 35, 2120, 110, [[run("Consigne : ", "Arial Narrow", 50, BLUE, 700), run("décrire ici ce que l'élève doit faire.", "Arial Narrow", 50, BLUE)]]);
  return [newGroup([b, t], "Encadré consigne")];
}

function cutLine(): SceneNode[] {
  return [{
    id: uid(), name: "Ligne de découpe", visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0],
    type: "path", subpaths: [{ closed: false, points: [{ x: 0, y: 0 }, { x: 2480, y: 0 }] }],
    fill: NONE, stroke: { paint: solid(CUT.color), width: CUT.width, dash: CUT.dash, cap: "round", join: "round" },
  }];
}

export function builtinItems(variant?: CharteVariant): LibItem[] {
  const mk = (name: string, nodes: SceneNode[], place: LibItem["place"], kind: LibItem["kind"] = "objects"): LibItem =>
    ({ id: `builtin:${name}`, name, kind, place, nodes, assets: {}, builtin: true });
  return [
    mk("Barre haute d'atelier", [newGroup(topBar(), "Barre haute")], { x: 0, y: 0, from: "top" }),
    mk("Barre basse d'atelier", [newGroup(bottomBar(), "Barre basse")], { x: 1640, y: 115, from: "bottom" }),
    mk("Pastille de niveau", [newGroup(pastille(0, 0, 115), "Pastille")], { x: 1182, y: 0, from: "center" }),
    mk("Titre de partie (numéroté)", heading(1), { x: 140, y: 230, from: "top" }),
    mk("Question (numérotée)", heading(2), { x: 140, y: 330, from: "top" }),
    mk("Sous-question (numérotée)", heading(3), { x: 200, y: 420, from: "top" }),
    mk("Lignes de réponse", answerLines(), { x: 140, y: 0, from: "center" }),
    mk("Encadré consigne", consigne(), { x: 140, y: 0, from: "center" }),
    mk("Ligne de découpe", cutLine(), { x: 0, y: 0, from: "center" }),
    ...charteBlocks(variant).map((b) => mk(`Charte · ${b.name}`, b.nodes, { x: b.x, y: 0, from: "center" })),
  ];
}

/** Gabarit « Atelier » : barre haute et barre basse, ajoutées à chaque partie de chaque feuille. */
export function atelierMaster(width = 2480, height = 3508): Master {
  const top = newLayer("Haut");
  top.anchor = "top";
  top.children = [newGroup(topBar(), "Barre haute")];
  const bottom = newLayer("Bas");
  bottom.anchor = "bottom";
  bottom.children = translateNodes([newGroup(bottomBar(), "Barre basse")], 1640, height - 115);
  return { id: uid("m"), name: "Atelier", width, height, layers: [top, bottom] };
}

export function emptyMaster(width = 2480, height = 3508): Master {
  const top = newLayer("Haut"); top.anchor = "top";
  const bottom = newLayer("Bas"); bottom.anchor = "bottom";
  return { id: uid("m"), name: "Gabarit", width, height, layers: [top, bottom] };
}

// ------------------------------------------------------------------ blocs personnels

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("fichestudio-lib", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function userItems(): Promise<LibItem[]> {
  try {
    const db = await idb();
    return await new Promise((res) => { const r = db.transaction("items").objectStore("items").getAll(); r.onsuccess = () => res(r.result ?? []); r.onerror = () => res([]); });
  } catch { return []; }
}

export async function saveItem(item: LibItem) {
  const db = await idb();
  await new Promise((res) => { const t = db.transaction("items", "readwrite"); t.objectStore("items").put(item); t.oncomplete = res; t.onerror = res; });
}

export async function deleteItem(id: string) {
  const db = await idb();
  await new Promise((res) => { const t = db.transaction("items", "readwrite"); t.objectStore("items").delete(id); t.oncomplete = res; t.onerror = res; });
}

/** Copie des nœuds avec de nouveaux identifiants, et images rattachées au document cible. */
export function instantiate(item: LibItem, doc: Doc): SceneNode[] {
  const remap: Record<string, string> = {};
  for (const [k, a] of Object.entries(item.assets)) {
    const nk = uid("a");
    doc.assets[nk] = structuredClone(a);
    remap[k] = nk;
  }
  const nodes = structuredClone(item.nodes);
  walk(nodes, (n) => { n.id = uid(); if (n.type === "image" && remap[n.asset]) n.asset = remap[n.asset]; });
  return nodes;
}

export function assetsOf(nodes: SceneNode[], doc: Doc): Record<string, Asset> {
  const out: Record<string, Asset> = {};
  walk(nodes, (n) => { if (n.type === "image" && doc.assets[n.asset]) out[n.asset] = structuredClone(doc.assets[n.asset]); });
  return out;
}

export type { GroupNode };
