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
# #297: /data/money-log = perzistentný money-audit volume (forenzný logger sink,
# prežije redeploy). Rovnaký vzor ako /data/app — čerstvý prázdny named volume
# zdedí owner node:node z tohto image adresára pri prvom mounte (non-root USER node).
RUN mkdir -p /data/app /data/money-log && chown node:node /data/app /data/money-log
USER node
EXPOSE 3000
# HEALTHCHECK (odoo-erp #5821): self-verujuci obraz pre ghcr publish + standalon
# `docker pull ... latest && docker run` (acceptance). Node stdlib fetch (Node >=18),
# image ZAMERNE nema curl/wget. 127.0.0.1 (NIE localhost: Node 17-19 resolvuje na
# ::1, kym adapter-node bindne IPv4). EXEC forma (ziadny sh -c -> ziadna $-expanzia
# regexu). Cita runtime PORT (adapter-node ho cti) + APP_BASE_PATH (obidva default
# root/3000, trailing-slash normalizovane), takze probe SLEDUJE base/port s ktorym
# bol obraz zostaveny/spusteny; kontroluje HTTP 200 (r.ok), nie DB-seed `ok` v tele.
# #5821 publikuje ROOT obraz (ZIADNY APP_BASE_PATH build-arg) -> probe = /health.
# Base-path wiring (svelte.config konzumacia + runtime ENV APP_BASE_PATH + publish
# build-arg) je ATOMICKA zmena #5822 — nedelit, inak probe/served base nesedia. V
# PROD compose (#5815) je HEALTHCHECK aj tak override-nuty vlastnym /automatizacie/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "const b=(process.env.APP_BASE_PATH||'').replace(/\\/+$/,'');const p=process.env.PORT||3000;fetch('http://127.0.0.1:'+p+b+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "build"]
