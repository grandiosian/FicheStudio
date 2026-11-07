# FicheStudio

> Création et gestion des ateliers de cours, compatible Affinity.

Mise en page de fiches et dessin vectoriel **dans le navigateur**, qui ouvre les fichiers
Affinity et sait les lui rendre en `.af` natif.

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

`npm run dev` sert l'application sur http://localhost:5180. `npm run build` produit `dist/`,
un site statique (≈ 100 Ko) à déposer tel quel sur GitHub Pages ou n'importe quel hébergement.
Tout se passe dans le navigateur : aucun fichier n'est envoyé sur un serveur.

## Fonctions

- **Ouvrir** `.af` / `.afdesign` (Affinity 1.x → 3.x), ou glisser-déposer sur la page ;
  calques, groupes, courbes, formes, couleurs RVB/TSL/CMJN, contours et pointillés,
  masques, images d'origine, textes riches.
- **Mise en page** : pages A4/A3/A5/paysage/personnalisées, calques (afficher, verrouiller,
  renommer, ordonner), cadres de texte riches (police, corps, gras, italique, souligné,
  couleur, alignement, interligne), images, alignement/répartition, magnétisme.
- **Dessin vectoriel** : rectangle (coins arrondis), ellipse, triangle, losange, flèche,
  ligne, plume de Bézier, édition des nœuds (A ; Alt-clic = point lisse/anguleux,
  Suppr = retirer un nœud), conversion en courbes, masques, groupes.
- **Modèles et série** : variables `{{prénom}}` dans les textes + import CSV
  (UTF-8 ou export Excel) → aperçu ligne par ligne et PDF de toute la série.
- **Feuilles et gabarits** : une feuille peut être pleine ou découpée en 2 ou 3 parties
  (empilées ou côte à côte) séparées par une ligne de découpe ✂. Un gabarit (ex. « Atelier » :
  barre haute + barre basse avec pastille de niveau) s'ajoute à chaque partie ; « ＋ » crée une
  feuille avec le même gabarit et le même découpage, numérotée automatiquement
  (`{{feuille}}` = 01, 02…). Sur une feuille découpée, le gabarit est posé **une seule fois**
  (barre haute en haut de la 1re partie, barre basse en bas de la dernière) pour distribuer les
  parties au fil du cours ; « Gabarit posé : dans chaque partie » le répète (01a, 01b…).
  « Détacher le gabarit » le copie dans la feuille.
- **Calques → feuilles** (Fichier, ou ⇉ dans Feuilles) : dans les fichiers d'atelier où chaque
  fiche est un calque (P01…, R01…), crée une feuille par calque choisi (sélection rapide Pages /
  Ressources), garde ou retire les corrigés `_Corr`, retire les images devenues inutiles,
  dans le document ou dans un nouvel onglet. Annulable.
- **Présentation** (▶ Présenter ou F5), pensée pour le vidéoprojecteur en écran dupliqué :
  plein écran, correction pas à pas (→ / Espace / télécommande : les calques « _Corr » et les
  objets cochés « Étape de correction » apparaissent un par un dans l'ordre de lecture),
  clic sur un bloc ou rectangle tracé vers la droite (au format choisi : écran, 16:9, 16:10, 4:3 ou libre) pour l'agrandir sur tout
  l'écran, niveaux de zoom (feuille entière, pleine largeur, ×1,5 à ×4, − / +, molette),
  main pour se déplacer dans la feuille agrandie (H ou bouton du milieu),
  stylo, surligneur, flèche, gomme, 6 couleurs, 3 épaisseurs, tableau blanc (blanc, carreaux,
  Seyès, noir). Les annotations restent le temps de la session et ne modifient pas le document.
- **Onglets** : plusieurs documents ouverts à la fois, chacun avec son historique d'annulation ;
  ● = modifié depuis le dernier enregistrement. Tous les onglets sont restaurés au redémarrage.
- **Exemples** : Fichier › Exemples ouvre les fichiers du dossier `samples/` (avec `npm run dev`
  seulement : ce dossier n'est jamais copié dans la version publiée).
- **Bibliothèque** : barres d'atelier, pastille de niveau (couleur selon la classe : 6e, 5e, 4e, 3e),
  titres numérotés, lignes de réponse, encadré consigne, ligne de découpe ; « ＋ Sélection » et
  « ＋ Calque » y ajoutent vos propres blocs (gardés dans le navigateur).
- **Numérotation des ateliers** : paragraphes « titre numéroté » de niveau 1 à 3, nomenclatures
  1 · 1.1 · 1.1.1 / I · a · 1 / A · A1 · A1.a / 1 · a · i, recommencée par document, feuille ou partie.
- **Calques** : couleur d'étiquette par calque ou groupe (reprise depuis et vers Affinity).
- **Images liées** : une image peut être liée (URL, ou fichier du disque dans Chrome/Edge) au lieu
  d'être copiée ; seule la référence est enregistrée. « Intégrer » / « Relier… » dans les propriétés.
- **Exports** : PDF vectoriel intelligent (un fichier, un par feuille ou un par partie, nommés
  d'après les feuilles, ZIP, série CSV, polices intégrées), impression du navigateur, SVG par
  page, format natif **`.fstudio`** (les anciens `.fiche.json` s'ouvrent toujours), et **script Affinity**.
- Annuler/rétablir (200 niveaux), sauvegarde automatique locale (IndexedDB).
- **Barre d'outils** en groupes : sélection (V, A, H) · dessin (P, L, M, E) · texte (T) · insertion
  (modèles, tableau, image) ; la lettre du raccourci est rappelée dans le coin de chaque bouton.
- **Onglets de documents** : nom lisible (sans « AT_ » ni tirets bas), pastille de couleur selon le type de
  document, **aperçu de la feuille au survol** (nom complet, nombre de feuilles, modifications), liste
  « ▾ n » de tous les documents ouverts, fermeture par clic du milieu.
- **Vue isolée** (touche **I**, clic droit › Isoler, ou Propriétés › ◎ Isoler) : seuls la sélection, ou le
  calque actif, restent affichés, cadrés à l'écran, pour travailler dessus ; les nouveaux objets vont
  dans l'élément isolé. **I** ou **Échap** (sans sélection) ramène à la vue complète, exactement au
  même zoom et au même endroit.
- **Cadrer** : double-clic sur un calque ou un objet du panneau Calques = zoom animé sur son cadre
  (⌥ double-clic pour renommer). **Clic droit** : zoom au plus près, sélectionner le contenu,
  renommer, masquer, verrouiller, et pour un calque : appliquer / remplacer / retirer un modèle de la charte.
- **Sélection multiple dans Calques** : clic, puis Maj + clic = toutes les lignes entre les deux
  (un calque replié apporte son contenu) ; ⌘/Ctrl + clic ajoute ou retire un élément.
- **Panneau droit** : section **Exporter** en haut (enregistrer, PDF, PDF en série, imprimer, SVG,
  Affinity), propriétés de la sélection en dessous.
- **Documents** (Fichier › Documents…) : explorateur de tous les fichiers .af (sous-dossiers compris)
  d'un dossier, avec leur miniature (celle enregistrée par Affinity dans le fichier), recherche, tri,
  et **boutons de filtre par sous-dossier** (fil d'Ariane pour remonter, nombre de fichiers par dossier).
  En local (`npm run dev`), « Dossier sur ce Mac » fait lire le dossier par le serveur de
  développement (dossier personnel uniquement) : fonctionne dans tous les navigateurs. Sur le site
  publié, « Choisir un dossier… » utilise le sélecteur de Chrome / Edge (dossier mémorisé).
- **Barre de présentation compacte** : étape précédente / suivante avec le compteur, puis quatre gros boutons
  (Feuilles, Zoom, Outils, Tableau) qui ouvrent chacun leur rangée de sous-icônes, et le bouton **Main**
  pour déplacer la vue (aussi : **Espace maintenu** en glissant, bouton du milieu de la souris, H ;
  un appui bref sur Espace passe à l'étape suivante). Un rectangle tracé **vers la gauche** dézoome
  d'un cran à chaque fois.
- **Corrigé en grand** (bouton « Texte » de la barre, touche **T**) : le texte de l'étape révélée (calque
  « _Corr » ou objets « étape ») est remis en page sur tout l'écran, au plus grand corps qui tient,
  en gardant gras, couleurs et paragraphes. → / ← passent d'une étape à l'autre ; « Tout le corrigé »
  affiche tout le corrigé de la feuille ; Échap ou T revient à la feuille. En double vue, le projecteur
  affiche le même texte, ajusté à sa propre taille.
- **Double vue** (bouton « Projeter » de la barre, ou case « Double vue » de l'espace Présentation) :
  comme OpenBoard, l'ordinateur garde la **vue professeur** et une seconde fenêtre affiche la
  **projection** plein écran (à placer sur le vidéoprojecteur en mode écran étendu ; Chrome / Edge
  l'y envoient automatiquement avec l'autorisation « Gestion des fenêtres »). Tout est synchronisé :
  feuille, étapes, zoom, annotations, tableau. La vue professeur montre le **cadre projeté**, les
  corrigés à venir **en transparence** (invisibles au projecteur) avec la prochaine étape surlignée,
  un chronomètre, et les boutons **Écran noir** (N) et **Figer** (K). Les flèches et Espace
  fonctionnent depuis les deux fenêtres. Autoriser les fenêtres surgissantes pour le site.
- **Espace Présentation** (bouton « ▶ Présentation ») : document à présenter (onglets ouverts ou
  explorateur de documents), feuilles à projeter, et **classes** (ex. 5eA, 4eB) avec leur niveau.
  L'avancement de la correction est enregistré pour chaque classe et chaque document : barre
  d'avancement par feuille (à faire, en cours, corrigée), « Reprendre » là où la classe s'était
  arrêtée, tableau de toutes les classes, remise à zéro. Le bouton **🏁 Fin de cours** de la présentation
  (touche Fin) marque où la classe s'est arrêtée : la séance est ajoutée à l'**historique des séances** de la
  classe (date, « de … à … »), le drapeau 🏁 apparaît sur la feuille, et « Reprendre » repart du dernier marqueur. F5 présente directement le document affiché.
- **Œil et cadenas** : zones cliquables de 24 px ; appuyer puis glisser sur d'autres lignes masque,
  affiche ou verrouille plusieurs calques d'un coup (une seule annulation).
- **Couleurs en direct** : la page suit le sélecteur de couleur pendant qu'on le fait glisser ;
  un seul niveau d'annulation par réglage.

### Charte graphique des ateliers

La charte ([docs/charte_ateliers.md](docs/charte_ateliers.md)) est intégrée :

- menu **Charte** : consulter la charte, vérifier le document (découpes, types de feuilles, pastilles) ;
- **fichier init** `public/charte.init.json` (lu au démarrage) : variante par défaut, couleurs de la
  charte, couleurs d'étiquette par type de feuille, couleurs des compétences par thème, pastilles de
  niveau, rayons des bandeaux (1re feuille 8 mm, cadre du résumé 1 mm, ressource 1 mm), ligne de découpe. Charte ›
  Préférences permet de le modifier, l'importer ou l'exporter ; les préférences personnelles sont
  gardées dans le navigateur et peuvent mettre à jour les gabarits de la charte du document ;
- **variantes de disposition** (Charte › Variantes) : Classique (1 · 1.1 · 1.1.1), Chapitres
  (« Chapitre I », a), b)… 1.), Grille (A, puis A1, A2… B1, B2…), Mixte (1 · a · i). La variante règle la
  numérotation et le style des titres ; les blocs « titre de niveau 1/2/3 » de la bibliothèque suivent la variante ;
- **Menu FicheStudio** (le nom en haut à gauche) : fichier, export, exemples et charte, sur deux colonnes.
- **FicheStudio › Appliquer la charte à tous les calques** : le modèle de la charte est **copié dans chaque calque de page**
  (groupe verrouillé « Modèle charte · … », sous le contenu), choisi d'après le nom du calque
  (P01 → feuille d'atelier, la 1re ayant le grand en-tête ; R01 → ressource ; S01 → synthèse ;
  E01 → évaluation…). Chaque calque garde ainsi son propre en-tête, modifiable, sans gabarit partagé.
  Les nouvelles feuilles d'un document à la charte reçoivent aussi leur modèle ;
- types de feuille de la charte (fiche péda, prof, atelier, ressource, synthèse, évaluation,
  ressource d'évaluation) avec leur couleur d'étiquette de calque (atelier bleu, ressources orange,
  fiche péda et prof jaune, synthèse violet, évaluation rouge) ; ligne de découpe seulement
  sur les feuilles d'atelier, en pointillés bleus de 12 px à tirets arrondis (éditeur, PDF, Affinity) ;
- bibliothèque « Charte · … » : bande question, cadre « Recopie et réponds », case à compléter,
  case à cocher, lignes de réponse, filet fin, étiquettes ORDI / PAPIER, « À retenir », banque de
  mots, objectif, cadre de ressource, blocs ressources (liseré bleu avec cartouche arrondi du nom :
  pleine largeur, demi-largeur, avec image, avec tableau), bloc définition, barème,
  « → Tourne la page », réponse corrigée ;
- **Modèles** (icône de la barre d'outils) : fenêtre d'aperçus qui regroupe aussi l'ancienne bibliothèque,
  par rubriques (Pages, Titres, Blocs de la charte, Blocs généraux, **Mes blocs** avec « ＋ Sélection » et
  « ＋ Calque actif »), avec filtre. Les 5 modèles
  de page se copient dans le calque actif (celui conseillé pour son nom est entouré) ; les titres de
  la variante et tous les blocs s'insèrent d'un clic. Choix de la **classe** (Document, 6e, 5e, 4e, 3e) :
  avec une classe, les pastilles sont figées sur son numéro et sa couleur ;
- **Tableau** (icône de la barre d'outils : grille à survoler pour choisir rangées × colonnes ; ou panneau Propriétés) : rangées, colonnes, rangée et colonne de titre, largeur, hauteur
  des cases. Le tableau est un dossier de calques : une rangée par groupe, chaque case = rectangle +
  texte ; en-têtes bleu clair, contours bleus ;
- nuancier de la charte sous chaque couleur, et **styles de texte de la charte** (corps, puces,
  titres, étiquettes…, interligne 1,12 et espace après 0,35 × corps).

### Compétences (programme de technologie, cycle 4)

Onglet **Compétences** (extrait de `Prog_Acad_Techno_College_5-4-3.xlsx` par
`tools/referentiel.py` → `src/data/referentiel.json`) : thèmes OST / SFC / CCRI, codes T1C11…T3C31,
attendus par niveau (5e, 4e, 3e) et connaissances, recherche, filtre de niveau. ◉ insère la pastille
de compétence dans la marge, colorée selon le thème (T1 vert, T2 rose, T3 jaune orangé), ≡ insère les attendus en liste à puces ; ✓ marque les
compétences déjà présentes dans le document.

**Compétences des calques** : clic droit sur un calque, un groupe ou un objet › Compétences… (ou
Propriétés › Compétences › Choisir…) ouvre une fenêtre de choix (recherche, niveau, cases à cocher).
Dans le panneau Calques, les compétences s'affichent à droite du nom : points de couleur quand le
panneau est étroit, pastilles avec les codes quand il est assez large (clic sur une pastille = isoler). Dans la vue
création, les pastilles s'affichent dans la marge gauche, à hauteur de l'élément, empilées l'une sous
l'autre (non imprimées) ; clic droit › « Poser les pastilles sur la feuille » en fait des objets
imprimés (groupe « …_Comp »). Dans l'onglet
Compétences, la vue **« Calques par compétence »** regroupe les éléments marqués sous chaque compétence,
avec un bouton « 👁 Isoler » ; dans le référentiel, « 👁 n calques » fait de même : un clic les
**isole** : seuls les calques qui contiennent la compétence sont affichés, en entier (même s'ils
sont masqués dans le document), tous les autres sont cachés ; le panneau Calques ne montre qu'eux et liste les
éléments, toutes feuilles confondues, pour y aller d'un clic. Cycle 4 uniquement : 5e, 4e, 3e.

### Polices dans les PDF

L'export intègre les vraies polices : soit celles de l'ordinateur (Chrome/Edge demandent
l'autorisation une fois), soit des fichiers ajoutés via « Ajouter des polices… »
(ex. `/System/Library/Fonts/Supplemental/Arial Narrow.ttf`). À défaut, Helvetica est utilisée,
avec une largeur ajustée pour que la mise en page ne bouge pas.

### Fidélité avec Affinity

- Images **liées** dans le .af (le fichier ne garde que le chemin de l'original, ou un alias macOS) : en
  local (`npm run dev`), le serveur retrouve l'original — même si le dossier a été déplacé — et convertit
  TIFF / PSD en PNG (sips). Sur le site publié, ces images apparaissent comme liens à relier.
- Formes avec texte (« TxtS ») importées ; mots plus longs que la ligne coupés au bord du cadre et
  espace avant du premier paragraphe ignoré en haut du cadre, comme Affinity.
- Texte artistique à l'échelle réelle (groupes × sa propre transformation) ; masques attachés aux
  images et groupes ; alignement vertical des cadres (haut / milieu / bas) ; soulignement ; listes à puces
  (puce + retrait suspendu) ; coins des rectangles selon leur type (aucun, arrondi, coupé).
- Paragraphes : interligne exact ou relatif, interligne propre à certains caractères, retrait de 1re ligne
  compté depuis le bord du cadre (comme Affinity), taquets de tabulation, interlettrage ; colonnes
  (largeur et gouttière) ; texte qui déborde du cadre masqué ; texte artistique jamais coupé.
- Traits : extrémités et jointures, pointes de flèche (triangle, barbelée), épaisseur uniforme même sur une
  courbe étirée ; flèches (forme) avec longueur et décalage de pointe.

La composition du texte reprend celle d'Affinity (mesures faites dans Affinity 3.3) : capitales
alignées sur le haut du cadre, interligne idéal de la police × interligne relatif, retraits,
tabulations, espaces avant/après. Écart mesuré entre les deux applications : moins de 0,15 mm.

## Retour vers Affinity

« Fichier › Exporter pour Affinity » télécharge `nom.affinity.js`. Exécuté dans Affinity
(panneau Scripts, ou par Claude via la passerelle Affinity), il crée un **nouveau document
.af natif** : calques, formes, courbes, textes riches, images et masques sont recréés avec
les objets d'Affinity, puis Fichier › Enregistrer sous… Les rectangles à coins arrondis
arrivent en courbes (le SDK d'Affinity ignore les rayons de coins à la création).

## Organisation

| Fichier | Rôle |
|---|---|
| `src/model.ts` | modèle de document (unités : px à la résolution du document) |
| `src/render.ts`, `src/textlayout.ts` | rendu SVG, composition du texte avec les métriques réelles des polices |
| `src/canvas.ts` | canevas : vue, sélection, poignées, outils, magnétisme |
| `src/ops.ts` | opérations d'édition (transformations, groupes, alignement…) |
| `src/textedit.ts` | édition de texte riche en place |
| `src/panels.ts` | panneaux pages, calques, propriétés, données |
| `src/templates.ts` | variables et CSV |
| `src/io/afread.ts`, `src/io/afimport.ts` | lecture du format Affinity (voir `../AF_Format/FORMAT.md`) |
| `src/io/affinityExport.ts` | génération du script de reconstruction Affinity |
| `src/io/export.ts` | PDF, SVG, format natif |

## Limites actuelles

- Opérations booléennes (union, soustraction…) non disponibles.
- Dégradés : orientation simplifiée à l'import ; exportés vers Affinity et en PDF en couleur unie.
- Polices `.ttc` (collections) non prises en charge à l'import de polices : utiliser les `.ttf`/`.otf`.
- Calques de pixels peints, calques de réglage et effets Affinity ne sont pas importés
  (signalés dans la barre d'état).
- Le texte suit les polices installées sur l'ordinateur qui affiche ou imprime.
