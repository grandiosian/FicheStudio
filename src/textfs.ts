// Corrigé en plein écran : le texte d'une étape de correction (ou de tout le calque « _Corr »)
// est remis en page sur tout l'écran, avec le plus grand corps possible, pour être lu de loin.
import { store } from "./store";
import { walk, type SceneNode, type TextNode } from "./model";
import { computeNumbering, prepareText, varsFor } from "./templates";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Couleur trop claire sur fond blanc (texte blanc d'une étiquette…) : remplacée par le bleu marine. */
function readable(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.82 ? "#10213f" : hex;
}

/** HTML du texte contenu dans ces étapes (dans l'ordre), ou "" s'il n'y en a pas. */
export function stepsHtml(ids: string[], pageIndex: number): string {
  const doc = store.doc;
  const vars = varsFor(doc, pageIndex);
  const numbers = computeNumbering(doc);
  const blocks: string[] = [];
  for (const id of ids) {
    const node = store.find(id)?.node;
    if (!node) continue;
    const texts: TextNode[] = [];
    walk([node as SceneNode], (n) => { if (n.type === "text" && n.visible !== false) texts.push(n); });
    if (!texts.length) continue;
    // corps de référence : le plus fréquent, pour garder les titres un peu plus grands
    const sizes = texts.flatMap((t) => t.paragraphs.flatMap((p) => p.runs.map((r) => r.size))).sort((a, b) => a - b);
    const base = sizes[Math.floor(sizes.length / 2)] || 50;
    const paras = texts.flatMap((t) => prepareText(t, numbers, doc.numbering, vars).paragraphs).map((p) => {
      const runs = p.runs.filter((r) => r.text).map((r) => {
        const em = Math.max(0.75, Math.min(1.6, r.size / base));
        const style = `font-family:'${r.font}',Arial,sans-serif;font-weight:${r.weight};${r.italic ? "font-style:italic;" : ""}${r.underline ? "text-decoration:underline;" : ""}color:${readable(r.color)};font-size:${em.toFixed(2)}em`;
        return `<span style="${style}">${esc(r.text.replace(/\t/g, "  ")).replace(/\n/g, "<br>")}</span>`;
      }).join("");
      return `<p style="text-align:${p.align === "justify" ? "left" : p.align}">${runs || "&nbsp;"}</p>`;
    });
    blocks.push(`<div class="tf-step">${paras.join("")}</div>`);
  }
  return blocks.join("");
}

/** Plus grand corps pour lequel le contenu tient entièrement dans la boîte (recherche par dichotomie). */
export function fitText(box: HTMLElement, content: HTMLElement) {
  let lo = 10, hi = 420;
  const fits = (px: number) => {
    content.style.fontSize = `${px}px`;
    return content.scrollHeight <= box.clientHeight && content.scrollWidth <= box.clientWidth + 1;
  };
  for (let k = 0; k < 14; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  content.style.fontSize = `${Math.floor(lo)}px`;
}

/** Styles de l'affichage plein écran, partagés par la vue professeur et la fenêtre de projection. */
export const TEXTFS_CSS = `
.textfs { position: absolute; inset: 0; z-index: 4; background: #fff; display: flex; flex-direction: column; }
.textfs .tf-box { flex: 1; min-height: 0; margin: 4vh 5vw; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.textfs .tf-content { line-height: 1.25; color: #10213f; max-width: 100%; }
.textfs .tf-content p { margin: 0 0 .35em; overflow-wrap: normal; }
.textfs .tf-step + .tf-step { margin-top: .6em; padding-top: .5em; border-top: .06em solid #c9d4f4; }
.textfs .tf-empty { color: #9aa3b5; font: 600 3vw system-ui, sans-serif; }
`;
