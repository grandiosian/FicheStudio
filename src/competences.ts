// Référentiel de compétences de technologie (cycle 4, 5e-4e-3e) : consultation, recherche,
// et insertion des pastilles de compétence et des attendus dans la feuille.
import referentiel from "./data/referentiel.json";
import { store } from "./store";
import { walk, newParagraph, uid, type SceneNode, type TextNode } from "./model";
import { applyTextStyle, competencePill, themeColor, TEXT_STYLES } from "./charte";

export interface Sub { code: string; abbr: string; title: string; niveaux: Record<string, string[]>; connaissances: string[] }
interface Comp { code: string; abbr: string; title: string; subs: Sub[] }
interface Theme { code: string; abbr: string; title: string; competences: Comp[] }
const THEMES = (referentiel as { themes: Theme[] }).themes;

let level = "";       // "" = tous les niveaux
let query = "";
const open = new Set<string>();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Codes de compétence déjà présents dans le document (textes et noms d'objets). */
function usedCodes(): Set<string> {
  const used = new Set<string>();
  const scan = (s: string) => { for (const m of s.matchAll(/T[123]C\d{2}/g)) used.add(m[0]); };
  for (const p of store.doc.pages) walk(p.layers, (n) => {
    scan(n.name);
    if (n.type === "text") for (const para of n.paragraphs) for (const r of para.runs) scan(r.text);
  });
  return used;
}

function attendusText(s: Sub): TextNode {
  const corps = TEXT_STYLES.find((t) => t.id === "corps")!, puce = TEXT_STYLES.find((t) => t.id === "puce")!;
  const lv = level ? [level] : Object.keys(s.niveaux);
  const paras = [newParagraph([{ text: `${s.code} – ${s.title}`, font: "Arial Narrow", size: 0, weight: 700, italic: false, underline: false, color: "#2f57a1", opacity: 1 }])];
  applyTextStyle(paras[0], corps);
  paras[0].runs[0].weight = 700;
  for (const l of lv) for (const a of s.niveaux[l] ?? []) {
    const p = newParagraph([{ text: lv.length > 1 ? `${a} (${l}e)` : a, font: "Arial Narrow", size: 0, weight: 400, italic: false, underline: false, color: "#2f57a1", opacity: 1 }]);
    applyTextStyle(p, puce);
    paras.push(p);
  }
  return {
    id: uid(), name: `Attendus ${s.code}`, visible: true, locked: false, opacity: 1, transform: [1, 0, 0, 1, 0, 0], type: "text",
    frame: { x: 0, y: 0, w: 2284, h: 78 * paras.length }, paragraphs: paras,
  };
}

export function refreshCompetences(insert: (name: string, nodes: SceneNode[], x: number) => void) {
  const el = document.querySelector<HTMLElement>("#competences");
  if (!el || el.hidden) return;
  const used = usedCodes();
  const q = norm(query);
  const match = (s: Sub) => !q || norm(`${s.code} ${s.abbr} ${s.title} ${Object.values(s.niveaux).flat().join(" ")} ${s.connaissances.join(" ")}`).includes(q);
  const visible = (s: Sub) => match(s) && (!level || (s.niveaux[level]?.length ?? 0) > 0);
  el.innerHTML = `<div class="panel-head"><h3>Compétences</h3></div>
    <div class="comp-filters">
      <input type="search" placeholder="Rechercher (code, mot…)" value="${esc(query)}" data-c="q">
      <select data-c="lv"><option value="">Tous niveaux</option>${["5", "4", "3"].map((l) => `<option value="${l}" ${level === l ? "selected" : ""}>${l}e</option>`).join("")}</select>
    </div>
    <div class="comp-tree">${THEMES.map((t) => {
      const comps = t.competences.map((c) => ({ c, subs: c.subs.filter(visible) })).filter((x) => x.subs.length);
      if (!comps.length) return "";
      return `<div class="comp-theme"><div class="th" style="--th:${themeColor(t.code)}"><b>${t.code}</b> ${esc(t.abbr)} · ${esc(t.title)}</div>${comps.map(({ c, subs }) =>
        `<div class="comp"><div class="ch" title="${esc(c.title)}"><b>${c.code}</b> ${esc(c.title)}</div>${subs.map((s) => {
          const isOpen = open.has(s.code) || !!q;
          const lv = level ? [level] : ["5", "4", "3"];
          return `<div class="sub ${used.has(s.code) ? "used" : ""}" data-s="${s.code}">
            <div class="sh"><span class="tw">${isOpen ? "▾" : "▸"}</span><span class="code" style="--th:${themeColor(s.code)}">${s.code}</span><span class="nm">${esc(s.title)}</span>${used.has(s.code) ? `<span class="ok" title="Déjà utilisée dans le document">✓</span>` : ""}
              <button data-c="pill" title="Insérer la pastille de compétence (marge gauche)">◉</button><button data-c="att" title="Insérer les attendus${level ? ` de ${level}e` : ""} en liste à puces">≡</button></div>
            ${isOpen ? `<div class="sd">${lv.map((l) => (s.niveaux[l]?.length ? `<div class="lv"><span class="lvb lv${l}">${l}e</span><ul>${s.niveaux[l].map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>` : "")).join("")}
              ${s.connaissances.length ? `<details><summary>Connaissances</summary><ul>${s.connaissances.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></details>` : ""}</div>` : ""}
          </div>`;
        }).join("")}</div>`).join("")}</div>`;
    }).join("") || `<p class="hint">Aucune compétence ne correspond.</p>`}</div>
    <p class="hint">◉ insère la pastille de la charte (T1 vert, T2 rose, T3 jaune orangé · 126 × 42 px, à x = 8) ; ≡ insère les attendus. ✓ : compétence déjà présente dans le document.</p>`;
  const qi = el.querySelector<HTMLInputElement>('[data-c="q"]')!;
  qi.oninput = () => { query = qi.value; const pos = qi.selectionStart; refreshCompetences(insert); const n = document.querySelector<HTMLInputElement>('#competences [data-c="q"]'); n?.focus(); n?.setSelectionRange(pos, pos); };
  el.querySelector<HTMLSelectElement>('[data-c="lv"]')!.onchange = (e) => { level = (e.target as HTMLSelectElement).value; refreshCompetences(insert); };
  el.querySelectorAll<HTMLElement>(".sub").forEach((div) => {
    const s = THEMES.flatMap((t) => t.competences.flatMap((c) => c.subs)).find((x) => x.code === div.dataset.s)!;
    div.querySelector<HTMLElement>(".sh")!.onclick = (e) => {
      const c = (e.target as HTMLElement).dataset.c;
      if (c === "pill") return insert(`Compétence ${s.code}`, [competencePill(s.code, s.title)], 8);
      if (c === "att") return insert(`Attendus ${s.code}`, [attendusText(s)], 141);
      if (open.has(s.code)) open.delete(s.code); else open.add(s.code);
      refreshCompetences(insert);
    };
  });
}
