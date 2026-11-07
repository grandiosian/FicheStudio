// Export PDF intelligent : PDF vectoriel construit directement (pdf-lib), polices de
// l'ordinateur intégrées (API Local Font Access), un fichier unique, un fichier par feuille
// ou par partie de feuille, nommés d'après les feuilles ; ZIP s'il y a plusieurs fichiers.
import {
  PDFDocument, PDFFont, PDFName, PDFPage, StandardFonts,
  appendBezierCurve, beginText, clip, closePath, concatTransformationMatrix, drawObject, endPath, endText,
  fill, fillAndStroke, lineTo, moveTo, popGraphicsState, pushGraphicsState, setDashPattern, setFillingRgbColor,
  setFontAndSize, setGraphicsState, setLineCap, setLineJoin, setLineWidth, setStrokingRgbColor, setTextMatrix,
  showText, stroke, LineCapStyle, LineJoinStyle, type PDFOperator,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { zipSync } from "fflate";
import type { Doc, Mat, Paint, Paragraph, Run, SceneNode, SubPath } from "../model";
import { masterAreas, sectionRects } from "../model";
import { apply, shapeToSubpaths } from "../geom";
import { layoutText } from "../textlayout";
import { boundColor, computeNumbering, fileName, prepareText, varsFor } from "../templates";
import { cutLines, masterLayerMatrix } from "../render";
import { assetBytes } from "../assets";
import { download } from "./export";

export type Split = "single" | "sheet" | "section";
export interface PdfOptions {
  split: Split;
  series: boolean;            // une copie par ligne de données
  pattern: string;            // motif du nom de fichier
  zip: boolean;
  cutMarks: boolean;
  systemFonts: boolean;
}

// ------------------------------------------------------------------ polices

interface LocalFont { family: string; fullName: string; style: string; postscriptName: string; blob(): Promise<Blob> }
let localFonts: LocalFont[] | null = null;
const fontBytes = new Map<string, Uint8Array | null>();

async function loadLocalFonts(): Promise<boolean> {
  if (localFonts?.length) return true;
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
  if (!q) return false;
  try { localFonts = await q(); return localFonts.length > 0; } catch { return false; }
}

// ---- polices ajoutées par l'utilisateur (fichiers .ttf/.otf gardés dans le navigateur)

interface UserFont { key: string; family: string; style: string; bytes: Uint8Array }
let userFonts: UserFont[] | null = null;

function fontsDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("fichestudio-fonts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("fonts", { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function listUserFonts(): Promise<UserFont[]> {
  if (userFonts) return userFonts;
  try {
    const db = await fontsDb();
    userFonts = await new Promise((res) => { const r = db.transaction("fonts").objectStore("fonts").getAll(); r.onsuccess = () => res(r.result ?? []); r.onerror = () => res([]); });
  } catch { userFonts = []; }
  return userFonts!;
}

/** Ajoute des fichiers de police ; renvoie les noms reconnus. */
export async function addUserFonts(files: File[]): Promise<string[]> {
  const db = await fontsDb();
  const names: string[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    try {
      const font = (fontkit as unknown as { create: (b: Uint8Array) => { familyName: string; subfamilyName: string; fonts?: unknown[] } }).create(bytes);
      if (font.fonts) { names.push(`${f.name} (collection .ttc non prise en charge)`); continue; }
      const uf: UserFont = { key: `${font.familyName}|${font.subfamilyName}`, family: font.familyName, style: font.subfamilyName, bytes };
      await new Promise((res) => { const t = db.transaction("fonts", "readwrite"); t.objectStore("fonts").put(uf); t.oncomplete = res; t.onerror = res; });
      names.push(`${uf.family} ${uf.style}`);
    } catch { names.push(`${f.name} (illisible)`); }
  }
  userFonts = null;
  return names;
}

function pickUser(r: Run): UserFont | null {
  const fam = r.font.toLowerCase();
  const cands = (userFonts ?? []).filter((f) => f.family.toLowerCase() === fam);
  if (!cands.length) return null;
  const wantBold = r.weight >= 600 && !/black|heavy/i.test(r.font);
  const score = (f: UserFont) => {
    const st = f.style.toLowerCase();
    return (/bold|black|heavy|semibold/.test(st) === wantBold ? 2 : 0) + (/italic|oblique/.test(st) === r.italic ? 2 : 0) + (/regular|normal|book/.test(st) ? 0.5 : 0);
  };
  return cands.sort((a, b) => score(b) - score(a))[0];
}

/** Polices du document et leur disponibilité pour l'export. */
export async function fontReport(doc: Doc): Promise<{ font: string; ok: boolean }[]> {
  await listUserFonts();
  const set = new Set<string>();
  const visit = (nodes: SceneNode[]) => { for (const n of nodes) { if (n.type === "text") n.paragraphs.forEach((p) => p.runs.forEach((r) => set.add(r.font))); if (n.type === "group") visit(n.children); } };
  doc.pages.forEach((p) => visit(p.layers));
  doc.masters.forEach((m) => visit(m.layers));
  return [...set].map((font) => ({ font, ok: !!(userFonts ?? []).some((u) => u.family.toLowerCase() === font.toLowerCase()) || !!localFonts?.some((l) => l.family.toLowerCase() === font.toLowerCase()) }));
}

function pickLocal(r: Run): LocalFont | null {
  if (!localFonts) return null;
  const fam = r.font.toLowerCase();
  const cands = localFonts.filter((f) => f.family.toLowerCase() === fam);
  if (!cands.length) return null;
  const wantBold = r.weight >= 600 && !/black|heavy/i.test(r.font);
  const score = (f: LocalFont) => {
    const s = f.style.toLowerCase();
    const bold = /bold|black|heavy|semibold|demi/.test(s), it = /italic|oblique/.test(s);
    return (bold === wantBold ? 2 : 0) + (it === r.italic ? 2 : 0) + (/regular|normal|roman|book/.test(s) || s === "" ? 0.5 : 0);
  };
  return cands.sort((a, b) => score(b) - score(a))[0];
}

class Fonts {
  private cache = new Map<string, PDFFont>();
  missing = new Set<string>();
  constructor(private pdf: PDFDocument, private system: boolean) {}
  async get(r: Run): Promise<PDFFont> {
    const key = `${r.font}|${r.weight >= 600}|${r.italic}`;
    const c = this.cache.get(key);
    if (c) return c;
    let font: PDFFont | null = null;
    const lf = this.system ? pickLocal(r) : null;
    const uf = pickUser(r);
    if (uf) { try { font = await this.pdf.embedFont(uf.bytes, { subset: true }); } catch { font = null; } }
    if (!font && lf) {
      let bytes = fontBytes.get(lf.postscriptName);
      if (bytes === undefined) {
        try { bytes = new Uint8Array(await (await lf.blob()).arrayBuffer()); } catch { bytes = null; }
        fontBytes.set(lf.postscriptName, bytes);
      }
      if (bytes) { try { font = await this.pdf.embedFont(bytes, { subset: true }); } catch { font = null; } }
    }
    if (!font) {
      this.missing.add(r.font);
      const b = r.weight >= 600, i = r.italic;
      font = await this.pdf.embedFont(b && i ? StandardFonts.HelveticaBoldOblique : b ? StandardFonts.HelveticaBold : i ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica);
    }
    this.cache.set(key, font);
    return font;
  }
}

/** Texte encodable par la police (les polices standard ne couvrent que WinAnsi). */
function safeText(f: PDFFont, s: string): string {
  try { f.encodeText(s); return s; } catch {
    return Array.from(s).map((ch) => { try { f.encodeText(ch); return ch; } catch { return "?"; } }).join("");
  }
}

// ------------------------------------------------------------------ peintre

const rgbOf = (hex: string) => {
  const v = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255] as const;
};
const solidOf = (p: Paint, bound: string | null): { c: string; o: number } | null => {
  if (bound) return { c: bound, o: p.type === "solid" ? p.opacity : 1 };
  if (p.type === "solid") return { c: p.color, o: p.opacity };
  if (p.type === "linear" || p.type === "radial") return p.stops[0] ? { c: p.stops[0].color, o: p.stops[0].opacity } : null;
  return null;
};

class Painter {
  ops: PDFOperator[] = [];
  private gs = new Map<string, PDFName>();
  private fontKeys = new Map<PDFFont, PDFName>();
  private images = new Map<string, PDFName | null>();
  vars: Record<string, string> = {};
  constructor(private pdf: PDFDocument, private page: PDFPage, private doc: Doc, private fonts: Fonts, private numbers: Map<Paragraph, string>, private warn: Set<string>) {}

  private alpha(fillO: number, strokeO: number) {
    const k = `${fillO.toFixed(3)}|${strokeO.toFixed(3)}`;
    let n = this.gs.get(k);
    if (!n) {
      const ref = this.pdf.context.register(this.pdf.context.obj({ Type: "ExtGState", ca: fillO, CA: strokeO }));
      n = this.page.node.newExtGState("GS", ref);
      this.gs.set(k, n);
    }
    this.ops.push(setGraphicsState(n));
  }

  private path(sps: SubPath[], m?: Mat) {
    const P = (p: { x: number; y: number }) => (m ? apply(m, p) : p);
    for (const sp of sps) {
      const pts = sp.points;
      if (!pts.length) continue;
      const a0 = P(pts[0]);
      this.ops.push(moveTo(a0.x, a0.y));
      const n = sp.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const B = P(b);
        if (a.out || b.in) {
          const c1 = P(a.out ?? a), c2 = P(b.in ?? b);
          this.ops.push(appendBezierCurve(c1.x, c1.y, c2.x, c2.y, B.x, B.y));
        } else this.ops.push(lineTo(B.x, B.y));
      }
      if (sp.closed) this.ops.push(closePath());
    }
  }

  private vector(n: Extract<SceneNode, { type: "shape" | "path" }>, opacity: number, m?: Mat) {
    const sps = n.type === "shape" ? shapeToSubpaths(n) : n.subpaths;
    const f = solidOf(n.fill, boundColor(n.bind?.fill, this.vars));
    const st = n.stroke.width > 0 ? solidOf(n.stroke.paint, boundColor(n.bind?.stroke, this.vars)) : null;
    if (n.fill.type === "linear" || n.fill.type === "radial") this.warn.add("dégradés exportés en couleur unie");
    if (!f && !st) return;
    this.ops.push(pushGraphicsState());
    this.alpha((f?.o ?? 1) * opacity, (st?.o ?? 1) * opacity);
    if (f) this.ops.push(setFillingRgbColor(...rgbOf(f.c)));
    if (st) {
      this.ops.push(setStrokingRgbColor(...rgbOf(st.c)), setLineWidth(n.stroke.width));
      this.ops.push(setLineCap({ butt: LineCapStyle.Butt, round: LineCapStyle.Round, square: LineCapStyle.Projecting }[n.stroke.cap]));
      this.ops.push(setLineJoin({ miter: LineJoinStyle.Miter, round: LineJoinStyle.Round, bevel: LineJoinStyle.Bevel }[n.stroke.join]));
      if (n.stroke.dash?.length) this.ops.push(setDashPattern(n.stroke.dash.map((d) => Math.max(d, 0.01) * n.stroke.width), 0));
    }
    this.path(sps, m);
    this.ops.push(f && st ? fillAndStroke() : f ? fill() : stroke());
    this.ops.push(popGraphicsState());
  }

  private async image(n: Extract<SceneNode, { type: "image" }>, opacity: number) {
    let name = this.images.get(n.asset);
    if (name === undefined) {
      name = null;
      try {
        const { data, mime } = await assetBytes(this.doc, n.asset);
        const isPng = data[0] === 0x89 && data[1] === 0x50, isJpg = data[0] === 0xff && data[1] === 0xd8;
        let img;
        if (isPng) img = await this.pdf.embedPng(data);
        else if (isJpg) img = await this.pdf.embedJpg(data);
        else img = await this.pdf.embedPng(await toPng(data, mime));
        name = this.page.node.newXObject("Im", img.ref);
      } catch (e) { this.warn.add((e as Error).message); }
      this.images.set(n.asset, name);
    }
    if (!name) return;
    this.ops.push(pushGraphicsState());
    this.alpha(opacity, opacity);
    this.ops.push(concatTransformationMatrix(n.w, 0, 0, -n.h, 0, n.h), drawObject(name), popGraphicsState());
  }

  private async text(n: Extract<SceneNode, { type: "text" }>, opacity: number) {
    const t = prepareText(n, this.numbers, this.doc.numbering.suffix, this.vars);
    for (const l of layoutText(t)) {
      for (const s of l.spans) {
        const r = s.run;
        if (!s.text) continue;
        const f = await this.fonts.get(r);
        let key = this.fontKeys.get(f);
        if (!key) { key = this.page.node.newFontDictionary(f.name, f.ref); this.fontKeys.set(f, key); }
        this.ops.push(pushGraphicsState());
        this.alpha(r.opacity * opacity, r.opacity * opacity);
        this.ops.push(setFillingRgbColor(...rgbOf(r.color)));
        // en justification, les mots sont placés un à un
        const ctx = measureCtx(r);
        const pieces: [string, number][] = [];
        if (l.wordSpacing) {
          let x = s.x;
          for (const w of s.text.split(/( )/)) {
            if (w === " ") { x += ctx.measureText(" ").width + l.wordSpacing; continue; }
            if (w) pieces.push([w, x]);
            x += ctx.measureText(w).width;
          }
        } else pieces.push([s.text, s.x]);
        for (const [str, x] of pieces) {
          const txt = safeText(f, str);
          // largeur calée sur la composition : la mise en page reste exacte même si la police est remplacée
          const want = ctx.measureText(str).width, got = f.widthOfTextAtSize(txt, r.size);
          const hs = got > 0 && want > 0 ? Math.max(0.5, Math.min(1.5, want / got)) : 1;
          this.ops.push(beginText(), setFontAndSize(key, r.size), setTextMatrix(hs, 0, 0, -1, x, l.y), showText(f.encodeText(txt)), endText());
        }
        if (r.underline) {
          const w = s.width;
          this.ops.push(moveTo(s.x, l.y + r.size * 0.1), lineTo(s.x + w, l.y + r.size * 0.1), lineTo(s.x + w, l.y + r.size * 0.15), lineTo(s.x, l.y + r.size * 0.15), closePath(), fill());
        }
        this.ops.push(popGraphicsState());
      }
    }
  }

  async node(n: SceneNode, opacity = 1) {
    if (!n.visible) return;
    const op = opacity * n.opacity;
    this.ops.push(pushGraphicsState());
    const [a, b, c, d, e, f] = n.transform;
    this.ops.push(concatTransformationMatrix(a, b, c, d, e, f));
    if (n.type === "shape" || n.type === "path") this.vector(n, op);
    else if (n.type === "image") await this.image(n, op);
    else if (n.type === "text") await this.text(n, op);
    else if (n.type === "group") {
      if (n.mask && (n.mask.type === "shape" || n.mask.type === "path")) {
        this.vector(n.mask, op * n.mask.opacity, n.mask.transform);
        this.ops.push(pushGraphicsState());
        this.path(n.mask.type === "shape" ? shapeToSubpaths(n.mask) : n.mask.subpaths, n.mask.transform);
        this.ops.push(clip(), endPath());
        for (const k of n.children) await this.node(k, op);
        this.ops.push(popGraphicsState());
      } else for (const k of n.children) await this.node(k, op);
    }
    this.ops.push(popGraphicsState());
  }

  cut(x1: number, y1: number, x2: number, y2: number, w: number) {
    this.ops.push(pushGraphicsState(), setStrokingRgbColor(0.33, 0.33, 0.33), setLineWidth(w), setDashPattern([w * 6, w * 4], 0), moveTo(x1, y1), lineTo(x2, y2), stroke(), popGraphicsState());
  }
}

const mctx = document.createElement("canvas").getContext("2d")!;
function measureCtx(r: Run) {
  mctx.font = `${r.italic ? "italic " : ""}${r.weight} ${r.size}px "${r.font}", sans-serif`;
  return mctx;
}

async function toPng(data: Uint8Array, mime: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([data], { type: mime || "image/png" }));
  const img = new Image();
  img.src = url;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth || 512; cv.height = img.naturalHeight || 512;
  cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(url);
  const blob = await new Promise<Blob>((res) => cv.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

// ------------------------------------------------------------------ assemblage

interface Sheet { pageIndex: number; section: number | null; row: Record<string, string> | null }

async function buildPdf(doc: Doc, sheets: Sheet[], opts: PdfOptions, warn: Set<string>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(doc.name);
  pdf.setCreator("FicheStudio");
  const fonts = new Fonts(pdf, opts.systemFonts);
  const numbers = computeNumbering(doc);
  const k = 72 / doc.dpi;
  for (const sh of sheets) {
    const page = doc.pages[sh.pageIndex];
    const rects = sectionRects(page);
    const r = sh.section === null ? { x: 0, y: 0, w: page.width, h: page.height } : rects[sh.section];
    const pdfPage = pdf.addPage([r.w * k, r.h * k]);
    const p = new Painter(pdf, pdfPage, doc, fonts, numbers, warn);
    // repère : pixels du document (y vers le bas) -> points PDF
    p.ops.push(pushGraphicsState(), concatTransformationMatrix(k, 0, 0, -k, -k * r.x, r.h * k + k * r.y));
    if (sh.section !== null) {
      p.ops.push(moveTo(r.x, r.y), lineTo(r.x + r.w, r.y), lineTo(r.x + r.w, r.y + r.h), lineTo(r.x, r.y + r.h), closePath(), clip(), endPath());
    }
    if (page.background && page.background !== "#ffffff") {
      p.ops.push(setFillingRgbColor(...rgbOf(page.background)), moveTo(0, 0), lineTo(page.width, 0), lineTo(page.width, page.height), lineTo(0, page.height), closePath(), fill());
    }
    const master = doc.masters.find((m) => m.id === page.master);
    if (master) {
      for (const { rect, section: si } of masterAreas(page)) {
        if (sh.section !== null && si >= 0 && si !== sh.section) continue;
        p.vars = varsFor(doc, sh.pageIndex, si, sh.row);
        for (const l of master.layers) {
          if (!l.visible) continue;
          const [a, b, c, d, e, f] = masterLayerMatrix(master, l.anchor, rect);
          p.ops.push(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f));
          await p.node(l);
          p.ops.push(popGraphicsState());
        }
      }
    }
    p.vars = varsFor(doc, sh.pageIndex, sh.section ?? 0, sh.row);
    for (const l of page.layers) await p.node(l);
    if (opts.cutMarks && sh.section === null) for (const [x1, y1, x2, y2] of cutLines(page)) p.cut(x1, y1, x2, y2, page.width / 600);
    p.ops.push(popGraphicsState());
    pdfPage.pushOperators(...p.ops);
  }
  if (fonts.missing.size) warn.add(`polices remplacées par Helvetica (ajoutez-les dans « Polices… ») : ${[...fonts.missing].join(", ")}`);
  return pdf.save();
}

export async function exportPdf(doc: Doc, opts: PdfOptions, progress: (msg: string) => void): Promise<string[]> {
  const warn = new Set<string>();
  if (opts.systemFonts && !(await loadLocalFonts())) opts = { ...opts, systemFonts: false };
  await listUserFonts();
  const rows: (Record<string, string> | null)[] = opts.series && doc.data.rows.length ? doc.data.rows : [null];
  const files: { name: string; sheets: Sheet[] }[] = [];
  if (opts.split === "single") {
    // tout dans un seul fichier (en série : toutes les copies à la suite)
    const sheets = rows.flatMap((row) => doc.pages.map((_, i): Sheet => ({ pageIndex: i, section: null, row })));
    files.push({ name: fileName(opts.pattern, varsFor(doc, 0, 0, rows.length === 1 ? rows[0] : null)), sheets });
  } else for (const row of rows) {
    doc.pages.forEach((p, i) => {
      if (opts.split === "sheet") files.push({ name: fileName(opts.pattern, varsFor(doc, i, 0, row)), sheets: [{ pageIndex: i, section: null, row }] });
      else sectionRects(p).forEach((_, s) => files.push({ name: fileName(opts.pattern, varsFor(doc, i, s, row)), sheets: [{ pageIndex: i, section: (p.sections ?? 1) > 1 ? s : null, row }] }));
    });
  }
  // noms uniques
  const seen = new Map<string, number>();
  for (const f of files) {
    const n = seen.get(f.name) ?? 0;
    seen.set(f.name, n + 1);
    if (n) f.name = `${f.name} (${n + 1})`;
  }
  const out: Record<string, Uint8Array> = {};
  for (let i = 0; i < files.length; i++) {
    progress(`PDF ${i + 1} / ${files.length} : ${files[i].name}`);
    out[`${files[i].name}.pdf`] = await buildPdf(doc, files[i].sheets, opts, warn);
  }
  const names = Object.keys(out);
  if (names.length > 1 && opts.zip) {
    download(`${fileName("{document}", varsFor(doc, 0, 0))}.zip`, zipSync(out, { level: 0 }), "application/zip");
  } else {
    for (const [i, n] of names.entries()) setTimeout(() => download(n, out[n], "application/pdf"), i * 400);
  }
  return [...warn];
}
