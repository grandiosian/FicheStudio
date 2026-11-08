// Modèle de document de FicheStudio.
// Unités : pixels à la résolution du document (comme Affinity), A4 à 300 ppp = 2480 × 3508.

export type Mat = [number, number, number, number, number, number]; // SVG : a b c d e f
export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export interface Stop { offset: number; color: string; opacity: number }

export type Paint =
  | { type: "none" }
  | { type: "solid"; color: string; opacity: number }
  | { type: "linear"; angle: number; stops: Stop[] }
  | { type: "radial"; stops: Stop[] };

export interface Stroke {
  paint: Paint;
  width: number;
  dash: number[] | null; // en multiples de l'épaisseur, comme Affinity
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  arrowStart?: ArrowHead; // pointe de flèche au début / à la fin d'un chemin ouvert
  arrowEnd?: ArrowHead;
}
/** Pointe de flèche (styles Affinity) ; taille proportionnelle à l'épaisseur du trait. */
export interface ArrowHead { style: "barbed" | "triangle"; sx: number; sy: number }

/** Modes de fusion (noms CSS) ; équivalents PDF et Affinity (nom dans BlendMode du SDK). */
export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "color-dodge" | "color-burn"
  | "hard-light" | "soft-light" | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";
export const BLEND_MODES: { id: BlendMode; label: string; pdf: string; af: string }[] = [
  { id: "normal", label: "Normal", pdf: "Normal", af: "Normal" },
  { id: "multiply", label: "Produit", pdf: "Multiply", af: "Multiply" },
  { id: "screen", label: "Superposition (écran)", pdf: "Screen", af: "Screen" },
  { id: "overlay", label: "Incrustation", pdf: "Overlay", af: "Overlay" },
  { id: "darken", label: "Obscurcir", pdf: "Darken", af: "Darken" },
  { id: "lighten", label: "Éclaircir", pdf: "Lighten", af: "Lighten" },
  { id: "color-dodge", label: "Densité couleur −", pdf: "ColorDodge", af: "ColourDodge" },
  { id: "color-burn", label: "Densité couleur +", pdf: "ColorBurn", af: "ColourBurn" },
  { id: "hard-light", label: "Lumière crue", pdf: "HardLight", af: "HardLight" },
  { id: "soft-light", label: "Lumière tamisée", pdf: "SoftLight", af: "SoftLight" },
  { id: "difference", label: "Différence", pdf: "Difference", af: "Difference" },
  { id: "exclusion", label: "Exclusion", pdf: "Exclusion", af: "Exclusion" },
  { id: "hue", label: "Teinte", pdf: "Hue", af: "Hue" },
  { id: "saturation", label: "Saturation", pdf: "Saturation", af: "Saturation" },
  { id: "color", label: "Couleur", pdf: "Color", af: "Colour" },
  { id: "luminosity", label: "Luminosité", pdf: "Luminosity", af: "Luminosity" },
];

interface Base {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  transform: Mat;
  tag?: string | null;   // couleur d'étiquette (calques, groupes)
  step?: boolean;        // étape de correction : révélée pas à pas en présentation
  comp?: string[];       // compétences travaillées (codes du BO : T1C11…), calques et groupes
  blend?: BlendMode;     // mode de fusion avec ce qui est dessous (absent = normal)
}

export interface Vec { x: number; y: number }
export interface Anchor extends Vec {
  in?: Vec;   // poignée entrante (absolue, repère local)
  out?: Vec;  // poignée sortante
  smooth?: boolean;
}
export interface SubPath { closed: boolean; points: Anchor[] }

/** Couleur liée à une variable (ex. « couleur_niveau » pour la pastille de classe). */
export interface Binding { fill?: string; stroke?: string }

export interface PathNode extends Base {
  type: "path";
  subpaths: SubPath[];
  fill: Paint;
  stroke: Stroke;
  bind?: Binding;
}

export type ShapeKind = "rect" | "ellipse" | "triangle" | "diamond" | "arrow";
export interface ShapeNode extends Base {
  type: "shape";
  kind: ShapeKind;
  x: number; y: number; w: number; h: number;
  radius: [number, number, number, number]; // px, coins HG HD BD BG (rect)
  corner?: "round" | "chamfer";              // forme des coins (rect) : arrondis par défaut, ou coupés
  param: number;                            // triangle/losange : position du sommet ; flèche : épaisseur
  head?: [number, number];                  // flèche : longueur de la pointe et décalage de sa base (× hauteur, comme Affinity)
  fill: Paint;
  stroke: Stroke;
  bind?: Binding;
}

export interface Run {
  text: string;
  font: string;
  size: number;      // px
  weight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  opacity: number;
  leading?: number;  // interligne imposé par ces caractères (px) : la ligne prend le plus grand
  tracking?: number; // interlettrage, en fraction du corps (comme Affinity : -0,05 = resserré)
}
export interface Paragraph {
  align: "left" | "center" | "right" | "justify";
  lineHeight: number;   // interligne relatif à l'interligne idéal de la police (comme Affinity ; 1 = normal)
  leading?: number;     // interligne absolu exact (px) : prioritaire sur lineHeight (« Exactement » dans Affinity)
  spaceBefore: number;  // px
  spaceAfter: number;
  leftIndent?: number;  // px
  rightIndent?: number;
  firstIndent?: number; // retrait de 1re ligne (négatif = retrait suspendu, listes à puces)
  tabStop?: number;     // pas des tabulations par défaut
  tabs?: number[];      // taquets de tabulation explicites (px depuis le bord du cadre), avant le pas par défaut
  level?: 0 | 1 | 2 | 3; // titre numéroté (nomenclature des ateliers)
  runs: Run[];
}
export interface TextNode extends Base {
  type: "text";
  frame: { x: number; y: number; w: number; h: number } | null; // null = texte artistique (origine = ligne de base)
  paragraphs: Paragraph[];
  valign?: "top" | "middle" | "bottom"; // position verticale du texte dans le cadre (haut par défaut)
  noWrap?: boolean;   // texte artistique d'Affinity : le cadre place le texte mais ne le coupe pas
  hideOverflow?: boolean; // lignes qui dépassent le bas du cadre masquées (comme Affinity)
}

export interface ImageNode extends Base {
  type: "image";
  asset: string;     // clé dans Doc.assets
  w: number; h: number;
}

export interface GroupNode extends Base {
  type: "group";
  children: SceneNode[];
  mask: SceneNode | null; // forme qui découpe les enfants (et qui est peinte dessous)
  isLayer?: boolean;
  /** Calque de gabarit : position dans chaque partie de feuille. */
  anchor?: "top" | "bottom" | "none";
}

export type SceneNode = PathNode | ShapeNode | TextNode | ImageNode | GroupNode;

export interface Page {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string | null;
  layers: GroupNode[];
  /** Découpage de la feuille : 1 = pleine page, 2 ou 3 parties séparées par une ligne de découpe. */
  sections?: 1 | 2 | 3;
  split?: "h" | "v";        // h : parties empilées ; v : côte à côte
  master?: string | null;   // gabarit de la feuille
  /** « sheet » : gabarit posé une fois sur la feuille entière (titre seulement en haut de la 1re partie) ;
   *  « each » : répété dans chaque partie. */
  masterMode?: "sheet" | "each";
  fields?: Record<string, string>; // variables propres à la feuille (titre, séance…)
  kind?: SheetKind;
}

/** Types de feuille d'un atelier (charte des ateliers) : numérotation, en-tête, couleur d'étiquette, ordre. */
export type SheetKind = "peda" | "prof" | "fiche" | "ressource" | "synthese" | "eval" | "evalres";
export const SHEET_KINDS: Record<SheetKind, { label: string; prefix: string; entete: string; tag: string; order: number }> = {
  peda: { label: "Fiche pédagogique", prefix: "FichePeda", entete: "FICHE PÉDAGOGIQUE", tag: "#ffdc00", order: 0 },
  prof: { label: "Fiche professeur", prefix: "PROF", entete: "FICHE PROFESSEUR", tag: "#ffdc00", order: 1 },
  fiche: { label: "Feuille d'atelier", prefix: "P", entete: "ATELIER", tag: "#118eff", order: 2 },
  ressource: { label: "Ressource", prefix: "R", entete: "RESSOURCE", tag: "#ff8c00", order: 3 },
  synthese: { label: "Synthèse", prefix: "S", entete: "SYNTHÈSE", tag: "#cb64ff", order: 4 },
  eval: { label: "Évaluation", prefix: "E", entete: "ÉVALUATION", tag: "#ff4f44", order: 5 },
  evalres: { label: "Ressource d'évaluation", prefix: "R", entete: "RESSOURCE D'ÉVALUATION", tag: "#ff8c00", order: 6 },
};

/** Prochain nom libre pour un type de feuille : P01, R02, E01, ER01… */
export function nextSheetName(pages: Page[], kind: SheetKind): string {
  const pre = SHEET_KINDS[kind].prefix;
  if (kind === "peda" || kind === "prof") return pre; // une seule par atelier
  const re = new RegExp(`(^|[_\\s-])${pre}(\\d+)$`, "i");
  const n = Math.max(0, ...pages.map((p) => { const m = p.name.match(re); return m ? +m[2] : 0; })) + 1;
  return `${pre}${String(n).padStart(2, "0")}`;
}

export interface Master {
  id: string;
  name: string;
  width: number;   // taille de la partie pour laquelle il est dessiné
  height: number;
  layers: GroupNode[];
}

/** Image intégrée (data) ou liée (référence externe enregistrée dans le fichier). */
export interface Asset {
  mime: string;
  name: string;
  data?: string;                                   // dataURL si intégrée
  link?: { kind: "url"; url: string } | { kind: "file"; handle: string; path: string };
  w?: number; h?: number;
}

export type NumberingScheme = "decimal" | "roman" | "alpha" | "letters";
export interface Numbering {
  scheme: NumberingScheme; restart: "doc" | "page" | "section"; suffix: string;
  prefix1?: string;                    // devant les numéros de niveau 1 (« Chapitre »)
  suffixes?: [string, string, string]; // séparateur propre à chaque niveau (sinon suffix)
  bold?: boolean;                      // numéro en gras
}

export interface Doc {
  format: "fichestudio";
  version: 2;
  name: string;
  dpi: number;
  pages: Page[];
  masters: Master[];
  assets: Record<string, Asset>;
  data: { columns: string[]; rows: Record<string, string>[] }; // données de publipostage
  fields: Record<string, string>;     // variables du document (atelier, séquence, niveau…)
  levelColors: Record<string, string>; // couleur de pastille par niveau de classe
  numbering: Numbering;
  /** Variante de disposition de la charte (numérotation et titres). */
  charte?: string;
  /** Fichier Affinity d'origine (pour le réimporter) : nom, dossier sur le Mac s'il est connu, date d'import. */
  source?: { name: string; dir?: string; importedAt: number };
}

// ------------------------------------------------------------------ fabriques

let counter = 0;
export function uid(prefix = "n"): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const base = (name: string): Base => ({ id: uid(), name, visible: true, locked: false, opacity: 1, transform: [...IDENTITY] });

export const solid = (color: string, opacity = 1): Paint => ({ type: "solid", color, opacity });
export const NONE: Paint = { type: "none" };
export const defaultStroke = (width = 0, color = "#1e2a44"): Stroke =>
  ({ paint: width ? solid(color) : NONE, width, dash: null, cap: "round", join: "round" });

export function newLayer(name = "Calque"): GroupNode {
  return { ...base(name), type: "group", children: [], mask: null, isLayer: true };
}

export function newGroup(children: SceneNode[], name = "Groupe"): GroupNode {
  return { ...base(name), type: "group", children, mask: null };
}

export function newShape(kind: ShapeKind, x: number, y: number, w: number, h: number): ShapeNode {
  return {
    ...base({ rect: "Rectangle", ellipse: "Ellipse", triangle: "Triangle", diamond: "Losange", arrow: "Flèche" }[kind]),
    type: "shape", kind, x, y, w, h, radius: [0, 0, 0, 0], param: kind === "arrow" ? 0.4 : 0.5,
    fill: solid("#c9d4f4"), stroke: defaultStroke(6, "#2f57a1"),
  };
}

export function newPath(subpaths: SubPath[], name = "Courbe"): PathNode {
  return { ...base(name), type: "path", subpaths, fill: NONE, stroke: defaultStroke(6, "#2f57a1") };
}

export const defaultRun = (text = ""): Run => ({
  text, font: "Arial", size: 50, weight: 400, italic: false, underline: false, color: "#1e2a44", opacity: 1,
});

export const newParagraph = (runs: Run[], align: Paragraph["align"] = "left"): Paragraph =>
  ({ align, lineHeight: 1, spaceBefore: 0, spaceAfter: 0, leftIndent: 0, rightIndent: 0, firstIndent: 0, tabStop: 50, level: 0, runs });

export function newText(frame: TextNode["frame"], text = "Texte"): TextNode {
  return { ...base("Texte"), type: "text", frame, paragraphs: text.split("\n").map((t) => newParagraph([defaultRun(t)])) };
}

export function newImage(asset: string, w: number, h: number, name: string): ImageNode {
  return { ...base(name), type: "image", asset, w, h };
}

export function newPage(width = 2480, height = 3508, name = "Page 1"): Page {
  return { id: uid("p"), name, width, height, background: "#ffffff", layers: [newLayer("Calque 1")], sections: 1, split: "h", master: null, masterMode: "sheet", fields: {} };
}

// couleurs de pastille de niveau de la charte (5e vert, 4e jaune, 3e rouge)
export const DEFAULT_LEVEL_COLORS: Record<string, string> = { "5": "#30c700", "4": "#fcca30", "3": "#d82834" };

export function newDoc(name = "Sans titre"): Doc {
  return {
    format: "fichestudio", version: 2, name, dpi: 300, pages: [newPage()], masters: [], assets: {},
    data: { columns: [], rows: [] },
    fields: { atelier: name, "séquence": "", niveau: "5" },
    levelColors: { ...DEFAULT_LEVEL_COLORS },
    numbering: { scheme: "decimal", restart: "doc", suffix: " " },
  };
}

/** Met à niveau un document enregistré par une version antérieure. */
export function upgradeDoc(d: Doc): Doc {
  const v = (d as { version: number }).version;
  d.masters ??= [];
  d.fields ??= { atelier: d.name, "séquence": "", niveau: "5" };
  d.levelColors ??= { ...DEFAULT_LEVEL_COLORS };
  d.numbering ??= { scheme: "decimal", restart: "doc", suffix: " " };
  d.data ??= { columns: [], rows: [] };
  d.assets ??= {};
  for (const p of [...d.pages, ...d.masters.map((m) => ({ layers: m.layers }))]) {
    walk(p.layers, (n) => {
      if (n.type === "text" && v < 2)
        for (const para of n.paragraphs) if (para.lineHeight === 1.2) para.lineHeight = 1; // ancien interligne = 1,2 × corps
    });
  }
  for (const p of d.pages) { p.sections ??= 1; p.split ??= "h"; p.master ??= null; p.fields ??= {}; p.masterMode ??= "sheet"; }
  d.version = 2;
  return d;
}

// ------------------------------------------------------------------ parcours

export function walk(nodes: SceneNode[], fn: (n: SceneNode, parent: GroupNode | null) => void, parent: GroupNode | null = null) {
  for (const n of nodes) {
    fn(n, parent);
    if (n.type === "group") {
      if (n.mask) fn(n.mask, n);
      walk(n.children, fn, n);
    }
  }
}

export function findNode(page: { layers: GroupNode[] }, id: string): { node: SceneNode; parent: GroupNode; index: number } | null {
  const visit = (g: GroupNode): ReturnType<typeof findNode> => {
    for (let i = 0; i < g.children.length; i++) {
      const c = g.children[i];
      if (c.id === id) return { node: c, parent: g, index: i };
      if (c.type === "group") {
        const r = visit(c);
        if (r) return r;
      }
    }
    return null;
  };
  for (const l of page.layers) {
    const r = visit(l);
    if (r) return r;
  }
  return null;
}

export function plainText(t: TextNode): string {
  return t.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");
}

/** Zones où poser le gabarit : la feuille entière (section -1) ou chaque partie. */
export function masterAreas(p: Page): { rect: { x: number; y: number; w: number; h: number }; section: number }[] {
  if ((p.sections ?? 1) > 1 && p.masterMode === "each") return sectionRects(p).map((rect, section) => ({ rect, section }));
  return [{ rect: { x: 0, y: 0, w: p.width, h: p.height }, section: -1 }];
}

/** Rectangles des parties d'une feuille (repère de la page). */
export function sectionRects(p: Page): { x: number; y: number; w: number; h: number }[] {
  const n = p.sections ?? 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (p.split === "v") out.push({ x: (p.width / n) * i, y: 0, w: p.width / n, h: p.height });
    else out.push({ x: 0, y: (p.height / n) * i, w: p.width, h: p.height / n });
  }
  return out;
}
