// Opérations booléennes sur les objets vectoriels (formes, courbes, groupes de formes) :
// union, soustraction, intersection, exclusion, division. Calcul par paper.js, chargé à la demande,
// qui garde les courbes de Bézier (un cercle soustrait reste un arc, pas un polygone).
import { store } from "./store";
import { newPath, walk, type Anchor, type GroupNode, type Mat, type PathNode, type SceneNode, type SubPath } from "./model";
import { apply, inv, mul, shapeToSubpaths } from "./geom";

export type BoolOp = "unite" | "subtract" | "intersect" | "exclude" | "divide";
export const BOOL_OPS: { op: BoolOp; label: string; hint: string }[] = [
  { op: "unite", label: "Union", hint: "Fusionne les objets en une seule forme" },
  { op: "subtract", label: "Soustraire", hint: "Retire les objets du dessus à l'objet du dessous" },
  { op: "intersect", label: "Intersection", hint: "Garde la partie commune à tous les objets" },
  { op: "exclude", label: "Exclure", hint: "Garde ce qui n'est pas commun (zones qui se chevauchent évidées)" },
  { op: "divide", label: "Diviser", hint: "Découpe les objets en morceaux séparés à chaque chevauchement" },
];

type Paper = typeof import("paper/dist/paper-core");
let paperP: Promise<Paper> | null = null;
async function getPaper(): Promise<Paper> {
  paperP ??= import("paper/dist/paper-core").then((m) => {
    const p = ((m as unknown as { default?: Paper }).default ?? m) as Paper;
    p.setup(new p.Size(1, 1)); // projet hors écran : seulement pour la géométrie
    return p;
  });
  return paperP;
}

/** Objets vectoriels (dans l'ordre de dessin) de la sélection ; un groupe apporte ses formes et courbes. */
function vectorsOf(ids: string[]): SceneNode[] {
  const want = new Set(ids);
  const out: SceneNode[] = [];
  walk(store.page.layers, (n) => {
    if (!want.has(n.id)) return;
    if (n.type === "shape" || n.type === "path") out.push(n);
    else if (n.type === "group") walk(n.children, (c) => { if (c.type === "shape" || c.type === "path") out.push(c); });
  });
  return [...new Set(out)];
}

/** Contours de l'objet dans le repère de la page. */
function pageSubpaths(n: SceneNode): SubPath[] {
  const M = mul(store.parentCumulative(n.id), n.transform);
  const sps = n.type === "shape" ? shapeToSubpaths(n) : n.type === "path" ? n.subpaths : [];
  return sps.map((sp) => ({
    closed: true, // un trait ouvert est fermé pour l'opération (comme Affinity)
    points: sp.points.map((p) => ({ ...apply(M, p), ...(p.in ? { in: apply(M, p.in) } : {}), ...(p.out ? { out: apply(M, p.out) } : {}) })),
  }));
}

function toPaper(P: Paper, sps: SubPath[]) {
  const paths = sps.filter((sp) => sp.points.length > 1).map((sp) => new P.Path({
    closed: true, insert: false,
    segments: sp.points.map((a) => new P.Segment(
      new P.Point(a.x, a.y),
      a.in ? new P.Point(a.in.x - a.x, a.in.y - a.y) : undefined,
      a.out ? new P.Point(a.out.x - a.x, a.out.y - a.y) : undefined,
    )),
  }));
  return new P.CompoundPath({ children: paths, insert: false, fillRule: "nonzero" });
}

function fromPaper(item: paper.PathItem, toLocal: Mat): SubPath[] {
  const paths = item.className === "CompoundPath" ? ((item as paper.CompoundPath).children as paper.Path[]) : [item as paper.Path];
  const L = (x: number, y: number) => apply(toLocal, { x, y });
  return paths.filter((p) => p.segments && p.segments.length > 1 && Math.abs(p.area) > 0.01).map((p) => ({
    closed: true,
    points: p.segments.map((s): Anchor => {
      const pt = L(s.point.x, s.point.y);
      const a: Anchor = { ...pt };
      if (!s.handleIn.isZero()) a.in = L(s.point.x + s.handleIn.x, s.point.y + s.handleIn.y);
      if (!s.handleOut.isZero()) a.out = L(s.point.x + s.handleOut.x, s.point.y + s.handleOut.y);
      if (a.in && a.out) a.smooth = true;
      return a;
    }),
  }));
}

const isEmpty = (it: paper.PathItem | null | undefined) => !it || Math.abs((it as paper.Path).area ?? 0) < 0.5;

/** Applique l'opération à la sélection ; renvoie un message pour la barre d'état. */
export async function booleanOp(op: BoolOp): Promise<string> {
  const objs = vectorsOf(store.selection);
  if (objs.length < (op === "divide" ? 1 : 2)) return op === "divide" ? "Sélectionnez des formes ou courbes à diviser." : "Sélectionnez au moins deux formes ou courbes.";
  const P = await getPaper();
  const items = objs.map((n) => toPaper(P, pageSubpaths(n)));
  const base = objs[0], top = objs[objs.length - 1];
  // le résultat prend la place de l'objet du dessus et le style de celui du dessous (comme Affinity)
  const host = store.find(top.id)!;
  const toLocal = inv(store.parentCumulative(top.id));
  let results: paper.PathItem[] = [];
  if (op === "unite") results = [items.slice(1).reduce((a, b) => a.unite(b), items[0] as paper.PathItem)];
  else if (op === "subtract") results = [items.slice(1).reduce((a, b) => a.subtract(b), items[0] as paper.PathItem)];
  else if (op === "intersect") results = [items.slice(1).reduce((a, b) => a.intersect(b), items[0] as paper.PathItem)];
  else if (op === "exclude") results = [items.slice(1).reduce((a, b) => a.exclude(b), items[0] as paper.PathItem)];
  else {
    // division : chaque zone délimitée par les contours devient un objet séparé
    let regions: paper.PathItem[] = [items[0]];
    for (const it of items.slice(1)) {
      const next: paper.PathItem[] = [];
      for (const r of regions) next.push(r.intersect(it), r.subtract(it));
      const covered = regions.reduce((a, b) => a.unite(b));
      next.push(it.subtract(covered));
      regions = next.filter((r) => !isEmpty(r));
    }
    // un seul objet : ses parties disjointes deviennent des objets séparés
    results = regions.flatMap((r) => {
      const kids = (r as paper.CompoundPath).children as paper.Path[] | undefined;
      return objs.length === 1 && r.className === "CompoundPath" && kids && kids.length > 1 && kids.every((k) => k.clockwise === kids[0].clockwise) ? kids.map((k) => k.clone({ insert: false })) : [r];
    });
  }
  results = results.filter((r) => !isEmpty(r));
  if (!results.length) return "Rien ne reste : les objets ne se chevauchent pas assez pour cette opération.";
  const style = base as Extract<SceneNode, { type: "shape" | "path" }>;
  const label = BOOL_OPS.find((b) => b.op === op)!.label;
  const created: PathNode[] = results.map((r, i) => {
    const p = newPath(fromPaper(r, toLocal), results.length > 1 ? `${label} ${i + 1}` : label);
    p.fill = structuredClone(style.fill);
    p.stroke = structuredClone(style.stroke);
    p.opacity = style.opacity;
    if (style.blend) p.blend = style.blend;
    return p;
  });
  store.commit(() => {
    const at = host.parent.children.indexOf(top);
    host.parent.children.splice(at + 1, 0, ...created);
    // retirer les originaux (et les groupes vidés)
    for (const n of objs) {
      const f = store.find(n.id);
      if (f) f.parent.children.splice(f.parent.children.indexOf(n), 1);
    }
    const prune = (g: GroupNode) => { g.children = g.children.filter((c) => c.type !== "group" || c.isLayer || c.children.length || c.mask); g.children.forEach((c) => c.type === "group" && prune(c)); };
    store.page.layers.forEach(prune);
    store.selection = created.map((c) => c.id);
  });
  return `${label} : ${objs.length} objet(s) → ${created.length} objet(s).`;
}
