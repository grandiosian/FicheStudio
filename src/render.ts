// Modèle -> SVG (affichage dans l'éditeur et exports).
import type { Doc, Master, Page, Paint, Paragraph, SceneNode, Stroke, TextNode } from "./model";
import { masterAreas, sectionRects } from "./model";
import { fmt, isIdentity, shapeToD, subpathsToD, svgMatrix } from "./geom";
import { layoutText } from "./textlayout";
import { boundColor, computeNumbering, prepareText, varsFor } from "./templates";
import { assetUrl } from "./assets";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface RenderOpts {
  row?: Record<string, string> | null;  // ligne de données (publipostage)
  editor?: boolean;                     // ajoute data-id pour la sélection
  showHidden?: boolean;
  cutMarks?: boolean;                   // lignes de découpe entre les parties (défaut : oui)
}

class Ctx {
  defs: string[] = [];
  n = 0;
  vars: Record<string, string> = {};
  numbers: Map<Paragraph, string>;
  constructor(public doc: Doc, public opts: RenderOpts) { this.numbers = computeNumbering(doc); }
  id(p: string) { return `${p}${++this.n}`; }
}

function paint(c: Ctx, p: Paint, bound?: string | null): { v: string; o: number } {
  if (bound) return { v: bound, o: p.type === "solid" ? p.opacity : 1 };
  if (p.type === "none") return { v: "none", o: 1 };
  if (p.type === "solid") return { v: p.color, o: p.opacity };
  const id = c.id("grad");
  const stops = p.stops.map((s) => `<stop offset="${fmt(s.offset)}" stop-color="${s.color}" stop-opacity="${fmt(s.opacity)}"/>`).join("");
  if (p.type === "linear") {
    const r = (p.angle * Math.PI) / 180, dx = Math.cos(r) / 2, dy = Math.sin(r) / 2;
    c.defs.push(`<linearGradient id="${id}" x1="${fmt(0.5 - dx)}" y1="${fmt(0.5 - dy)}" x2="${fmt(0.5 + dx)}" y2="${fmt(0.5 + dy)}">${stops}</linearGradient>`);
  } else c.defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
  return { v: `url(#${id})`, o: 1 };
}

function styleOf(c: Ctx, n: { fill: Paint; stroke: Stroke; bind?: { fill?: string; stroke?: string } }): string {
  const f = paint(c, n.fill, boundColor(n.bind?.fill, c.vars));
  const parts = [`fill:${f.v}`];
  if (f.o < 1) parts.push(`fill-opacity:${fmt(f.o)}`);
  const stroke = n.stroke;
  const s = paint(c, stroke.paint, boundColor(n.bind?.stroke, c.vars));
  if (stroke.width > 0 && s.v !== "none") {
    parts.push(`stroke:${s.v}`, `stroke-width:${fmt(stroke.width)}`, `stroke-linecap:${stroke.cap}`, `stroke-linejoin:${stroke.join}`);
    if (s.o < 1) parts.push(`stroke-opacity:${fmt(s.o)}`);
    if (stroke.dash?.length) parts.push(`stroke-dasharray:${stroke.dash.map((d) => fmt(Math.max(d, 0.01) * stroke.width)).join(",")}`);
  } else parts.push("stroke:none");
  return parts.join(";");
}

function attrs(c: Ctx, n: SceneNode, editable: boolean): string {
  const a: string[] = [];
  if (c.opts.editor && editable) a.push(`data-id="${n.id}"`);
  if (!isIdentity(n.transform)) a.push(`transform="${svgMatrix(n.transform)}"`);
  if (n.opacity < 1) a.push(`style="opacity:${fmt(n.opacity)}"`);
  if (!c.opts.editor && n.name) a.push(`inkscape:label="${esc(n.name)}"`);
  return a.join(" ");
}

function geometry(n: SceneNode): string | null {
  if (n.type === "shape") return shapeToD(n);
  if (n.type === "path") return subpathsToD(n.subpaths);
  return null;
}

function text(c: Ctx, n: TextNode, editable: boolean): string {
  const t = prepareText(n, c.numbers, c.doc.numbering.suffix, c.vars);
  const lines = layoutText(t);
  const out: string[] = [];
  for (const l of lines) {
    if (!l.spans.length) continue;
    const spans = l.spans.map((s) => {
      const r = s.run;
      const st = [`font-family:'${r.font}'`, `font-size:${fmt(r.size)}px`, `font-weight:${r.weight}`, `fill:${r.color}`];
      if (r.italic) st.push("font-style:italic");
      if (r.underline) st.push("text-decoration:underline");
      if (r.opacity < 1) st.push(`fill-opacity:${fmt(r.opacity)}`);
      return `<tspan x="${fmt(s.x)}" style="${st.join(";")}">${esc(s.text)}</tspan>`;
    }).join("");
    out.push(`<text xml:space="preserve" y="${fmt(l.y)}"${l.wordSpacing ? ` word-spacing="${fmt(l.wordSpacing)}"` : ""}>${spans}</text>`);
  }
  let hit = "";
  if (c.opts.editor && editable) {
    // zone cliquable : cadre, ou boîte approximative du texte artistique
    const f = n.frame ?? { x: Math.min(0, ...lines.map((l) => l.spans[0]?.x ?? 0)), y: -60, w: Math.max(40, ...lines.map((l) => l.width)), h: Math.max(80, lines.length * 60) };
    hit = `<rect class="hit" x="${fmt(f.x)}" y="${fmt(f.y)}" width="${fmt(f.w)}" height="${fmt(f.h)}" fill="transparent"/>`;
  }
  return `<g ${attrs(c, n, editable)}>${hit}${out.join("")}</g>`;
}

function renderNode(c: Ctx, n: SceneNode, editable = true): string {
  if (!n.visible && !c.opts.showHidden) return "";
  switch (n.type) {
    case "shape":
    case "path":
      return `<path d="${geometry(n)}" style="${styleOf(c, n)}" ${attrs(c, n, editable)}/>`;
    case "text":
      return text(c, n, editable);
    case "image": {
      const a = c.doc.assets[n.asset];
      const href = assetUrl(n.asset, a);
      if (!href) {
        // image liée introuvable : cadre de remplacement
        return `<g ${attrs(c, n, editable)}><rect width="${fmt(n.w)}" height="${fmt(n.h)}" fill="#eef1f7" stroke="#c0392b" stroke-width="${fmt(Math.max(n.w, n.h) / 150)}" stroke-dasharray="12 8"/><text x="${fmt(n.w / 2)}" y="${fmt(n.h / 2)}" text-anchor="middle" style="font:${fmt(Math.max(n.w, n.h) / 18)}px Arial;fill:#c0392b">Lien manquant : ${esc(a?.name ?? "")}</text></g>`;
      }
      return `<image width="${fmt(n.w)}" height="${fmt(n.h)}" preserveAspectRatio="none" href="${esc(href)}" ${attrs(c, n, editable)}/>`;
    }
    case "group": {
      const kids = n.children.map((k) => renderNode(c, k, editable)).join("");
      const layer = n.isLayer && !c.opts.editor ? ' inkscape:groupmode="layer"' : "";
      if (n.mask) {
        const d = geometry(n.mask);
        const cid = c.id("clip");
        const mt = isIdentity(n.mask.transform) ? "" : ` transform="${svgMatrix(n.mask.transform)}"`;
        if (d) c.defs.push(`<clipPath id="${cid}"><path d="${d}"${mt}/></clipPath>`);
        return `<g${layer} ${attrs(c, n, editable)}>${renderNode(c, n.mask, editable)}${d ? `<g clip-path="url(#${cid})">${kids}</g>` : kids}</g>`;
      }
      return `<g${layer} ${attrs(c, n, editable)}>${kids}</g>`;
    }
  }
}

/** Placement d'un calque de gabarit dans une partie de feuille. */
export function masterLayerMatrix(m: Master, anchor: string | undefined, r: { x: number; y: number; w: number; h: number }): [number, number, number, number, number, number] {
  const s = r.w / m.width;
  const ty = anchor === "bottom" ? r.y + r.h - m.height * s : r.y;
  return [s, 0, 0, s, r.x, ty];
}

/** Lignes de découpe entre les parties (repère de la page). */
export function cutLines(p: Page): [number, number, number, number][] {
  const rects = sectionRects(p);
  return rects.slice(1).map((r) => (p.split === "v" ? [r.x, 0, r.x, p.height] : [0, r.y, p.width, r.y]));
}

export function renderPage(doc: Doc, page: Page, opts: RenderOpts = {}): { defs: string; body: string } {
  const c = new Ctx(doc, opts);
  const pi = Math.max(0, doc.pages.indexOf(page));
  const bg = page.background ? `<rect class="page-bg" x="0" y="0" width="${page.width}" height="${page.height}" fill="${page.background}"/>` : "";
  const parts: string[] = [bg];
  // gabarit dans chaque partie de la feuille
  const master = doc.masters.find((m) => m.id === page.master);
  if (master && doc.pages.includes(page)) {
    masterAreas(page).forEach(({ rect: r, section: si }) => {
      c.vars = varsFor(doc, pi, si, opts.row ?? null);
      for (const l of master.layers) {
        if (!l.visible) continue;
        const m = masterLayerMatrix(master, l.anchor, r);
        parts.push(`<g class="master" transform="${svgMatrix(m)}">${renderNode(c, l, false)}</g>`);
      }
    });
  }
  c.vars = varsFor(doc, pi, 0, opts.row ?? null);
  parts.push(...page.layers.map((l) => renderNode(c, l)));
  if (opts.cutMarks !== false)
    for (const [x1, y1, x2, y2] of cutLines(page)) {
      const w = page.width / 600;
      parts.push(`<g class="cut"><line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="#555" stroke-width="${fmt(w)}" stroke-dasharray="${fmt(w * 6)},${fmt(w * 4)}"/>`
        + `<text x="${fmt(x1 + (x1 === x2 ? -w * 9 : w * 10))}" y="${fmt(y1 + (x1 === x2 ? w * 20 : w * 7))}" style="font:${fmt(w * 16)}px Arial;fill:#555">✂</text></g>`);
    }
  return { defs: c.defs.join(""), body: parts.join("") };
}

/** SVG autonome d'une page (dimensions physiques en mm). */
export function pageToSvg(doc: Doc, page: Page, row: Record<string, string> | null = null): string {
  const { defs, body } = renderPage(doc, page, { row });
  const mm = (px: number) => fmt((px / doc.dpi) * 25.4);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${mm(page.width)}mm" height="${mm(page.height)}mm" viewBox="0 0 ${page.width} ${page.height}">
<defs>${defs}</defs>${body}</svg>`;
}
