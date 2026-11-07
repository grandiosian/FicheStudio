// État de l'application, historique (annuler/rétablir) et sauvegarde automatique.
import { findNode, newDoc, upgradeDoc, type Doc, type GroupNode, type Page, type SceneNode } from "./model";
import { IDENTITY, type Mat } from "./model";
import { mul } from "./geom";

export type Tool = "select" | "node" | "pen" | "rect" | "ellipse" | "line" | "text" | "hand";

type Snapshot = string;

/** Un onglet = un document ouvert, avec son propre historique et sa position. */
export interface Session {
  id: string;
  doc: Doc;
  pageIndex: number;
  selection: string[];
  scope: string | null;
  activeLayer: string | null;
  editingMaster: string | null;
  previewRow: number | null;
  undo: Snapshot[];
  redo: Snapshot[];
  dirty: boolean;
}

let sid = 0;

/** Images retirées d'un document : gardées pour pouvoir annuler (les clés sont uniques). */
export const assetTrash: Record<string, Doc["assets"][string]> = {};

class Store {
  tabs: Session[] = [];
  activeTab = 0;
  dirty = false;
  doc: Doc = newDoc();
  pageIndex = 0;
  selection: string[] = [];
  scope: string | null = null;        // groupe dans lequel on est « entré » (double-clic)
  activeLayer: string | null = null;
  tool: Tool = "select";
  previewRow: number | null = null;   // ligne de données affichée en aperçu
  editingText: string | null = null;
  editingMaster: string | null = null; // gabarit en cours de modification
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<(why: string) => void>();
  private saveTimer = 0;

  get page(): Page {
    const m = this.editingMaster ? this.doc.masters.find((x) => x.id === this.editingMaster) : null;
    if (m) {
      // pseudo-page : on édite directement les calques du gabarit
      const p = { id: m.id, name: `Gabarit « ${m.name} »`, width: m.width, height: m.height, background: "#ffffff", sections: 1, split: "h", master: null, fields: {} } as Page;
      Object.defineProperty(p, "layers", { get: () => m.layers, set: (v) => { m.layers = v; }, enumerable: true });
      return p;
    }
    return this.doc.pages[Math.min(this.pageIndex, this.doc.pages.length - 1)];
  }

  on(fn: (why: string) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(why = "change") {
    for (const l of this.listeners) l(why);
    if (why === "change" || why === "doc") this.scheduleSave();
  }

  private snap(): Snapshot {
    const { pages, data, name, dpi, masters, fields, levelColors, numbering } = this.doc;
    return JSON.stringify({ pages, data, name, dpi, masters, fields, levelColors, numbering, pageIndex: this.pageIndex, assetKeys: Object.keys(this.doc.assets) });
  }
  private restore(s: Snapshot) {
    const o = JSON.parse(s);
    Object.assign(this.doc, { pages: o.pages, data: o.data, name: o.name, dpi: o.dpi, masters: o.masters, fields: o.fields, levelColors: o.levelColors, numbering: o.numbering });
    // images retirées depuis : on les remet (les données ne sont pas dans l'historique)
    if (Array.isArray(o.assetKeys)) {
      const keep = new Set<string>(o.assetKeys);
      for (const k of keep) if (!this.doc.assets[k] && assetTrash[k]) this.doc.assets[k] = assetTrash[k];
      for (const k of Object.keys(this.doc.assets)) if (!keep.has(k)) { assetTrash[k] = this.doc.assets[k]; delete this.doc.assets[k]; }
    }
    if (this.editingMaster && !this.doc.masters.some((m) => m.id === this.editingMaster)) this.editingMaster = null;
    this.pageIndex = o.pageIndex;
    this.selection = this.selection.filter((id) => this.find(id));
  }

  /** Toute modification passe par ici : un niveau d'annulation par appel. */
  commit(fn: () => void, why = "change") {
    this.undoStack.push(this.snap());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    fn();
    this.emit(why);
  }
  /** Point d'annulation avant une modification faite « en direct » (glisser de nœuds). */
  checkpoint() {
    this.undoStack.push(this.snap());
    this.redoStack = [];
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snap());
    this.restore(s);
    this.emit("change");
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snap());
    this.restore(s);
    this.emit("change");
  }

  /** Remplace le document de l'onglet courant. */
  load(doc: Doc) {
    if (!this.tabs.length) this.tabs.push(this.blankSession(doc));
    this.dirty = false;
    this.doc = upgradeDoc(doc);
    this.editingMaster = null;
    this.pageIndex = 0;
    this.selection = [];
    this.scope = null;
    this.activeLayer = null;
    this.undoStack = [];
    this.redoStack = [];
    this.previewRow = null;
    this.emit("doc");
  }

  private blankSession(doc: Doc): Session {
    return { id: `t${++sid}`, doc, pageIndex: 0, selection: [], scope: null, activeLayer: null, editingMaster: null, previewRow: null, undo: [], redo: [], dirty: false };
  }
  /** Range l'état courant dans son onglet. */
  private stash() {
    const t = this.tabs[this.activeTab];
    if (!t) return;
    Object.assign(t, {
      doc: this.doc, pageIndex: this.pageIndex, selection: this.selection, scope: this.scope, activeLayer: this.activeLayer,
      editingMaster: this.editingMaster, previewRow: this.previewRow, undo: this.undoStack, redo: this.redoStack, dirty: this.dirty,
    });
  }
  private unstash(t: Session) {
    this.doc = t.doc; this.pageIndex = t.pageIndex; this.selection = t.selection; this.scope = t.scope;
    this.activeLayer = t.activeLayer; this.editingMaster = t.editingMaster; this.previewRow = t.previewRow;
    this.undoStack = t.undo; this.redoStack = t.redo; this.dirty = t.dirty;
  }
  /** Ouvre un document dans un nouvel onglet (ou à la place d'un onglet vide inutilisé). */
  openTab(doc: Doc) {
    this.stash();
    const cur = this.tabs[this.activeTab];
    const unused = cur && !cur.dirty && cur.undo.length === 0 && cur.doc.pages.length === 1 && cur.doc.pages[0].layers.every((l) => !l.children.length) && !cur.doc.masters.length;
    if (unused) { this.load(doc); this.stash(); return; }
    const t = this.blankSession(upgradeDoc(doc));
    this.tabs.push(t);
    this.activeTab = this.tabs.length - 1;
    this.unstash(t);
    this.emit("doc");
  }
  switchTab(i: number) {
    if (i === this.activeTab || !this.tabs[i]) return;
    this.stash();
    this.activeTab = i;
    this.unstash(this.tabs[i]);
    this.emit("doc");
  }
  closeTab(i: number) {
    this.stash();
    this.tabs.splice(i, 1);
    if (!this.tabs.length) this.tabs.push(this.blankSession(newDoc()));
    this.activeTab = Math.min(i <= this.activeTab ? Math.max(0, this.activeTab - 1) : this.activeTab, this.tabs.length - 1);
    this.unstash(this.tabs[this.activeTab]);
    this.emit("doc");
  }
  isDirty(i: number) { return i === this.activeTab ? this.dirty : this.tabs[i]?.dirty; }
  markSaved() { this.dirty = false; this.emit("tabs"); }
  allDocs(): { docs: Doc[]; active: number } {
    this.stash();
    return { docs: this.tabs.map((t) => t.doc), active: this.activeTab };
  }
  restoreTabs(docs: Doc[], active: number) {
    this.tabs = docs.map((d) => this.blankSession(upgradeDoc(d)));
    this.activeTab = Math.min(active, this.tabs.length - 1);
    this.unstash(this.tabs[this.activeTab]);
    this.emit("doc");
  }

  find(id: string) { return findNode(this.page, id); }
  selected(): SceneNode[] { return this.selection.map((id) => this.find(id)?.node).filter(Boolean) as SceneNode[]; }
  select(ids: string[]) { this.selection = ids; this.emit("selection"); }

  layer(): GroupNode {
    const p = this.page;
    const l = p.layers.find((l) => l.id === this.activeLayer && l.visible && !l.locked)
      ?? [...p.layers].reverse().find((l) => l.visible && !l.locked)
      ?? p.layers[p.layers.length - 1];
    return l;
  }

  /** Matrice cumulée (repère de la page) d'un parent, pour placer un nouvel objet. */
  cumulative(target: GroupNode): Mat {
    let result: Mat = [...IDENTITY];
    const chain: GroupNode[] = [];
    const visit = (g: GroupNode, path: GroupNode[]): boolean => {
      if (g === target) { chain.push(...path, g); return true; }
      for (const c of g.children) if (c.type === "group" && visit(c, [...path, g])) return true;
      return false;
    };
    for (const l of this.page.layers) if (visit(l, [])) break;
    for (const g of chain) result = mul(result, g.transform);
    return result;
  }

  parentCumulative(id: string): Mat {
    const f = this.find(id);
    if (!f) return [...IDENTITY];
    return this.cumulative(f.parent);
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { const { docs, active } = this.allDocs(); saveLocal(docs, active); }, 800);
  }
}

export const store = new Store();

// ------------------------------------------------------------------ sauvegarde locale (IndexedDB)

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("fichestudio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("docs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** Sauvegarde de tous les onglets ouverts. */
export async function saveLocal(docs: Doc[], active: number) {
  try {
    const db = await idb();
    db.transaction("docs", "readwrite").objectStore("docs").put(JSON.stringify({ docs, active }), "tabs");
  } catch { /* stockage indisponible (navigation privée) : on ignore */ }
}

export async function loadLocal(): Promise<{ docs: Doc[]; active: number } | null> {
  try {
    const db = await idb();
    const get = (key: string) => new Promise<unknown>((res) => {
      const r = db.transaction("docs").objectStore("docs").get(key);
      r.onsuccess = () => { try { res(r.result ? JSON.parse(r.result) : null); } catch { res(null); } };
      r.onerror = () => res(null);
    });
    const tabs = (await get("tabs")) as { docs: Doc[]; active: number } | null;
    if (tabs?.docs?.length) return tabs;
    const one = (await get("current")) as Doc | null; // ancienne sauvegarde (un seul document)
    return one ? { docs: [one], active: 0 } : null;
  } catch { return null; }
}
