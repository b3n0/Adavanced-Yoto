# Yoto Player Advanced

Cette intégration ajoute à Gladys Assistant chaque Yoto Player d'un compte
Yoto : veilleuse, limites de volume, batterie, et lecture d'une carte depuis
une scène.

## Ce que vous obtenez

Après la liaison du compte, chaque lecteur apparaît dans l'onglet
**Découverte** :

- **Veilleuse** — marche/arrêt et couleur de l'anneau lumineux pour le profil
  en cours (jour ou nuit). L'arrêt envoie la couleur `#0` de Yoto.
- **Luminosité** — luminosité de l'écran de ce même profil, de 0 à 100.
  La valeur `auto` s'affiche comme 100 ; déplacer le curseur enregistre un
  nombre fixe.
- **Volume** — la molette du lecteur, de 0 à 16.
- **Volume max jour** et **Volume max nuit** — les plafonds enregistrés sur
  le lecteur.
- **Batterie** — pourcentage en lecture seule.

## Lire une carte depuis une scène

Dans l'éditeur de scènes, ajoutez l'action **Lire une carte Yoto** :

1. Choisissez le lecteur.
2. Saisissez l'identifiant de la carte (par exemple `5WsQg`).
3. Laissez l'index de piste à 0 pour démarrer la première piste du chapitre 01.

## Configuration

Ouvrez [le site des applications Yoto](https://dashboard.yoto.dev/), créez
une application, puis ouvrez **Edit Application**.

1. **Application Type** : laissez **Public Client**.
2. **Allowed Callback URLs** : effacez l'exemple et mettez seulement
   `https://my.gladysassistant.com/redirect/oauth`.
3. **Scopes** : cochez `family:devices:control`, `family:devices:manage`,
   `family:view` et `offline_access`. Les droits déjà marqués
   Included automatically suffisent. Ne cochez pas `family:library:manage`
   ni `user:content:manage`.
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

**Mise à jour des lecteurs** règle la lecture de la batterie, du volume et de
la veilleuse. 300 correspond à 5 minutes, et Gladys ne peut pas descendre
sous une minute.
