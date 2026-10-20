# koyeb-apps

Un seul service Koyeb (plan gratuit) qui sert cinq projets sur la même adresse :

| Chemin | App | Dépôt |
|---|---|---|
| `/` | Kuzzle (hearts_game) | `s-foerster/Kuzzle` |
| `/maboul/` | Le Maboul du Mardoul | `Teqih/maboul-du-mardoul` |
| `/odin/` | Odin | `s-foerster/odin` |
| `/trio/` | Trio | `s-foerster/trio` |
| `/flip7/` | Flip 7 | `s-foerster/flip7` |

## Comment ça marche

- `gateway.js` est le seul processus exposé (port `8000`). Il lance les 5 apps sur des ports internes (3001 à 3005) et envoie chaque requête à la bonne app selon le chemin, WebSockets compris.
- Le préfixe (`/maboul`, `/odin`, `/trio`, `/flip7`) est retiré avant d'arriver à l'app : côté serveur, chaque app croit être à la racine. Seul le front de Maboul, d'Odin, de Trio et de Flip 7 utilise le bon préfixe (chemins relatifs).
- Kuzzle reste à la racine, donc rien ne change pour lui : même domaine, mêmes URLs Stripe et Supabase, même SEO.
- Si une app plante, le routeur la relance automatiquement.
- `gateway.js` n'a aucune dépendance npm.
- Le `Dockerfile` clone les 5 dépôts GitHub (branche `main`) au moment du build.

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
- `https://ton-app.koyeb.app/flip7/` → Flip 7
- `https://ton-app.koyeb.app/__gateway/health` → état des 5 apps

### Déploiement automatique (GitHub Actions)

Le workflow `.github/workflows/koyeb-deploy.yml` redéploie le service **sans cache de build** :

- à chaque push sur `main` de `koyeb-apps` ;
- toutes les 5 minutes, il regarde le dernier commit de `main` de Kuzzle, Maboul, Odin, Trio et Flip 7, et redéploie seulement si l'un d'eux a changé (délai de 5 à 15 min après un push, GitHub ne lance pas les tâches planifiées à la minute près) ;
- à la demande : onglet **Actions** du dépôt > **Déploiement Koyeb** > **Run workflow**.

Le workflow attend la fin du déploiement et échoue si Koyeb signale une erreur : GitHub t'envoie alors un e-mail.

Réglage : secret `KOYEB_TOKEN` (jeton API Koyeb, créé dans Koyeb > Settings > API) dans **Settings > Secrets and variables > Actions** de ce dépôt. L'identifiant du service est écrit dans le workflow.

L'option **Autodeploy** de Koyeb est encore active : un push sur `koyeb-apps` lance aussi un build Koyeb avec cache, puis le workflow en relance un sans cache. Le résultat final est bon ; pour éviter ce double build, décoche **Autodeploy** dans Koyeb (Settings > Source).

### Mettre à jour une app plus tard

1. Push sur le dépôt de l'app : le workflow ci-dessus redéploie tout seul.
2. Pour forcer à la main : dans Koyeb, **Redeploy** > **Trigger build** en décochant **Use build cache**.

Un simple push sur `koyeb-apps` ne suffit pas toujours : Koyeb réutilise son cache et risque de garder l'ancienne version des apps.

## Mémoire (512 Mo sur le plan gratuit)

Si le service manque de mémoire (redémarrages, erreurs « OOM » dans les logs Koyeb), deux options sont disponibles via les variables d'environnement :

| Variable | Effet |
|---|---|
| `VOICE_MESSAGES_DISABLED=true` | Odin : masque le bouton micro et le serveur refuse les vocaux (pas de ffmpeg). Nécessite un **Redeploy**. |
| `DISABLED_APPS=odin` | Ne lance pas une app. Plusieurs valeurs possibles : `odin,maboul,trio,flip7`. |

Trio et Flip 7 sont très légers (aucune dépendance npm, mémoire plafonnée à 64 Mo chacun par `--max-old-space-size`).

## Trio

Jeu de cartes Trio (règles officielles Cogitum / Cocktail Games), dépôt `s-foerster/trio` (local : `Documents\dev\trio`). Voir son README.

- Créer / rejoindre une partie avec un code à 4 chiffres, ajouter des bots (facile, normal, expert).
- Modes simple et piquant, mode équipes à 4 ou 6.
- Aucune dépendance npm (serveur HTTP + WebSocket maison).

## Flip 7

Jeu de cartes Flip 7 (règles officielles The Op, Eric Olsen), dépôt `s-foerster/flip7` (local : `Documentsdevlip7`). Voir son README.

- Créer / rejoindre une partie avec un code à 4 chiffres, 3 à 8 joueurs, bots facile / normal / expert.
- Hit or Stay, Freeze, Flip Three, Second Chance, modificateurs, bonus Flip 7, course à 200 points (réglable).
- Cartes dessinées en SVG dans le style des cartes officielles. Même architecture que Trio, aucune dépendance npm.

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

Puis ouvre <http://localhost:8000/>, <http://localhost:8000/maboul/>, <http://localhost:8000/odin/>, <http://localhost:8000/trio/> et <http://localhost:8000/flip7/>.

Trio tout seul, sans Docker : `cd ..\trio; node server.js` puis <http://localhost:3004/>. Flip 7 : `cd ..\flip7; node server.js` puis <http://localhost:3005/>.
