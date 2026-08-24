---
paths:
  - "src/lib/datum.ts"
  - "tests/datum.test.ts"
  - "e2e/datum-vytvorenia.spec.ts"
---

# Server-side wall-clock timestamps — gotchas z #114 (dátum v hlavičke nárezáku)

## Docker image nemá TZ nastavené → defaultne beží pod UTC

`Dockerfile` (`node:24-bookworm-slim`) nikde nenastavuje `TZ`. Akékoľvek `new Date()`
formátovanie BEZ explicitnej IANA zóny (`Intl.DateTimeFormat(..., { timeZone: 'Europe/Bratislava' })`)
bude na nasadenej appke bežať v UTC — dielňa by videla čas posunutý o 1-2h (podľa
letného/zimného času) od skutočnosti. Toto sa NEPREJAVÍ lokálne na dev1 (Europe/Prague,
rovnaký offset ako Bratislava — skryje bug pri lokálnom teste) ani nutne v CI, ak runner
beží náhodou v kompatiblenej zóne — spoľahlivo sa prejaví LEN v produkčnom kontajneri.

**Vždy**: `new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Bratislava', ... }).formatToParts(d)`,
nikdy `d.getHours()`/`d.toLocaleString()` bez explicitnej zóny, keď hodnota ide na obrazovku/tlač.

## Testovanie TZ-nezávislosti: mid-process `process.env.TZ` mutácia je NESPOĽAHLIVÁ

Zmena `process.env.TZ` PO štarte Node procesu sa u tohto Node/ICU (overené priamo na dev1)
neprejaví v `Intl.DateTimeFormat` bez explicitnej zóny — Node si predvolenú zónu cachuje pri
štarte. Test, ktorý len nastaví `process.env.TZ = 'UTC'` uprostred behu a očakáva zmenu
výstupu, je FALOŠNE ZELENÝ (neodhalí chýbajúcu explicitnú zónu).

**Spoľahlivý test**: spustiť ČERSTVÝ node proces s `TZ` nastaveným PRED štartom (presne ako
Docker) a porovnať výstup:

```ts
import { execFileSync } from 'node:child_process';

const vystup = execFileSync(
	process.execPath,
	['--experimental-strip-types', '-e', "import('./src/lib/datum.ts').then(m => console.log(m.formatDatumCasSk('...')))"],
	{ cwd: import.meta.dirname + '/..', env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' }
).trim();
```

Node 24 podporuje priamy import `.ts` súborov (type-stripping bez `tsx`/`ts-node`) —
`--experimental-strip-types` funguje pre jednoduché typové anotácie (žiadny `enum`/`interface`
so zložitou syntaxou v importovanom module).

## Formát v hlavičke zobrazuje len minúty — e2e test na "iný dátum" nemôže porovnávať text na nerovnosť

Dva rýchlo po sebe idúce požiadavky takmer vždy padnú do tej istej minúty → `expect(a).not.toBe(b)`
na vykreslenom texte je flaky/nič-neoverujúci. Namiesto toho over silnejšiu vlastnosť: vykreslená
hodnota zodpovedá AKTUÁLNEMU serverovému času (porovnaj s `new Date()` naformátovaným tou istou
Intl logikou v teste, s toleranciou ~1-2 minúty na hranicu minúty/latenciu kliku) — to zachytí
regresiu typu "hodnota sa počíta raz pri štarte servera namiesto per-request", čo je presne to,
čo taký test má chrániť.

## SQLite `datetime('now')` timestamp → zobrazenie: cez `sqliteUtcToIso`, nie priamo (#282)

SQLite `datetime('now')` (napr. `dopyt.created_at`) vracia UTC v tvare
`YYYY-MM-DD HH:MM:SS` — **medzera, BEZ zóny**. `new Date('2026-08-23 12:34:56')` to JS
parsuje ako **LOKÁLNY** čas (medzera = nie ISO 8601), takže `formatDatumCasSk(created_at)`
priamo by na prod kontajneri (UTC) ukázal posunutý čas / blízko polnoci nesprávny deň —
tá istá UTC pasca ako vyššie, len z iného zdroja. Preto najprv `sqliteUtcToIso(created_at)`
(v `datum.ts`) → `...T...Z` (UTC ISO), až potom `formatDatumCasSk`/`formatDatumSk`. Vstup,
ktorý už ISO je, vráti nezmenený (most, nie parser). Nový kód, čo zobrazuje SQLite timestamp
na obrazovke/tlači, MUSÍ ísť cez `sqliteUtcToIso`.
