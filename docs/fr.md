# Yoto Player Advanced

Cette intégration ajoute à Gladys Assistant chaque Yoto Player d'un compte
Yoto : veilleuse, volume, capteurs, et lecture d'une carte depuis une scène.
Gladys 5.3 ou plus récent est nécessaire.

## Ce que vous obtenez

Après la liaison du compte, chaque lecteur apparaît dans l'onglet
**Découverte**. Une mise à jour du lecteur déjà ajouté (bouton **Mettre à
jour** de cet onglet) ajoute les fonctionnalités nouvelles.

Commandes :

- **Veilleuse** — marche/arrêt et couleur de l'anneau lumineux pour le profil
  en cours (jour ou nuit). L'arrêt envoie la couleur `#0` de Yoto.
- **Luminosité** — luminosité de l'écran de ce même profil, de 0 à 100.
  La valeur `auto` s'affiche comme 100 ; déplacer le curseur enregistre un
  nombre fixe.
- **Volume** — de 0 à 100 %.
- **Volume max jour** et **Volume max nuit** — les plafonds, affichés de 0 à
  100 %. Le lecteur les enregistre sur sa molette à 17 crans : le curseur se
  cale sur le cran le plus proche.

Lecture seule :

- **Batterie**, **En charge** (sur secteur, y compris batterie pleine),
  **En ligne**, **Signal Wi-Fi**, **Lumière ambiante**, **Température**.
- **Lecture** et **Carte en cours**. Le titre, l'auteur et la pochette
  alimentent le lecteur musical de Gladys. La piste et la position ne sont
  pas disponibles : l'API ne les donne pas.

## Tableau de bord

Deux widgets : **Lecteurs Yoto** (tous les lecteurs du compte) et **Lecteur
Yoto** (un lecteur, avec la courbe de batterie sur 24 h). Ils affichent la
dernière lecture. **Rafraîchir** interroge le lecteur tout de suite.

## Scènes

Déclencheurs :

- **Une carte démarre** — filtres : lecteur, titre exact. Variables : nom du
  lecteur, titre, identifiant.
- **Un lecteur arrête la lecture** — filtre : lecteur.
- **Batterie faible** — sous 20 %, une seule fois tant que le lecteur n'est
  pas rebranché ou remonté au-dessus de 25 %.

Actions :

- **Lire une carte Yoto** — lecteur, identifiant de carte (par exemple
  `5WsQg`), index de piste (0 = première piste du chapitre 01).
- **Lire l'état d'un lecteur Yoto** — lit maintenant et passe batterie,
  volume, carte, température et veilleuse aux étapes suivantes.
- **Rafraîchir tous les lecteurs Yoto**.

Le premier relevé après un démarrage ne déclenche pas de scène.

## Configuration

Ouvrez [le site des applications Yoto](https://dashboard.yoto.dev/), créez
une application, puis ouvrez **Edit Application**.

1. **Application Type** : laissez **Public Client**.
2. **Allowed Callback URLs** : effacez l'exemple et mettez seulement
   `https://my.gladysassistant.com/redirect/oauth`.
3. **Scopes** : cochez `family:devices:control`, `family:devices:manage`,
   `family:view` et `offline_access`. Les droits déjà marqués
   Included automatically suffisent, dont `family:library:view` pour le
   titre des cartes. Ne cochez pas `family:library:manage` ni
   `user:content:manage`.
4. Laissez vides **Description**, **Allowed Logout URLs**, **Application
   Logo** et **Application Privacy Policy URL**.
5. Cliquez sur **Update Application**.
6. Dans Gladys, copiez le **Client ID** dans **Identifiant**. Laissez
   **Secret** vide, enregistrez, puis cliquez sur **Lier mon compte Yoto**.
   Connectez-vous avec le compte de la famille.
7. Cliquez sur **Tester la connexion Yoto**. Les lecteurs apparaissent dans
   l'onglet Découverte.

La connexion se maintient toute seule. On ne la refait que si le mot de passe
Yoto change, ou si l'application est retirée du compte.

**Mise à jour des lecteurs** règle le délai entre deux lectures. 300
correspond à 5 minutes, et Gladys ne peut pas descendre sous une minute.
**Demander un statut à jour** demande au lecteur de se signaler avant la
lecture. Décochez-le s'il se réveille trop souvent.
