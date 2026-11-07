// Document Affinity -> modèle FicheStudio.
import { AfArchive, KsStream, type KsObj, type KsValue } from "./afread";
import {
  IDENTITY, NONE, newDoc, newLayer, uid,
  type Anchor, type ArrowHead, type Doc, type GroupNode, type Mat, type Page, type Paint, type Paragraph, type Run,
  type SceneNode, type ShapeKind, type Stroke, type SubPath, type TextNode,
} from "../model";
import { apply, inv, mul, scaleOf } from "../geom";

const isObj = (v: unknown): v is KsObj => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array);
const nums = (v: KsValue | undefined) => (Array.isArray(v) ? (v as number[]) : null);

/** Xfrm Affinity [a, b, tx, c, d, ty] -> matrice SVG. */
const mat = (v: KsValue | undefined): Mat => {
  const x = nums(v);
  return x && x.length === 6 ? [x[0], x[3], x[1], x[4], x[2], x[5]] : [...IDENTITY];
};

export interface ImportReport { warnings: Record<string, number> }

class Importer {
  ids = new Map<number, KsObj>();
  assets: Doc["assets"] = {};
  assetBySrc = new Map<string, string>();
  warnings: Record<string, number> = {};
  groupTextScale = 1;
  /** échelle cumulée des groupes (Xfrm) : le texte artistique suit l'échelle réelle, pas FTxS */
  groupScale = 1;
  constructor(public arc: AfArchive, public root: KsObj) {
    const stack: unknown[] = [root];
    while (stack.length) {
      const o = stack.pop();
      if (Array.isArray(o)) stack.push(...o);
      else if (isObj(o)) {
        if (typeof o.$id === "number" && o.$class && !this.ids.has(o.$id)) this.ids.set(o.$id, o);
        for (const k in o) if (k[0] !== "$") stack.push(o[k]);
      }
    }
  }
  note(w: string) { this.warnings[w] = (this.warnings[w] ?? 0) + 1; }
  res(v: KsValue | undefined): KsObj | null {
    let o = v, guard = 0;
    while (isObj(o) && typeof o.$ref === "number" && guard++ < 64) o = this.ids.get(o.$ref);
    return isObj(o) ? o : null;
  }

  // ---------------------------------------------------------------- couleurs

  colour(v: KsValue | undefined): { color: string; opacity: number } | null {
    const c = this.res(v);
    const raw = c?._col;
    if (!(raw instanceof Uint8Array)) return null;
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const f = (i: number) => dv.getFloat32(i * 4, true);
    let r = 0, g = 0, b = 0, a = 1;
    switch (c!.$class) {
      case "RGBA": [r, g, b, a] = [f(0), f(1), f(2), f(3)]; break;
      case "HSLA": { const h = f(0), s = f(1), l = f(2); a = f(3); [r, g, b] = hsl(h, s, l); break; }
      case "CMYK": { const k = f(3); r = (1 - f(0)) * (1 - k); g = (1 - f(1)) * (1 - k); b = (1 - f(2)) * (1 - k); a = f(4); break; }
      case "GRAY": r = g = b = f(0); a = f(1); break;
      case "LABA": r = g = b = dv.getUint16(0, true) / 65535; a = dv.getUint16(6, true) / 65535; this.note("couleur Lab approchée"); break;
      default: return null;
    }
    const h8 = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, "0");
    return { color: `#${h8(r)}${h8(g)}${h8(b)}`, opacity: Math.max(0, Math.min(1, a)) };
  }

  paint(v: KsValue | undefined): Paint {
    const fd = this.res(v);
    const f = this.res(fd?.FDeF);
    if (!f) return NONE;
    if (f.$class === "FilS") {
      const c = this.colour(f.Colr);
      return c ? { type: "solid", ...c } : NONE;
    }
    if (f.$class === "FilG") {
      const g = this.res(f.Grad);
      const posn = (g?.Posn as number[][] | undefined) ?? [];
      const cols = (g?.Cols as KsValue[] | undefined) ?? [];
      const stops = posn.map((p, i) => ({ offset: p[0], ...(this.colour(cols[i]) ?? { color: "#000000", opacity: 1 }) }));
      this.note("dégradé : orientation simplifiée");
      return (f.Type as number) === 1 || (f.Type as number) === 2 ? { type: "radial", stops } : { type: "linear", angle: 0, stops };
    }
    return NONE;
  }

  stroke(n: KsObj, cum: Mat): Stroke {
    const lines = (n.LILn as KsValue[] | undefined) ?? [];
    const lfills = (n.LIFl as KsValue[] | undefined) ?? [];
    const ld = this.res(lines[(n.LICr as number) ?? 0] ?? lines[0]);
    const ls = this.res(ld?.LDeL);
    let width = (ls?.Wght as number) ?? 0;
    if (!ld?.LDSc) width /= scaleOf(cum); // épaisseur absolue sauf « mettre à l'échelle avec l'objet »
    // Data = [limite d'onglet, [extrémité, jointure, type, ?]] (ancienne forme : liste à plat)
    // extrémité 0 plate, 1 carrée, 2 ronde ; jointure 0-1 onglet, 2 ronde, 3 biseau ; type 0 aucun, 1 plein, 2 tirets, 3 texturé
    const raw = (ls?.Data as KsValue[] | undefined) ?? [4, [0, 0, 1, 0]];
    const flat = (Array.isArray(raw[1]) ? [raw[0], ...(raw[1] as number[])] : raw) as (number | undefined)[];
    const [, cap, join, type = 1] = flat;
    const paint = lfills.length ? this.paint(lfills[0]) : NONE;
    // pointes de flèche (LSAr.Styl : 0-2 triangles, 4 barbelée ; les autres styles en triangle)
    const head = (v: KsValue | undefined): ArrowHead | null => {
      const a = this.res(v ?? null);
      const st = a?.Styl as number | undefined;
      if (!a || st === undefined) return null;
      const tall = st === 1 ? 1.75 : st === 2 ? 0.6 : 1;
      return { style: st === 4 ? "barbed" : "triangle", sx: (a.SclX as number) || 1, sy: ((a.SclY as number) || 1) * tall };
    };
    if (type === 3) this.note("contour texturé rendu en trait plein");
    return {
      paint: type === 0 ? NONE : paint,
      width: type === 0 ? 0 : width,
      dash: type === 2 && Array.isArray(ls?.Patn) ? (ls!.Patn as number[]) : null,
      cap: cap === 1 ? "square" : cap === 2 ? "round" : "butt",
      join: join === 3 ? "bevel" : join === 2 ? "round" : "miter",
      ...(head(ld?.LFAh) ? { arrowStart: head(ld?.LFAh)! } : {}),
      ...(head(ld?.LBAh) ? { arrowEnd: head(ld?.LBAh)! } : {}),
    };
  }

  fill(n: KsObj): Paint {
    const fills = (n.BFFl as KsValue[] | undefined) ?? [];
    return fills.length ? this.paint(fills[(n.BFCr as number) ?? 0] ?? fills[0]) : NONE;
  }

  base(n: KsObj, name: string) {
    return {
      id: uid(),
      name: (n.Desc as string) || name,
      visible: n.Visi !== false,
      locked: false,
      opacity: typeof n.Opac === "number" ? n.Opac : 1,
      transform: mat(n.Xfrm),
      tag: this.colour(n.TagC)?.color ?? null,
    };
  }

  // ---------------------------------------------------------------- nœuds

  node(v: KsValue, parentCum: Mat): SceneNode | null {
    const n = this.res(v);
    if (!n) return null;
    const cls = n.$class ?? "";
    const own = mat(n.Xfrm);
    const cum = mul(parentCum, own);
    const kids = ((n.Chld as KsValue[] | undefined) ?? []);
    let out: SceneNode | null = null;
    if (cls === "PCrv" || cls === "ShpN") {
      out = cls === "PCrv" ? this.curve(n, parentCum) : this.shape(n, parentCum);
      if (out && kids.length) {
        // un enfant d'une forme est découpé par elle
        const inner = kids.map((k) => this.node(k, cum)).filter(Boolean) as SceneNode[];
        const wrap: GroupNode = { type: "group", id: uid(), name: "Contenu", visible: true, locked: false, opacity: 1, transform: own, children: inner, mask: null };
        const g: GroupNode = { ...this.base(n, out.name), type: "group", transform: [...IDENTITY], children: [wrap], mask: out };
        out.visible = true; out.opacity = 1;
        return g;
      }
    } else if (cls === "TxtF" || cls === "TxtA") out = this.text(n, parentCum);
    else if (cls === "TxtS") {
      // forme avec texte (« texte dans une forme ») : la forme, et son texte s'il y en a un
      const shape = this.shape(n, parentCum);
      let txt: TextNode | null = null;
      try { txt = this.text(n, parentCum); } catch { /* pas de texte lisible */ }
      const has = txt?.paragraphs.some((p) => p.runs.some((r) => r.text.replace(/\u0000/g, "").trim()));
      if (has && txt) {
        shape.visible = true; shape.opacity = 1;
        out = { ...this.base(n, "Forme avec texte"), transform: [...IDENTITY], type: "group", children: [shape, txt], mask: null };
      } else out = shape;
    }
    else if (cls === "ImgN") out = this.image(n);
    else if (kids.length || ["LogN", "Scop", "Grup", "Node", "SymN", "SymI"].includes(cls)) {
      const saved = this.groupTextScale, savedG = this.groupScale;
      if (n.FTxS) this.groupTextScale *= scaleOf(mat(n.FTxS));
      this.groupScale *= scaleOf(own);
      const children = kids.map((k) => this.node(k, cum)).filter(Boolean) as SceneNode[];
      this.groupTextScale = saved; this.groupScale = savedG;
      out = { ...this.base(n, cls === "Grup" ? "Groupe" : "Calque"), type: "group", children, mask: null };
    } else this.note(`objet ${cls} non pris en charge`);
    // masque attaché (« AdCh ») : une forme rangée dans l'image ou le groupe qui le découpe
    const clip = ((n.AdCh as KsValue[] | undefined) ?? []).map((k) => this.res(k)).find((m) => m && (m.$class === "ShpN" || m.$class === "PCrv"));
    if (out && clip) {
      const mask = clip.$class === "ShpN" ? this.shape(clip, cum) : this.curve(clip, cum);
      // masque invisible : il découpe seulement (la forme d'un « contenu dans une forme » reste, elle, dessinée)
      mask.visible = false; mask.opacity = 1;
      const inner = { ...out, transform: [...IDENTITY] as Mat, visible: true, opacity: 1 } as SceneNode;
      const g: GroupNode = { ...this.base(n, out.name), type: "group", transform: out.transform, children: [inner], mask };
      return g;
    }
    return out;
  }

  /** Courbe : sa transformation est appliquée aux points, comme Affinity garde un trait d'épaisseur
   *  uniforme quand la courbe est étirée (un trait court écrasé ne doit pas devenir un pavé). */
  curve(n: KsObj, parentCum: Mat): SceneNode {
    const own = mat(n.Xfrm);
    const P = (x: number, y: number) => apply(own, { x, y });
    const data = (this.res(n.Crvs)?.Data as KsValue[] | undefined) ?? [];
    const subpaths: SubPath[] = [];
    const count = (data[1] as number) ?? 0;
    for (let k = 0; k < count; k++) {
      const closed = data[2 + 2 * k] as boolean;
      const pts = (data[3 + 2 * k] as number[][]) ?? [];
      const start = pts.findIndex((p) => p[2] !== 0);
      if (start < 0) continue;
      const seq = [...pts.slice(start), ...(closed ? pts.slice(0, start) : [])];
      const anchors: Anchor[] = [];
      let ctrl: number[][] = [];
      const close = (next: Anchor | null) => {
        const a = anchors[anchors.length - 1];
        if (!a) return;
        const b = next ?? anchors[0];
        if (ctrl.length >= 2) { a.out = P(ctrl[0][0], ctrl[0][1]); b.in = P(ctrl[1][0], ctrl[1][1]); }
        else if (ctrl.length === 1) {
          const q = P(ctrl[0][0], ctrl[0][1]);
          a.out = { x: a.x + (2 / 3) * (q.x - a.x), y: a.y + (2 / 3) * (q.y - a.y) };
          b.in = { x: b.x + (2 / 3) * (q.x - b.x), y: b.y + (2 / 3) * (q.y - b.y) };
        }
        ctrl = [];
      };
      for (const p of seq) {
        if (p[2] === 0) { ctrl.push(p); continue; }
        const a: Anchor = { ...P(p[0], p[1]), smooth: p[2] === 2 || p[2] === 3 };
        if (anchors.length) close(a);
        anchors.push(a);
      }
      if (closed) close(null);
      subpaths.push({ closed, points: anchors });
    }
    return { ...this.base(n, "Courbe"), transform: [...IDENTITY] as Mat, type: "path", subpaths, fill: this.fill(n), stroke: this.stroke(n, parentCum) };
  }

  shape(n: KsObj, parentCum: Mat): SceneNode {
    const shp = this.res(n.Shpe) ?? {};
    const m = mat(n.Xfrm);
    const b = nums(n.ShpB) ?? [0, 0, 0, 0];
    // la forme est construite dans la boîte déjà étirée : seule la rotation reste une transformation
    const th = Math.atan2(m[1], m[0]);
    const rot: Mat = [Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th), 0, 0];
    const rest = mul(inv(rot), m);
    const localMin = Math.min(b[2] - b[0], b[3] - b[1]);
    let box = { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
    let transform: Mat = m, rbase = localMin;
    if (Math.abs(rest[1]) < 1e-6 && Math.abs(rest[2]) < 1e-6) {
      const p = apply(rest, { x: b[0], y: b[1] }), q = apply(rest, { x: b[2], y: b[3] });
      box = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
      transform = rot;
      rbase = Math.min(box.w, box.h); // rayon relatif au petit côté de la boîte étirée
    }
    const kinds: Record<string, ShapeKind> = { ShNR: "rect", ShpE: "ellipse", ShpT: "triangle", ShpD: "diamond", ShDA: "arrow" };
    const kind = kinds[shp.$class ?? ""] ?? "rect";
    if (!kinds[shp.$class ?? ""]) this.note(`forme ${shp.$class} importée comme rectangle`);
    // coins liés : seul le 1er type / rayon compte. Type 0 = arrondi, 1 = coupé (chanfrein),
    // 4 ou absent = aucun (ShCR garde alors le rayon par défaut 0,25, sans effet)
    const ctype = ((shp.CTyp as number[] | undefined) ?? [])[0] ?? 4;
    const r0 = ctype === 0 || ctype === 1 ? (nums(shp.ShCR)?.[0] ?? 0) * rbase : 0;
    const cr: [number, number, number, number] = [r0, r0, r0, r0];
    const param = kind === "arrow" ? ((shp.Thck as number) ?? 0.4) : ((shp["Pos "] as number) ?? 0.5);
    // flèche (ShDA) : pointe droite RPr1 = longueur, RPr2 = décalage de sa base (× hauteur)
    const head: [number, number] | null = kind === "arrow" ? [(shp.RPr1 as number) ?? 0.5, (shp.RPr2 as number) ?? 0] : null;
    if (kind === "arrow" && (shp.LSty as number) > 0) this.note("flèche double importée avec une seule pointe");
    const cum = mul(parentCum, transform);
    return {
      ...this.base(n, "Forme"), transform, type: "shape", kind, ...box,
      radius: kind === "rect" ? cr : [0, 0, 0, 0], ...(kind === "rect" && ctype === 1 ? { corner: "chamfer" as const } : {}), ...(head ? { head } : {}), param, fill: this.fill(n), stroke: this.stroke(n, cum),
    };
  }

  image(n: KsObj): SceneNode | null {
    const bm = this.res(n.Bitm);
    const w = bm?.BmpW as number, h = bm?.BmpH as number;
    const src = isObj(bm?.Bckg) ? (bm!.Bckg as KsObj).path as string : null;
    const key = src ? this.assetBySrc.get(src) : undefined;
    if (!w || !h || !key) { this.note("image sans fichier source (pixels) ignorée"); return null; }
    return { ...this.base(n, (n.Desc as string) || this.assets[key].name), type: "image", asset: key, w, h };
  }

  text(n: KsObj, parentCum: Mat): TextNode {
    // tailles de police absolues : on compose dans le repère de la planche, tourné comme le cadre
    const m = mul(parentCum, mat(n.Xfrm));
    const th = Math.atan2(m[1], m[0]);
    const rot: Mat = [Math.cos(th), Math.sin(th), -Math.sin(th), Math.cos(th), 0, 0];
    const toRot = mul(inv(rot), m);
    const fb = nums(this.res(n.TxtH)?.FrmB);
    let frame: TextNode["frame"] = null;
    let origin = { x: 0, y: 0 };
    if (fb) {
      const pts = [[fb[0], fb[1]], [fb[2], fb[1]], [fb[0], fb[3]], [fb[2], fb[3]]].map(([x, y]) => apply(toRot, { x, y }));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      frame = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      // cadre en colonnes : le texte se coupe à la largeur de la 1re colonne, pas du cadre entier
      // ColW / GutW peuvent dater d'avant un redimensionnement : on répartit la largeur actuelle
      // (moins les gouttières) au prorata. Une 2e colonne de largeur nulle garde sa gouttière.
      // (la gouttière est en unités du texte : elle suit l'échelle des glyphes du cadre)
      const tsF = this.groupTextScale * (n.FTxS ? scaleOf(mat(n.FTxS)) : 1);
      const th = this.res(n.TxtH), cols = nums(th?.ColW) ?? [], gut = (nums(th?.GutW)?.[0] ?? 0) * tsF;
      const sum = cols.reduce((a, c) => a + c, 0);
      if (cols.length > 1 && sum > 0) frame.w = Math.max(1, (frame.w - gut * (cols.length - 1)) * (cols[0] / sum));
    } else origin = apply(toRot, { x: 0, y: 0 });
    // texte artistique : les glyphes suivent l'échelle réelle (groupes × son propre Xfrm) ;
    // texte encadré : corps absolu, corrigé seulement par les FTxS des groupes
    const ts = n.$class === "TxtA"
      ? this.groupScale * scaleOf(mat(n.Xfrm))
      : this.groupTextScale * (n.FTxS ? scaleOf(mat(n.FTxS)) : 1);
    const paragraphs: Paragraph[] = [];
    const story = this.res(n.StSt);
    for (const bv of (story?.Blok as KsValue[] | undefined) ?? []) {
      const blk = this.res(bv);
      if (!blk) continue;
      const gs = blk.Glyp as KsObj | undefined;
      let txt = (gs?.Utf8 as string | undefined) ?? ((gs?.Mixd as KsObj[] | undefined) ?? []).map((p) => (p.Utf8 as string) ?? "").join("");
      txt = txt.replace(/\u0000/g, "");
      const chars = Array.from(txt);
      const gruns = (((blk.GAtt as KsObj | undefined)?.Runs as KsObj[] | undefined) ?? []).map((r) => ({ end: r.Indx as number, run: this.runStyle(r.Item, ts) }));
      const pruns = (((blk.PAtt as KsObj | undefined)?.Runs as KsObj[] | undefined) ?? []).map((r) => ({ end: r.Indx as number, att: this.res(r.Item) }));
      const styleAt = (i: number) => (gruns.find((g) => i < g.end) ?? gruns[gruns.length - 1])?.run ?? this.runStyle(null, ts);
      const paraAt = (i: number) => (pruns.find((p) => i < p.end) ?? pruns[pruns.length - 1])?.att ?? null;
      let pos = 0;
      for (const para of txt.split(" ")) {
        const pc = Array.from(para);
        const att = paraAt(pos);
        const align = ((att?.Ints as number[] | undefined) ?? [0])[0];
        const runs: Run[] = [];
        for (let i = 0; i < pc.length; i++) {
          const st = styleAt(pos + i);
          const ch = pc[i] === " " ? "\n" : pc[i];
          const last = runs[runs.length - 1];
          if (last && sameStyle(last, st)) last.text += ch;
          else runs.push({ ...st, text: ch });
        }
        if (!runs.length) runs.push({ ...styleAt(pos), text: "" });
        // liste à puces (LisA, type 1) : puce + tabulation en retrait suspendu, comme Affinity
        const list = ((att?.Objs as KsValue[] | undefined) ?? []).map((o) => this.res(o)).find((o) => o?.$class === "LisA");
        const bullet = list && list.Type === 1 && runs.some((r) => r.text.trim())
          ? (((this.res(list.BulS as KsValue)?.Utf8 as string | undefined) ?? "•\t").replace(/\u0000/g, "") || "•\t") : null;
        if (bullet) runs.unshift({ ...runs[0], text: bullet.includes("\t") ? bullet : `${bullet}\t` });
        // PAtt.Doub = [interligne relatif, interligne absolu, retrait gauche, retrait droit, retrait 1re ligne, espace avant, espace après, pas de tabulation…]
        const d = (att?.Doub as number[] | undefined) ?? [];
        const lead = ((att?.Ints as number[] | undefined) ?? [])[1] ?? 0;
        // taquets explicites (TabS.Stop[].Posn)
        const tabS = ((att?.Objs as KsValue[] | undefined) ?? []).map((o) => this.res(o)).find((o) => o?.$class === "TabS");
        const tabs = ((tabS?.Stop as KsValue[] | undefined) ?? []).map((t) => this.res(t)?.Posn as number | undefined)
          .filter((v): v is number => typeof v === "number" && v > 0).map((v) => v * ts).sort((a, b) => a - b);
        const px = (i: number) => (typeof d[i] === "number" ? d[i] * ts : 0);
        paragraphs.push({
          align: (["left", "center", "right", "justify"] as const)[align] ?? "left",
          lineHeight: d[0] > 0 && d[0] < 10 ? d[0] : 1,
          // PAtt.Ints[1] : type d'interligne (0 relatif à l'idéal, 1 relatif au corps, 2 exact, 3 au moins)
          ...(lead === 2 && d[1] > 0 ? { leading: d[1] * ts } : {}),
          // Affinity : la 1re ligne commence au « retrait de 1re ligne » compté depuis le bord du cadre,
          // les suivantes au retrait gauche (ici, retrait de 1re ligne relatif au retrait gauche)
          leftIndent: px(2), rightIndent: px(3), firstIndent: px(4) - px(2), spaceBefore: px(5), spaceAfter: px(6),
          tabStop: d[7] > 1 ? d[7] * ts : 50, level: 0, runs,
          ...(tabs.length ? { tabs } : {}),
        });
        pos += pc.length + 1;
      }
      void chars;
    }
    // TxtH.Algn : alignement vertical du cadre (0 haut, 1 milieu, 2 bas)
    const va = (this.res(n.TxtH)?.Algn as number | undefined) ?? 0;
    // texte artistique : ni retour à la ligne automatique, ni retraits, ni espaces avant/après (seul l'interligne compte)
    if (n.$class === "TxtA") for (const p of paragraphs) { p.leftIndent = 0; p.firstIndent = 0; p.rightIndent = 0; p.spaceBefore = 0; p.spaceAfter = 0; }
    const t: TextNode = {
      ...(n.$class === "TxtA" && frame ? { noWrap: true } : {}),
      ...(n.$class !== "TxtA" && frame && this.res(n.Flow)?.HOvr ? { hideOverflow: true } : {}),
      ...(frame && va === 1 ? { valign: "middle" as const } : frame && va === 2 ? { valign: "bottom" as const } : {}),
      ...this.base(n, "Texte"),
      transform: mul(inv(parentCum), rot),
      type: "text",
      frame,
      paragraphs,
    };
    if (!frame) t.transform = mul(t.transform, [1, 0, 0, 1, origin.x, origin.y]);
    if (!(n.Desc as string)) t.name = paragraphs.map((p) => p.runs.map((r) => r.text).join("")).join(" ").slice(0, 30) || "Texte";
    return t;
  }

  runStyle(item: KsValue | null | undefined, scale: number): Run {
    const g = this.res(item ?? null);
    const font = this.res(g?.DFnt);
    const objs = (g?.Objs as KsValue[] | undefined) ?? [];
    const p = objs.length ? this.paint(objs[0]) : null;
    const col = p && p.type === "solid" ? p : { color: "#000000", opacity: 1 };
    return {
      text: "",
      font: (font?.Famy as string) || "Arial",
      size: (((g?.Doub as number[] | undefined) ?? [50])[0] || 50) * scale,
      weight: (font?.Wegt as number) || 400,
      italic: !!font?.Ital,
      underline: (((g?.Ints as number[] | undefined) ?? [0])[0] ?? 0) > 0, // GAtt.Ints[0] : soulignement
      color: col.color,
      opacity: col.opacity,
      // GAtt.Doub[4] : interlettrage (fraction du corps)
      ...(Math.abs(((g?.Doub as number[] | undefined) ?? [])[4] ?? 0) > 1e-4 ? { tracking: (g!.Doub as number[])[4] } : {}),
      // GAtt.Ints[4] = 1 : interligne des caractères (« au moins », Doub[13]) qui remplace celui du paragraphe
      ...(((g?.Ints as number[] | undefined) ?? [])[4] === 1 && ((g?.Doub as number[] | undefined) ?? [])[13] > 0
        ? { leading: (g!.Doub as number[])[13] * scale } : {}),
    };
  }

  /** Dossier du fichier .af sur le disque (s'il est connu) : aide à retrouver les images liées. */
  afDir: string | null = null;

  async loadAssets() {
    for (const e of this.arc.entries.values()) {
      if (!e.name?.startsWith("c/") || !e.size) continue;
      try {
        const ks = new KsStream(await this.arc.extract(e));
        const root = ks.parse();
        const data = ks.blobs.find((b) => b.length > 64);
        const key = uid("a");
        if (data && (data[0] === 0x89 || (data[0] === 0xff && data[1] === 0xd8))) {
          // image incorporée : le fichier d'origine est dans le .af
          const mime = data[0] === 0x89 ? "image/png" : "image/jpeg";
          this.assets[key] = { mime, data: await toDataUrl(data, mime), name: e.name };
        } else {
          // image liée : le .af ne garde que le chemin de l'original (chaîne, ou alias macOS « book »)
          const path = (data && bookmarkPath(data)) || findPath(root);
          if (!path) continue;
          const name = path.split("/").pop() || e.name;
          const q = `path=${encodeURIComponent(path)}${this.afDir ? `&afdir=${encodeURIComponent(this.afDir)}` : ""}`;
          this.assets[key] = { mime: mimeOf(name), name, link: { kind: "url", url: `__localdocs/image?${q}` } };
          this.linked++;
        }
        this.assetBySrc.set(e.name, key);
      } catch { this.note("ressource illisible"); }
    }
  }
  linked = 0;
}

const sameStyle = (a: Run, b: Run) =>
  a.font === b.font && a.size === b.size && a.weight === b.weight && a.italic === b.italic && a.color === b.color && a.opacity === b.opacity
  && a.underline === b.underline && a.leading === b.leading && a.tracking === b.tracking;

function hsl(h: number, s: number, l: number): [number, number, number] {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

function toDataUrl(b: Uint8Array, mime: string): Promise<string> {
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.readAsDataURL(new Blob([b], { type: mime }));
  });
}

/** Chemin d'un alias macOS (« bookmark ») : les éléments du chemin sont les premières chaînes UTF-8. */
export function bookmarkPath(b: Uint8Array): string | null {
  if (b.length < 64 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== "book") return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const comps: string[] = [];
  let i = dv.getUint32(12, true) + 4;
  while (i + 8 <= b.length) {
    const len = dv.getUint32(i, true), type = dv.getUint32(i + 4, true);
    if (len > 4096) break;
    if (type === 0x0101) comps.push(new TextDecoder().decode(b.subarray(i + 8, i + 8 + len)));
    else if (comps.length) break;
    i += 8 + ((len + 3) & ~3);
  }
  return comps.length ? `/${comps.join("/")}` : null;
}

/** Premier chemin absolu de fichier trouvé dans un objet de lien. */
function findPath(o: unknown): string | null {
  if (typeof o === "string") return /^\/.+\.[a-z0-9]{2,5}$/i.test(o) ? o : null;
  if (o && typeof o === "object") for (const v of Object.values(o)) { const p = findPath(v); if (p) return p; }
  return null;
}

const mimeOf = (name: string) => {
  const ext = name.split(".").pop()!.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" } as Record<string, string>)[ext] ?? "image/png";
};

export async function importAffinity(buf: ArrayBuffer, name: string, opts: { dir?: string } = {}): Promise<{ doc: Doc; report: ImportReport }> {
  const importedAt = Date.now();
  const arc = new AfArchive(new Uint8Array(buf));
  const e = arc.byName("doc.dat");
  if (!e) throw new Error("doc.dat introuvable dans le fichier");
  const root = new KsStream(await arc.extract(e)).parse();
  const im = new Importer(arc, root);
  im.afDir = opts.dir ?? null;
  await im.loadAssets();
  const docR = im.res(root.DocR as KsValue);
  const dpi = (im.res(root.UVCn as KsValue)?.UPPI as number) || 300;
  const pages: Page[] = [];
  let i = 0;
  for (const sv of (docR?.Chld as KsValue[] | undefined) ?? []) {
    const sp = im.res(sv);
    if (!sp) continue;
    let rect = [0, 0, 2480, 3508];
    const pr = ((im.res(sp.SpMd)?.PagR as KsValue[] | undefined) ?? []).map((p) => nums(im.res(p)?.rctp)).find((r) => r && r[2] > r[0]);
    const bb = ((im.res(sp.bbxs)?.rcts as number[][] | undefined) ?? [])[0];
    if (pr) rect = pr; else if (bb && bb[2] > bb[0]) rect = bb;
    else { const ds = nums(docR?.DfSz); if (ds) rect = [0, 0, ds[0], ds[1]]; }
    const layers: GroupNode[] = [];
    const shift: Mat = [1, 0, 0, 1, -rect[0], -rect[1]];
    for (const lv of (sp.Chld as KsValue[] | undefined) ?? []) {
      const node = im.node(lv, IDENTITY);
      if (!node) continue;
      let layer: GroupNode;
      if (node.type === "group" && !node.mask) layer = { ...node, isLayer: true };
      else { layer = newLayer(node.name); layer.children = [node]; }
      if (rect[0] || rect[1]) layer.transform = mul(shift, layer.transform);
      layers.push(layer);
    }
    const bg = im.colour(sp.BgrC);
    pages.push({
      id: uid("p"), name: `Page ${++i}`, width: rect[2] - rect[0], height: rect[3] - rect[1],
      background: bg && bg.opacity > 0 ? bg.color : null, layers: layers.length ? layers : [newLayer()],
      sections: 1, split: "h", master: null, fields: {},
    });
  }
  const doc: Doc = {
    ...newDoc(name.replace(/\.(af|afdesign|afpub|afphoto)$/i, "")), dpi,
    pages, assets: im.assets,
    source: { name, ...(opts.dir ? { dir: opts.dir } : {}), importedAt },
  };
  doc.fields.atelier = doc.name;
  return { doc, report: { warnings: im.warnings } };
}
