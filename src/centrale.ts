// FicheStudio ouvert depuis la Centrale (…/admin/appli.php/fichestudio/, réservé à l'enseignant connecté) :
// les classes et l'avancement de la correction viennent de la Centrale et y sont enregistrés, pour les retrouver
// sur n'importe quel ordinateur. Ouvert ailleurs (GitHub Pages, local), rien ne change : stockage du navigateur.

export interface CentraleClasse {
  id: string; nom: string; court: string; niveau: string; etablissement: string; simule: boolean;
  groupes: { id: string; nom: string }[];
}
/** Cours en cours (ou terminé depuis moins de 10 min), sinon le prochain du jour. */
export interface CentraleCours { cible: string; libelle: string; intitule: string; debut: string; fin: string; maintenant: boolean }
export interface CentraleDonnees { classes: CentraleClasse[]; cours: CentraleCours | null; avancement: Record<string, Record<string, unknown>> }

const m = location.pathname.match(/^(.*)\/admin\/appli\.php\//);
/** Adresse de l'API, ou null quand FicheStudio n'est pas servi par une Centrale. */
export const centraleApi: string | null = m ? `${m[1]}/api/fichestudio.php` : null;
/** Espace enseignant de la Centrale (retour à la feuille d'appel), ou null hors Centrale. */
export const centraleAdmin: string | null = m ? `${m[1]}/admin/` : null;

export async function chargerCentrale(): Promise<CentraleDonnees> {
  const r = await fetch(centraleApi!, { cache: "no-store", credentials: "same-origin" });
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.ok) throw new Error(d?.erreur ?? `Centrale injoignable (${r.status})`);
  return d as CentraleDonnees;
}

// --- Envoi regroupé : une seule requête par (classe, document) toutes les 1,5 s au plus, nouvel essai si échec ---
export type EtatEnvoi = "ok" | "attente" | "erreur";
const enAttente = new Map<string, { cible: string; doc: string; avancement: unknown }>();
let minuteur: number | undefined;
let etat: EtatEnvoi = "ok";
let surEtat: (e: EtatEnvoi) => void = () => {};
export const etatEnvoi = () => etat;
export function suivreEnvoi(f: (e: EtatEnvoi) => void) { surEtat = f; }
const changer = (e: EtatEnvoi) => { if (e !== etat) { etat = e; surEtat(e); } };

export function envoyerAvancement(cible: string, doc: string, avancement: unknown) {
  // copie : l'objet continue d'évoluer pendant la présentation
  enAttente.set(`${cible}\n${doc}`, { cible, doc, avancement: avancement == null ? null : JSON.parse(JSON.stringify(avancement)) });
  changer(etat === "erreur" ? "erreur" : "attente");
  clearTimeout(minuteur);
  minuteur = window.setTimeout(vider, 1500);
}

async function vider(keepalive = false) {
  clearTimeout(minuteur);
  for (const [k, corps] of [...enAttente]) {
    try {
      const r = await fetch(centraleApi!, {
        method: "POST", credentials: "same-origin", keepalive,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps),
      });
      if (!r.ok) throw new Error(String(r.status));
      // une version plus récente a pu arriver pendant l'envoi : on ne retire que celle envoyée
      if (enAttente.get(k) === corps) enAttente.delete(k);
    } catch {
      changer("erreur");
      minuteur = window.setTimeout(vider, 10000);
      return;
    }
  }
  changer(enAttente.size ? "attente" : "ok");
}

/** Envoie tout de suite l'avancement en attente (avant de quitter FicheStudio pour la Centrale). */
export async function toutEnvoyer() { if (enAttente.size) await vider(); }

// fermeture de l'onglet : dernier envoi (keepalive survit à la page)
if (centraleApi) window.addEventListener("pagehide", () => { if (enAttente.size) void vider(true); });

// --- Documents de l'enseignant rangés sur la Centrale (.fstudio, images intégrées), ouverts depuis tout poste ---
export interface CentraleDocument { nom: string; taille: number; maj: number }
const urlDoc = (nom: string, extra = "") => `${centraleApi}?document=${encodeURIComponent(nom)}${extra}`;
async function lireJson(r: Response) {
  const d = await r.json().catch(() => null);
  if (!r.ok || !d?.ok) throw new Error(d?.erreur ?? `Centrale : erreur ${r.status}`);
  return d;
}
export async function listerDocuments(): Promise<CentraleDocument[]> {
  return (await lireJson(await fetch(`${centraleApi}?documents`, { cache: "no-store", credentials: "same-origin" }))).documents;
}
/** Le document, sous forme de fichier .fstudio (à passer à l'ouverture habituelle). */
export async function chargerDocument(nom: string): Promise<File> {
  const r = await fetch(urlDoc(nom), { cache: "no-store", credentials: "same-origin" });
  if (!r.ok) await lireJson(r);
  return new File([await r.blob()], `${nom}.fstudio`, { type: "application/json" });
}
export async function enregistrerDocument(nom: string, json: string): Promise<void> {
  await lireJson(await fetch(urlDoc(nom), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: json }));
}
export async function retirerDocument(nom: string): Promise<void> {
  await lireJson(await fetch(urlDoc(nom, "&supprimer"), { method: "POST", credentials: "same-origin" }));
}
/** Nom accepté par la Centrale : lettres, chiffres, espace, _ - . ( ) ' */
export const nomDocumentCentrale = (n: string) => n.replace(/\.fstudio$/i, "").replace(/[^\p{L}\p{N} _.()'-]+/gu, "_").replace(/^[.\s]+/, "").slice(0, 120) || "Document";
