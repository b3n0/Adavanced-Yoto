# Yoto Player Advanced

Intégration externe Gladys Assistant pour un ou plusieurs [Yoto Player](https://yotoplay.com).
Elle parle à l'API `https://api.yotoplay.com`. Le compte Yoto se lie une fois, et la connexion se maintient toute seule.

## Ce que Gladys reçoit

Pour chaque lecteur du compte :

| Fonctionnalité  | Catégorie Gladys       | Commande Yoto                                       |
| --------------- | ---------------------- | --------------------------------------------------- |
| Veilleuse       | `light` / `binary`     | couleur d'ambiance du profil actif (`#0` = éteinte) |
| Couleur         | `light` / `color`      | même couleur, entier Gladys converti en hex         |
| Luminosité      | `light` / `brightness` | luminosité d'écran du profil jour ou nuit (0–100)   |
| Volume          | `music` / `volume`     | molette 0–16, envoyée en pourcentage                |
| Volume max jour | `music` / `volume`     | `maxVolumeLimit`                                    |
| Volume max nuit | `music` / `volume`     | `nightMaxVolumeLimit`                               |
| Batterie        | `battery` / `integer`  | lecture seule, ombre de configuration               |

La lecture d'une carte est une **action de scène** `play_card` (identifiant de carte + index de piste). Une fonctionnalité Gladys ne porte qu'un nombre, pas un identifiant de carte.

## Configuration

1. Sur [dashboard.yoto.dev](https://dashboard.yoto.dev/), dans **Allowed Callback URLs**, mettez `https://my.gladysassistant.com/redirect/oauth`.
2. Cochez `family:devices:control`, `family:devices:manage`, `family:view` et `offline_access`, puis **Update Application**.
3. Copiez le Client ID dans **Identifiant**, enregistrez, puis cliquez sur **Lier mon compte Yoto**.

La connexion se maintient toute seule. On ne la refait que si le mot de passe Yoto change, ou si l'application est retirée du compte. Le détail est dans `docs/fr.md`.

## Développement

```bash
npm install
npm test
npm run lint
npm run format:check
```

Node.js 22 ou plus. Aucune dépendance HTTP : `fetch` est celui de Node. Les tests ne sortent pas sur le réseau.

Les variables `GLADYS_HOST_API_URL`, `GLADYS_INTEGRATION_TOKEN` et `GLADYS_INTEGRATION_SELECTOR` sont injectées par Gladys dans le conteneur. Le SDK les lit seul.

## Publication

La version se pose via **Actions → Release**, pas à la main dans `package.json` ni dans le manifeste. Décrivez le changement sous `## [Unreleased]` de `CHANGELOG.md` avant de lancer le workflow.

Image : `ghcr.io/b3n0/adavanced-yoto`.

## Licence

Apache-2.0
