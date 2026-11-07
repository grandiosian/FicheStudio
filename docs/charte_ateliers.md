# Charte de mise en page des ateliers de technologie (Affinity)

Ce document récapitule tout ce qu'il faut respecter pour fabriquer une séquence (atelier) : feuilles élèves, documents ressources, synthèse, évaluation, version SEGPA, fiche pédagogique et fiche professeur.

Toutes les mesures sont données pour un **A4 portrait à 300 dpi : 2480 × 3508 px**. Les tailles de police sont en **points**. Les couleurs sont en **RVB (0-255)**.

---

## 1. Principe pédagogique

- Chaque atelier doit fonctionner **sur papier ET sur ordinateur** : il n'y a que **7 postes pour 30 élèves**.
- Organisation type : 7 îlots, 1 poste par îlot. Le binôme A travaille sur l'ordinateur (activités **ORDI**) pendant que le binôme B travaille sur papier avec les ressources, puis on échange.
- Chaque activité ORDI a une **version papier** : les ressources donnent tous les blocs, schémas et calculs nécessaires.
- Les compétences sont repérées avec les **codes du BO n°9 du 29/02/2024** (TxCyz), voir § 12.

---

## 2. Organisation du fichier Affinity

### 2.1 Un calque = une page A4

Nommage : `AT_<NomAtelier>_<Type><Numéro>`. Par exemple `AT_Radar_P01`, `AT_Radar_R04`, `AT_Radar_SEGPA_EVAL2`.

| Type | Nom de calque | Couleur d'étiquette du calque (RVB) |
|---|---|---|
| Fiche pédagogique | `AT_xxx_FichePeda` | jaune (255, 220, 0) |
| Fiche professeur | `AT_xxx_PROF` | jaune (255, 220, 0) |
| Feuilles élèves | `AT_xxx_P01`, `P02`… | bleu (17, 142, 255) |
| Ressources | `AT_xxx_R01`, `R02`… | orange (255, 140, 0) |
| Synthèse | `AT_xxx_S01` | violet (203, 100, 255) |
| Évaluation | `AT_xxx_E01` (recto), `E02` (verso) | rouge (255, 79, 68) |
| Ressource d'évaluation | `AT_xxx_R..` (dernier numéro) | orange (255, 140, 0) |
| Feuilles SEGPA | `AT_xxx_SEGPA_P01`… | bleu |
| Ressources SEGPA | `AT_xxx_SEGPA_R01`… | orange |
| Évaluation SEGPA | `AT_xxx_SEGPA_EVAL`, `SEGPA_EVAL2` | rouge |
| Ancienne version | `ARCHIVE_…` | — |

### 2.2 Ordre des calques (du BAS vers le HAUT dans le panneau Calques)

1. FichePeda (tout en bas)
2. PROF
3. P01, P02, …
4. R01, R02, …
5. Synthèse S01
6. Évaluation E01, E02
7. Ressource d'évaluation
8. SEGPA P01, P02, …
9. SEGPA R01, R02, …
10. SEGPA EVAL, EVAL2
11. Ressource d'évaluation SEGPA
12. ARCHIVE (tout en haut)

### 2.3 Sous-calques de correction (dans chaque feuille et chaque évaluation)

- `<calque>_Corr` : les réponses, écrites **en vert (0, 150, 70), en gras**.
- `<calque>_Comp` : les pastilles de compétences du BO (codes TxCyz).
- Les deux sous-calques sont placés **au-dessus** du contenu, et **masqués par défaut**.
- Pour imprimer la feuille élève : on affiche le calque seul, sans `_Corr` ni `_Comp`.

---

## 3. Typographie

| Élément | Police | Taille | Graisse / couleur |
|---|---|---|---|
| Texte courant (par défaut) | **Arial Narrow** | 12 pt | normal, bleu (47, 87, 161) |
| Mots importants dans le texte | Arial Narrow | idem | **gras** |
| Titre de l'atelier (grand en-tête) | **Arial Black** | 15 pt | bleu |
| Sous-titre de l'en-tête (séance, feuille) | Arial | 12 pt | bleu |
| Résumé et objectif de l'atelier | Arial Narrow | 11 pt | bleu, début en gras |
| Titre du bandeau fin | Arial Black | 11 pt | bleu |
| Sous-titre du bandeau fin | Arial | 8,5 pt | bleu |
| Titre de ressource (bandeau) | Arial Black | 14 pt | bleu |
| Étiquette de cadre (« Ressource 8 ») | Arial Narrow | 15 pt | gras, blanc sur bleu |
| Titre de section dans une ressource | Arial Narrow | 14 pt | gras + suite normale |
| Bande question (consigne) | Arial Narrow | 12 pt | numéro en gras |
| Titre de partie SEGPA (« 1. Comment… ») | Arial Narrow | 16 pt | gras |
| Consigne SEGPA | Arial Narrow | 13 pt | verbe d'action en gras |
| Banque de mots | Arial Narrow | 13 pt | « Banque de mots : » en gras |
| « À retenir » | Arial Narrow | 14 pt (titre), 13 pt (texte) | gras pour le titre |
| Réponses (`_Corr`) | Arial Narrow | 11 à 14 pt | **gras, vert (0, 150, 70)** |
| Barème (/3, /20) | Arial Narrow | 22 pt | gras, aligné à droite |
| Pastille de compétence | Arial Narrow | 8 pt | gras, blanc |
| Chiffre de la pastille de niveau | Arial Black | 21,6 pt (grand), 11 pt (petit) | noir (30, 30, 30) |
| Cartouche de fin, ligne 1 | Arial Black | 6,3 pt | bleu |
| Cartouche de fin, ligne 2 | Arial | 7,5 pt | « FIN Feuille 0x » en gras |

Règles :
- Interligne 1,12, espace après paragraphe de 0,35 × la taille.
- Listes à puces : « • » + tabulation, retrait de 0,9 × la taille.
- Couleurs d'accent dans le texte : bleu marine (1, 9, 88) pour insister, rouge (214, 45, 45) pour alerter.
- **Évaluations** : si la page n'est pas pleine, on **augmente la taille du texte** (13 à 15 pt) plutôt que de laisser du blanc.

---

## 4. Palette de couleurs

| Rôle | RVB |
|---|---|
| Bleu texte et traits (couleur principale) | (47, 87, 161) |
| Bleu marine (titres forts, flèches, points) | (1, 9, 88) |
| Bleu clair (bandeaux, en-têtes de tableau, bandes question) | (201, 212, 244) |
| Bleu très pâle (2ᵉ courbe de l'en-tête) | (229, 232, 242) |
| Gris des cases à compléter | (233, 236, 243) |
| Fond des cadres « Recopie et réponds » | (243, 245, 251) |
| Correction | (0, 150, 70) |
| Pastille de compétence | selon le thème : T1 vert (40, 170, 70), T2 rose (230, 80, 150), T3 jaune orangé (245, 165, 30) |
| Étiquette ORDI | fond vert (2, 199, 49), texte vert foncé (21, 45, 0) |
| Étiquette PAPIER | fond bleu (47, 87, 161), texte blanc |
| Bandeau « Objectif » (SEGPA) | jaune pâle (255, 240, 200) |
| Encadré « À retenir » | fond (255, 249, 225), contour orange (240, 170, 30) |
| Banque de mots | fond (232, 244, 255), contour bleu |

### Pastille de niveau

| Niveau | Couleur de la pastille (RVB) |
|---|---|
| 5ᵉ | vert (48, 199, 0) |
| 4ᵉ | jaune (252, 202, 48) |
| 3ᵉ | rouge (216, 40, 52) |

---

## 5. Feuilles élèves (P01, P02…)

### 5.1 Marges

- Zone de texte : **x de 141 à 2425 px** (largeur 2284 px).
- Les pastilles de compétences (`_Comp`) se placent dans la marge gauche, à x = 8 px (126 × 42 px).
- Le barème se place à droite, aligné sur x = 2425.

### 5.2 En-tête

- **Première feuille de l'atelier : grand en-tête.**
  - Deux courbes de fond : bleu clair (201, 212, 244) et bleu très pâle (229, 232, 242).
  - Titre « ATELIER - … » en Arial Black 15 pt, à (189, 79).
  - Sous-titre « SÉANCE x - Feuille y » en Arial 12 pt, à (189, 143).
  - Bloc « **Résumé et objectif de l'atelier :** … » en 11 pt, à (141, 248).
  - Pastille de niveau Ø 117 px à (2225, 66).
  - Le contenu commence à y = 381.
- **Feuilles suivantes : bandeau fin.**
  - Bande arrondie bleu clair à (90, 72), de 2290 × 66 px.
  - Titre en Arial Black 11 pt, sous-titre en Arial 8,5 pt.
  - Petite pastille Ø 62 px à (2300, 74).
  - Le contenu commence à y = 200.

### 5.3 Corps de la feuille

- **Parties à découper (feuilles d'atelier uniquement)** : les lignes de découpe n'existent **que sur les feuilles d'atelier** (P01, P02… et SEGPA_P01…). Jamais sur les ressources, la synthèse, l'évaluation, la fiche pédagogique ni la fiche PROF.
  - La règle à viser : **2 parties par page** (1 ligne de découpe).
  - **3 parties au maximum** (2 lignes de découpe), jamais plus.
  - L'élève découpe une partie, la **colle dans son cahier** et **répond juste en dessous**, dans le cahier, aux questions posées **à la fin de la partie**. Chaque partie se termine donc par ses questions (cadre « Recopie et réponds »).
  - À l'intérieur d'une partie, les exercices sont séparés par un espace ou par un **filet fin** (trait plein bleu pâle (175, 185, 215) de 4 px), jamais par une ligne de découpe.
  - Ligne de découpe : **ligne pointillée bleue épaisse** sur toute la largeur de la page (trait de 12 px, bleu (47, 87, 161), tirets arrondis).
- **Bande question** : pilule arrondie bleu clair, texte 12 pt, numéro de question en gras.
- **Cadre « Recopie et réponds »** : fond (243, 245, 251), coins arrondis (rayon 30). La correction (`_Corr`) recouvre le cadre avec les réponses en vert après « → ».
- **Case à compléter** : rectangle arrondi (rayon 26), fond gris (233, 236, 243), contour bleu de 8,33 px, pointillés « …… » au centre.
- **Case à cocher** : carré arrondi de 46 px, contour bleu de 6 px.
- **Lignes de réponse** : pointillés ronds bleus de 4 px, espacés de 62 à 75 px.
- **Étiquettes d'activité** : « ORDI » (vert) ou « PAPIER » (bleu), hauteur 64 px, 12 pt.
- Schémas, robots et blocs de programmation sont **dessinés** (style Scratch / mBlock, bloc de 74 px de haut). On ne colle pas de captures floues.

### 5.4 Bas de page

- **Cartouche « FIN Feuille 0x »** : en bas à droite, rectangle bleu clair de 940 × 62 px à x = 1540, y ≈ 3290 (3330 pour la SEGPA).
  - Petite pastille de niveau.
  - Ligne 1 : titre de l'atelier.
  - Ligne 2 : « **FIN Feuille 0x** - AT SEQ 0x SEANCE 0x ».
- **Pas de grand blanc** : s'il reste de la place, on ajoute une question ou on agrandit les éléments.

---

## 6. Documents ressources (R01, R02…)

- **Pleine page**, **sans ligne de découpe** ni cartouche de fin.
- **Bandeau titre** : rectangle bleu clair à (73, 86), de 2335 × 145 px. Titre en majuscules, en Arial Black 14 pt (« RESSOURCES 8 ET 9 - … »).
- **Pastille de niveau** Ø 110 px à droite du bandeau (x ≈ 2265, y ≈ 103).
- Le contenu commence à y = 270.
- **Cadres de ressource** :
  - Rectangle arrondi (rayon 60), contour bleu de 12,5 px, sans fond, x = 119, largeur 2283.
  - **Étiquette** en haut à gauche (« Ressource 8 », « Ressource S2 ») : pilule bleue, texte blanc en gras 15 pt, hauteur 104 px.
  - Titre de section à côté de l'étiquette, en 14 pt, avec le début en gras.
  - Espace de 35 à 40 px entre deux cadres.
- **Contenu** : schémas légendés (flèche + point bleu marine, légende avec le mot clé en gras), tableaux (en-tête bleu clair, cellules contour bleu), blocs de programme dessinés, chaînes fonctionnelles (boîtes bleues pour l'information, orange pour l'énergie, reliées par des flèches).
- Si un deuxième matériel équivalent existe (par exemple **Maqueen** à côté du **mBot**), on ajoute un encadré d'équivalence (tableau « même rôle »).
- La page doit être **remplie jusqu'en bas**.

---

## 7. Fiche de synthèse (S01)

- Calque violet. Même en-tête que les feuilles (bandeau fin).
- Reprend les notions clés : texte à trous ou carte mentale, avec sa correction dans `_Corr`.
- **Pas de ligne de découpe** : la synthèse se colle en entier. Les parties sont séparées par des filets fins.

---

## 8. Évaluation (E01 recto + E02 verso)

- **Recto verso** sur une seule feuille : deux calques E01 (recto) et E02 (verso).
- **Pas de cartouche de fin** de page.
- **Pas de blanc** : on ajoute des questions et on **agrandit les textes** si nécessaire.
- **En-tête du recto** :
  - Bandeau arrondi bleu clair à (94, 51), de 2274 × 155 px.
  - « ÉVALUATION - … » en Arial Black 15 pt.
  - « Nom : …… Prénom : …… Classe : …… Date : …… » en 12 pt.
  - Pastille de niveau Ø 117 px à (2225, 66).
- **Bandeau des consignes** : bleu clair, à (94, 239), de 1900 × 123 px (sans ordinateur, ressources autorisées, recto verso).
- **Case de note** « …… / 20 » : 340 × 140 px, contour bleu, 22 pt, en haut à droite.
- **Questions** : bande question numérotée, **barème à droite** (/3, /4…) en 22 pt gras, pastilles de compétences dans `_Comp`. Les questions sont séparées par un **filet fin** bleu pâle (175, 185, 215), **jamais par une ligne de découpe** : l'évaluation ne se découpe pas.
- **Total = 20 points.**
- Le recto se termine par « **→ Tourne la page** » (14 pt gras, aligné à droite).
- **Verso** : petit bandeau titre « ÉVALUATION … (verso) » + pastille de niveau.
- **Ressource d'évaluation** possible (documents A, B, C), sur une page à part et rangée juste après l'évaluation.
- Les réponses sont dans `_Corr`, en vert (cases cochées, liaisons tracées, mots).

---

## 9. Version SEGPA (élèves en difficulté)

- **Mêmes séances, mêmes robots et mêmes postes ORDI** que la classe. Les feuilles sont simplifiées.
- Feuilles :
  - Bandeau fin avec « SEGPA : SÉANCE x - Feuille y » (grand en-tête sur la première).
  - Bandeau « **Objectif :** … » jaune pâle.
  - Titres de parties en 16 pt gras, consignes en 13 pt.
- Types d'exercices : **texte à trous avec banque de mots**, **relier**, **cocher vrai/faux**, **légender un dessin**, petit tableau, programme à trous. Un encadré **« À retenir »** par feuille.
- Mêmes règles de découpe que les feuilles d'atelier : **2 parties par feuille** (3 au maximum), chaque partie se termine par ses questions.
- Valeurs simplifiées, identiques sur toutes les feuilles SEGPA (par exemple les seuils 20 cm et 50 cm).
- Ressources SEGPA : « Ressource S1 », « Ressource S2 »… avec mots à connaître et étapes illustrées.
- Évaluation SEGPA :
  - /20 recto verso, mêmes règles que l'évaluation normale.
  - Questions courtes et très illustrées.
  - Un « **Mon bilan** » à colorier peut terminer le verso.
- Cartouche : « FIN Feuille SEGPA 0x - AT SEQ 0x SEANCE 0x ».

---

## 10. Fiche pédagogique (FichePeda)

Elle suit le format du modèle **« FICHE_PEDAGOGIQUE_AT_REPARATION_ROUE_5EME »** :

1. En-tête : « Cycle 4 » + pastille de niveau, « FICHE PÉDAGOGIQUE DE SÉQUENCE », « Pôle des Sciences et de la Technologie au collège ».
2. **Problématique**.
3. **Objet ou système technique** (Arial Black 15 pt) + **positionnement sur le cycle** (frise de 9 cases, case de l'atelier en bleu marine).
4. Tableau **Compétences travaillées (CT)** / **Connaissances (CO)** : code de compétence en pastille colorée, intitulé en gras italique, sous-compétences (TxCyz) en italique.
5. Bandeaux **Présentation de la séquence**, **Éléments de la synthèse**, **Modalités d'évaluation** (texte gras italique centré, 11 pt).
6. Tableau **Déroulement de la séquence** : Séance / Objectifs pédagogiques / Activités / Ressources et matériels.
7. Si une version SEGPA existe : bandeau **Différenciation**.

## 11. Fiche professeur (PROF)

- Mise en page de ressource : bandeau titre + cadres à étiquettes (« Organisation », « Matériel », « Calques », « SEGPA »).
- Contenu :
  - organisation des 7 postes ;
  - matériel et fichiers à préparer par séance ;
  - consignes d'impression (afficher le calque seul, découper, coller) ;
  - tableau de tous les calques avec leur contenu.

---

## 12. Codes de compétences du BO (n°9 du 29/02/2024)

| Code | Compétence |
|---|---|
| T1C11 | Évolution des objets |
| T1C21 | Impact environnemental |
| T1C31 | Choix d'un objet ou système technique |
| T2C11 | Chaîne d'énergie |
| T2C12 | Matériaux |
| T2C13 | Chaîne d'information |
| T2C14 | Données |
| T2C21 | Dépannage, identifier un dysfonctionnement |
| T2C22 | Réparer selon un protocole |
| T2C31 | Comprendre et modifier un programme |
| T3C11 | Projet |
| T3C12 | Prototypage |
| T3C13 | Choix des matériaux |
| T3C16 | Modélisation et fabrication |
| T3C21 | Validation mécanique |
| T3C22 | Performances, protocoles de tests |
| T3C31 | Écrire un programme |

---

## 13. Liste de contrôle avant de rendre une séquence

- [ ] Chaque page tient sur un A4 (2480 × 3508 px), sans débordement ni chevauchement.
- [ ] Grand en-tête sur la première feuille, bandeau fin sur les suivantes.
- [ ] La pastille de niveau a la bonne couleur partout (5ᵉ verte, 4ᵉ jaune, 3ᵉ rouge).
- [ ] Cartouche « FIN Feuille 0x » sur chaque feuille élève, et pas sur les ressources ni sur l'évaluation.
- [ ] Lignes de découpe **uniquement sur les feuilles d'atelier** : 2 parties par page (3 au maximum), chaque partie se termine par ses questions.
- [ ] Aucune ligne de découpe sur les ressources, la synthèse et l'évaluation (filets fins à la place).
- [ ] Toutes les activités ORDI ont une version papier.
- [ ] Sous-calques `_Corr` (vert) et `_Comp` (codes du BO) présents, au-dessus du contenu et masqués.
- [ ] Évaluation : /20, recto verso, « → Tourne la page », pas de blanc, pas de cartouche.
- [ ] Les mêmes valeurs (seuils, mots, numéros de ressources) sont utilisées dans les feuilles, les ressources et l'évaluation.
- [ ] Étiquettes de couleur des calques correctes et calques rangés du bas vers le haut : FichePeda → PROF → P → R → S → E → ressource d'éval → SEGPA.
- [ ] La fiche pédagogique et la fiche PROF sont à jour.
- [ ] Le texte est lisible : pas de texte foncé sur fond rouge ou vert foncé (utiliser du blanc).
- [ ] Le fichier est enregistré.

---

## 14. Document exemple

Le fichier **AT_Exemple_Charte_Atelier.af** (sur le Bureau) montre une séquence complète construite avec cette charte : l'atelier fictif « La lampe de poche » (5e).

- 12 calques dans le bon ordre : FichePeda, PROF, P01, P02, R01, S01, E01, E02, R02 (ressource d'évaluation), SEGPA_P01, SEGPA_R01, SEGPA_EVAL.
- Chaque page a un sous-calque **`_Annot`** (encadrés roses) qui explique les règles directement sur la page. On le masque pour voir la page telle qu'elle sera imprimée.
- Les sous-calques `_Corr` et `_Comp` sont présents et masqués, comme dans un vrai atelier.
- Ce fichier sert de modèle : on peut le dupliquer, puis remplacer le contenu en gardant la mise en page.
