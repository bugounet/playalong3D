# Playalong 3D

Prototype web pour apprendre le piano depuis un fichier MIDI et un clavier
branché à l’ordinateur. L’interface reprend le principe du rouleau vertical de
Synthesia, avec une scène WebGL en perspective, les doigtés calculés, un piano
cliquable et des mains virtuelles.

## Démarrage

Prérequis : Node.js 20 ou plus récent.

```bash
npm install
npm run dev
```

Ouvrir ensuite `http://localhost:5173`. Une démo en Do majeur est chargée par
défaut. Le bouton **Importer un MIDI** accepte les fichiers `.mid` et `.midi`.

Pour connecter un vrai piano, utiliser Chrome ou Edge sur ordinateur, cliquer
sur **Connecter MIDI**, puis autoriser le clavier. Web MIDI exige une page en
HTTPS ou `localhost`. Les touches `A` à `P` du clavier d’ordinateur et le piano
3D permettent de tester l’application sans matériel.

## Fonctions implémentées

- import et parsing Standard MIDI File ;
- sélection d’une ou deux pistes, avec attribution automatique ou manuelle à
  la main gauche/droite ;
- entraînement main gauche, main droite ou deux mains ;
- rouleau de notes 3D vert/bleu, numéros de doigts et touches actives ;
- mode **En rythme** avec score basé sur la distance temporelle ;
- mode **Attendre la note**, y compris pour les accords ;
- boucle par mesures de 50 % à 100 %, incréments de 5 %, validation à 95/100
  et répétition automatique du palier en cas d’échec ;
- entrée Web MIDI, piano à l’écran et mini-synthèse audio Web Audio ;
- assistant de découverte de l’étendue du piano MIDI ;
- métronome accentué et réglage du tempo de 25 % à 200 % ;
- vues perspective 3D et verticale 2D ;
- bilan de précision combinant timing, fausses notes et notes manquées ;
- mains virtuelles translucides montrant la position globale et le doigt cible ;
- interface responsive et build statique déployable sur n’importe quel
  hébergement HTTPS.

## Calcul des tonalités et des doigtés

Le fichier MIDI ne contient généralement pas de doigtés. Le moteur réalise
d’abord une analyse harmonique avant toute attribution :

1. La partition sélectionnée est découpée en fenêtres de quatre mesures.
2. Un histogramme des douze classes de hauteur est pondéré par la durée et la
   vélocité des notes.
3. Les 24 tonalités majeures/mineures sont comparées avec les profils
   Krumhansl–Schmuckler. Le meilleur profil donne la gamme locale et un indice
   de confiance.
4. Les pistes automatiques sont attribuées selon leur registre ; une piste de
   piano mixte est séparée autour du Do central.
5. Pour chaque main, une programmation dynamique teste les cinq doigts et
   minimise un coût combinant déplacement de la position de main, écartement,
   répétition avec le même doigt, croisements, passages du pouce, pouce sur
   touche noire et doigtés usuels de la gamme détectée.
6. Une passe dédiée aux accords garantit des doigts distincts et ordonnés sur
   les notes simultanées.

Ce calcul est volontairement déterministe : un même fichier et les mêmes pistes
produisent toujours les mêmes doigtés. Pour une version de production, la suite
logique serait d’ajouter des contraintes biomécaniques configurables (taille de
main, portée maximale) et un éditeur permettant de verrouiller les doigtés
préférés du musicien.

## Architecture

- React + TypeScript + Vite pour l’interface ;
- Three.js via React Three Fiber pour la scène 3D ;
- `@tonejs/midi` pour le parsing des fichiers ;
- Web MIDI API pour le matériel et Web Audio API pour le retour sonore ;
- logique musicale pure dans `src/lib/music.ts`, testée avec Vitest.

Commandes de validation :

```bash
npm test
npm run build
```

Le build de production est généré dans `dist/`.
