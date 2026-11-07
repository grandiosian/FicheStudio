# FicheStudio

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
  page, format natif `.fiche.json`, et **script Affinity**.
- Annuler/rétablir (200 niveaux), sauvegarde automatique locale (IndexedDB).

### Polices dans les PDF

L'export intègre les vraies polices : soit celles de l'ordinateur (Chrome/Edge demandent
l'autorisation une fois), soit des fichiers ajoutés via « Ajouter des polices… »
(ex. `/System/Library/Fonts/Supplemental/Arial Narrow.ttf`). À défaut, Helvetica est utilisée,
avec une largeur ajustée pour que la mise en page ne bouge pas.

### Fidélité avec Affinity

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
