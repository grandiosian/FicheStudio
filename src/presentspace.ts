// Espace Présentation : choix du document et des feuilles, gestion des classes, et avancement
// de la correction pour chaque classe (on reprend là où la classe s'était arrêtée).
import { store } from "./store";
import { SHEET_KINDS, uid, type Page } from "./model";
import { countSteps, startPresentation } from "./present";
import { docBrowser } from "./docbrowser";
import { DEFAULT_LEVEL_COLORS } from "./model";

export interface Classe { id: string; name: string; level: string }
interface PageProg { shown: number; total: number; at: number }
interface Pos { page: string; shown: number; total?: number }
/** Une séance : de la position de départ jusqu'au marqueur « fin de cours ». */
interface Session { at: number; from: Pos | null; to: Pos }
interface DocProg { last?: Pos; mark?: Pos & { at: number }; sessions?: Session[]; pages: Record<string, PageProg> }
type Progress = Record<string, Record<string, DocProg>>; // classe -> document -> avancement

const K_CLASSES = "fichestudio.classes", K_PROG = "fichestudio.progress", K_SEL = "fichestudio.presentSel", K_CUR = "fichestudio.presentClass";
const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

let classes: Classe[] = load(K_CLASSES, []);
let progress: Progress = load(K_PROG, {});
const excluded: Record<string, string[]> = load(K_SEL, {}); // feuilles décochées, par document
let current: string = load(K_CUR, "");
let dual: boolean = load("fichestudio.dualView", false);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** Le document est repéré par son nom (celui du fichier) : il garde son avancement d'une ouverture à l'autre. */
const docKey = () => store.doc.name;
/** Une feuille est repérée par son nom (P01, R02…), stable quand on rouvre le fichier .af. */
const pageKey = (p: Page, i: number) => p.name || `#${i + 1}`;
const levelColor = (l: string) => DEFAULT_LEVEL_COLORS[l] ?? "#8a93a6";

function docProg(classId: string): DocProg {
  const c = (progress[classId] ??= {});
  return (c[docKey()] ??= { pages: {} });
}

type Status = "none" | "todo" | "doing" | "done";
function statusOf(classId: string, p: Page, i: number): { st: Status; shown: number; total: number } {
  const total = countSteps(p);
  const pg = progress[classId]?.[docKey()]?.pages[pageKey(p, i)];
  if (!pg) return { st: total ? "todo" : "none", shown: 0, total };
  const t = pg.total || total;
  if (!t) return { st: "done", shown: 0, total: 0 };
  return { st: pg.shown >= t ? "done" : pg.shown > 0 ? "doing" : "todo", shown: pg.shown, total: t };
}

const STATUS_LABEL: Record<Status, string> = { none: "Sans correction", todo: "À faire", doing: "En cours", done: "Corrigée" };

let openFileFn: (f: File) => Promise<void> = async () => {};
export function initPresentSpace(openFile: (f: File) => Promise<void>) { openFileFn = openFile; }

export function openPresentSpace() {
  document.querySelector("#pspace")?.remove();
  const root = document.createElement("div");
  root.id = "pspace";
  document.body.appendChild(root);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("#present") && !document.querySelector(".modal")) close(); };
  const close = () => { root.remove(); window.removeEventListener("keydown", onKey); };
  window.addEventListener("keydown", onKey);
  const draw = () => render(root, close, draw);
  draw();
}

function render(root: HTMLElement, close: () => void, redraw: () => void) {
  const doc = store.doc;
  if (current && !classes.some((c) => c.id === current)) current = "";
  const cls = classes.find((c) => c.id === current) ?? null;
  const ex = new Set(excluded[docKey()] ?? []);
  const pages = doc.pages.map((p, i) => ({ p, i, key: pageKey(p, i) }));
  const chosen = pages.filter((x) => !ex.has(x.key));
  const pct = (classId: string) => {
    const list = chosen.filter((x) => countSteps(x.p) > 0 || progress[classId]?.[docKey()]?.pages[x.key]);
    if (!list.length) return 0;
    return Math.round((100 * list.filter((x) => statusOf(classId, x.p, x.i).st === "done").length) / list.length);
  };
  const dp = cls ? progress[cls.id]?.[docKey()] : undefined;
  // reprise : au marqueur « fin de cours » s'il existe, sinon à la dernière position vue
  const markIdx = dp?.mark ? pages.findIndex((x) => x.key === dp.mark!.page) : -1;
  const lastIdx = dp?.last ? pages.findIndex((x) => x.key === dp.last!.page) : -1;
  const resume = cls && markIdx >= 0 ? { i: markIdx, shown: dp!.mark!.shown, mark: true }
    : cls && lastIdx >= 0 ? { i: lastIdx, shown: dp!.last!.shown, mark: false } : null;
  const day = (t: number) => new Date(t).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
  const posLabel = (p: Pos | null) => (p ? `${esc(p.page)}, étape ${p.shown}${p.total ? ` / ${p.total}` : ""}` : "début");

  root.innerHTML = `
    <header class="ps-head">
      <span class="ps-title">▶ Présentation</span>
      <span class="ps-doc">${esc(doc.name)} · ${doc.pages.length} feuille(s)</span>
      <span class="spacer"></span>
      <select class="ps-tabs" title="Documents ouverts">${store.tabs.map((t, i) => `<option value="${i}" ${i === store.activeTab ? "selected" : ""}>${esc((i === store.activeTab ? store.doc : t.doc).name)}</option>`).join("")}</select>
      <button data-k="browse">📁 Documents…</button>
      <button data-k="close" title="Revenir à l'édition (Échap)">✕ Retour à l'édition</button>
    </header>
    <div class="ps-body">
      <aside class="ps-classes">
        <h3>Classes</h3>
        <ul>${classes.map((c) => `<li class="${c.id === current ? "on" : ""}" data-c="${c.id}">
            <i style="background:${levelColor(c.level)}">${esc(c.level)}</i><span class="nm">${esc(c.name)}</span>
            <span class="pc" title="Feuilles corrigées dans ce document">${pct(c.id)} %</span>
            <button data-ren="${c.id}" title="Renommer">✎</button><button data-del="${c.id}" title="Supprimer la classe et son avancement">✕</button></li>`).join("")}
          <li class="${current ? "" : "on"}" data-c=""><i class="none">–</i><span class="nm">Sans classe <small>(pas de suivi)</small></span></li></ul>
        <form class="ps-add"><input name="n" placeholder="Nouvelle classe (ex. 5eA)" required>
          <select name="l">${["5", "4", "3"].map((l) => `<option value="${l}">${l}e</option>`).join("")}</select><button>＋</button></form>
        <p class="hint">L'avancement de la correction est gardé pour chaque classe et chaque document : la présentation reprend là où la classe s'était arrêtée.</p>
      </aside>
      <main class="ps-main">
        <div class="ps-actions">
          ${resume ? `<button class="primary-inline big" data-k="resume">▶ Reprendre ${esc(cls!.name)}${resume.mark ? ` au 🏁 du ${day(dp!.mark!.at)}` : ""} — ${esc(pages[resume.i].p.name)}, étape ${resume.shown}${(() => { const t = statusOf(cls!.id, pages[resume.i].p, resume.i).total; return t ? ` / ${t}` : ""; })()}</button>` : ""}
          <button class="${resume ? "" : "primary-inline big"}" data-k="start" ${chosen.length ? "" : "disabled"}>▶ ${resume ? "Depuis le début" : `Présenter${cls ? ` à ${esc(cls.name)}` : ""}`} (${chosen.length} feuille(s))</button>
          ${cls ? `<button data-k="reset" title="Effacer l'avancement de cette classe pour ce document">↺ Remettre à zéro</button>` : ""}
          <label class="ps-dual" title="Interface sur cet écran, projection plein écran dans une seconde fenêtre (sur le vidéoprojecteur)"><input type="checkbox" data-k="dual" ${dual ? "checked" : ""}> 🖥 Double vue (vidéoprojecteur)</label>
        </div>
        <table class="ps-sheets">
          <thead><tr><th><input type="checkbox" data-all ${chosen.length === pages.length ? "checked" : ""} title="Toutes / aucune"></th><th>Feuille</th><th>${cls ? `Avancement · ${esc(cls.name)}` : "Corrections"}</th><th></th></tr></thead>
          <tbody>${pages.map(({ p, i, key }) => {
            const s = cls ? statusOf(cls.id, p, i) : { st: "todo" as Status, shown: 0, total: countSteps(p) };
            const w = s.total ? Math.round((100 * Math.min(s.shown, s.total)) / s.total) : s.st === "done" ? 100 : 0;
            const flag = dp?.mark && dp.mark.page === key ? `<span class="ps-flag" title="Fin du dernier cours de ${esc(cls!.name)}">🏁 fin du cours du ${day(dp.mark.at)} · étape ${dp.mark.shown}</span>` : "";
            return `<tr class="${ex.has(key) ? "off" : ""} ${resume?.i === i ? "last" : ""}">
              <td><input type="checkbox" data-sel="${esc(key)}" ${ex.has(key) ? "" : "checked"}></td>
              <td><span class="kind-tag k-${p.kind ?? "fiche"}">${SHEET_KINDS[p.kind ?? "fiche"].prefix}</span> ${esc(p.name)} ${flag}</td>
              <td>${cls ? `<div class="ps-prog st-${s.st}"><div class="bar"><i style="width:${w}%"></i></div><span>${s.total ? `${s.shown} / ${s.total}` : ""} ${STATUS_LABEL[s.st]}</span></div>` : `<span class="muted">${s.total ? `${s.total} étape(s)` : "—"}</span>`}</td>
              <td><button data-from="${i}" title="Présenter à partir de cette feuille">▶</button></td></tr>`;
          }).join("")}</tbody></table>
        ${cls ? `<h3 class="ps-sub">Séances de ${esc(cls.name)} · ${esc(doc.name)}</h3>
        ${dp?.sessions?.length ? `<ol class="ps-sessions">${dp.sessions.map((se, k) => `<li><b>Séance ${k + 1}</b><span class="d">${day(se.at)} ${new Date(se.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span><span class="r">${posLabel(se.from)} → <b>🏁 ${posLabel(se.to)}</b></span><button data-sdel="${k}" title="Supprimer cette séance">✕</button></li>`).join("")}</ol>`
          : `<p class="hint">Pendant la présentation, le bouton <b>🏁 Fin de cours</b> (ou la touche Fin) enregistre où la classe s'est arrêtée : la prochaine séance reprendra à cet endroit, et la séance s'ajoute ici.</p>`}` : ""}
        ${classes.length ? `<h3 class="ps-sub">Toutes les classes · ${esc(doc.name)}</h3>
        <div class="ps-matrix" style="grid-template-columns: 120px repeat(${chosen.length}, minmax(26px, 1fr)) 52px">
          <span></span>${chosen.map((x) => `<span class="mh" title="${esc(x.p.name)}">${esc(x.p.name)}</span>`).join("")}<span class="mh">Total</span>
          ${classes.map((c) => `<span class="mr" data-c="${c.id}"><i style="background:${levelColor(c.level)}"></i>${esc(c.name)}</span>${chosen.map((x) => {
            const s = statusOf(c.id, x.p, x.i);
            const mk = progress[c.id]?.[docKey()]?.mark;
            const here = mk && mk.page === x.key;
            return `<span class="cell st-${s.st} ${here ? "flag" : ""}" title="${esc(c.name)} · ${esc(x.p.name)} : ${STATUS_LABEL[s.st]}${s.total ? ` (${s.shown} / ${s.total})` : ""}${here ? ` · 🏁 fin du cours du ${day(mk!.at)}` : ""}">${here ? "🏁" : ""}</span>`;
          }).join("")}<span class="mt">${pct(c.id)} %</span>`).join("")}
        </div>` : ""}
      </main>
    </div>`;

  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s);
  $<HTMLElement>('[data-k="close"]')!.onclick = close;
  $<HTMLSelectElement>(".ps-tabs")!.onchange = (e) => { store.switchTab(+(e.target as HTMLSelectElement).value); redraw(); };
  $<HTMLElement>('[data-k="browse"]')!.onclick = () => docBrowser(async (f) => { await openFileFn(f); redraw(); }, "Choisir le document à présenter");
  root.querySelectorAll<HTMLElement>(".ps-classes li[data-c], .ps-matrix .mr").forEach((li) => (li.onclick = (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    current = li.dataset.c!; save(K_CUR, current); redraw();
  }));
  root.querySelectorAll<HTMLElement>("[data-ren]").forEach((b) => (b.onclick = () => {
    const c = classes.find((x) => x.id === b.dataset.ren)!;
    const n = prompt("Nom de la classe", c.name);
    if (n?.trim()) { c.name = n.trim(); save(K_CLASSES, classes); redraw(); }
  }));
  root.querySelectorAll<HTMLElement>("[data-del]").forEach((b) => (b.onclick = () => {
    const c = classes.find((x) => x.id === b.dataset.del)!;
    if (!confirm(`Supprimer la classe « ${c.name} » et tout son avancement ?`)) return;
    classes = classes.filter((x) => x.id !== c.id); delete progress[c.id];
    save(K_CLASSES, classes); save(K_PROG, progress); redraw();
  }));
  $<HTMLFormElement>(".ps-add")!.onsubmit = (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const name = (f.elements.namedItem("n") as HTMLInputElement).value.trim();
    const level = (f.elements.namedItem("l") as HTMLSelectElement).value;
    if (!name) return;
    const c = { id: uid("c"), name, level };
    classes.push(c); current = c.id;
    save(K_CLASSES, classes); save(K_CUR, current); redraw();
  };
  const setSel = (keys: string[], on: boolean) => {
    const s = new Set(excluded[docKey()] ?? []);
    keys.forEach((k) => (on ? s.delete(k) : s.add(k)));
    excluded[docKey()] = [...s]; save(K_SEL, excluded); redraw();
  };
  root.querySelectorAll<HTMLInputElement>("[data-sel]").forEach((c) => (c.onchange = () => setSel([c.dataset.sel!], c.checked)));
  $<HTMLInputElement>("[data-all]")!.onchange = (e) => setSel(pages.map((x) => x.key), (e.target as HTMLInputElement).checked);
  $<HTMLElement>('[data-k="reset"]')?.addEventListener("click", () => {
    if (!cls || !confirm(`Remettre à zéro l'avancement de ${cls.name} pour « ${doc.name} » ?`)) return;
    delete progress[cls.id]?.[docKey()];
    save(K_PROG, progress); redraw();
  });

  const launch = (start?: number, shown?: number) => {
    const order = chosen.map((x) => x.i);
    if (start !== undefined && !order.includes(start)) order.push(start), order.sort((a, b) => a - b);
    if (!order.length) return;
    const c = cls;
    // point de départ de la séance (pour l'historique « de … à … »)
    const startPos: Pos | null = start !== undefined ? { page: pageKey(store.doc.pages[start], start), shown: shown ?? 0 } : null;
    let sessionIndex = -1;
    root.style.display = "none";
    startPresentation(order, {
      start, shown, label: c?.name, dual,
      onProgress: (pi, sh, total) => {
        if (!c) return;
        const d = docProg(c.id), key = pageKey(store.doc.pages[pi], pi);
        const prev = d.pages[key];
        // l'avancement retient l'étape la plus loin atteinte ; la reprise, la position exacte
        d.pages[key] = { shown: Math.max(prev?.shown ?? 0, sh), total, at: Date.now() };
        d.last = { page: key, shown: sh };
        save(K_PROG, progress);
      },
      onMark: c ? (pi, sh, total) => {
        const d = docProg(c.id), key = pageKey(store.doc.pages[pi], pi);
        const to = { page: key, shown: sh, total };
        d.mark = { ...to, at: Date.now() };
        d.sessions ??= [];
        // un second marquage pendant la même présentation corrige la séance au lieu d'en ajouter une
        if (sessionIndex >= 0 && d.sessions[sessionIndex]) d.sessions[sessionIndex] = { ...d.sessions[sessionIndex], to, at: Date.now() };
        else { d.sessions.push({ at: Date.now(), from: startPos, to }); sessionIndex = d.sessions.length - 1; }
        save(K_PROG, progress);
        return `🏁 Fin de cours enregistrée pour ${c.name} : ${store.doc.pages[pi].name}, étape ${sh}${total ? ` / ${total}` : ""}. La prochaine séance reprendra ici.`;
      } : undefined,
      onClose: () => { root.style.display = ""; redraw(); },
    });
  };
  $<HTMLInputElement>('[data-k="dual"]')!.onchange = (e) => { dual = (e.target as HTMLInputElement).checked; save("fichestudio.dualView", dual); };
  $<HTMLElement>('[data-k="start"]')!.onclick = () => launch(chosen[0]?.i, 0);
  root.querySelectorAll<HTMLElement>("[data-sdel]").forEach((b) => (b.onclick = () => {
    if (!cls || !dp?.sessions || !confirm("Supprimer cette séance de l'historique ?")) return;
    dp.sessions.splice(+b.dataset.sdel!, 1);
    // le marqueur suit la dernière séance restante
    const lastS = dp.sessions[dp.sessions.length - 1];
    if (lastS) dp.mark = { ...lastS.to, at: lastS.at }; else delete dp.mark;
    save(K_PROG, progress); redraw();
  }));
  $<HTMLElement>('[data-k="resume"]')?.addEventListener("click", () => resume && launch(resume.i, resume.shown));
  root.querySelectorAll<HTMLElement>("[data-from]").forEach((b) => (b.onclick = () => launch(+b.dataset.from!, 0)));
}
