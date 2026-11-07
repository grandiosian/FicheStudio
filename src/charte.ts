// Charte graphique des ateliers (docs/charte_ateliers.md) : palette, styles de texte,
// gabarits et blocs aux mesures de la charte (feuille A4 de 2480 × 3508 px à 300 dpi).
import {
  DEFAULT_LEVEL_COLORS, SHEET_KINDS, defaultStroke, newGroup, newLayer, newParagraph, newShape, NONE, solid, uid,
  type Doc, type GroupNode, type Master, type Numbering, type Paragraph, type Run, type SceneNode, type TextNode,
} from "./model";

const rgb = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export const C = {
  bleu: rgb(47, 87, 161),
  marine: rgb(1, 9, 88),
  clair: rgb(201, 212, 244),
  pale: rgb(229, 232, 242),
  gris: rgb(233, 236, 243),
  recopie: rgb(243, 245, 251),
  corr: rgb(0, 150, 70),
  comp: rgb(240, 140, 20),
  t1: rgb(40, 170, 70),   // compétences du thème 1 (OST) : vert
  t2: rgb(230, 80, 150),  // thème 2 (SFC) : rose
  t3: rgb(245, 165, 30),  // thème 3 (CCRI) : jaune orangé
  ordi: rgb(2, 199, 49),
  ordiTexte: rgb(21, 45, 0),
  objectif: rgb(255, 240, 200),
  retenir: rgb(255, 249, 225),
  retenirTrait: rgb(240, 170, 30),
  mots: rgb(232, 244, 255),
  filet: rgb(175, 185, 215),
  alerte: rgb(214, 45, 45),
  blanc: "#ffffff",
};

/** Nuancier proposé à côté des sélecteurs de couleur. */
export const palette = (): { name: string; hex: string }[] => [
  { name: "Bleu texte", hex: C.bleu }, { name: "Bleu marine", hex: C.marine }, { name: "Bleu clair (bandeaux)", hex: C.clair },
  { name: "Bleu très pâle", hex: C.pale }, { name: "Gris des cases", hex: C.gris }, { name: "Fond « Recopie »", hex: C.recopie },
  { name: "Correction", hex: C.corr }, { name: "Compétence thème 1", hex: C.t1 }, { name: "Compétence thème 2", hex: C.t2 }, { name: "Compétence thème 3", hex: C.t3 }, { name: "ORDI", hex: C.ordi },
  { name: "Texte ORDI", hex: C.ordiTexte }, { name: "Objectif", hex: C.objectif }, { name: "À retenir (fond)", hex: C.retenir },
  { name: "À retenir (contour)", hex: C.retenirTrait }, { name: "Banque de mots", hex: C.mots }, { name: "Filet fin", hex: C.filet },
  { name: "Alerte", hex: C.alerte }, { name: "5e", hex: DEFAULT_LEVEL_COLORS["5"] }, { name: "4e", hex: DEFAULT_LEVEL_COLORS["4"] },
  { name: "3e", hex: DEFAULT_LEVEL_COLORS["3"] }, { name: "Blanc", hex: C.blanc },
];

/** Mesures réglables par le fichier init (charte.init.json). */
export const DIM = { enteteRayonMm: 8, resumeRayonMm: 1, ressourceRayonMm: 1 };
export const PREFS = { variante: "classique" };
const mm = (v: number) => (v * 300) / 25.4;

const PT = 300 / 72;
export const pt = (v: number) => v * PT;

export interface TextStyle { id: string; label: string; font: string; size: number; weight: number; color: string; bullet?: boolean }
/** Styles de texte de la charte (corps en pt). */
export const TEXT_STYLES: TextStyle[] = [
  { id: "corps", label: "Texte courant (Arial Narrow 12)", font: "Arial Narrow", size: 12, weight: 400, color: C.bleu },
  { id: "puce", label: "Liste à puces (12)", font: "Arial Narrow", size: 12, weight: 400, color: C.bleu, bullet: true },
  { id: "titreAtelier", label: "Titre d'atelier (Arial Black 15)", font: "Arial Black", size: 15, weight: 900, color: C.bleu },
  { id: "sousTitre", label: "Sous-titre d'en-tête (Arial 12)", font: "Arial", size: 12, weight: 400, color: C.bleu },
  { id: "resume", label: "Résumé de l'atelier (11)", font: "Arial Narrow", size: 11, weight: 400, color: C.bleu },
  { id: "titreBande", label: "Titre du bandeau fin (Arial Black 11)", font: "Arial Black", size: 11, weight: 900, color: C.bleu },
  { id: "sousBande", label: "Sous-titre du bandeau fin (Arial 8,5)", font: "Arial", size: 8.5, weight: 400, color: C.bleu },
  { id: "titreRessource", label: "Titre de ressource (Arial Black 14)", font: "Arial Black", size: 14, weight: 900, color: C.bleu },
  { id: "etiquette", label: "Étiquette de cadre (15 gras blanc)", font: "Arial Narrow", size: 15, weight: 700, color: C.blanc },
  { id: "competence", label: "Pastille de compétence (8 gras blanc)", font: "Arial Narrow", size: 8, weight: 700, color: C.blanc },
  { id: "bareme", label: "Barème (22 gras)", font: "Arial Narrow", size: 22, weight: 700, color: C.bleu },
  { id: "reponse", label: "Réponse corrigée (gras vert)", font: "Arial Narrow", size: 12, weight: 700, color: C.corr },
];

/** Applique un style de la charte à un paragraphe (interligne 1,12, espace après 0,35 × corps). */
export function applyTextStyle(p: Paragraph, s: TextStyle) {
  const size = pt(s.size);
  for (const r of p.runs) { r.font = s.font; r.size = size; r.weight = s.weight; r.color = s.color; }
  p.lineHeight = 1.12;
  p.spaceAfter = 0.35 * size;
  if (s.bullet) {
    p.leftIndent = 0.9 * size; p.firstIndent = -0.9 * size; p.tabStop = 0.9 * size;
    const r0 = p.runs[0];
    if (r0 && !r0.text.startsWith("•")) r0.text = `•\t${r0.text}`;
  }
}

/** Ligne de découpe (feuilles d'atelier seulement) : 12 px, bleu, tirets arrondis. */
export const CUT = { color: C.bleu, width: 12, dash: [2, 3] as number[] };

// ------------------------------------------------------------------ construction

const run = (text: string, font: string, sizePt: number, color = C.bleu, weight = 400): Run =>
  ({ text, font, size: pt(sizePt), weight, italic: false, underline: false, color, opacity: 1 });

function text(x: number, y: number, w: number, h: number, runs: Run[][], align: Paragraph["align"] = "left", name = "Texte"): TextNode {
  return {
    id: uid(), name, visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0], type: "text",
    frame: { x, y, w, h }, paragraphs: runs.map((r) => { const p = newParagraph(r, align); p.lineHeight = 1.12; return p; }),
  };
}

function box(x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke = 0, strokeColor = C.bleu, name = "Cadre") {
  const b = newShape("rect", x, y, w, h);
  b.name = name; b.fill = fill ? solid(fill) : NONE; b.stroke = defaultStroke(stroke, strokeColor); b.radius = [r, r, r, r];
  return b;
}

function line(x1: number, y1: number, x2: number, y2: number, w: number, color: string, dash: number[] | null, name: string): SceneNode {
  return {
    id: uid(), name, visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0],
    type: "path", subpaths: [{ closed: false, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] }],
    fill: NONE, stroke: { paint: solid(color), width: w, dash, cap: "round", join: "round" },
  };
}

/** Pastille de niveau : couleur liée à {{niveau}}. */
function pastille(x: number, y: number, d: number): SceneNode {
  const c = newShape("ellipse", x, y, d, d);
  c.name = "Pastille"; c.fill = solid("#fcca30"); c.stroke = defaultStroke(0); c.bind = { fill: "couleur_niveau" };
  const sizePt = d >= 100 ? 21.6 : 11;
  const t = text(x, y + d / 2 - pt(sizePt) * 0.358, d, pt(sizePt), [[run("{{niveau}}", "Arial Black", sizePt, C.marine, 900)]], "center", "Niveau");
  return newGroup([c, t], "Pastille de niveau");
}

/** Bandeau fin des feuilles suivantes (contenu à partir de y = 200). */
function thinBand(): SceneNode {
  return newGroup([
    box(90, 72, 2290, 66, 33, C.clair, 0, C.bleu, "Bande"),
    text(130, 82, 1400, 50, [[run("{{entete}} - {{atelier}}", "Arial Black", 11, C.bleu, 900)]], "left", "Titre"),
    text(1300, 88, 960, 40, [[run("{{séquence}} - Feuille {{feuille}}", "Arial", 8.5)]], "right", "Sous-titre"),
    pastille(2300, 74, 62),
  ], "Bandeau fin");
}

/** Grand en-tête de la 1re feuille d'un atelier (contenu à partir de y = 381).
 *  Mesures reprises du gabarit ajusté à la main dans FicheStudio. */
function bigHeader(): SceneNode {
  const niveau = text(2267.35, 108.53, 110, 100, [[run("{{niveau}}", "Arial Black", 21.6, C.marine, 900)]], "center", "Niveau");
  const disque = newShape("ellipse", 2265, 91.19, 110, 110);
  disque.name = "Pastille"; disque.fill = solid("#fcca30"); disque.stroke = defaultStroke(0); disque.bind = { fill: "couleur_niveau" };
  return newGroup([
    box(73, 73.75, 2335, 157.25, mm(DIM.enteteRayonMm), C.clair, 0, C.bleu, "Bandeau"),
    text(198.61, 103.8, 2021.39, 119, [[run("{{entete}} - {{atelier}}", "Arial Black", 15, C.bleu, 900)]], "left", "Titre de l'atelier"),
    text(190, 166.26, 2100, 77, [[run("{{séquence}} - Feuille {{feuille}}", "Arial", 12)]], "left", "Sous-titre"),
    newGroup([disque, niveau], "Pastille de niveau"),
    box(73, 252, 2335, 116, mm(DIM.resumeRayonMm), C.gris, 0, C.bleu, "Cadre du résumé"),
    text(112.5, 278, 2255, 90, [[run("Résumé et objectif de l'atelier : ", "Arial Narrow", 11, C.bleu, 700), run("{{résumé}}", "Arial Narrow", 11)]], "left", "Résumé"),
  ], "Grand en-tête");
}

/** Cartouche « FIN Feuille 0x » en bas à droite (y ≈ 3290). */
function cartouche(y = 3290): SceneNode {
  return newGroup([
    box(1540, y, 940, 62, 14, C.clair, 0, C.bleu, "Cartouche"),
    pastille(1550, y + 6, 50),
    text(1615, y + 4, 850, 28, [[run("{{atelier}}", "Arial Black", 6.3, C.bleu, 900)]], "left", "Titre"),
    text(1615, y + 31, 850, 30, [[run("FIN Feuille {{feuille}}", "Arial", 7.5, C.bleu, 700), run(" - {{séquence}}", "Arial", 7.5)]], "left", "Fin de feuille"),
  ], "Cartouche FIN");
}

function ressourceBand(): SceneNode {
  return newGroup([
    box(73, 86, 2335, 145, mm(DIM.ressourceRayonMm), C.clair, 0, C.bleu, "Bandeau"),
    text(120, 128, 2100, 70, [[run("{{entete}} - {{atelier}}", "Arial Black", 14, C.bleu, 900)]], "left", "Titre"),
    pastille(2265, 103, 110),
  ], "Bandeau ressource");
}

function evalHeader(): SceneNode {
  return newGroup([
    box(94, 51, 2274, 155, 40, C.clair, 0, C.bleu, "Bandeau"),
    text(140, 66, 2000, 70, [[run("{{entete}} - {{atelier}}", "Arial Black", 15, C.bleu, 900)]], "left", "Titre"),
    text(140, 140, 2000, 55, [[run("Nom : ………………  Prénom : ………………  Classe : ………  Date : ………", "Arial", 12)]], "left", "Identité"),
    pastille(2225, 66, 117),
    box(94, 239, 1900, 123, 40, C.clair, 0, C.bleu, "Bandeau des consignes"),
    text(130, 268, 1830, 70, [[run("Sans ordinateur · Ressources autorisées · Recto verso", "Arial Narrow", 12)]], "left", "Consignes"),
    box(2028, 231, 340, 140, 30, null, 8.33, C.bleu, "Case de note"),
    text(2028, 270, 340, 90, [[run("…… / 20", "Arial Narrow", 22, C.bleu, 700)]], "center", "Note"),
  ], "En-tête d'évaluation");
}

function master(name: string, top: SceneNode[], bottom: SceneNode[] = []): Master {
  const t = newLayer("Haut"); t.anchor = "top"; t.children = top;
  const b = newLayer("Bas"); b.anchor = "bottom"; b.children = bottom;
  return { id: uid("m"), name, width: 2480, height: 3508, layers: bottom.length ? [t, b] : [t] };
}

/** Gabarits de la charte, à associer aux feuilles selon leur type. */
export function charteMasters(): Master[] {
  return [
    master("Charte · 1re feuille d'atelier", [bigHeader()], [cartouche()]),
    master("Charte · Feuille d'atelier", [thinBand()], [cartouche()]),
    master("Charte · Ressource", [ressourceBand()]),
    master("Charte · Synthèse", [thinBand()]),
    master("Charte · Évaluation", [evalHeader()]),
  ];
}
/** Ajoute les gabarits de la charte au document, ou met à jour ceux qui y sont déjà (même nom). */
export function updateCharteMasters(doc: Doc): number {
  let updated = 0;
  for (const m of charteMasters()) {
    const old = doc.masters.find((x) => x.name === m.name);
    if (old) { old.layers = m.layers; old.width = m.width; old.height = m.height; updated++; }
    else doc.masters.push(m);
  }
  return updated;
}
export const hasCharteMasters = (doc: Doc) => doc.masters.some((m) => m.name.startsWith("Charte · "));

// ------------------------------------------------------------------ variantes par classe

export const LEVELS = ["6", "5", "4", "3"];

/** Fige les pastilles sur une classe : numéro écrit en dur et couleur de la classe
 *  (au lieu de suivre {{niveau}} et la couleur du document). */
export function fixLevel(nodes: SceneNode[], level: string): SceneNode[] {
  const color = DEFAULT_LEVEL_COLORS[level] ?? "#fcca30";
  const visit = (n: SceneNode) => {
    if (n.type === "text") for (const p of n.paragraphs) for (const r of p.runs) r.text = r.text.replace(/\{\{niveau\}\}/g, level);
    if ((n.type === "shape" || n.type === "path") && n.bind?.fill === "couleur_niveau") {
      n.fill = solid(color);
      n.bind = { ...n.bind, fill: undefined };
    }
    if (n.type === "group") n.children.forEach(visit);
  };
  nodes.forEach(visit);
  return nodes;
}

// ------------------------------------------------------------------ modèles copiés dans les calques

/** Modèles de la charte (mêmes contenus que les gabarits), à copier dans un calque de page. */
export const TEMPLATES = ["1re feuille d'atelier", "Feuille d'atelier", "Ressource", "Synthèse", "Évaluation"];
export const TEMPLATE_PREFIX = "Modèle charte · ";

/** Modèle conseillé pour un type de feuille (1re feuille d'atelier si first). */
export function templateFor(kind: string, first = false): number {
  return kind === "fiche" && first ? 0 : MASTER_FOR_KIND[kind] ?? 1;
}

const TEMPLATE_KIND = ["fiche", "fiche", "ressource", "synthese", "eval"] as const;

/** Copie le modèle n° i dans le calque, sous son contenu ; remplace un modèle déjà présent.
 *  L'en-tête ({{entete}}) est écrit d'après le type du calque, car une page peut porter
 *  plusieurs calques de types différents (P01, R01… dans un même fichier Affinity). */
export function applyTemplate(layer: import("./model").GroupNode, i: number, kind?: string, level?: string) {
  const m = charteMasters()[i];
  const nodes = m.layers.flatMap((l) => l.children);
  if (level) fixLevel(nodes, level);
  const k = kind && templateFor(kind) === templateFor(TEMPLATE_KIND[i]) ? kind : TEMPLATE_KIND[i];
  const entete = SHEET_KINDS[k as keyof typeof SHEET_KINDS].entete;
  walkText(nodes, (p) => { for (const r of p.runs) r.text = r.text.replace(/\{\{entete\}\}/g, entete); });
  const g = newGroup(nodes, `${TEMPLATE_PREFIX}${TEMPLATES[i]}${level ? ` · ${level}e` : ""}`);
  g.locked = true; // le modèle ne bouge pas quand on travaille le contenu
  const at = layer.children.findIndex((c) => c.name.startsWith(TEMPLATE_PREFIX));
  if (at >= 0) layer.children.splice(at, 1, g); else layer.children.unshift(g);
}

/** Gabarit conseillé pour chaque type de feuille (index dans charteMasters()). */
export const MASTER_FOR_KIND: Record<string, number> = { fiche: 1, ressource: 2, evalres: 2, synthese: 3, eval: 4 };

// ------------------------------------------------------------------ blocs

const W = 2284; // largeur de la zone de texte (x de 141 à 2425)

// ------------------------------------------------------------------ variantes de disposition

type Heading = { font: string; size: number; weight: number; color: string };
export interface CharteVariant {
  id: string; label: string; description: string;
  numbering: Omit<Numbering, "restart">;
  headings: [Heading, Heading, Heading];
  /** Exemple affiché dans le choix de la variante : [niveau, texte]. */
  example: [1 | 2 | 3, string][];
}

export const VARIANTS: CharteVariant[] = [
  {
    id: "classique", label: "Classique · 1 · 1.1 · 1.1.1", description: "Parties numérotées en bandeau bleu clair, questions en bande arrondie.",
    numbering: { scheme: "decimal", suffix: " ", suffixes: [". ", " ", " "], bold: true },
    headings: [{ font: "Arial Black", size: 13, weight: 900, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 700, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 400, color: C.bleu }],
    example: [[1, "1. Le capteur de lumière"], [2, "1.1 Repère le capteur sur le robot."], [3, "1.1.1 Quelle est sa fonction ?"], [2, "1.2 Mesure la luminosité."], [1, "2. Programmer le robot"]],
  },
  {
    id: "chapitres", label: "Chapitres · I · a · 1", description: "« Chapitre I » souligné d'un filet marine, questions a), b), c)…",
    numbering: { scheme: "roman", suffix: " ", prefix1: "Chapitre ", suffixes: [" – ", ") ", ". "], bold: true },
    headings: [{ font: "Arial Black", size: 15, weight: 900, color: C.marine }, { font: "Arial Narrow", size: 13, weight: 700, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 400, color: C.bleu }],
    example: [[1, "Chapitre I – Le capteur de lumière"], [2, "a) Repère le capteur sur le robot."], [2, "b) Mesure la luminosité."], [3, "1. Note la valeur."], [1, "Chapitre II – Programmer le robot"]],
  },
  {
    id: "grille", label: "Grille · A · A1, A2… B1", description: "Parties A, B, C ; activités A1, A2, A3… dans un cadre bleu, comme une grille de progression.",
    numbering: { scheme: "alpha", suffix: " ", suffixes: [" – ", "  ", ") "], bold: true },
    headings: [{ font: "Arial Black", size: 14, weight: 900, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 700, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 400, color: C.bleu }],
    example: [[1, "A – Le capteur de lumière"], [2, "A1  Repère le capteur."], [2, "A2  Mesure la luminosité."], [3, "A2.a) Note la valeur."], [1, "B – Programmer le robot"], [2, "B1  Ouvre mBlock."]],
  },
  {
    id: "mixte", label: "Mixte · 1 · a · i", description: "Parties 1, 2, 3 ; questions a, b, c ; détails i, ii, iii.",
    numbering: { scheme: "letters", suffix: " ", suffixes: [". ", ") ", ". "], bold: true },
    headings: [{ font: "Arial Black", size: 13, weight: 900, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 700, color: C.bleu }, { font: "Arial Narrow", size: 12, weight: 400, color: C.bleu }],
    example: [[1, "1. Le capteur de lumière"], [2, "a) Repère le capteur."], [3, "i. Quelle est sa fonction ?"], [2, "b) Mesure la luminosité."]],
  },
];
export const variantOf = (doc: Doc) => VARIANTS.find((v) => v.id === (doc.charte ?? PREFS.variante)) ?? VARIANTS[0];

/** Applique une variante : numérotation du document et style de tous les titres numérotés. */
export function applyVariant(doc: Doc, v: CharteVariant, restyle: boolean) {
  doc.charte = v.id;
  doc.numbering = { ...v.numbering, restart: doc.numbering.restart };
  if (!restyle) return;
  for (const p of [...doc.pages, ...doc.masters]) walkText(p.layers, (para) => {
    if (!para.level) return;
    const h = v.headings[para.level - 1];
    for (const r of para.runs) { r.font = h.font; r.size = pt(h.size); r.weight = h.weight; r.color = h.color; }
  });
}
function walkText(nodes: SceneNode[], fn: (p: Paragraph) => void) {
  for (const n of nodes) {
    if (n.type === "text") n.paragraphs.forEach(fn);
    else if (n.type === "group") walkText(n.children, fn);
  }
}

/** Titres de la variante (blocs de bibliothèque). */
function headingBlocks(v: CharteVariant): { name: string; nodes: SceneNode[]; x: number }[] {
  const title = (level: 1 | 2 | 3, txt: string, x: number, y: number, w: number) => {
    const h = v.headings[level - 1];
    const t = text(x, y, w, pt(h.size) * 1.3, [[run(txt, h.font, h.size, h.color, h.weight)]], "left", `Titre ${level}`);
    t.paragraphs[0].level = level;
    return t;
  };
  let l1: SceneNode, l2: SceneNode;
  if (v.id === "chapitres") {
    l1 = newGroup([title(1, "Titre du chapitre", 0, 0, W), line(0, 92, W, 92, 6, C.marine, null, "Filet")], "Titre de chapitre");
    l2 = title(2, "Question posée à l'élève.", 40, 0, W - 40);
  } else if (v.id === "grille") {
    l1 = newGroup([box(0, 0, W, 100, 50, C.clair, 0, C.bleu, "Bandeau"), title(1, "Titre de la partie", 40, 18, W - 80)], "Partie (A, B…)");
    l2 = newGroup([box(0, 0, W, 90, 22, null, 6, C.bleu, "Cadre"), title(2, "Activité à réaliser.", 30, 16, W - 60)], "Activité (A1, A2…)");
  } else {
    l1 = newGroup([box(0, 0, W, 96, 48, C.clair, 0, C.bleu, "Bandeau"), title(1, "Titre de la partie", 40, 18, W - 80)], "Titre de partie");
    l2 = newGroup([box(0, 0, W, 84, 42, C.recopie, 0, C.bleu, "Bande"), title(2, "Question posée à l'élève.", 36, 14, W - 72)], "Bande question");
  }
  return [
    { name: `${v.label.split(" · ")[0]} : titre de niveau 1`, nodes: [l1], x: 141 },
    { name: `${v.label.split(" · ")[0]} : titre de niveau 2`, nodes: [l2], x: 141 },
    { name: `${v.label.split(" · ")[0]} : titre de niveau 3`, nodes: [title(3, "Sous-question.", 0, 0, W - 80)], x: 221 },
  ];
}

export function charteBlocks(v: CharteVariant = VARIANTS[0]): { name: string; nodes: SceneNode[]; x: number }[] {
  return [...headingBlocks(v), ...baseBlocks()];
}

function baseBlocks(): { name: string; nodes: SceneNode[]; x: number }[] {
  const dots = (n: number, gap = 70) => newGroup(Array.from({ length: n }, (_, i) => line(0, i * gap, W, i * gap, 4, C.bleu, [0.01, 4], "Ligne de réponse")), "Lignes de réponse");
  const label = (t: string, bg: string, fg: string) => newGroup([box(0, 0, 210, 64, 32, bg, 0, C.bleu, "Fond"), text(0, 9, 210, 50, [[run(t, "Arial Narrow", 12, fg, 700)]], "center", "Texte")], `Étiquette ${t}`);
  return [
    { name: "Bande question", x: 141, nodes: [newGroup([box(0, 0, W, 84, 42, C.clair, 0, C.bleu, "Bande"), text(36, 16, W - 72, 60, [[run("1. ", "Arial Narrow", 12, C.bleu, 700), run("Question posée à l'élève.", "Arial Narrow", 12)]], "left", "Question")], "Bande question")] },
    { name: "Cadre « Recopie et réponds »", x: 141, nodes: [newGroup([box(0, 0, W, 320, 30, C.recopie, 0, C.bleu, "Fond"), text(40, 30, W - 80, 60, [[run("Recopie et réponds : ", "Arial Narrow", 12, C.bleu, 700), run("question à recopier dans le cahier.", "Arial Narrow", 12)]], "left", "Consigne")], "Recopie et réponds")] },
    { name: "Case à compléter", x: 141, nodes: [newGroup([box(0, 0, 420, 90, 26, C.gris, 8.33, C.bleu, "Case"), text(0, 18, 420, 60, [[run("……", "Arial Narrow", 12)]], "center", "Pointillés")], "Case à compléter")] },
    { name: "Case à cocher", x: 141, nodes: [box(0, 0, 46, 46, 10, null, 6, C.bleu, "Case à cocher")] },
    { name: "Lignes de réponse (charte)", x: 141, nodes: [dots(4)] },
    { name: "Filet fin", x: 141, nodes: [line(0, 0, W, 0, 4, C.filet, null, "Filet fin")] },
    { name: "Étiquette ORDI", x: 141, nodes: [label("ORDI", C.ordi, C.ordiTexte)] },
    { name: "Étiquette PAPIER", x: 141, nodes: [label("PAPIER", C.bleu, C.blanc)] },
    { name: "Encadré « À retenir »", x: 141, nodes: [newGroup([box(0, 0, W, 260, 30, C.retenir, 8.33, C.retenirTrait, "Fond"), text(40, 30, W - 80, 200, [[run("À retenir : ", "Arial Narrow", 12, C.bleu, 700), run("la notion clé de la feuille.", "Arial Narrow", 12)]], "left", "Texte")], "À retenir")] },
    { name: "Banque de mots", x: 141, nodes: [newGroup([box(0, 0, W, 120, 30, C.mots, 6, C.bleu, "Fond"), text(40, 30, W - 80, 60, [[run("Banque de mots : ", "Arial Narrow", 12, C.bleu, 700), run("mot · mot · mot", "Arial Narrow", 12)]], "left", "Mots")], "Banque de mots")] },
    { name: "Bandeau « Objectif »", x: 141, nodes: [newGroup([box(0, 0, W, 100, 30, C.objectif, 0, C.bleu, "Fond"), text(40, 22, W - 80, 60, [[run("Objectif : ", "Arial Narrow", 12, C.bleu, 700), run("ce que l'élève saura faire.", "Arial Narrow", 12)]], "left", "Texte")], "Objectif")] },
    { name: "Cadre de ressource", x: 119, nodes: [newGroup([box(0, 0, 2283, 700, 60, null, 12.5, C.bleu, "Cadre"), box(0, 0, 420, 104, 52, C.bleu, 0, C.bleu, "Étiquette"), text(0, 22, 420, 70, [[run("Ressource 1", "Arial Narrow", 15, C.blanc, 700)]], "center", "Nom"), text(460, 26, 1780, 70, [[run("Titre ", "Arial Narrow", 14, C.bleu, 700), run("de la ressource", "Arial Narrow", 14)]], "left", "Titre")], "Cadre de ressource")] },
    { name: "Bloc ressource (étiquette intérieure)", x: 119, nodes: [ressourceBlock(2283, 700, "Ressource 1")] },
    { name: "Bloc ressource demi-largeur", x: 119, nodes: [ressourceBlock(1120, 700, "Ressource 1")] },
    { name: "Bloc ressource avec image", x: 119, nodes: [ressourceBlock(2283, 900, "Ressource 1", "image")] },
    { name: "Bloc ressource avec tableau", x: 119, nodes: [ressourceBlock(2283, 640, "Ressource 1", "table")] },
    { name: "Bloc définition", x: 119, nodes: [definitionBlock()] },
    { name: "Barème", x: 2125, nodes: [text(0, 0, 300, 100, [[run("/3", "Arial Narrow", 22, C.bleu, 700)]], "right", "Barème")] },
    { name: "« → Tourne la page »", x: 1625, nodes: [text(0, 0, 800, 70, [[run("→ Tourne la page", "Arial Narrow", 14, C.bleu, 700)]], "right", "Tourne la page")] },
    { name: "Réponse corrigée", x: 141, nodes: [text(0, 0, W, 60, [[run("→ réponse attendue", "Arial Narrow", 12, C.corr, 700)]], "left", "Réponse")] },
  ];
}

/** Couleur de pastille selon le thème du code (T1 vert, T2 rose, T3 jaune orangé). */
export const themeColor = (code: string) => ({ "1": C.t1, "2": C.t2, "3": C.t3 } as Record<string, string>)[code[1]] ?? C.comp;

/** Bloc ressource : liseré bleu, et à l'intérieur un rectangle arrondi bleu clair avec le nom de la ressource. */
function ressourceBlock(w: number, h: number, nom: string, inner: "texte" | "image" | "table" = "texte"): SceneNode {
  const pad = 34, labelH = 104;
  const kids: SceneNode[] = [
    box(0, 0, w, h, 60, null, 12.5, C.bleu, "Liseré"),
    box(pad, pad, w - pad * 2, labelH, 40, C.clair, 0, C.bleu, "Cartouche du nom"),
    text(pad + 30, pad + 20, w - pad * 2 - 60, 70, [[run(`${nom} : `, "Arial Narrow", 15, C.bleu, 700), run("titre de la ressource", "Arial Narrow", 15)]], "left", "Nom de la ressource"),
  ];
  const top = pad + labelH + 30, iw = w - pad * 2 - 20;
  if (inner === "image") {
    kids.push(box(pad + 10, top, iw, h - top - 140, 26, C.gris, 0, C.bleu, "Emplacement image"),
      text(pad + 10, top + (h - top - 140) / 2 - 30, iw, 60, [[run("Image ou schéma (Insertion › image, ou glisser un fichier)", "Arial Narrow", 12, C.filet)]], "center", "Indication"),
      text(pad + 10, h - 110, iw, 70, [[run("Légende : ", "Arial Narrow", 12, C.bleu, 700), run("mot clé et explication.", "Arial Narrow", 12)]], "left", "Légende"));
  } else if (inner === "table") {
    const t = makeTable({ rows: 4, cols: 3, header: true, headerCol: false, width: iw, cellH: 96 });
    t.transform = [1, 0, 0, 1, pad + 10, top];
    kids.push(t);
  } else {
    kids.push(text(pad + 10, top, iw, h - top - pad, [[run("Texte de la ressource : notions, vocabulaire, exemples.", "Arial Narrow", 12)]], "left", "Contenu"));
  }
  return newGroup(kids, `Bloc ${nom}`);
}

function definitionBlock(): SceneNode {
  return newGroup([
    box(0, 0, 2283, 220, 40, null, 8.33, C.bleu, "Liseré"),
    box(24, 24, 360, 172, 30, C.clair, 0, C.bleu, "Cartouche"),
    text(24, 80, 360, 70, [[run("Définition", "Arial Narrow", 15, C.bleu, 700)]], "center", "Mot"),
    text(420, 40, 1820, 150, [[run("Mot : ", "Arial Narrow", 12, C.bleu, 700), run("sa définition, en une ou deux phrases.", "Arial Narrow", 12)]], "left", "Définition"),
  ], "Bloc définition");
}

// ------------------------------------------------------------------ tableaux

export interface TableOpts { rows: number; cols: number; header: boolean; headerCol: boolean; width: number; cellH: number }

/** Tableau à la charte : un groupe « Tableau » qui range une rangée par groupe, et chaque case
 *  dans son propre groupe (rectangle + texte). En-têtes bleu clair, cellules contour bleu. */
export function makeTable(o: TableOpts): GroupNode {
  const cw = o.width / o.cols, size = 12, stroke = 5;
  const ty = (o.cellH - pt(size) * 1.12) / 2;
  const rows: SceneNode[] = [];
  for (let r = 0; r < o.rows; r++) {
    const isHead = o.header && r === 0;
    const cells: SceneNode[] = [];
    for (let c = 0; c < o.cols; c++) {
      const head = isHead || (o.headerCol && c === 0);
      const x = c * cw, y = r * o.cellH;
      const label = isHead ? `Titre ${c + 1}` : head ? `Ligne ${o.header ? r : r + 1}` : "";
      const rect = box(x, y, cw, o.cellH, 0, head ? C.clair : C.blanc, stroke, C.bleu, "Case");
      const t = text(x + 20, y + ty, cw - 40, pt(size) * 1.3, [[run(label, "Arial Narrow", size, C.bleu, head ? 700 : 400)]], head ? "center" : "left", head ? "Titre" : "Texte");
      cells.push(newGroup([rect, t], `Case ${r + 1}.${c + 1}`));
    }
    rows.push(newGroup(cells, isHead ? "Rangée de titre" : `Rangée ${o.header ? r : r + 1}`));
  }
  return newGroup(rows, `Tableau ${o.rows} × ${o.cols}`);
}

/** Pastille de compétence (marge gauche, x = 8). */
export function competencePill(code: string, title = ""): SceneNode {
  const g = newGroup([
    box(0, 0, 126, 42, 21, themeColor(code), 0, C.bleu, "Fond"),
    text(0, 5, 126, 36, [[run(code, "Arial Narrow", 8, C.blanc, 700)]], "center", "Code"),
  ], `Compétence ${code}`);
  if (title) g.name = `Compétence ${code} – ${title}`.slice(0, 120);
  return g;
}

/** Vérifie quelques règles de la charte sur le document. */
export function checkCharte(doc: import("./model").Doc): string[] {
  const out: string[] = [];
  doc.pages.forEach((p) => {
    const kind = p.kind ?? "fiche";
    if ((p.sections ?? 1) > 1 && kind !== "fiche") out.push(`${p.name} : pas de ligne de découpe hors des feuilles d'atelier.`);
    if ((p.sections ?? 1) > 3) out.push(`${p.name} : 3 parties au maximum.`);
  });
  for (const [lvl, hex] of Object.entries(DEFAULT_LEVEL_COLORS))
    if (doc.levelColors[lvl] && doc.levelColors[lvl].toLowerCase() !== hex) out.push(`Pastille du ${lvl}e : ${doc.levelColors[lvl]} au lieu de ${hex}.`);
  return out;
}
