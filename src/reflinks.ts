// Renvois cliquables en présentation : « (aide : ressource 9) », « ressources 9 et 10 », « ressource SEGPA 2 »,
// ou un nom de feuille (« R09 », « E01 »). Une ressource numérotée est repérée par son titre « Ressource 9 »,
// souvent l'un des encadrés d'une feuille R… (R04 contient les ressources 8 et 9) : on cadre alors cet encadré.
import type { Doc, SceneNode, TextNode } from "./model";

export interface RefTarget { page: number; node: string | null; label: string }
export interface RefMatch { start: number; end: number; key: string; kind: "res" | "sheet" }

export const plainText = (n: TextNode) => n.paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join("\n");

/** « 09 » → « 9 », « s1 » → « S1 » ; « SEGPA 1 » se note « S1 » (titres « Ressource S1 »). */
const normKey = (tok: string, segpa: boolean) => {
  const m = tok.toUpperCase().match(/^(S?)0*(\d+)$/);
  return m ? `${segpa ? "S" : m[1]}${m[2]}` : tok.toUpperCase();
};

const TITLE = /^ressources?\s+(segpa\s+)?(s?\d+)$/i;

/** Titres des ressources numérotées du document : clé → feuille et encadré (null = toute la feuille). */
export function resourceIndex(doc: Doc): { targets: Map<string, RefTarget>; titleIds: Set<string> } {
  const found = new Map<string, { page: number; node: string }[]>();
  const titleIds = new Set<string>();
  const visit = (nodes: SceneNode[], page: number) => {
    for (const n of nodes) {
      if (n.type === "group") { visit(n.children, page); continue; }
      if (n.type !== "text") continue;
      const m = plainText(n).replace(/\s+/g, " ").trim().match(TITLE);
      if (!m) continue;
      const key = normKey(m[2], !!m[1]);
      (found.get(key) ?? found.set(key, []).get(key)!).push({ page, node: n.id });
    }
  };
  doc.pages.forEach((p, i) => visit(p.layers, i));
  const targets = new Map<string, RefTarget>();
  for (const [key, list] of found) {
    // une feuille de ressources passe avant la fiche pédagogique qui les énumère
    const isRes = (i: number) => /^(ressource|evalres)$/.test(doc.pages[i].kind ?? "") || /(^|_)R\d/i.test(doc.pages[i].name);
    const page = (list.find((x) => isRes(x.page)) ?? list[0]).page;
    const onPage = list.filter((x) => x.page === page);
    // seuls les titres de la feuille retenue ne sont pas cliquables (« Ressource 8 » dans la fiche péda l'est)
    onPage.forEach((x) => titleIds.add(x.node));
    // le même titre répété sur la feuille (« Ressource S1 » sur chaque partie) : c'est toute la feuille
    targets.set(key, { page, node: onPage.length === 1 ? onPage[0].node : null, label: `Ressource ${key} · ${doc.pages[page].name}` });
  }
  return { targets, titleIds };
}

const RES = /\b(ressources?)\s+(segpa\s+)?((?:s?\d+)(?:\s*(?:,|et|à|-)\s*s?\d+)*)/giu;
const SHEET = /\b([A-Z]{1,2}\d{2})\b/g;

/** Renvois dans un texte ; `sheets` : noms des feuilles du document (pour « R09 »). */
export function findRefs(text: string, sheets: Set<string>): RefMatch[] {
  const out: RefMatch[] = [];
  for (const m of text.matchAll(RES)) {
    const listStart = m.index! + m[0].length - m[3].length;
    let first = true;
    for (const t of m[3].matchAll(/s?\d+/giu)) {
      const s = listStart + t.index!, e = s + t[0].length;
      // le premier numéro emporte le mot « ressource » : la zone à cliquer est plus grande
      out.push({ start: first ? m.index! : s, end: e, key: normKey(t[0], !!m[2]), kind: "res" });
      first = false;
    }
  }
  for (const m of text.matchAll(SHEET)) {
    const s = m.index!, e = s + m[0].length;
    if (sheets.has(m[1]) && !out.some((o) => s < o.end && e > o.start)) out.push({ start: s, end: e, key: m[1], kind: "sheet" });
  }
  return out.sort((a, b) => a.start - b.start);
}
