# koyeb-apps

Un seul service Koyeb (plan gratuit) qui sert quatre projets sur la même adresse :

| Chemin | App | Dépôt |
|---|---|---|
| `/` | Kuzzle (hearts_game) | `s-foerster/Kuzzle` |
| `/maboul/` | Le Maboul du Mardoul | `Teqih/maboul-du-mardoul` |
| `/odin/` | Odin | `s-foerster/odin` |
| `/trio/` | Trio | `s-foerster/trio` |

## Comment ça marche

- `gateway.js` est le seul processus exposé (port `8000`). Il lance les 4 apps sur des ports internes (3001, 3002, 3003, 3004) et envoie chaque requête à la bonne app selon le chemin, WebSockets compris.
- Le préfixe (`/maboul`, `/odin`, `/trio`) est retiré avant d'arriver à l'app : côté serveur, chaque app croit être à la racine. Seul le front de Maboul, d'Odin et de Trio utilise le bon préfixe (chemins relatifs).
- Kuzzle reste à la racine, donc rien ne change pour lui : même domaine, mêmes URLs Stripe et Supabase, même SEO.
- Si une app plante, le routeur la relance automatiquement.
- `gateway.js` n'a aucune dépendance npm.
- Le `Dockerfile` clone les 4 dépôts GitHub (branche `main`) au moment du build.

## Mise en place

### 1. Pousser les modifications des 3 projets

Chaque projet a reçu de petites modifications compatibles avec l'ancien fonctionnement (voir plus bas). Commit et push sur `main` dans chacun :

```powershell
cd C:\Users\Stephen\Documents\dev\hearts_game;  git add -A; git commit -m "Support reverse proxy (TRUST_PROXY)"; git push
cd C:\Users\Stephen\Documents\maboul-mardoul;   git add -A; git commit -m "Chemins relatifs pour servir l'app sous /maboul/"; git push
cd C:\Users\Stephen\Documents\dev\odin;          git add -A; git commit -m "Support d'un sous-chemin (BASE_PATH) + option pour couper les vocaux"; git push
```

### 2. Créer le dépôt GitHub `koyeb-apps`

```powershell
cd C:\Users\Stephen\Documents\dev\koyeb-apps
git init; git add -A; git commit -m "Routeur multi-apps pour Koyeb"
git branch -M main
git remote add origin https://github.com/s-foerster/koyeb-apps.git   # créer le dépôt vide sur GitHub avant
git push -u origin main
```

### 3. Modifier le service Koyeb existant

Il vaut mieux modifier le service actuel plutôt que d'en créer un nouveau, pour garder son adresse (`xxx.koyeb.app` ou ton domaine) et les variables d'environnement.

Dans Koyeb, ouvre le service puis **Settings** :

1. **Source** : le dépôt GitHub `koyeb-apps`, branche `main`.
2. **Builder** : `Dockerfile` (chemin `Dockerfile`, pas de commande à surcharger).
3. **Exposed ports** : `8000`, en HTTP, route `/`. Supprime l'ancien port s'il est différent.
4. **Health check** : TCP sur le port `8000`. Tu peux aussi utiliser HTTP sur `/__gateway/health`.
5. **Variables d'environnement** : garde toutes celles de Kuzzle. Elles sont transmises à Kuzzle, et celles qui commencent par `VITE_` sont utilisées pendant le build :
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY` (et `VITE_API_URL` si tu l'utilisais)
   - `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `ALLOWED_ORIGINS`, `APP_URL`…
   - Si `PORT` est défini, il doit valoir `8000`. Tu peux aussi le supprimer, le routeur utilise 8000 par défaut.
6. Clique sur **Deploy**.

Ensuite, vérifie ces adresses (remplace par ton adresse Koyeb) :

- `https://ton-app.koyeb.app/` → Kuzzle
- `https://ton-app.koyeb.app/maboul/` → Maboul du Mardoul
- `https://ton-app.koyeb.app/odin/` → Odin
- `https://ton-app.koyeb.app/trio/` → Trio
- `https://ton-app.koyeb.app/__gateway/health` → état des 4 apps

### Mettre à jour une app plus tard

1. Push sur le dépôt de l'app.
2. Dans Koyeb, clique sur **Redeploy**. Ça reconstruit sans cache, donc le code le plus récent de chaque dépôt est récupéré.

Un simple push sur `koyeb-apps` ne suffit pas toujours : Koyeb réutilise son cache et risque de garder l'ancienne version des apps.

## Mémoire (512 Mo sur le plan gratuit)

Si le service manque de mémoire (redémarrages, erreurs « OOM » dans les logs Koyeb), deux options sont disponibles via les variables d'environnement :

| Variable | Effet |
|---|---|
| `VOICE_MESSAGES_DISABLED=true` | Odin : masque le bouton micro et le serveur refuse les vocaux (pas de ffmpeg). Nécessite un **Redeploy**. |
| `DISABLED_APPS=odin` | Ne lance pas une app. Plusieurs valeurs possibles : `odin,maboul,trio`. |

Trio est très léger (aucune dépendance npm, mémoire plafonnée à 64 Mo par `--max-old-space-size`).

## Trio

Jeu de cartes Trio (règles officielles Cogitum / Cocktail Games), dépôt `s-foerster/trio` (local : `Documents\dev\trio`). Voir son README.

- Créer / rejoindre une partie avec un code à 4 chiffres, ajouter des bots (facile, normal, expert).
- Modes simple et piquant, mode équipes à 4 ou 6.
- Aucune dépendance npm (serveur HTTP + WebSocket maison).

## Modifications faites dans les projets

**hearts_game (Kuzzle)** : une seule modification dans `server.js`. La variable optionnelle `TRUST_PROXY` permet à Express de lire la vraie IP du client, pour que le rate-limit fonctionne derrière le routeur. Sans cette variable, le comportement reste celui d'origine.

**maboul-mardoul** :

- Tous les chemins sont relatifs : HTML, CSS, `script.js`, service worker et manifest.
- socket.io utilise le préfixe de la page.
- Ajout de `npm start`.
- `express.static` ne dépend plus du dossier courant.
- L'app fonctionne toujours à la racine en local.

**odin** :

- `vite.config.ts` utilise `base: process.env.BASE_PATH || '/'`.
- Nouveau fichier `client/src/lib/base.ts` (`BASE`, `withBase()`), utilisé pour les appels `/api`, le WebSocket `/ws`, les vocaux et le routeur wouter.
- Option `VOICE_MESSAGES_DISABLED`.
- Sans `BASE_PATH`, rien ne change : Odin marche toujours seul à la racine, en local comme sur Fly.

## Tester en local (optionnel, avec Docker Desktop)

```powershell
docker build -t koyeb-apps `
  --build-arg VITE_SUPABASE_URL=... --build-arg VITE_SUPABASE_ANON_KEY=... `
  --build-arg VITE_STRIPE_PUBLISHABLE_KEY=... .
docker run --rm -p 8000:8000 --env-file ..\hearts_game\.env -e PORT=8000 koyeb-apps
```

Puis ouvre <http://localhost:8000/>, <http://localhost:8000/maboul/>, <http://localhost:8000/odin/> et <http://localhost:8000/trio/>.

Trio tout seul, sans Docker : `cd ..\trio; node server.js` puis <http://localhost:3004/>.
