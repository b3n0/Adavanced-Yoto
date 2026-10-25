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

Le jeton d'accès Yoto dure quelques heures. L'intégration garde aussi un
jeton de rafraîchissement, à usage unique, et s'en sert pour en obtenir un
nouveau avant l'échéance. La liaison ne s'interrompt pas tant que Yoto
l'accepte.

1. Sur le portail développeur Yoto, créez une application qui autorise le
   flux **device code**. Copiez le client id. Les droits sont ceux de
   l'intégration Home Assistant : `offline_access` et les droits `family`
   des lecteurs. Le guide est sur
   [yoto.dev](https://yoto.dev/authentication/headless-cli-auth/).
2. Collez le client id. Si l'application est confidentielle, collez aussi
   le secret. Un client public n'a pas de secret.
3. Enregistrez, puis cliquez sur **Lier mon compte Yoto**. Une page Yoto
   s'ouvre : connectez-vous et autorisez l'application.
4. Utilisez **Tester la connexion Yoto**. Les lecteurs apparaissent dans
   l'onglet Découverte.

Il faut lier le compte à nouveau seulement si vous changez le mot de passe
Yoto, si vous révoquez l'application dans le compte Yoto, ou si les serveurs
Yoto rejettent durablement la session. Les jetons ne sont jamais écrits dans
les logs.

L'**intervalle de rafraîchissement** règle la lecture de la batterie, du
volume et de la veilleuse. Le défaut est 5 minutes, et Gladys n'interroge pas
plus d'une fois par minute.
