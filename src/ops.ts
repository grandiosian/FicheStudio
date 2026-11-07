// Opérations d'édition sur le modèle (déplacer, redimensionner, grouper, aligner…).
import { store } from "./store";
import { apply, inv, mul, shapeToSubpaths, translate, type Box } from "./geom";
import { newGroup, uid, walk, type GroupNode, type Mat, type SceneNode } from "./model";

/** Applique une transformation exprimée dans le repère de la page à un nœud. */
export function transformNode(n: SceneNode, docM: Mat, parentCum: Mat, bake = true) {
  const delta = mul(inv(parentCum), mul(docM, parentCum)); // dans le repère du parent
  const T = n.transform;
  const G = mul(inv(T), mul(delta, T));                     // dans le repère local du nœud
  const axisAligned = Math.abs(G[1]) < 1e-9 && Math.abs(G[2]) < 1e-9;
  if (bake && n.type === "path") {
    for (const sp of n.subpaths)
      for (const p of sp.points) {
        Object.assign(p, apply(G, p));
        if (p.in) p.in = apply(G, p.in);
        if (p.out) p.out = apply(G, p.out);
      }
    return;
  }
  if (bake && axisAligned && (n.type === "shape" || (n.type === "text" && n.frame))) {
    // on redimensionne la géométrie : coins arrondis et corps du texte conservés
    const b = n.type === "shape" ? n : n.frame!;
    const p = apply(G, { x: b.x, y: b.y }), q = apply(G, { x: b.x + b.w, y: b.y + b.h });
    b.x = Math.min(p.x, q.x); b.y = Math.min(p.y, q.y); b.w = Math.abs(q.x - p.x); b.h = Math.abs(q.y - p.y);
    return;
  }
  n.transform = mul(delta, T);
}

export function moveSelection(dx: number, dy: number) {
  const nodes = store.selected().filter((n) => !n.locked);
  if (!nodes.length) return;
  store.commit(() => {
    for (const n of nodes) transformNode(n, translate(dx, dy), store.parentCumulative(n.id), false);
  });
}

export function deleteSelection() {
  const ids = new Set(store.selection);
  if (!ids.size) return;
  store.commit(() => {
    const prune = (g: GroupNode) => {
      g.children = g.children.filter((c) => !ids.has(c.id));
      g.children.forEach((c) => c.type === "group" && prune(c));
    };
    store.page.layers.forEach(prune);
    store.selection = [];
  });
}

export function cloneNode<T extends SceneNode>(n: T): T {
  const c = structuredClone(n);
  walk([c], (x) => { x.id = uid(); });
  return c;
}

let clipboard: { nodes: SceneNode[]; cums: Mat[] } | null = null;

export function copySelection() {
  const nodes = store.selected();
  clipboard = { nodes: nodes.map((n) => structuredClone(n)), cums: nodes.map((n) => store.parentCumulative(n.id)) };
}

export function paste(offset = 30) {
  if (!clipboard) return;
  const layer = store.drawLayer();
  const L = store.cumulative(layer);
  store.commit(() => {
    const ids: string[] = [];
    clipboard!.nodes.forEach((n, i) => {
      const c = cloneNode(n);
      // conserver la position visuelle dans le nouveau parent, puis décaler
      c.transform = mul(inv(L), mul(translate(offset, offset), mul(clipboard!.cums[i], c.transform)));
      layer.children.push(c);
      ids.push(c.id);
    });
    store.isoAdd(ids);
    store.selection = ids;
  });
}

export function duplicate() { copySelection(); paste(30); }

export function groupSelection() {
  const found = store.selection.map((id) => store.find(id)).filter(Boolean) as NonNullable<ReturnType<typeof store.find>>[];
  if (found.length < 2) return;
  const parent = found[0].parent;
  if (found.some((f) => f.parent !== parent)) return;
  store.commit(() => {
    const ordered = found.sort((a, b) => a.index - b.index);
    const g = newGroup(ordered.map((f) => f.node));
    const at = ordered[ordered.length - 1].index - ordered.length + 1;
    parent.children = parent.children.filter((c) => !ordered.some((f) => f.node === c));
    parent.children.splice(Math.max(0, at), 0, g);
    store.selection = [g.id];
  });
}

export function ungroupSelection() {
  const groups = store.selection.map((id) => store.find(id)).filter((f) => f && f.node.type === "group") as NonNullable<ReturnType<typeof store.find>>[];
  if (!groups.length) return;
  store.commit(() => {
    const ids: string[] = [];
    for (const f of groups) {
      const g = f.node as GroupNode;
      const kids = [...(g.mask ? [g.mask] : []), ...g.children];
      for (const k of kids) {
        k.transform = mul(g.transform, k.transform);
        if (g.opacity < 1) k.opacity *= g.opacity;
        ids.push(k.id);
      }
      const i = f.parent.children.indexOf(g);
      f.parent.children.splice(i, 1, ...kids);
    }
    store.isoAdd(ids); // vue isolée : les éléments du groupe dissocié restent visibles
    store.selection = ids;
  });
}

export function arrange(where: "front" | "back" | "up" | "down") {
  const found = store.selection.map((id) => store.find(id)).filter(Boolean) as NonNullable<ReturnType<typeof store.find>>[];
  if (!found.length) return;
  store.commit(() => {
    for (const f of found) {
      const arr = f.parent.children;
      const i = arr.indexOf(f.node);
      arr.splice(i, 1);
      const j = where === "front" ? arr.length : where === "back" ? 0 : where === "up" ? Math.min(arr.length, i + 1) : Math.max(0, i - 1);
      arr.splice(j, 0, f.node);
    }
  });
}

/** Le premier élément (en haut de la pile) découpe les autres. */
export function maskSelection() {
  const found = store.selection.map((id) => store.find(id)).filter(Boolean) as NonNullable<ReturnType<typeof store.find>>[];
  if (found.length < 2) return;
  const parent = found[0].parent;
  if (found.some((f) => f.parent !== parent)) return;
  const ordered = found.sort((a, b) => a.index - b.index);
  const top = ordered[ordered.length - 1].node;
  if (top.type !== "shape" && top.type !== "path") return;
  store.commit(() => {
    const g = newGroup(ordered.slice(0, -1).map((f) => f.node), "Masque");
    g.mask = top;
    const at = ordered[0].index;
    parent.children = parent.children.filter((c) => !ordered.some((f) => f.node === c));
    parent.children.splice(at, 0, g);
    store.selection = [g.id];
  });
}

export function convertToCurves() {
  const shapes = store.selected().filter((n) => n.type === "shape");
  if (!shapes.length) return;
  store.commit(() => {
    for (const s of shapes) {
      if (s.type !== "shape") continue;
      const f = store.find(s.id)!;
      f.parent.children[f.index] = {
        id: s.id, name: s.name, visible: s.visible, locked: s.locked, opacity: s.opacity, transform: s.transform,
        type: "path", subpaths: shapeToSubpaths(s), fill: s.fill, stroke: s.stroke,
      };
    }
  });
}

export function alignSelection(boxes: Map<string, Box>, mode: "l" | "c" | "r" | "t" | "m" | "b", page: Box | null) {
  const nodes = store.selected().filter((n) => boxes.has(n.id));
  if (!nodes.length) return;
  let ref: Box | null = page;
  if (!ref) {
    const bs = nodes.map((n) => boxes.get(n.id)!);
    const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y));
    ref = { x: x0, y: y0, w: Math.max(...bs.map((b) => b.x + b.w)) - x0, h: Math.max(...bs.map((b) => b.y + b.h)) - y0 };
  }
  store.commit(() => {
    for (const n of nodes) {
      const b = boxes.get(n.id)!;
      let dx = 0, dy = 0;
      if (mode === "l") dx = ref!.x - b.x;
      if (mode === "c") dx = ref!.x + ref!.w / 2 - (b.x + b.w / 2);
      if (mode === "r") dx = ref!.x + ref!.w - (b.x + b.w);
      if (mode === "t") dy = ref!.y - b.y;
      if (mode === "m") dy = ref!.y + ref!.h / 2 - (b.y + b.h / 2);
      if (mode === "b") dy = ref!.y + ref!.h - (b.y + b.h);
      transformNode(n, translate(dx, dy), store.parentCumulative(n.id), false);
    }
  });
}

export function distribute(boxes: Map<string, Box>, axis: "h" | "v") {
  const nodes = store.selected().filter((n) => boxes.has(n.id));
  if (nodes.length < 3) return;
  const key = axis === "h" ? "x" : "y", size = axis === "h" ? "w" : "h";
  const sorted = [...nodes].sort((a, b) => boxes.get(a.id)![key] - boxes.get(b.id)![key]);
  const first = boxes.get(sorted[0].id)!, last = boxes.get(sorted[sorted.length - 1].id)!;
  const total = sorted.reduce((s, n) => s + boxes.get(n.id)![size], 0);
  const gap = (last[key] + last[size] - first[key] - total) / (sorted.length - 1);
  store.commit(() => {
    let pos = first[key];
    for (const n of sorted) {
      const b = boxes.get(n.id)!;
      const d = pos - b[key];
      transformNode(n, axis === "h" ? translate(d, 0) : translate(0, d), store.parentCumulative(n.id), false);
      pos += b[size] + gap;
    }
  });
}

/** Ajoute un nœud créé en coordonnées de page dans le calque actif. */
export function addToLayer(n: SceneNode) {
  const layer = store.drawLayer();
  const L = store.cumulative(layer);
  n.transform = mul(inv(L), n.transform);
  store.commit(() => {
    layer.children.push(n);
    store.selection = [n.id];
    store.isoAdd([n.id]); // vue isolée : le nouvel objet reste visible
  });
}
