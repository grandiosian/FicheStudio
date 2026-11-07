// Export « script Affinity » : un fichier .js autonome qui reconstruit le document
// en .af natif quand on l'exécute dans Affinity (panneau Scripts ou passerelle MCP).
// Chaque appel du SDK utilisé ici a été validé dans Affinity 3.3.
import type { Doc, Mat, Paint, Paragraph, SceneNode, Stroke } from "../model";
import { masterAreas } from "../model";
import { apply, mul, rotationOf, shapeToSubpaths } from "../geom";
import { boundColor, computeNumbering, prepareText, varsFor } from "../templates";
import { cutLines, masterLayerMatrix } from "../render";
import { CUT } from "../charte";
import { assetBytes } from "../assets";

interface Ctx { vars: Record<string, string>; numbers: Map<Paragraph, string> }

type Color = [number, number, number, number]; // RVBA 0-255
interface XStroke { color: Color | null; width: number; dash: number[] | null; cap: number; join: number }
type Item =
  | { k: "path"; name: string; sub: { closed: boolean; pts: number[][] }[]; fill: Color | null; stroke: XStroke; opacity: number; hidden: boolean; children?: Item[] }
  | { k: "rect" | "ellipse"; name: string; box: number[]; fill: Color | null; stroke: XStroke; opacity: number; hidden: boolean; children?: Item[] }
  | { k: "text"; name: string; frame: number[] | null; angle: number; origin: number[]; paras: { align: number; lh: number; li: number; ri: number; fi: number; sb: number; sa: number; tab: number; runs: { t: string; font: string; size: number; weight: number; italic: boolean; color: Color }[] }[]; opacity: number; hidden: boolean }
  | { k: "image"; name: string; w: number; h: number; px: string; m: number[]; opacity: number; hidden: boolean }
  | { k: "group"; name: string; children: Item[]; opacity: number; hidden: boolean; tag?: Color | null };

const hex = (c: string, o = 1): Color => {
  const v = parseInt(c.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, Math.round(o * 255)];
};
const paintColor = (p: Paint, bound: string | null = null): Color | null =>
  bound ? hex(bound, p.type === "solid" ? p.opacity : 1) : p.type === "solid" ? hex(p.color, p.opacity) : p.type === "linear" || p.type === "radial" ? (p.stops[0] ? hex(p.stops[0].color, p.stops[0].opacity) : null) : null;
const r2 = (v: number) => Math.round(v * 100) / 100;

function xstroke(s: Stroke, scale: number, bound: string | null = null): XStroke {
  const c = s.width > 0 ? paintColor(s.paint, bound) : null;
  return {
    color: c, width: r2(s.width * scale), dash: s.dash,
    cap: { butt: 0, round: 1, square: 2 }[s.cap], join: { miter: 0, round: 1, bevel: 2 }[s.join],
  };
}

async function pixels(doc: Doc, asset: string, w: number, h: number): Promise<{ w: number; h: number; px: string }> {
  const { data, mime } = await assetBytes(doc, asset); // intégrée ou liée
  const url = URL.createObjectURL(new Blob([data], { type: mime || "image/png" }));
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  const rgba = g.getImageData(0, 0, w, h).data;
  let bin = "";
  for (let i = 0; i < rgba.length; i += 0x8000) bin += String.fromCharCode(...rgba.subarray(i, i + 0x8000));
  return { w, h, px: btoa(bin) };
}

async function flatten(doc: Doc, n: SceneNode, parent: Mat, cx: Ctx): Promise<Item | null> {
  const M = mul(parent, n.transform);
  const sc = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])) || 1;
  const common = { name: n.name, opacity: n.opacity, hidden: !n.visible };
  const axis = Math.abs(M[1]) < 1e-6 && Math.abs(M[2]) < 1e-6 && M[0] > 0 && M[3] > 0;
  switch (n.type) {
    case "group": {
      const kids: Item[] = [];
      for (const c of n.children) { const it = await flatten(doc, c, M, cx); if (it) kids.push(it); }
      if (n.mask) {
        const m = await flatten(doc, n.mask, M, cx);
        if (m && (m.k === "path" || m.k === "rect" || m.k === "ellipse")) {
          m.children = kids;
          return { k: "group", ...common, tag: n.tag ? hex(n.tag) : null, children: [m] };
        }
      }
      return { k: "group", ...common, tag: n.tag ? hex(n.tag) : null, children: kids };
    }
    case "shape": {
      const plain = n.kind === "rect" && n.radius.every((r) => r === 0);
      if ((plain || n.kind === "ellipse") && axis) {
        const p = apply(M, { x: n.x, y: n.y }), q = apply(M, { x: n.x + n.w, y: n.y + n.h });
        return { k: n.kind === "ellipse" ? "ellipse" : "rect", ...common, box: [p.x, p.y, q.x - p.x, q.y - p.y].map(r2), fill: paintColor(n.fill, boundColor(n.bind?.fill, cx.vars)), stroke: xstroke(n.stroke, sc, boundColor(n.bind?.stroke, cx.vars)) };
      }
      // rectangles arrondis et formes tournées : en courbes (le SDK ignore les rayons de coins)
      return flatten(doc, { ...n, type: "path", subpaths: shapeToSubpaths(n) } as unknown as SceneNode, parent, cx);
    }
    case "path": {
      const sub = n.subpaths.map((sp) => {
        const pts: number[][] = [];
        sp.points.forEach((a, i) => {
          const A = apply(M, a);
          if (i === 0) { pts.push([0, A.x, A.y]); return; }
          const prev = sp.points[i - 1];
          if (prev.out || a.in) {
            const c1 = apply(M, prev.out ?? prev), c2 = apply(M, a.in ?? a);
            pts.push([1, c1.x, c1.y, c2.x, c2.y, A.x, A.y]);
          } else pts.push([0, A.x, A.y]);
        });
        if (sp.closed && sp.points.length > 1) {
          const a = sp.points[0], prev = sp.points[sp.points.length - 1];
          if (prev.out || a.in) {
            const c1 = apply(M, prev.out ?? prev), c2 = apply(M, a.in ?? a), A = apply(M, a);
            pts.push([1, c1.x, c1.y, c2.x, c2.y, A.x, A.y]);
          }
        }
        return { closed: sp.closed, pts: pts.map((p) => p.map(r2)) };
      });
      return { k: "path", ...common, sub, fill: paintColor(n.fill, boundColor(n.bind?.fill, cx.vars)), stroke: xstroke(n.stroke, sc, boundColor(n.bind?.stroke, cx.vars)) };
    }
    case "text": {
      const t = prepareText(n, cx.numbers, doc.numbering, cx.vars);
      const sx = Math.hypot(M[0], M[1]), sy = Math.hypot(M[2], M[3]);
      const g = Math.sqrt(sx * sy);
      const angle = rotationOf(M);
      const o = apply(M, t.frame ? { x: t.frame.x, y: t.frame.y } : { x: 0, y: 0 });
      const frame = t.frame ? [0, 0, t.frame.w * sx, t.frame.h * sy] : null;
      return {
        k: "text", ...common, frame: frame?.map(r2) ?? null, angle, origin: [r2(o.x), r2(o.y)],
        paras: t.paragraphs.map((p) => ({
          align: { left: 0, center: 1, right: 2, justify: 3 }[p.align],
          lh: p.lineHeight || 1, li: r2((p.leftIndent ?? 0) * g), ri: r2((p.rightIndent ?? 0) * g), fi: r2((p.firstIndent ?? 0) * g),
          sb: r2(p.spaceBefore * g), sa: r2(p.spaceAfter * g), tab: r2((p.tabStop || 50) * g),
          runs: p.runs.filter((r) => r.text).map((r) => ({ t: r.text.replace(/\n/g, " "), font: r.font, size: r2(r.size * g), weight: r.weight, italic: r.italic, color: hex(r.color, r.opacity) })),
        })),
      };
    }
    case "image": {
      const sx = Math.hypot(M[0], M[1]);
      // résolution limitée à la taille affichée (et à 2000 px) pour garder un script raisonnable
      const w = Math.max(1, Math.round(Math.min(n.w, n.w * sx, (2000 * n.w) / Math.max(n.w, n.h))));
      const h = Math.max(1, Math.round((n.h * w) / n.w));
      const { px } = await pixels(doc, n.asset, w, h);
      // matrice : pixels (0..w) -> page
      const m = mul(M, [n.w / w, 0, 0, n.h / h, 0, 0]);
      return { k: "image", ...common, w, h, px, m: m.map((v) => +v.toFixed(6)) };
    }
  }
}

export async function buildAffinityScript(doc: Doc, row: Record<string, string> | null = null): Promise<string> {
  const pages = [];
  const numbers = computeNumbering(doc);
  for (const [pi, p] of doc.pages.entries()) {
    const layers: Item[] = [];
    // gabarit : une fois sur la feuille, ou recopié dans chaque partie
    const master = doc.masters.find((m) => m.id === p.master);
    if (master) {
      const rects = masterAreas(p);
      for (const { rect: r, section: si } of rects) {
        const kids: Item[] = [];
        for (const l of master.layers) {
          const it = await flatten(doc, l, masterLayerMatrix(master, l.anchor, r), { vars: varsFor(doc, pi, si, row), numbers });
          if (it) kids.push(it);
        }
        layers.push({ k: "group", name: rects.length > 1 ? `Gabarit ${master.name} – partie ${si + 1}` : `Gabarit ${master.name}`, opacity: 1, hidden: false, children: kids });
      }
    }
    for (const l of p.layers) {
      const it = await flatten(doc, l, [1, 0, 0, 1, 0, 0], { vars: varsFor(doc, pi, 0, row), numbers });
      if (it) layers.push(it);
    }
    const cuts = cutLines(p);
    if (cuts.length) {
      const w = CUT.width * p.width / 2480;
      layers.push({ k: "group", name: "Découpe", opacity: 1, hidden: false, children: cuts.map(([x1, y1, x2, y2]) => ({
        k: "path" as const, name: "Ligne de découpe", opacity: 1, hidden: false, fill: null,
        sub: [{ closed: false, pts: [[0, x1, y1], [0, x2, y2]] }],
        stroke: { color: [47, 87, 161, 255] as Color, width: w, dash: CUT.dash, cap: 1, join: 1 },
      })) });
    }
    pages.push({ name: p.name, w: p.width, h: p.height, bg: p.background ? hex(p.background) : null, layers });
  }
  const data = { name: doc.name, dpi: doc.dpi, pages };
  return `// ${doc.name} — script généré par FicheStudio le ${new Date().toLocaleString("fr-FR")}
// Exécuter dans Affinity (panneau Scripts, ou via la passerelle) : crée un nouveau document .af natif.
// Ensuite : Fichier > Enregistrer sous…
'use strict';
const DATA = ${JSON.stringify(data)};
${RUNTIME}`;
}

// Partie exécutée dans Affinity (JavaScript du SDK, pas de TypeScript).
const RUNTIME = String.raw`
const { Document, NewDocumentOptions, UnitType } = require('/document.js');
const N = require('/nodes.js');
const G = require('/geometry.js');
const F = require('/fills.js');
const C = require('/colours.js');
const LS = require('/linestyle.js');
const S = require('/shapes.js');
const RO = require('/rasterobject.js');
const R = require('affinity:raster');
const NativeRGBA8 = require('affinity:colours').RGBA8;
const { StoryBuilder } = require('/storybuilder.js');
const { Font, FontWeight, FontWidth } = require('/fonts.js');
const { ParagraphAlignXType } = require('/paragraphatts.js');
const { DocumentCommand } = require('/commands.js');

const opts = NewDocumentOptions.createDefault();
opts.units = UnitType.Pixel;
opts.dpi = DATA.dpi;
opts.width = DATA.pages[0].w;
opts.height = DATA.pages[0].h;
opts.pageCount = DATA.pages.length;
opts.isMultiPage = DATA.pages.length > 1;
opts.createMaster = false;
const doc = Document.create(opts);

const col = (c) => C.RGBA8(c[0], c[1], c[2], c[3]);
const fillOf = (c) => (c ? F.FillDescriptor.createSolid(col(c)) : F.FillDescriptor.createNone());
function lineOf(s) {
  const ls = LS.LineStyle.create({ weight: s.color ? s.width : 0 });
  if (s.dash && s.dash.length) { ls.type = LS.LineType.Dash; ls.dashPattern = s.dash; }
  try { ls.cap = [LS.LineCap.Butt, LS.LineCap.Round, LS.LineCap.Square][s.cap]; ls.join = [LS.LineJoin.Miter, LS.LineJoin.Round, LS.LineJoin.Bevel][s.join]; } catch (e) {}
  return LS.LineStyleDescriptor.create(ls);
}
const last = (parent) => { const k = [...parent.children]; return k[k.length - 1]; };
const ALIGN = [ParagraphAlignXType.Left, ParagraphAlignXType.Centre, ParagraphAlignXType.Right, ParagraphAlignXType.Justify];
const WEIGHTS = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Normal', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

function b64(s) {
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map = new Uint8Array(128); for (let i = 0; i < 64; i++) map[T.charCodeAt(i)] = i;
  const n = s.length, pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((n * 3) / 4 - pad);
  for (let i = 0, j = 0; i < n; i += 4) {
    const v = (map[s.charCodeAt(i)] << 18) | (map[s.charCodeAt(i + 1)] << 12) | (map[s.charCodeAt(i + 2)] << 6) | map[s.charCodeAt(i + 3)];
    if (j < out.length) out[j++] = (v >> 16) & 255;
    if (j < out.length) out[j++] = (v >> 8) & 255;
    if (j < out.length) out[j++] = v & 255;
  }
  return out;
}

function finish(node, it) {
  if (!node) return;
  try { if (it.name) node.userDescription = it.name; } catch (e) {}
  if (it.opacity < 1) doc.setOpacity(it.opacity, [node]);
  if (it.hidden) doc.setVisible(false, [node]);
}

function add(it, parent) {
  if (it.k === 'group') {
    doc.addNode(N.ContainerNodeDefinition.create(it.name), parent);
    const g = last(parent);
    for (const c of it.children) add(c, g);
    if (it.tag) { try { doc.setTagColour(col(it.tag), [g]); } catch (e) {} }
    finish(g, it);
    return;
  }
  if (it.k === 'rect' || it.k === 'ellipse') {
    const shape = it.k === 'ellipse' ? S.ShapeEllipse.create() : S.ShapeRectangle.create();
    const b = it.box;
    doc.addNode(N.ShapeNodeDefinition.create(shape, new G.Rectangle(b[0], b[1], b[2], b[3]), fillOf(it.fill), fillOf(it.stroke.color), lineOf(it.stroke)), parent);
  } else if (it.k === 'path') {
    const pc = G.PolyCurve.create();
    for (const sp of it.sub) {
      if (!sp.pts.length) continue;
      const cb = G.CurveBuilder.create();
      cb.beginXY(sp.pts[0][1], sp.pts[0][2]);
      for (let i = 1; i < sp.pts.length; i++) {
        const p = sp.pts[i];
        if (p[0] === 1) cb.addBezierXY(p[1], p[2], p[3], p[4], p[5], p[6]); else cb.lineToXY(p[1], p[2]);
      }
      if (sp.closed) cb.close();
      pc.addCurve(cb.createCurve(), true);
    }
    const none = F.FillDescriptor.createNone();
    doc.addNode(N.PolyCurveNodeDefinition.create(pc, fillOf(it.fill), fillOf(it.stroke.color), lineOf(it.stroke), none), parent);
  } else if (it.k === 'text') {
    const sb = StoryBuilder.create();
    sb.setToFrameTextDefaultStyle(doc.dpi, doc.format);
    it.paras.forEach((p, i) => {
      if (i) sb.addText(' ');
      const pa = sb.paragraphAtts; pa.alignXType = ALIGN[p.align] || ParagraphAlignXType.Left;
      pa.relativeLeading = p.lh; pa.leftIndent = p.li; pa.rightIndent = p.ri; pa.firstLineIndent = p.fi;
      pa.spaceBefore = p.sb; pa.spaceAfter = p.sa; pa.defaultTabStops = p.tab;
      sb.setParagraphAtts(pa);
      for (const r of p.runs) {
        const g = sb.glyphAtts;
        let w = FontWeight[WEIGHTS[Math.round(r.weight / 100) * 100] || 'Normal'];
        if (w === undefined) w = r.weight >= 600 ? FontWeight.Bold : FontWeight.Normal;
        g.font = Font.create(r.font, w, r.italic, FontWidth.Normal);
        g.height = r.size;
        g.brushFill = F.FillDescriptor.createSolid(col(r.color));
        sb.setGlyphAtts(g);
        sb.addText(r.t);
      }
    });
    if (it.frame) doc.addNode(N.FrameTextNodeDefinition.createFromStoryBuilder(new G.Rectangle(0, 0, it.frame[2], it.frame[3]), sb), parent);
    else doc.addNode(N.ArtTextNodeDefinition.createFromStoryBuilder(new G.Point(0, 0), sb), parent);
    const node = last(parent);
    if (Math.abs(it.angle) > 1e-4) doc.applyTransform(G.Transform.createRotate(it.angle), [node]);
    doc.applyTransform(G.Transform.createTranslate(it.origin[0], it.origin[1]), [node]);
    finish(node, it);
    return;
  } else if (it.k === 'image') {
    const bm = RO.Bitmap.create(it.w, it.h, RO.RasterFormat.RGBA8);
    const pw = R.PixelReaderWriterRGBA8Api.create(bm.handle);
    const px = b64(it.px), c = new NativeRGBA8();
    for (let y = 0, i = 0; y < it.h; y++) for (let x = 0; x < it.w; x++, i += 4) {
      c.r = px[i]; c.g = px[i + 1]; c.b = px[i + 2]; c.alpha = px[i + 3];
      R.PixelReaderWriterRGBA8Api.writePixel(pw, x, y, c);
    }
    R.PixelReaderWriterRGBA8Api.dispose(pw);
    const def = N.ImageNodeDefinition.create(RO.RasterFormat.RGBA8);
    def.bitmap = bm;
    doc.addNode(def, parent);
    const node = last(parent);
    // m = [a, b, c, d, e, f] : échelle, rotation puis translation
    const m = it.m, sx = Math.hypot(m[0], m[1]), rot = Math.atan2(m[1], m[0]), sy = (m[0] * m[3] - m[1] * m[2]) / (sx || 1);
    doc.applyTransform(G.Transform.createScale(sx, sy), [node]);
    if (Math.abs(rot) > 1e-6) doc.applyTransform(G.Transform.createRotate(rot), [node]);
    doc.applyTransform(G.Transform.createTranslate(m[4], m[5]), [node]);
    finish(node, it);
    return;
  }
  const node = last(parent);
  if (it.children && it.children.length) for (const c of it.children) add(c, node); // enfants découpés par la forme
  finish(node, it);
}

const spreads = [...doc.spreads];
DATA.pages.forEach((page, i) => {
  const sp = spreads[i];
  if (!sp) return;
  if (i) doc.executeCommand(DocumentCommand.createSetCurrentSpread(sp));
  for (const l of page.layers) add(l, sp);
});
console.log('FicheStudio : document « ' + DATA.name + ' » reconstruit (' + DATA.pages.length + ' page(s)).');
`;
