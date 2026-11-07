import type { ArrowHead, Mat, ShapeNode, Stroke, SubPath, Vec } from "./model";

export const fmt = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === "-0" ? "0" : s;
};

export function mul(m: Mat, n: Mat): Mat {
  // m ∘ n : applique n puis m
  const [a, b, c, d, e, f] = m;
  const [A, B, C, D, E, F] = n;
  return [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];
}

export function inv(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1e-12;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

export const apply = (m: Mat, p: Vec): Vec => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
export const scaleAt = (sx: number, sy: number, o: Vec): Mat => [sx, 0, 0, sy, o.x - sx * o.x, o.y - sy * o.y];
export function rotateAt(rad: number, o: Vec): Mat {
  const c = Math.cos(rad), s = Math.sin(rad);
  return [c, s, -s, c, o.x - c * o.x + s * o.y, o.y - s * o.x - c * o.y];
}
export const isIdentity = (m: Mat) => m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
export const svgMatrix = (m: Mat) => `matrix(${m.map(fmt).join(" ")})`;
export const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
export const rotationOf = (m: Mat) => Math.atan2(m[1], m[0]);

export interface Box { x: number; y: number; w: number; h: number }
export function boxOfPoints(pts: Vec[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const unionBox = (a: Box | null, b: Box): Box =>
  !a ? b : boxOfPoints([{ x: a.x, y: a.y }, { x: a.x + a.w, y: a.y + a.h }, { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }]);
export const transformBox = (m: Mat, b: Box): Box =>
  boxOfPoints([{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h }].map((p) => apply(m, p)));

// ------------------------------------------------------------------ tracés

export function subpathsToD(sps: SubPath[]): string {
  const out: string[] = [];
  for (const sp of sps) {
    const pts = sp.points;
    if (!pts.length) continue;
    out.push(`M${fmt(pts[0].x)},${fmt(pts[0].y)}`);
    const n = sp.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (a.out || b.in) {
        const c1 = a.out ?? a, c2 = b.in ?? b;
        out.push(`C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(b.x)},${fmt(b.y)}`);
      } else out.push(`L${fmt(b.x)},${fmt(b.y)}`);
    }
    if (sp.closed) out.push("Z");
  }
  return out.join(" ");
}

export function subpathsBox(sps: SubPath[]): Box {
  const pts: Vec[] = [];
  for (const sp of sps) for (const p of sp.points) { pts.push(p); if (p.in) pts.push(p.in); if (p.out) pts.push(p.out); }
  return pts.length ? boxOfPoints(pts) : { x: 0, y: 0, w: 0, h: 0 };
}

const K = 0.5522847498; // poignées d'un quart de cercle

/** Forme paramétrique -> sous-chemins éditables (utilisé aussi pour « convertir en courbes »). */
export function shapeToSubpaths(s: ShapeNode): SubPath[] {
  const { x, y, w, h } = s;
  const x1 = x + w, y1 = y + h, cx = x + w / 2, cy = y + h / 2;
  switch (s.kind) {
    case "ellipse": {
      const rx = w / 2, ry = h / 2;
      return [{ closed: true, points: [
        { x: cx, y, in: { x: cx - rx * K, y }, out: { x: cx + rx * K, y } },
        { x: x1, y: cy, in: { x: x1, y: cy - ry * K }, out: { x: x1, y: cy + ry * K } },
        { x: cx, y: y1, in: { x: cx + rx * K, y: y1 }, out: { x: cx - rx * K, y: y1 } },
        { x, y: cy, in: { x, y: cy + ry * K }, out: { x, y: cy - ry * K } },
      ] }];
    }
    case "triangle":
      return [{ closed: true, points: [{ x: x + s.param * w, y }, { x: x1, y: y1 }, { x, y: y1 }] }];
    case "diamond":
      return [{ closed: true, points: [{ x: cx, y }, { x: x1, y: y + s.param * h }, { x: cx, y: y1 }, { x, y: y + s.param * h }] }];
    case "arrow": {
      const t = (s.param * h) / 2;
      // pointe : longueur et décalage de la base au ras du corps (proportionnels à la hauteur, comme Affinity)
      const head = s.head ? Math.min(w, s.head[0] * h) : Math.min(h, w / 2);
      const rx = x1 - head, ix = s.head ? Math.min(x1, Math.max(x, x1 - head - s.head[1] * h)) : rx;
      return [{ closed: true, points: [
        { x, y: cy - t }, { x: ix, y: cy - t }, { x: rx, y }, { x: x1, y: cy }, { x: rx, y: y1 }, { x: ix, y: cy + t }, { x, y: cy + t },
      ] }];
    }
    default: {
      const lim = Math.min(w, h) / 2;
      const [tl, tr, br, bl] = s.radius.map((r) => Math.max(0, Math.min(r, lim)));
      const pts: SubPath["points"] = [];
      const corner = (px: number, py: number, r: number, ax: number, ay: number, bx: number, by: number) => {
        // ax,ay : direction vers le point d'entrée ; bx,by : vers la sortie
        if (r <= 0) { pts.push({ x: px, y: py }); return; }
        const p1 = { x: px + ax * r, y: py + ay * r }, p2 = { x: px + bx * r, y: py + by * r };
        if (s.corner === "chamfer") { pts.push(p1, p2); return; }
        pts.push({ ...p1, out: { x: p1.x - ax * r * K, y: p1.y - ay * r * K } });
        pts.push({ ...p2, in: { x: p2.x - bx * r * K, y: p2.y - by * r * K } });
      };
      corner(x, y, tl, 0, 1, 1, 0);
      corner(x1, y, tr, -1, 0, 0, 1);
      corner(x1, y1, br, 0, -1, -1, 0);
      corner(x, y1, bl, 1, 0, 0, -1);
      return [{ closed: true, points: pts }];
    }
  }
}

export function shapeToD(s: ShapeNode): string {
  if (s.kind === "ellipse") {
    const rx = s.w / 2, ry = s.h / 2, cx = s.x + rx, cy = s.y + ry;
    return `M${fmt(cx - rx)},${fmt(cy)} A${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(cx + rx)},${fmt(cy)} A${fmt(rx)},${fmt(ry)} 0 1 0 ${fmt(cx - rx)},${fmt(cy)} Z`;
  }
  return subpathsToD(shapeToSubpaths(s));
}

// ---------------------------------------------------------------- pointes de flèche
// Formes d'Affinity (repère unité, pointe en (1 ; 0,5)) ; le trait s'arrête au creux (« ancre »).
const ARROW: Record<ArrowHead["style"], { pts: [number, number][]; anchor: number; across: number }> = {
  barbed: { pts: [[0, 0], [1, 0.5], [0, 1], [0.5, 0.5]], anchor: 0.5, across: 1 },
  triangle: { pts: [[0, 0], [1, 0.5], [0, 1]], anchor: 0.2, across: 1 },
};
const ARROW_UNIT = 2.8; // longueur de la pointe en épaisseurs de trait (mesuré dans Affinity)

/** Extrémité d'un chemin ouvert : point final et direction sortante (unitaire). */
function pathEnd(sp: SubPath, atEnd: boolean): { p: Vec; d: Vec } | null {
  const pts = sp.points;
  if (sp.closed || pts.length < 2) return null;
  const a = atEnd ? pts[pts.length - 1] : pts[0];
  const b = atEnd ? pts[pts.length - 2] : pts[1];
  // tangente : poignée de l'extrémité, sinon celle du point voisin, sinon le point voisin lui-même
  const near = atEnd ? a.in : a.out, far = atEnd ? b.out : b.in;
  const ok = (v?: Vec) => !!v && Math.hypot(v.x - a.x, v.y - a.y) > 1e-6;
  const q = ok(near) ? near! : ok(far) ? far! : b;
  const len = Math.hypot(a.x - q.x, a.y - q.y);
  return len > 1e-9 ? { p: { x: a.x, y: a.y }, d: { x: (a.x - q.x) / len, y: (a.y - q.y) / len } } : null;
}

/** Chemins des pointes de flèche (à remplir avec la couleur du trait). */
export function arrowHeadsD(sps: SubPath[], s: Stroke): string {
  const out: string[] = [];
  for (const sp of sps) {
    for (const [ah, atEnd] of [[s.arrowStart, false], [s.arrowEnd, true]] as const) {
      if (!ah) continue;
      const e = pathEnd(sp, atEnd);
      if (!e) continue;
      const f = ARROW[ah.style], L = ARROW_UNIT * s.width * ah.sx, W = ARROW_UNIT * s.width * ah.sy * f.across;
      const nrm = { x: -e.d.y, y: e.d.x };
      const pts = f.pts.map(([u, v]) => ({ x: e.p.x + e.d.x * (u - 1) * L + nrm.x * (v - 0.5) * W, y: e.p.y + e.d.y * (u - 1) * L + nrm.y * (v - 0.5) * W }));
      out.push(`M${pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" L")} Z`);
    }
  }
  return out.join(" ");
}

/** Chemin raccourci sous les pointes : le trait s'arrête dans la flèche au lieu de dépasser la pointe. */
export function trimForArrows(sps: SubPath[], s: Stroke): SubPath[] {
  if (!s.arrowStart && !s.arrowEnd) return sps;
  return sps.map((sp) => {
    if (sp.closed || sp.points.length < 2) return sp;
    const pts = sp.points.map((p) => ({ ...p, in: p.in && { ...p.in }, out: p.out && { ...p.out } }));
    for (const [ah, atEnd] of [[s.arrowStart, false], [s.arrowEnd, true]] as const) {
      if (!ah) continue;
      const e = pathEnd(sp, atEnd);
      if (!e) continue;
      const k = (1 - ARROW[ah.style].anchor) * ARROW_UNIT * s.width * ah.sx;
      const a = pts[atEnd ? pts.length - 1 : 0];
      const dx = -e.d.x * k, dy = -e.d.y * k;
      a.x += dx; a.y += dy;
      const h = atEnd ? a.in : a.out;
      if (h) { h.x += dx; h.y += dy; }
    }
    return { ...sp, points: pts };
  });
}
