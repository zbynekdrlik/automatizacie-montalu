# B2B veľkoobchodné prostredie + rozmerové limity — design

**Dátum:** 2026-07-14
**Projekt:** automatizacie-montalu (webová appka na nárezové plány zasklení, deploy app.montalu.cloud, `MONEY_LIVE=1`)
**Zadanie:** Dominik + Pala (2026-07-14)

## Kontext a hlavné obmedzenie

Appka je **v ostrom používaní** internými pracovníkmi. Každá zmena musí byť
aditívna a nesmie narušiť existujúci interný tok. Nový B2B režim je **neaktívny,
kým nevznikne prvý `b2b` účet** — existujúci users ostávajú `internal` a nič sa
im nemení.

Dve prepojené funkcie, obe **len pre Zasklenia**:

1. **B2B veľkoobchodná rola** — externý veľkoobchodník má prístup LEN do Zasklenia,
   vie spraviť nárezák + vytlačiť/uložiť PDF, ale **NEODPISUJE do Money**.
2. **Rozmerové limity** (len pre B2B) — min/max šírka na pole podľa systému +
   upozornenie na výšku „zasklenie bez záruky". Interní users bez obmedzení (atyp).

## Rozhodnutia (schválené používateľom)

- **Šírka mimo rozsahu → blok + poradí štýl** (nie auto-voľba, nie len upozornenie).
- **B2B účty spravuje interná admin stránka** (nie env, nie ručne).
- Limit sa počíta z **`S / N`** (šírka okna / počet polí) — Dominikovo „3×1000",
  nie z jemnej sklo-miery s offsetmi.
- Výška nad limit = **povoliť + upozorniť** (nie blok).
- Interní users = **žiadne limity**.

## Súčasný stav (grounded 2026-07-14)

- `users(id, username, pass_hash, created_at)` + `sessions(token, user_id, expires_at)`;
  cookie `am_session`; `locals.user = {id, username}` set v `hooks.server.ts:13`
  (`getSessionUser`, `auth.ts:32-46`). Typ `SessionUser` v `$lib/server/auth`.
- **Žiadne role.** Globálny login-guard v `hooks.server.ts` (`PUBLIC_PATHS = ['/login','/health']`);
  každý prihlásený vidí všetko. Žiadne per-user obmedzenie.
- Users vznikajú len cez `SEED_USERS` env pri prázdnej DB (`seedUsers()`, `db.ts:372-383`).
  Žiadne admin UI, žiadny runtime add-user.
- Migrácie `PRAGMA user_version`, aktuálne **v7**. `migrate()` beží pri module load.
- Zasklenia akcie: `nahlad` (spočíta, nezapíše), `odoslat`/`odoslatMulti` (Money zápis,
  gated len `MONEY_LIVE`, nie auth), `upravit` (späť). Print = `window.print()` +
  `@media print`, **oddelený od Money** (funguje v náhľade). Validácia v `vstup.ts parseVstup`
  (šírka/výška 300–20000).
- Engine: šírka jedného skla = `val(sklo_S, S, V, N) − skloOffset` (compute.ts:304);
  **N (počet polí) na sys riadku** (`cfg_sys.n`). `safeCompute` pipeline: `validSys` →
  `inBounds` → `missingHrubkaProfile` → `oversizeCut` → `computeFlat`.
- Systémy/štýly a N:
  - Robust: 2K=2, 3K=3, 4K=4, 2x2K=4, 2x3K=6, 2x4K=8
  - Slide: 2K=2, 3K=3, 2x2K=4, 2x3K=6
  - Deluxe: 2K=2, 3K=3, 4K=4, 2x2K=4, 2x3K=6, 2x4K=8, 5K=5, 6K=6
- Nav (`+layout.svelte:14-21`): pergola, bazen, zasklenia, zasklenia/nastavenia (Vzorce),
  odpisy (História), problem. Print: `+page.svelte:458/486/512/537`.

## Návrh riešenia

### 1. Rola B2B (dáta + auth)

- **Migrácia v8** (`db.ts`, idempotentná, PRAGMA-guarded):
  `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'internal'` (hodnoty
  `'internal' | 'b2b'`). Existujúci riadky → `internal` (default). `user_version = 8`.
- `SessionUser` (`auth.ts`) rozšíriť o `role: 'internal' | 'b2b'`; `getSessionUser`
  SELECT pridá `u.role`; `locals.user.role` dostupné všade. `app.d.ts` bez zmeny
  (odkazuje na `SessionUser`).
- Helper `isB2B(user)` / `isInternal(user)` v `auth.ts`.

### 2. Prístup (vynútené server-side, nie len skrytie)

- `hooks.server.ts`: **denylist** (nie allowlist — allowlist by zablokoval SvelteKit
  assety `/_app/*` → prázdna stránka). Keď `locals.user.role === 'b2b'` a cesta je
  **presne `/`** ALEBO začína ktorýmkoľvek `B2B_FORBIDDEN_PREFIXES` = `['/pergola',
  '/bazen', '/odpisy', '/problem', '/pouzivatelia', '/zasklenia/nastavenia']`
  → `redirect(303, '/zasklenia')`. Všetko ostatné (`/zasklenia`, `/logout`, `/_app/*`,
  `/favicon`, statické) prejde. `/zasklenia/nastavenia` je v denyliste (b2b needituje Vzorce),
  ale `/zasklenia` a jeho akcie prejdú. Denylist beží PO existujúcom login-guarde.
- Nav (`+layout.svelte`): keď b2b → zobraz len „Zasklenia" + Odhlásiť; skry Vzorce,
  Pergola, Bazén, História, Problém, Používatelia. Interný → plná nav + „Používatelia".

### 3. Žiadny odpis do Money pre B2B

- `+page.svelte`: tlačidlá `odoslat`/`odoslatMulti` (a súvisiaci text „odpis do Money")
  render len keď `!isB2B(data.user)`. B2B vidí náhľad + `🖨 Tlačiť / uložiť PDF`.
- `+page.server.ts`: akcie `odoslat` a `odoslatMulti` na začiatku **odmietnu b2b**
  (`if (isB2B(locals.user)) return fail(403, ...)`) — obrana do hĺbky proti ručnému POST.

### 4. Rozmerové limity (len B2B)

Nový server modul `src/lib/server/b2b-limits.ts`:

```
export const B2B_LIMITS = {
  Deluxe: { minPanel: 800, maxPanel: 1000, maxHeight: 2500 },
  Slide:  { minPanel: 800, maxPanel: 1300, maxHeight: 2500 },
  Robust: { minPanel: 800, maxPanel: 1500, maxHeight: 2600 },
}
```

- **Šírka na pole = `S / N`** (N = počet polí zvoleného štýlu; z `cfg`).
- **`checkB2BWidth(cfg, system, styl, S)`**:
  - panel = `S / N`. Ak `minPanel ≤ panel ≤ maxPanel` → OK.
  - Inak **blok + poradí štýl**: v rovnakej **rodine** (jednoduché `2K/3K/4K/5K/6K`
    vs dvojité `2x*`) daného systému nájdi štýl s N kde `S/N ∈ [min,max]`; preferuj
    najmenšie N (najmenej polí). Ak existuje → `„Pri šírke {S} a {styl} by malo pole
    {round(S/N0)} mm (max {maxPanel}). Zvoľ {suggested}."`
  - Ak žiaden štýl v rodine nesedí (mŕtva zóna medzi počtami polí) → hláška s najbližšími
    možnosťami: `„Šírka {S} sa pri {system} nedá rozdeliť na polia 800–{max} (N polí = A,
    N+1 polí = B). Uprav šírku."`
- **`checkB2BHeight(system, V)`**: ak `V > maxHeight` → **neblokuje**, vráti warning flag
  `„⚠ Výška {V} mm presahuje {maxHeight} — zasklenie BEZ ZÁRUKY."`
- Rodina zo štýlu: prefix `2x` → dvojité, inak jednoduché. Zoznam štýlov/N per systém
  z `cfg` (`listSysStyly` + N na sys riadku), nie hardcode.
- **Vynútenie v akciách `nahlad`/`nahladMulti`** (`+page.server.ts` — majú `locals.user`),
  LEN keď `isB2B(locals.user)` (nie vnútri `compute()`, ktorý `locals` nemá):
  - šírka blok → vráť `step: 'form'` s chybou (nespočíta, nezobrazí náhľad).
  - výška warning → spočítaj normálne, náhľad + PDF nesú warning banner „BEZ ZÁRUKY".
  - Multi-posuv: kontrola **per posuv** (šírka blok ktoréhokoľvek → blok celku;
    výška warning agreguje).
  - Akcie `odoslat`/`odoslatMulti` sú pre b2b už zamknuté (bod 3), takže limit netreba
    duplikovať tam.
- Klientske zrkadlo v `+page.svelte` (len b2b): pod poľami živý hint valid rozsahu /
  suggested štýl — okamžitá odozva; server je pravý guard.
- Interní users: kontroly sa **preskočia** (žiadny blok, žiadny warning).

### 5. Admin stránka „Používatelia" (len interní)

- Route `/pouzivatelia`:
  - `load`: `if (isB2B(locals.user)) redirect('/zasklenia')`. Vráti zoznam users
    (`listUsers()`: id, username, role, created_at).
  - Akcia `pridat`: username (trim, unikát, neprázdny), heslo (min 6), rola pevne `b2b`
    → `addUser(username, pass, 'b2b')` (nový `db.ts` helper cez `hashPassword`). Validácia +
    duplicitný username → chyba.
  - Akcia `zmazat`: `zmazatUser(id)` — **len b2b účty**, a **nie vlastný účet**
    (guard proti lockoutu interných). Zmaže usera + jeho sessions (CASCADE).
- `db.ts` helpery: `listUsers()`, `addUser(username, pass, role)`, `deleteB2BUser(id)`.
- Nav odkaz „Používatelia" len pre interných (bod 2).
- Password reset = mimo MVP (zmaž + pridaj znova); poznamenané.

### 6. Testy (rovnaké PR, plné pokrytie — pravidlo appky)

**Unit (`tests/`):**
- `b2b-limits.test.ts`: `checkB2BWidth` per systém — hranice 800/1000/1300/1500,
  suggested štýl (2K@3000 → 3K; 2x2K@6000 → 2x3K), mŕtva zóna (3100 Deluxe single →
  hláška), min-blok (príliš úzke → menej polí). `checkB2BHeight` — 2500/2600 hranica,
  warning text. Rodina single vs 2x.
- `auth-role.test.ts`: `isB2B`/`isInternal`, `getSessionUser` vracia role.
- `migration-v8.test.ts`: v7-fixture → v8 pridá `role` default `internal`, existujúci
  users nedotknutí, `user_version=8`.
- `users-admin.test.ts`: `addUser` (hash, unikát), `deleteB2BUser` (nezmaže internal),
  duplicitný username → chyba.

**E2E (`e2e/`):**
- B2B user: redirect z `/pergola`, `/bazen`, `/odpisy`, `/zasklenia/nastavenia`,
  `/pouzivatelia` → `/zasklenia`; nav ukazuje len Zasklenia; **žiadne tlačidlo Odoslať**;
  Spočítať + Tlačiť fungujú.
- B2B šírka blok: Deluxe 2K @3000 → chyba „Zvoľ 3K", žiadny náhľad; po zmene na 3K → náhľad OK.
- B2B výška: 2700 → warning „BEZ ZÁRUKY", náhľad + tlač fungujú.
- Interný user: pergola/bazen/odpisy/nastavenia dostupné, Odoslať prítomné, žiadny limit.
- Admin: interný na `/pouzivatelia` pridá b2b účet; ten sa vie prihlásiť a je obmedzený.

**Money-safe:** B2B nikdy nezapíše do Money (server odmietne + UI skryje). Všetky testy
bežia s `MONEY_LIVE` vypnutým; žiadny zápis do ostrého Money. Manuálne overenie na prode
len náhľadom (Spočítať/Tlačiť), NIKDY Odoslať.

## Bezpečné nasadenie (appka je v ostrom používaní)

- Migrácia v8 aditívna + idempotentná → beží na deploy pri module load, existujúce
  dáta/sessions nedotknuté.
- Feature inertný pre existujúcich (všetci `internal`) — interný tok bit-identický,
  kým nevznikne prvý b2b účet.
- Jeden PR (dev→main), plný test matrix, CI zelené, merge, deploy na VPS, post-deploy
  overenie na app.montalu.cloud: interný tok nezmenený + (po vytvorení test b2b účtu)
  b2b obmedzenia fungujú — všetko Money-safe.

## Mimo rozsahu (MVP)

- Password reset pre b2b (zatiaľ zmaž+pridaj).
- Presun `B2B_LIMITS` do editora Vzorce (zatiaľ konštanta v kóde).
- Správa interných účtov cez admin stránku (zatiaľ len B2B).
