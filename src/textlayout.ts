// Composition du texte, calée sur Affinity (mesures faites dans Affinity 3.3) :
// - 1re ligne d'un cadre : la hauteur des capitales touche le haut du cadre ;
// - interligne = interligne « idéal » de la police (ascendante + descendante + interligne
//   typographique) × interligne relatif du paragraphe ;
// - retraits gauche/droit/1re ligne, tabulations à pas régulier depuis le bord du cadre,
//   espaces avant/après paragraphe.
import type { Paragraph, Run, TextNode } from "./model";

const ctx = document.createElement("canvas").getContext("2d")!;

export const cssFont = (r: Pick<Run, "italic" | "weight" | "size" | "font">) =>
  `${r.italic ? "italic " : ""}${r.weight} ${r.size}px "${r.font}", sans-serif`;

// Interligne idéal mesuré dans Affinity (em) : le canevas ne donne pas l'interligne typographique (lineGap).
const IDEAL: Record<string, number> = { Arial: 1.15, "Arial Narrow": 1.1475, "Arial Black": 1.41, Helvetica: 1.15 };

interface Metrics { cap: number; ideal: number; asc: number; desc: number }
const metricCache = new Map<string, Metrics>();
export function fontMetrics(r: Pick<Run, "italic" | "weight" | "font">): Metrics {
  const key = `${r.font}|${r.weight}|${r.italic}`;
  let m = metricCache.get(key);
  if (!m) {
    ctx.font = cssFont({ ...r, size: 100 });
    const t = ctx.measureText("H");
    const asc = t.fontBoundingBoxAscent || 91, desc = t.fontBoundingBoxDescent || 21;
    m = { cap: (t.actualBoundingBoxAscent || 71.6) / 100, ideal: IDEAL[r.font] ?? (asc + desc) / 100, asc: asc / 100, desc: desc / 100 };
    metricCache.set(key, m);
  }
  return m;
}

function measure(r: Run, s: string): number {
  ctx.font = cssFont(r);
  return ctx.measureText(s).width;
}

export interface LineSpan { run: Run; text: string; x: number; width: number }
export interface Line { y: number; spans: LineSpan[]; width: number; height: number; para: Paragraph; last: boolean; wordSpacing?: number }

type Token = { run: Run; text: string; kind: "word" | "space" | "tab" | "break" };

function tokens(p: Paragraph): Token[] {
  const out: Token[] = [];
  for (const r of p.runs)
    for (const part of r.text.split(/(\t|\n| +)/)) {
      if (!part) continue;
      out.push({ run: r, text: part, kind: part === "\t" ? "tab" : part === "\n" ? "break" : part.trim() ? "word" : "space" });
    }
  return out;
}

export function layoutText(t: TextNode): Line[] {
  const lines: Line[] = [];
  const frame = t.frame;
  const width = frame ? frame.w : Infinity;
  let baseline = frame ? frame.y : 0;
  let prevAfter = 0;
  let firstLine = true;
  for (const p of t.paragraphs) {
    const left = p.leftIndent ?? 0, right = p.rightIndent ?? 0, first = p.firstIndent ?? 0;
    const tab = p.tabStop && p.tabStop > 1 ? p.tabStop : 50;
    const avail = width - right;
    const fallback = p.runs[0];
    const toks = tokens(p);
    let cur: LineSpan[] = [];
    let start = left + first;
    let x = start;
    let paraFirst = true;
    const flush = (last: boolean) => {
      while (cur.length && !cur[cur.length - 1].text.trim() && cur[cur.length - 1].text !== "\t") cur.pop();
      const runs = cur.length ? cur.map((s) => s.run) : fallback ? [fallback] : [];
      const cap = Math.max(0, ...runs.map((r) => fontMetrics(r).cap * r.size));
      const lh = Math.max(0, ...runs.map((r) => fontMetrics(r).ideal * r.size)) * (p.lineHeight || 1);
      if (firstLine) baseline += (frame ? p.spaceBefore + cap : 0);
      else baseline += (paraFirst ? prevAfter + p.spaceBefore : 0) + lh;
      firstLine = false;
      paraFirst = false;
      const end = cur.length ? cur[cur.length - 1].x + cur[cur.length - 1].width : start;
      lines.push({ y: baseline, spans: cur, width: end - start, height: lh, para: p, last });
      (lines[lines.length - 1] as Line & { start: number }).start = start;
      cur = [];
      start = left;
      x = start;
    };
    for (const tk of toks) {
      if (tk.kind === "break") { flush(false); continue; }
      if (tk.kind === "tab") {
        const nx = (Math.floor(x / tab + 1e-6) + 1) * tab;
        cur.push({ run: tk.run, text: "\t", x, width: nx - x });
        x = nx;
        continue;
      }
      const w = measure(tk.run, tk.text);
      if (tk.kind === "word" && x + w > avail && cur.some((s) => s.text.trim())) flush(false);
      if (tk.kind === "space" && !cur.length && !paraFirst) continue; // espaces en début de ligne coupée
      const prev = cur[cur.length - 1];
      if (prev && prev.run === tk.run && prev.text !== "\t") { prev.text += tk.text; prev.width += w; }
      else cur.push({ run: tk.run, text: tk.text, x, width: w });
      x += w;
    }
    flush(true);
    prevAfter = p.spaceAfter;
  }
  // alignement horizontal
  for (const l of lines) {
    const start = (l as Line & { start: number }).start;
    const a = l.para.align;
    const right = l.para.rightIndent ?? 0;
    let shift = 0;
    if (frame) {
      const free = frame.w - right - start - l.width;
      if (a === "center") shift = free / 2;
      else if (a === "right") shift = free;
      else if (a === "justify" && !l.last && !l.spans.some((s) => s.text === "\t")) {
        const gaps = l.spans.reduce((n, s) => n + (s.text.match(/ /g)?.length ?? 0), 0);
        if (gaps && free > 0) {
          l.wordSpacing = free / gaps;
          let acc = 0;
          for (const s of l.spans) { s.x += acc; acc += (s.text.match(/ /g)?.length ?? 0) * l.wordSpacing; }
        }
      }
    } else if (a === "center") shift = -l.width / 2;
    else if (a === "right") shift = -l.width;
    const x0 = (frame ? frame.x : 0) + shift;
    for (const s of l.spans) s.x += x0;
    l.spans = l.spans.filter((s) => s.text !== "\t");
  }
  return lines;
}

/** Hauteur occupée par le texte (pour signaler un débordement de cadre). */
export function textHeight(t: TextNode): number {
  const ls = layoutText(t);
  if (!ls.length) return 0;
  const last = ls[ls.length - 1];
  return last.y + last.height * 0.3 - (t.frame ? t.frame.y : 0);
}
