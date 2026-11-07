// Variables {{nom}}, numérotation des titres (nomenclatures d'atelier), données CSV.
import type { Doc, GroupNode, Mat, Numbering, Page, Paragraph, SceneNode, TextNode } from "./model";
import { plainText, sectionRects, walk, SHEET_KINDS } from "./model";

const VAR = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function applyVars(s: string, vars: Record<string, string>): string {
  return s.replace(VAR, (m, k: string) => (k in vars ? vars[k] : m));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Variables disponibles sur une partie de feuille, de la plus générale à la plus précise. */
export function varsFor(doc: Doc, pageIndex: number, section = 0, row: Record<string, string> | null = null): Record<string, string> {
  const page = doc.pages[pageIndex];
  const v: Record<string, string> = {
    document: doc.name,
    page: String(pageIndex + 1),
    pages: String(doc.pages.length),
    feuille: pad2(pageIndex + 1),
    partie: section >= 0 ? String(section + 1) : "",
    nom_feuille: page?.name ?? "",
    date: new Date().toLocaleDateString("fr-FR"),
    ...doc.fields,
    ...(page?.fields ?? {}),
  };
  if ((page?.sections ?? 1) > 1 && section >= 0) v.feuille = `${pad2(pageIndex + 1)}${String.fromCharCode(97 + section)}`; // 01a, 01b…
  v.couleur_niveau = doc.levelColors[v.niveau] ?? "#fcca30";
  const kind = page?.kind ?? "fiche";
  v.type_feuille = SHEET_KINDS[kind].label;
  v.entete ??= SHEET_KINDS[kind].entete;
  if (row) Object.assign(v, row);
  return v;
}

/** Variables utilisées dans le document. */
export function findVars(doc: Doc): string[] {
  const set = new Set<string>();
  for (const p of [...doc.pages, ...doc.masters])
    walk(p.layers, (n) => {
      if (n.type === "text") for (const m of plainText(n).matchAll(VAR)) set.add(m[1]);
    });
  return [...set];
}

// ------------------------------------------------------------------ numérotation

export const SCHEMES: Record<Numbering["scheme"], { label: string; example: string }> = {
  decimal: { label: "1 · 1.1 · 1.1.1", example: "1  /  1.1  /  1.1.1  /  1.2" },
  roman: { label: "I · a · 1", example: "I  /  a, b, c  /  1, 2" },
  alpha: { label: "A · A1 · A1.a", example: "A  /  A1, A2  /  A1.a" },
  letters: { label: "1 · a · i", example: "1  /  a, b  /  i, ii" },
};

const roman = (n: number) => {
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
};
const letter = (n: number, upper = false) => {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return upper ? s.toUpperCase() : s;
};

export function formatNumber(scheme: Numbering["scheme"], c: number[], level: number): string {
  const [a, b, d] = c;
  switch (scheme) {
    case "decimal": return c.slice(0, level).join(".");
    case "roman": return level === 1 ? roman(a) : level === 2 ? letter(b) : String(d);
    case "alpha": return level === 1 ? letter(a, true) : level === 2 ? `${letter(a, true)}${b}` : `${letter(a, true)}${b}.${letter(d)}`;
    case "letters": return level === 1 ? String(a) : level === 2 ? letter(b) : roman(d).toLowerCase();
  }
}

const mulM = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/**
 * Préfixes de numérotation de chaque paragraphe titré, dans l'ordre de lecture :
 * feuille par feuille, puis de haut en bas et de gauche à droite.
 */
export function computeNumbering(doc: Doc): Map<Paragraph, string> {
  const out = new Map<Paragraph, string>();
  const { scheme, restart } = doc.numbering;
  let c = [0, 0, 0];
  doc.pages.forEach((page) => {
    if (restart !== "doc") c = [0, 0, 0];
    const rects = sectionRects(page);
    const items: { t: TextNode; x: number; y: number; s: number }[] = [];
    const visit = (nodes: SceneNode[], m: Mat) => {
      for (const n of nodes) {
        if (!n.visible) continue;
        const nm = mulM(m, n.transform);
        if (n.type === "group") visit(n.children, nm);
        else if (n.type === "text" && n.paragraphs.some((p) => p.level)) {
          const fx = n.frame?.x ?? 0, fy = n.frame?.y ?? 0;
          const x = nm[0] * fx + nm[2] * fy + nm[4], y = nm[1] * fx + nm[3] * fy + nm[5];
          const s = Math.max(0, rects.findIndex((r) => x >= r.x - 1 && x < r.x + r.w && y >= r.y - 1 && y < r.y + r.h));
          items.push({ t: n, x, y, s });
        }
      }
    };
    visit(page.layers as GroupNode[], [1, 0, 0, 1, 0, 0]);
    items.sort((a, b) => a.s - b.s || a.y - b.y || a.x - b.x);
    let lastSection = -1;
    for (const it of items) {
      if (restart === "section" && it.s !== lastSection) c = [0, 0, 0];
      lastSection = it.s;
      for (const p of it.t.paragraphs) {
        const L = p.level ?? 0;
        if (!L) continue;
        c[L - 1]++;
        for (let k = L; k < 3; k++) c[k] = 0;
        out.set(p, formatNumber(scheme, c, L));
      }
    }
  });
  return out;
}

/** Texte prêt à composer : préfixes de numérotation puis variables remplacées. */
export function prepareText(t: TextNode, numbers: Map<Paragraph, string> | null, suffix: string, vars: Record<string, string> | null): TextNode {
  const paragraphs = t.paragraphs.map((p) => {
    let runs = p.runs;
    const pre = numbers?.get(p);
    if (pre && runs.length) runs = [{ ...runs[0], text: pre + suffix }, ...runs];
    if (vars) runs = runs.map((r) => ({ ...r, text: applyVars(r.text, vars) }));
    return runs === p.runs ? p : { ...p, runs };
  });
  return { ...t, paragraphs };
}

/** Couleur liée à une variable (pastille de niveau…). */
export function boundColor(name: string | undefined, vars: Record<string, string> | null): string | null {
  if (!name || !vars) return null;
  const v = vars[name];
  return v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null;
}

/** Nom de fichier à partir d'un motif « {document} - {feuille} ». */
export function fileName(pattern: string, vars: Record<string, string>): string {
  const s = pattern.replace(/\{([^{}]+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
  return s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "document";
}

// ------------------------------------------------------------------ CSV

/** CSV (séparateur , ; ou tabulation, guillemets gérés) -> colonnes + lignes. */
export function parseCsv(src: string): { columns: string[]; rows: Record<string, string>[] } {
  const text = src.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, firstLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) rows.push(row);
  const columns = (rows.shift() ?? []).map((c) => c.trim());
  return { columns, rows: rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()]))) };
}

export type { Page };
