# bookworm-slim (glibc) — better-sqlite3 má prebuilt binárky, netreba kompilovať
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3's `prebuild-install` sťahuje jej prebuilt binárku priamo z
# GitHub releases CDN cez VLASTNÝ HTTP klient — MIMO npm registry klienta,
# takže `npm ci --fetch-retries=…` naň NEMÁ ŽIADEN vplyv (overené naživo:
# pridanie flagu zlyhanie vôbec nezmenilo, 4. zlyhanie v rade malo identickú
# "socket hang up" stopu ako predošlé 3). Skutočný fix: retry CELÉHO `npm ci`
# príkazu na shell úrovni — to reálne zopakuje aj prebuild-install-ov fetch,
# nie len npm registry požiadavky. Node-gyp fallback (keby aj retry zlyhal)
# vždy padne, image nemá Python — zámerne, netreba ho pri fungujúcom
# prebuild-install. 4 po sebe idúce zlyhania na VPS (2026-08-12) sa manuálne
# nedali zreprodukovať (curl aj `docker build` mimo CI prešli čisto) → dôkaz
# prechodnej záťaže na tomto konkrétnom, zdrojmi obmedzenom hostiteľovi.
RUN npm ci || (echo 'npm ci #1 zlyhalo, skúšam znova o 5s' && sleep 5 && npm ci) || \
    (echo 'npm ci #2 zlyhalo, skúšam znova o 20s' && sleep 20 && npm ci)
COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/build build
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json .
# Non-root runtime (#256): bež ako `node` (uid 1000, existuje v base image) — least
# privilege. Priprav /data/app node-vlastnené, aby ČERSTVÝ prázdny named volume
# `appdata` zdedil owner node:node (Docker kopíruje vlastníctvo image adresára do
# prázdneho volume pri prvom mounte). EXISTUJÚCI (root-vlastnený) volume + zdieľané
# Money bind-mounty rieši idempotentná `migrate_ownership` v deploy-remote.sh — image
# chown existujúci volume neprepíše. adapter-node servuje `build/` read-only a
# better-sqlite3 sa len číta, takže /app nepotrebuje write; jediné zapisovateľné cesty
# sú namontované volumes. Port 3000 (≥1024) nevyžaduje root.
RUN mkdir -p /data/app && chown node:node /data/app
USER node
EXPOSE 3000
CMD ["node", "build"]
