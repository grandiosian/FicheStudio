// Espace Présentation : choix du document et des feuilles, gestion des classes, et avancement
// de la correction pour chaque classe (on reprend là où la classe s'était arrêtée).
import { store } from "./store";
import { SHEET_KINDS, uid, type Page } from "./model";
import { countSteps, startPresentation } from "./present";
import { docBrowser } from "./docbrowser";
import { DEFAULT_LEVEL_COLORS } from "./model";
import { centraleApi, centraleAdmin, toutEnvoyer, chargerCentrale, envoyerAvancement, etatEnvoi, suivreEnvoi, type CentraleCours,
  listerDocuments, chargerDocument, enregistrerDocument, retirerDocument, nomDocumentCentrale } from "./centrale";
import { assetBytes } from "./assets";

/** sub : groupe (demi-classe) d'une classe de la Centrale ; etab : établissement (Centrale). */
export interface Classe { id: string; name: string; level: string; sub?: boolean; etab?: string }
interface PageProg { shown: number; total: number; at: number }
interface Pos { page: string; shown: number; total?: number; pt?: { x: number; y: number } }
/** Une séance : de la position de départ jusqu'au marqueur « fin de cours ». */
interface Session { at: number; from: Pos | null; to: Pos }
interface DocProg { last?: Pos; mark?: Pos & { at: number }; sessions?: Session[]; pages: Record<string, PageProg> }
type Progress = Record<string, Record<string, DocProg>>; // classe -> document -> avancement

const K_CLASSES = "fichestudio.classes", K_PROG = "fichestudio.progress", K_SEL = "fichestudio.presentSel", K_CUR = "fichestudio.presentClass";
const load = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage indisponible */ } };

// Servi par la Centrale : classes et avancement de la Centrale (chargés à l'ouverture), sinon ceux du navigateur
const viaCentrale = !!centraleApi;
const K_CUR_ = viaCentrale ? "fichestudio.presentClass.centrale" : K_CUR;
let classes: Classe[] = viaCentrale ? [] : load(K_CLASSES, []);
let progress: Progress = viaCentrale ? {} : load(K_PROG, {});
const excluded: Record<string, string[]> = load(K_SEL, {}); // feuilles décochées, par document
let current: string = load(K_CUR_, "");
let centrale: { etat: "chargement" | "ok" | "erreur"; erreur?: string; cours?: CentraleCours | null } = { etat: "chargement" };
/** Classe demandée par un lien de la Centrale (feuille de séance) : elle passe avant le cours en cours. */
let classeImposee = "";
/** Lancement demandé par le lien : « presentation » (feuille en cours, corrigé masqué) ou « correction » (reprise à l'étape). */
let lancerDemande: "" | "presentation" | "correction" = "";
/** Séance de la feuille d'appel d'où vient le lien (pour y revenir). */
let seanceRetour = "";
export function demandeCentrale(o: { classe?: string; seance?: string; lancer?: string }) {
  if (o.classe) { classeImposee = o.classe; current = o.classe; save(K_CUR_, current); }
  seanceRetour = o.seance ?? "";
  lancerDemande = o.lancer === "presentation" || o.lancer === "correction" ? o.lancer : "";
}
/** Retour à la feuille d'appel (feuille de séance) de la classe choisie, sur la Centrale, après l'envoi de l'avancement. */
async function retourFeuille() {
  try { await toutEnvoyer(); } catch { /* le keepalive de la fermeture prendra le relais */ }
  const seance = seanceRetour && current === classeImposee ? `&seance=${encodeURIComponent(seanceRetour)}` : "";
  location.href = `${centraleAdmin}${current ? `#feuille=${encodeURIComponent(current)}${seance}` : ""}`;
}

/** Enregistre l'avancement d'une classe pour le document ouvert (Centrale ou navigateur). */
function persist(classId: string) {
  if (viaCentrale) envoyerAvancement(classId, docKey(), progress[classId]?.[docKey()] ?? null);
  else save(K_PROG, progress);
}

async function chargerDepuisCentrale() {
  centrale = { etat: "chargement" };
  try {
    const d = await chargerCentrale();
    classes = d.classes.flatMap((c) => [
      { id: c.id, name: c.court || c.nom, level: c.niveau, etab: c.etablissement || "Sans établissement" },
      ...c.groupes.map((g) => ({ id: g.id, name: `${c.court || c.nom} · ${g.nom}`, level: c.niveau, sub: true, etab: c.etablissement || "Sans établissement" })),
    ]);
    progress = d.avancement as Progress;
    centrale = { etat: "ok", cours: d.cours };
    // le cours en cours est choisi d'office (on peut en changer)
    if (classeImposee && classes.some((c) => c.id === classeImposee)) { current = classeImposee; save(K_CUR_, current); }
    else if (d.cours?.maintenant && classes.some((c) => c.id === d.cours!.cible)) { current = d.cours.cible; save(K_CUR_, current); }
  } catch (e) {
    centrale = { etat: "erreur", erreur: (e as Error).message };
  }
}
let dual: boolean = load("fichestudio.dualView", false);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
/** Icônes au trait de la barre du haut (même dessin que la barre de présentation). */
const PI = {
  play: "M8 5.5v13l10.5-6.5z",
  cloudOpen: "M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.6 11.2 3.7 3.7 0 0 0 7 18.5z M12 10.5v5.5 M9.6 13.8 12 16.2l2.4-2.4",
  cloudSave: "M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 6.6 11.2 3.7 3.7 0 0 0 7 18.5z M12 16.2v-5.5 M9.6 12.9 12 10.5l2.4 2.4",
  folder: "M3.5 6.5h6l2 2h9v10h-17z",
  appel: "M9 14 4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  edit: "M4 20l4-1L19 8l-3-3L5 16z M14 7l3 3",
};
const pic = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
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
  const draw = () => { if (root.isConnected) render(root, close, draw); };
  if (viaCentrale) {
    // à chaque ouverture : classes, cours du moment et avancement à jour (un autre ordinateur a pu avancer)
    centrale = { etat: "chargement" };
    void chargerDepuisCentrale().then(draw);
    suivreEnvoi(() => { const el = root.querySelector(".ps-sync"); if (el) el.outerHTML = syncBadge(); });
  }
  draw();
}

function syncBadge(): string {
  if (!viaCentrale) return "";
  if (centrale.etat === "chargement") return `<span class="ps-sync wait">☁ Centrale · chargement…</span>`;
  if (centrale.etat === "erreur") return `<span class="ps-sync err" title="${esc(centrale.erreur ?? "")}">⚠ Centrale injoignable</span>`;
  const e = etatEnvoi();
  return e === "ok" ? `<span class="ps-sync ok" title="Classes et avancement de la Centrale">☁ Centrale · enregistré</span>`
    : e === "attente" ? `<span class="ps-sync wait">☁ Centrale · envoi…</span>`
    : `<span class="ps-sync err" title="Nouvel essai toutes les 10 s ; vérifiez la connexion à l'espace enseignant">⚠ Avancement non enregistré</span>`;
}

function render(root: HTMLElement, close: () => void, redraw: () => void) {
  const doc = store.doc;
  // (pendant le chargement depuis la Centrale, la liste est vide : on garde la classe retenue)
  if (current && centrale.etat !== "chargement" && !classes.some((c) => c.id === current)) current = "";
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
  const coursTag = (id: string) => {
    const co = centrale.cours;
    if (!viaCentrale || !co || co.cible !== id) return "";
    return co.maintenant ? ` <small class="now" title="${esc(co.intitule)} · ${co.debut}–${co.fin}">● en cours</small>`
      : ` <small class="next" title="${esc(co.intitule)}">prochain ${co.debut}</small>`;
  };
  // tableau « toutes les classes » : via la Centrale, seulement celles qui ont commencé ce document (et la classe choisie)
  const matrixClasses = viaCentrale ? classes.filter((c) => c.id === current || progress[c.id]?.[docKey()]) : classes;
  const posLabel = (p: Pos | null) => (p ? `${esc(p.page)}, étape ${p.shown}${p.total ? ` / ${p.total}` : ""}${p.pt ? " 📍" : ""}` : "début");

  root.innerHTML = `
    <header class="ps-head">
      <span class="ps-title">${pic(PI.play)}Présentation</span>
      <span class="ps-doc">${esc(doc.name)} · ${doc.pages.length} feuille(s)</span>
      ${syncBadge()}
      <span class="spacer"></span>
      <select class="ps-tabs" title="Documents ouverts">${store.tabs.map((t, i) => `<option value="${i}" ${i === store.activeTab ? "selected" : ""}>${esc((i === store.activeTab ? store.doc : t.doc).name)}</option>`).join("")}</select>
      ${viaCentrale ? `<button data-k="cdocs" title="Documents rangés sur la Centrale : ouverts depuis n'importe quel poste">${pic(PI.cloudOpen)}<span>Ouvrir…</span></button>
      <button data-k="csave" title="Range ce document sur la Centrale (images intégrées) pour le présenter depuis n'importe quel poste">${pic(PI.cloudSave)}<span>Enregistrer</span></button>` : ""}
      <button data-k="browse" title="Documents de cet ordinateur">${pic(PI.folder)}<span>Documents…</span></button>
      ${centraleAdmin ? `<button data-k="retour" class="ps-appel" title="Revenir à la feuille d'appel de la classe choisie, sur la Centrale">${pic(PI.appel)}<span>Feuille d'appel</span></button>` : ""}
      <button data-k="close" title="Revenir à l'édition (Échap)">${pic(PI.edit)}<span>Édition</span></button>
    </header>
    <div class="ps-body">
      <aside class="ps-classes">
        <h3>Classes${viaCentrale ? ` <small>de la Centrale</small>` : ""}</h3>
        ${viaCentrale && centrale.etat === "erreur" ? `<p class="ps-err">${esc(centrale.erreur ?? "")}<button data-k="retry">Réessayer</button></p>` : ""}
        ${viaCentrale && centrale.etat === "chargement" ? `<p class="hint">Chargement des classes…</p>` : ""}
        <ul>${classes.map((c, k) => `${c.etab && c.etab !== classes[k - 1]?.etab ? `<li class="etab">${esc(c.etab)}</li>` : ""}<li class="${c.id === current ? "on" : ""} ${c.sub ? "sub" : ""}" data-c="${c.id}">
            <i style="background:${levelColor(c.level)}">${esc(c.level)}</i><span class="nm">${esc(c.name)}${coursTag(c.id)}</span>
            <span class="pc" title="Feuilles corrigées dans ce document">${pct(c.id)} %</span>
            ${viaCentrale ? "" : `<button data-ren="${c.id}" title="Renommer">✎</button><button data-del="${c.id}" title="Supprimer la classe et son avancement">✕</button>`}</li>`).join("")}
          <li class="${current ? "" : "on"}" data-c=""><i class="none">–</i><span class="nm">Sans classe <small>(pas de suivi)</small></span></li></ul>
        ${viaCentrale ? `<p class="hint">Les classes et les groupes viennent de la Centrale (emploi du temps : le cours en cours est choisi d'office). L'avancement de la correction y est enregistré pour chaque classe et chaque document : il suit d'un ordinateur à l'autre, et la présentation reprend là où la classe s'était arrêtée.</p>`
          : `<form class="ps-add"><input name="n" placeholder="Nouvelle classe (ex. 5eA)" required>
          <select name="l">${["5", "4", "3"].map((l) => `<option value="${l}">${l}e</option>`).join("")}</select><button>＋</button></form>
        <p class="hint">L'avancement de la correction est gardé pour chaque classe et chaque document : la présentation reprend là où la classe s'était arrêtée.</p>`}
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
            const flag = dp?.mark && dp.mark.page === key ? `<span class="ps-flag" title="Fin du dernier cours de ${esc(cls!.name)}">🏁 fin du cours du ${day(dp.mark.at)} · étape ${dp.mark.shown}${dp.mark.pt ? " · 📍 repère" : ""}</span>` : "";
            return `<tr class="${ex.has(key) ? "off" : ""} ${resume?.i === i ? "last" : ""}">
              <td><input type="checkbox" data-sel="${esc(key)}" ${ex.has(key) ? "" : "checked"}></td>
              <td><span class="kind-tag k-${p.kind ?? "fiche"}">${SHEET_KINDS[p.kind ?? "fiche"].prefix}</span> ${esc(p.name)} ${flag}</td>
              <td>${cls ? `<div class="ps-prog st-${s.st}"><div class="bar"><i style="width:${w}%"></i></div><span>${s.total ? `${s.shown} / ${s.total}` : ""} ${STATUS_LABEL[s.st]}</span></div>` : `<span class="muted">${s.total ? `${s.total} étape(s)` : "—"}</span>`}</td>
              <td><button data-from="${i}" title="Présenter à partir de cette feuille">▶</button></td></tr>`;
          }).join("")}</tbody></table>
        ${cls ? `<h3 class="ps-sub">Séances de ${esc(cls.name)} · ${esc(doc.name)}</h3>
        ${dp?.sessions?.length ? `<ol class="ps-sessions">${dp.sessions.map((se, k) => `<li><b>Séance ${k + 1}</b><span class="d">${day(se.at)} ${new Date(se.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span><span class="r">${posLabel(se.from)} → <b>🏁 ${posLabel(se.to)}</b></span><button data-sdel="${k}" title="Supprimer cette séance">✕</button></li>`).join("")}</ol>`
          : `<p class="hint">Pendant la présentation, le bouton <b>🏁 Fin de cours</b> (ou la touche Fin) enregistre où la classe s'est arrêtée : la prochaine séance reprendra à cet endroit, et la séance s'ajoute ici.</p>`}` : ""}
        ${matrixClasses.length ? `<h3 class="ps-sub">${viaCentrale ? "Classes qui ont commencé" : "Toutes les classes"} · ${esc(doc.name)}</h3>
        <div class="ps-matrix" style="grid-template-columns: 120px repeat(${chosen.length}, minmax(26px, 1fr)) 52px">
          <span></span>${chosen.map((x) => `<span class="mh" title="${esc(x.p.name)}">${esc(x.p.name)}</span>`).join("")}<span class="mh">Total</span>
          ${matrixClasses.map((c) => `<span class="mr" data-c="${c.id}"><i style="background:${levelColor(c.level)}"></i>${esc(c.name)}</span>${chosen.map((x) => {
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
    current = li.dataset.c!; save(K_CUR_, current); redraw();
  }));
  $<HTMLElement>('[data-k="cdocs"]')?.addEventListener("click", () => centraleDocs(async (f) => { await openFileFn(f); redraw(); }));
  $<HTMLElement>('[data-k="csave"]')?.addEventListener("click", () => void saveToCentrale(redraw));
  $<HTMLElement>('[data-k="retry"]')?.addEventListener("click", () => void chargerDepuisCentrale().then(redraw));
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
  const addForm = $<HTMLFormElement>(".ps-add");
  if (addForm) addForm.onsubmit = (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const name = (f.elements.namedItem("n") as HTMLInputElement).value.trim();
    const level = (f.elements.namedItem("l") as HTMLSelectElement).value;
    if (!name) return;
    const c = { id: uid("c"), name, level };
    classes.push(c); current = c.id;
    save(K_CLASSES, classes); save(K_CUR_, current); redraw();
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
    persist(cls.id); redraw();
  });

  const launch = (start?: number, shown?: number, pin?: { page: number; x: number; y: number; label: string }) => {
    const order = chosen.map((x) => x.i);
    if (start !== undefined && !order.includes(start)) order.push(start), order.sort((a, b) => a - b);
    if (!order.length) return;
    const c = cls;
    // point de départ de la séance (pour l'historique « de … à … »)
    const startPos: Pos | null = start !== undefined ? { page: pageKey(store.doc.pages[start], start), shown: shown ?? 0 } : null;
    let sessionIndex = -1;
    root.style.display = "none";
    startPresentation(order, {
      start, shown, label: c?.name, dual, retour: centraleAdmin ? () => void retourFeuille() : undefined,
      onProgress: (pi, sh, total) => {
        if (!c) return;
        const d = docProg(c.id), key = pageKey(store.doc.pages[pi], pi);
        const prev = d.pages[key];
        // l'avancement retient l'étape la plus loin atteinte ; la reprise, la position exacte
        d.pages[key] = { shown: Math.max(prev?.shown ?? 0, sh), total, at: Date.now() };
        d.last = { page: key, shown: sh };
        persist(c.id);
      },
      pin: pin ?? undefined,
      onMark: c ? (pi, sh, total, pt) => {
        const d = docProg(c.id), key = pageKey(store.doc.pages[pi], pi);
        const to: Pos = { page: key, shown: sh, total, ...(pt ? { pt } : {}) };
        d.mark = { ...to, at: Date.now() };
        d.sessions ??= [];
        // un second marquage pendant la même présentation corrige la séance au lieu d'en ajouter une
        if (sessionIndex >= 0 && d.sessions[sessionIndex]) d.sessions[sessionIndex] = { ...d.sessions[sessionIndex], to, at: Date.now() };
        else { d.sessions.push({ at: Date.now(), from: startPos, to }); sessionIndex = d.sessions.length - 1; }
        persist(c.id);
        return `🏁 Fin de cours enregistrée pour ${c.name} : ${store.doc.pages[pi].name}, étape ${sh}${total ? ` / ${total}` : ""}${pt ? ", au repère 📍" : ""}. La prochaine séance reprendra ici.`;
      } : undefined,
      onClose: () => { root.style.display = ""; redraw(); },
    });
  };
  $<HTMLInputElement>('[data-k="dual"]')!.onchange = (e) => { dual = (e.target as HTMLInputElement).checked; save("fichestudio.dualView", dual); };
  $<HTMLElement>('[data-k="start"]')!.onclick = () => launch(chosen[0]?.i, 0);
  $<HTMLElement>('[data-k="retour"]')?.addEventListener("click", () => void retourFeuille());
  root.querySelectorAll<HTMLElement>("[data-sdel]").forEach((b) => (b.onclick = () => {
    if (!cls || !dp?.sessions || !confirm("Supprimer cette séance de l'historique ?")) return;
    dp.sessions.splice(+b.dataset.sdel!, 1);
    // le marqueur suit la dernière séance restante
    const lastS = dp.sessions[dp.sessions.length - 1];
    if (lastS) dp.mark = { ...lastS.to, at: lastS.at }; else delete dp.mark;
    persist(cls.id); redraw();
  }));
  // reprise au 🏁 : le repère posé au cours précédent est réaffiché sur la feuille
  $<HTMLElement>('[data-k="resume"]')?.addEventListener("click", () => {
    if (!resume) return;
    const pt = resume.mark ? dp?.mark?.pt : undefined;
    launch(resume.i, resume.shown, pt ? { page: resume.i, x: pt.x, y: pt.y, label: `Reprise · arrêt du ${day(dp!.mark!.at)}` } : undefined);
  });
  root.querySelectorAll<HTMLElement>("[data-from]").forEach((b) => (b.onclick = () => launch(+b.dataset.from!, 0)));
  // lien de la feuille de séance : on lance dès que la classe et son avancement sont chargés
  if (lancerDemande && (!viaCentrale || centrale.etat !== "chargement")) {
    const mode = lancerDemande;
    lancerDemande = "";
    if (mode === "correction" && resume) $<HTMLElement>('[data-k="resume"]')?.click();   // reprise à l'étape (et au repère 📍)
    else launch(resume ? resume.i : chosen[0]?.i, 0);   // présentation : la feuille en cours, corrigé masqué
  }
}

// ---------------------------------------------------------------- documents rangés sur la Centrale

const taille = (o: number) => (o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(o / 1024))} Ko`);
const quand = (t: number) => new Date(t * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Liste des documents de la Centrale : ouvrir ou retirer. */
function centraleDocs(onOpen: (f: File) => Promise<void>) {
  document.querySelector(".modal")?.remove();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<div class="modal-card wide cdocs"><h3>☁ Documents de la Centrale</h3>
    <p class="cd-msg"><small>Chargement…</small></p><ul class="cd-list"></ul>
    <p><small>Pour ajouter un document : ouvrez-le (fichier .af ou .fstudio), puis « ☁ Enregistrer » dans l'espace Présentation.
    Les images sont intégrées ; seul l'enseignant connecté peut voir ces documents.</small></p>
    <div class="cd-foot"><button data-k="close">Fermer</button></div></div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector<HTMLElement>('[data-k="close"]')!.onclick = close;
  const msg = box.querySelector<HTMLElement>(".cd-msg")!, list = box.querySelector<HTMLElement>(".cd-list")!;
  const fill = async () => {
    try {
      const docs = await listerDocuments();
      msg.innerHTML = docs.length ? "" : "<small>Aucun document sur la Centrale pour l'instant.</small>";
      list.innerHTML = docs.map((d) => `<li><b>${esc(d.nom)}</b><small>${taille(d.taille)} · ${quand(d.maj)}</small>
        <button class="primary-inline" data-open="${esc(d.nom)}">Ouvrir</button><button data-rm="${esc(d.nom)}" title="Retirer de la Centrale">✕</button></li>`).join("");
      list.querySelectorAll<HTMLElement>("[data-open]").forEach((b) => (b.onclick = async () => {
        msg.innerHTML = `<small>Ouverture de ${esc(b.dataset.open!)}…</small>`;
        try { await onOpen(await chargerDocument(b.dataset.open!)); close(); } catch (e) { msg.innerHTML = `<small class="err">${esc((e as Error).message)}</small>`; }
      }));
      list.querySelectorAll<HTMLElement>("[data-rm]").forEach((b) => (b.onclick = async () => {
        if (!confirm(`Retirer « ${b.dataset.rm} » de la Centrale ? L'avancement des classes est gardé.`)) return;
        try { await retirerDocument(b.dataset.rm!); await fill(); } catch (e) { msg.innerHTML = `<small class="err">${esc((e as Error).message)}</small>`; }
      }));
    } catch (e) { msg.innerHTML = `<small class="err">${esc((e as Error).message)}</small>`; }
  };
  void fill();
}

/** Range le document ouvert sur la Centrale, images liées intégrées (le document ouvert n'est pas modifié). */
async function saveToCentrale(redraw: () => void) {
  const doc = store.doc;
  const nom = nomDocumentCentrale(doc.name);
  const btn = document.querySelector<HTMLButtonElement>('[data-k="csave"]');
  const label = btn?.querySelector("span")?.textContent ?? btn?.textContent ?? "";
  try {
    const existants = await listerDocuments();
    if (existants.some((d) => d.nom === nom) && !confirm(`« ${nom} » est déjà sur la Centrale. Le remplacer par la version ouverte ?`)) return;
    if (btn) { btn.disabled = true; const sp = btn.querySelector("span"); if (sp) sp.textContent = "Envoi…"; else btn.textContent = "☁ Envoi…"; }
    const copie = JSON.parse(JSON.stringify(doc)) as typeof doc;
    const manquantes: string[] = [];
    for (const [key, a] of Object.entries(copie.assets)) {
      if (a.data) continue;
      try {
        const b = await assetBytes(doc, key);
        const data = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(new Blob([b.data], { type: b.mime || a.mime })); });
        copie.assets[key] = { mime: b.mime || a.mime, name: a.name, data, w: a.w, h: a.h };
      } catch { manquantes.push(a.name); }
    }
    // l'avancement des classes est repéré par le nom du document : il doit rester le même
    copie.name = doc.name;
    await enregistrerDocument(nom, JSON.stringify(copie));
    alert(`« ${nom} » est enregistré sur la Centrale.${manquantes.length ? `\n\nImages liées introuvables, non intégrées : ${manquantes.join(", ")}` : ""}`);
  } catch (e) {
    alert(`Enregistrement sur la Centrale impossible : ${(e as Error).message}`);
  } finally {
    if (btn) { btn.disabled = false; const sp = btn.querySelector("span"); if (sp) sp.textContent = label; else btn.textContent = label; }
    redraw();
  }
}
