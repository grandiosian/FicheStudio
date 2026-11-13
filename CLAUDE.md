# FicheStudio — notes pour Claude

Éditeur de fiches pédagogiques et de dessin vectoriel **100 % navigateur** (Vite + TypeScript, sans
framework), qui ouvre les fichiers Affinity (`.af`) et sait les lui rendre (script SDK qui recrée un
`.af` natif). Site statique publié sur GitHub Pages ; aucun fichier n'est envoyé à un serveur.

## Commandes

```bash
npm run dev      # http://localhost:5180 (serveur de développement + points d'accès locaux)
npm run check    # tsc --noEmit — à lancer après chaque modification
npm run build    # tsc + vite build -> dist/
```

Pas de tests automatisés : vérifier dans le navigateur (voir « Vérifier » plus bas).

## Conventions

- Interface, commentaires, messages de commit et README **en français**. Commits : `feat: …`, `fix: …`,
  `refactor: …` (plusieurs sujets séparés par « ; »), corps en liste.
- Style du code : TypeScript strict, fonctions courtes, commentaires brefs qui expliquent le *pourquoi*
  (souvent une règle d'Affinity mesurée). Suivre la densité de commentaires du fichier modifié.
- Pas de nouvelle dépendance sans raison forte ; les grosses bibliothèques se chargent à la demande
  (`import()` dynamique, ex. paper.js dans `src/boolean.ts`).
- Mettre à jour `README.md` (section « Fonctions » ou « Fidélité avec Affinity ») pour toute fonction
  visible par l'utilisateur.

## Architecture (src/)

| Fichier | Rôle |
|---|---|
| `model.ts` | Types du document (`Doc`, `Page`, `SceneNode`, `Paragraph`, `Run`, `Stroke`…), fabriques, `upgradeDoc` (migration des anciens fichiers), `BLEND_MODES` |
| `store.ts` | État global : onglets, sélection, **annulation** (`commit`, `checkpoint`, `undo`), sauvegarde locale automatique (IndexedDB) |
| `canvas.ts` | Vue SVG, zoom/déplacement (`view`, `applyView` émet l'évènement `view`), outils, poignées |
| `render.ts` | Document → SVG (canevas, présentation, vignettes, exports) |
| `textlayout.ts` | Composition du texte calée sur Affinity (`layoutText`, `fontMetrics`) |
| `textedit.ts` | Édition de texte en place (contentEditable superposé, aligné sur la composition) |
| `panels.ts` | Panneaux gauche (feuilles, calques) et droit (propriétés en sections repliables `psec`) |
| `io/afread.ts` | Lecture du binaire `.af` (archive, flux « Ks ») |
| `io/afimport.ts` | `.af` → `Doc` (formes, courbes, textes, images liées, masques, styles) |
| `io/affinityExport.ts` | `Doc` → script JS pour le SDK Affinity |
| `io/pdfexport.ts` | Export PDF (pdf-lib), polices intégrées |
| `boolean.ts` | Opérations booléennes (paper.js) |
| `assets.ts`, `imagemanager.ts` | Images intégrées ou liées, relocalisation des sources |
| `reimport.ts` | Réimport du `.af` d'origine en gardant les ajouts faits dans FicheStudio |
| `charte*.ts`, `competences.ts`, `templates.ts`, `library.ts` | Charte des ateliers, compétences du programme, variables `{{…}}`, blocs |
| `present*.ts`, `projector.ts`, `textfs.ts` | Mode présentation, double vue (vidéoprojecteur), corrigé plein écran |

`vite.config.ts` ajoute des points d'accès **de développement seulement** sous `/__localdocs/`
(lister un dossier du Mac, lire un `.af`, miniature, image liée avec conversion TIFF/PSD par `sips`,
recherche d'images par nom) et `/__samples`. Le site publié n'en dépend pas.

## Règles à respecter

- **Toute modification du document passe par `store.commit(() => …)`** (un niveau d'annulation) ; pour
  une opération asynchrone : `store.checkpoint()` puis modification puis `store.emit("change")`.
  L'historique ne contient pas le contenu des images (`assets`) : les images retirées vont dans
  `assetTrash` pour que ⌘Z les retrouve.
- **Repères** : `node.transform` est relatif au parent ; `store.parentCumulative(id)` donne le repère
  de la page. Les cadres de texte importés sont en coordonnées « page tournée », corps de police absolu.
- **Paragraphes** : `firstIndent` est relatif au retrait gauche (dans Affinity, le retrait de 1re ligne
  est compté depuis le bord du cadre : convertir à l'import et à l'export). `leading` (exact) prime sur
  `lineHeight` (relatif à l'interligne idéal de la police) ; `run.leading` impose l'interligne d'une ligne.
- **Rendu et éditeur doivent rester d'accord** : toute nouvelle propriété de texte se reporte dans
  `textlayout.ts`, `render.ts`, `textedit.ts` (lecture et écriture), `pdfexport.ts` et
  `affinityExport.ts`.
- Les champs du panneau de droite utilisent `field(label, clé, valeur, unité)` et `data-k` ; les actions
  `data-act` sont traitées dans `bindProps`.

## Format Affinity

- Champs utiles (vérifiés avec le SDK Affinity) : `Xfrm` (transformation), `TxtH.FrmB/ColW/GutW/Algn`
  (cadre, colonnes, alignement vertical), `PAtt.Ints[0]` alignement, `Ints[1]` type d'interligne
  (2 = exact), `PAtt.Doub` = [interligne relatif, absolu, retrait gauche, droit, 1re ligne, espace
  avant, après, pas de tabulation…], `TabS` taquets, `LisA` listes, `GAtt.Doub[0]` corps, `Doub[4]`
  interlettrage, `Ints[0]` soulignement, `LSty.Data` = [onglet, [extrémité, jointure, type]],
  `LBAh` pointe de flèche, `ShCR`/`CTyp` coins, `Blnd` mode de fusion (numérotation propre au fichier,
  table `BLND` dans `afimport.ts`), `Flow.HOvr` texte en trop masqué.
- Les énumérations sont des **entiers bruts** dans le lecteur TS (pas `{ $enum }`).
- Texte artistique (`TxtA`) : jamais coupé, à l'échelle réelle (groupes × son `Xfrm`) ; texte encadré
  (`TxtF`) : corps absolu, corrigé par les `FTxS` des groupes.
- En cas de doute sur un champ, interroger Affinity par son SDK (passerelle MCP) sur une **copie**
  placée sur le Bureau, jamais sur un fichier de l'utilisateur ouvert.

## Vérifier

- L'utilisateur garde souvent des onglets non enregistrés dans l'application : **ne pas agir dans son
  onglet**. Tester dans un onglet séparé et y couper la sauvegarde automatique d'abord
  (`window.__fs.store.scheduleSave = () => {}` — sinon cet onglet écrase l'état enregistré partagé).
- `window.__fs` (développement) expose `store`, `view`, `zoomBy`, `applyZoom`.
- Après modification d'un module, Vite peut recharger toute la page (y compris l'onglet de
  l'utilisateur, qui se restaure depuis la sauvegarde locale). Un module importé dynamiquement depuis la
  console peut être une **autre instance** (horodatage `?t=`) : passer par `window.__fs` ou par l'interface.
- Fidélité de l'import : comparer le rendu de chaque calque à un export JPEG d'Affinity (score =
  % de pixels qui diffèrent). Les outils de comparaison et les `.af` d'essai vont dans `samples/`
  (ignoré par git), jamais dans `src/`.
