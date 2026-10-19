# syntax=docker/dockerfile:1
#
# Un seul service Koyeb pour quatre apps :
#   /        -> Kuzzle (hearts_game)
#   /maboul/ -> Maboul du Mardoul
#   /odin/   -> Odin
#   /trio/   -> Trio
#
# Le code de chaque app est récupéré depuis son dépôt GitHub au moment du build
# (branche main par défaut). Pour déployer une nouvelle version d'une app :
# push sur son dépôt, puis bouton "Redeploy" du service dans Koyeb. Pour déployer une nouvelle version d'une app :
# push sur son dépôt, puis bouton "Redeploy" du service dans Koyeb.

ARG NODE_VERSION=22

# ── Base commune ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app

FROM base AS git
RUN apt-get update -qq \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ── Récupération des sources ─────────────────────────────────────────────────
# Attention : Koyeb garde un cache des étapes Docker. Le bouton "Redeploy" du
# panneau Koyeb reconstruit SANS cache, donc re-clone la dernière version.
FROM git AS hearts-src
ARG HEARTS_REPO=s-foerster/Kuzzle
ARG HEARTS_REF=main
RUN git clone --depth 1 --branch "${HEARTS_REF}" "https://github.com/${HEARTS_REPO}.git" /repo \
 && rm -rf /repo/.git

FROM git AS maboul-src
ARG MABOUL_REPO=Teqih/maboul-du-mardoul
ARG MABOUL_REF=main
RUN git clone --depth 1 --branch "${MABOUL_REF}" "https://github.com/${MABOUL_REPO}.git" /repo \
 && rm -rf /repo/.git

FROM git AS odin-src
ARG ODIN_REPO=s-foerster/odin
ARG ODIN_REF=main
RUN git clone --depth 1 --branch "${ODIN_REF}" "https://github.com/${ODIN_REPO}.git" /repo \
 && rm -rf /repo/.git

FROM git AS trio-src
ARG TRIO_REPO=s-foerster/trio
ARG TRIO_REF=main
RUN git clone --depth 1 --branch "${TRIO_REF}" "https://github.com/${TRIO_REPO}.git" /repo \
 && rm -rf /repo/.git

# ── Build Kuzzle (hearts_game) ───────────────────────────────────────────────
FROM base AS hearts-build
COPY --from=hearts-src /repo/ ./
# Variables lues par Vite au build (définies dans les variables d'env Koyeb)
ARG VITE_API_URL=""
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
RUN npm ci --include=dev \
 && npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

# ── Build Maboul du Mardoul ──────────────────────────────────────────────────
FROM base AS maboul-build
COPY --from=maboul-src /repo/ ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Build Odin ───────────────────────────────────────────────────────────────
FROM base AS odin-build
RUN apt-get update -qq \
 && apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=odin-src /repo/ ./
# VOICE_MESSAGES_DISABLED=true masque le bouton micro (et le serveur refuse les vocaux)
ARG VOICE_MESSAGES_DISABLED=""
ENV NODE_ENV=production
RUN npm ci --include=dev \
 && BASE_PATH=/odin/ VITE_VOICE_MESSAGES_DISABLED="${VOICE_MESSAGES_DISABLED}" npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

# ── Build Trio (aucune dépendance npm) ───────────────────────────────────────
FROM base AS trio-build
COPY --from=trio-src /repo/ ./
RUN rm -rf test

# ── Image finale ─────────────────────────────────────────────────────────────
FROM base
ENV NODE_ENV=production \
    # Kuzzle : faire confiance à X-Forwarded-For de Koyeb pour le rate-limit
    TRUST_PROXY=1
COPY --from=hearts-build /app ./apps/hearts
COPY --from=maboul-build /app ./apps/maboul
COPY --from=odin-build   /app ./apps/odin
COPY --from=trio-build   /app ./apps/trio
COPY package.json gateway.js ./

EXPOSE 8000
CMD ["node", "gateway.js"]
