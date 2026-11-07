// Préférences de la charte : fichier init (public/charte.init.json, livré avec l'application),
// éventuellement remplacé par un fichier personnel importé (gardé dans le navigateur).
import { C, CUT, DIM, PREFS, VARIANTS } from "./charte";
import { DEFAULT_LEVEL_COLORS, SHEET_KINDS, type SheetKind } from "./model";
import { store } from "./store";

export interface CharteInit {
  variante?: string;
  couleurs?: Partial<Record<keyof typeof C, string>>;
  etiquettes?: Partial<Record<SheetKind, string>>;
  competences?: Partial<Record<"T1" | "T2" | "T3", string>>;
  niveaux?: Record<string, string>;
  bandeaux?: Partial<typeof DIM>;
  decoupe?: { couleur?: string; epaisseur?: number };
}

const KEY = "fichestudio.charte-init";
const HEX = /^#[0-9a-f]{6}$/i;

/** Valeurs actuellement en vigueur, au format du fichier init. */
export function currentInit(): CharteInit {
  const { t1, t2, t3, comp: _c, blanc: _b, ...couleurs } = C;
  return {
    variante: PREFS.variante,
    couleurs,
    etiquettes: Object.fromEntries(Object.entries(SHEET_KINDS).map(([k, v]) => [k, v.tag])),
    competences: { T1: t1, T2: t2, T3: t3 },
    niveaux: { ...DEFAULT_LEVEL_COLORS },
    bandeaux: { ...DIM },
    decoupe: { couleur: CUT.color, epaisseur: CUT.width },
  };
}

/** Applique un fichier init (les clés absentes ou invalides gardent leur valeur). */
export function applyInit(init: CharteInit): string[] {
  const warn: string[] = [];
  const color = (v: unknown, where: string, set: (h: string) => void) => {
    if (v === undefined) return;
    if (typeof v === "string" && HEX.test(v)) set(v.toLowerCase()); else warn.push(`${where} : couleur invalide (${String(v)})`);
  };
  if (init.variante !== undefined) {
    if (VARIANTS.some((v) => v.id === init.variante)) PREFS.variante = init.variante;
    else warn.push(`variante inconnue : ${init.variante} (${VARIANTS.map((v) => v.id).join(", ")})`);
  }
  for (const [k, v] of Object.entries(init.couleurs ?? {})) {
    if (!(k in C)) { warn.push(`couleurs.${k} : clé inconnue`); continue; }
    color(v, `couleurs.${k}`, (h) => { (C as Record<string, string>)[k] = h; });
  }
  for (const [k, v] of Object.entries(init.etiquettes ?? {})) {
    if (!(k in SHEET_KINDS)) { warn.push(`etiquettes.${k} : type de feuille inconnu`); continue; }
    color(v, `etiquettes.${k}`, (h) => { SHEET_KINDS[k as SheetKind].tag = h; });
  }
  const comp = init.competences ?? {};
  color(comp.T1, "competences.T1", (h) => { C.t1 = h; });
  color(comp.T2, "competences.T2", (h) => { C.t2 = h; });
  color(comp.T3, "competences.T3", (h) => { C.t3 = h; });
  for (const [k, v] of Object.entries(init.niveaux ?? {})) color(v, `niveaux.${k}`, (h) => { DEFAULT_LEVEL_COLORS[k] = h; });
  for (const [k, v] of Object.entries(init.bandeaux ?? {})) {
    if (!(k in DIM)) { warn.push(`bandeaux.${k} : clé inconnue`); continue; }
    if (typeof v === "number" && v >= 0 && v < 100) (DIM as Record<string, number>)[k] = v; else warn.push(`bandeaux.${k} : nombre de mm attendu`);
  }
  color(init.decoupe?.couleur, "decoupe.couleur", (h) => { CUT.color = h; });
  if (init.decoupe?.epaisseur !== undefined) {
    const w = init.decoupe.epaisseur;
    if (typeof w === "number" && w > 0 && w < 100) CUT.width = w; else warn.push("decoupe.epaisseur : nombre de px attendu");
  }
  return warn;
}

const personal = (): CharteInit | null => {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
};

/** Au démarrage : fichier init livré, puis préférences personnelles par-dessus. */
export async function loadCharteInit() {
  try {
    const r = await fetch("charte.init.json", { cache: "no-cache" });
    if (r.ok) applyInit(await r.json());
  } catch { /* hors ligne : valeurs par défaut */ }
  const p = personal();
  if (p) applyInit(p);
}

// ------------------------------------------------------------------ boîte de dialogue

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function prefsDialog(onApplied: (updateMasters: boolean) => void) {
  document.querySelector(".modal")?.remove();
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<form class="modal-card wide"><h3>Préférences de la charte (fichier init)</h3>
    <p class="hint">Valeurs lues au démarrage dans <code>charte.init.json</code>${personal() ? ", remplacées par <b>vos préférences personnelles</b> enregistrées dans ce navigateur" : ""}. Modifiez le texte, importez ou exportez un fichier.</p>
    <textarea class="init-json" spellcheck="false">${esc(JSON.stringify(currentInit(), null, 2))}</textarea>
    <p class="init-msg hint"></p>
    <label><input type="checkbox" name="masters" checked> Mettre à jour les gabarits de la charte du document</label>
    <div class="btnrow end"><button type="button" data-k="import">Importer…</button><button type="button" data-k="export">Exporter</button><button type="button" data-k="reset" title="Revenir au fichier init livré avec FicheStudio">Réinitialiser</button>
      <span class="spacer"></span><button type="button" data-k="cancel">Annuler</button><button type="submit" class="primary-inline">Appliquer</button></div></form>`;
  document.body.appendChild(box);
  const f = box.querySelector("form")!;
  const ta = box.querySelector<HTMLTextAreaElement>(".init-json")!;
  const msg = box.querySelector<HTMLElement>(".init-msg")!;
  const masters = () => (f.elements.namedItem("masters") as HTMLInputElement).checked;
  box.querySelector<HTMLElement>('[data-k="cancel"]')!.onclick = () => box.remove();
  box.querySelector<HTMLElement>('[data-k="export"]')!.onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ta.value], { type: "application/json" }));
    a.download = "charte.init.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  box.querySelector<HTMLElement>('[data-k="import"]')!.onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = async () => { const file = inp.files?.[0]; if (file) ta.value = await file.text(); msg.textContent = `« ${file?.name} » chargé : vérifiez puis Appliquer.`; };
    inp.click();
  };
  box.querySelector<HTMLElement>('[data-k="reset"]')!.onclick = () => {
    try { localStorage.removeItem(KEY); } catch { /* stockage indisponible */ }
    // repartir des valeurs du fichier livré : le plus simple est de recharger l'application
    if (confirm("Préférences personnelles retirées. Recharger FicheStudio pour revenir au fichier init livré ?")) location.reload();
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    let init: CharteInit;
    try { init = JSON.parse(ta.value); } catch (err) { msg.textContent = `JSON invalide : ${(err as Error).message}`; return; }
    const warn = applyInit(init);
    try { localStorage.setItem(KEY, JSON.stringify(init)); } catch { warn.push("préférences non enregistrées (stockage du navigateur indisponible)"); }
    box.remove();
    onApplied(masters());
    store.emit("change");
    document.dispatchEvent(new CustomEvent("status", { detail: warn.length ? `Préférences appliquées avec ${warn.length} avertissement(s) : ${warn.join(" ; ")}` : "Préférences de la charte appliquées." }));
  };
}
