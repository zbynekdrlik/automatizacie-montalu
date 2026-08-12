# bookworm-slim (glibc) — better-sqlite3 má prebuilt binárky, netreba kompilovať
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --fetch-retries: better-sqlite3's `prebuild-install` sťahuje jej prebuilt
# binárku priamo z GitHub releases CDN (mimo npm registry, mimo npm vlastného
# retry mechanizmu) — na zaťaženom VPS (build cache/RAM tlak) toto sťahovanie
# vie občas padnúť na "socket hang up", čo zhodí CELÝ build a spadne na
# node-gyp fallback (ten padne vždy, image nemá Python — zámerne, netreba ho).
# 3 po sebe idúce zlyhania (2026-08-12) reprodukované NEBOLI manuálne
# (curl aj `docker build` mimo CI prešli čisto) → dôkaz prechodnej záťaže,
# nie trvalej poruchy. Retry namiesto slepého "skús znova" na CI úrovni.
RUN npm ci --fetch-retries=5 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=30000
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
EXPOSE 3000
CMD ["node", "build"]
