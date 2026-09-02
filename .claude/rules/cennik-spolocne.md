---
paths:
  - 'src/lib/server/cennik-spolocne.ts'
  - 'src/lib/server/konfigurator-cena-akcia.ts'
  - 'src/lib/server/konfigurator-cena.ts'
  - 'src/lib/server/konfigurator-bazen-cena.ts'
  - 'src/lib/server/konfigurator-zimna-zahrada-cena.ts'
  - 'src/lib/server/konfigurator-oplotenie-cena.ts'
  - 'src/routes/konfigurator/pergola/+page.server.ts'
  - 'src/routes/konfigurator/bazen/+page.server.ts'
  - 'src/routes/konfigurator/zimna-zahrada/+page.server.ts'
  - 'src/routes/konfigurator/oplotenie/+page.server.ts'
---

# Zdieľané cenové helpery — `cennik-spolocne.ts` + `cenaThrottle` (#426/#428)

4 interim cenové moduly (pergola #279 / bazén #404 / zimná záhrada #408 / oplotenie #410) boli vedome
ZRKADLENÉ (#404 vzor). #426/#428 extrahovali SKUTOČNE zdieľané časti. **PRI 5. PRODUKTE ich len
IMPORTUJ, NEKOPÍRUJ** — zrkadlenie DPH aritmetiky pozývalo tichý drift, čo bol celý dôvod extrakcie.

## `src/lib/server/cennik-spolocne.ts` — Money-kritická DPH/EUR aritmetika (pure LEAF)

Exportuje: `Mriezka`, `CenaZlozka`, `EPS`, `VO_LABEL`, `eur2(net)`, `dphNaPct(dph)`,
`sDphEur(net, dphPct)`, `zlozka(net, dphPct)`, `cennikHash(cenotvorne)`. LEAF s NULOVÝMI internými
importmi (iba `node:crypto`) — cenové moduly ho importujú jednosmerne (acyklický graf, vzor
`large-file-split.md` „Pure functions: a layered façade split").

- **`sDphEur` je PARAMETRIZOVANÁ `dphPct`** (celé percentá; per modul `const DPH_PCT = dphNaPct(DPH_*)`)
  — nie viazaná na globál. DPH 23 % half-up v CENTOCH
  (`Math.round((Math.round(net*100)*(100+dphPct))/100)/100`), zrkadlí PHP `round()` na .xx5 hraniciach.
  NIKDY nezmeň na `net*1.23` (FP drift o 1 cent — celý dôvod celocentovej aritmetiky).
- Každý modul si drží tenký LOKÁLNY `zlozka(net)` obal nad importovaným `zlozka(net, DPH_PCT)`
  (`import { zlozka as zlozkaSpolocna }`) → call-sites (`zlozka(bunka[0])`) ostávajú NEZMENENÉ.
- **`cennikHash(cenotvorne)` je SENZITÍVNY na PORADIE kľúčov (JSON.stringify).** Pergola posiela
  `{cennik, priplatky, dph, mriezka}`, ostatné 3 `{cennik, dph, mriezka}` — zachovaj presné poradie,
  inak sa zmení `CENNIK_VERZIA*` (audit verzia opečiatkovanej ceny).
- Kontrakt zamyká `tests/cennik-spolocne.test.ts` + parity kotvy 4 modulov (vrátane .xx5 hraníc) —
  extrakcia bola ČISTO ŠTRUKTURÁLNA, byte-identická (žiadna zmena ceny).

## `src/lib/server/konfigurator-cena-akcia.ts` — `cenaThrottle(event, prazdno)` (vypocet shell)

Zdieľaná per-IP rate-limit predohra 4 route `vypocet` akcií: `cenaThrottle(event, prazdno)` vráti
`null` (POVOLENÉ — volateľ pokračuje parse → cena) alebo `fail(429, {...prazdno, error})`. `prazdno` =
prázdne dátové polia návratového tvaru DANEJ akcie (`{cena:null, cenyModely:null}` / `{vysledok:null}`
/ `{cena:null}`) → 429 telo je byte-identické (vrátane poradia kľúčov). Route akcia:

```ts
vypocet: async (event) => {
	const throttled = cenaThrottle(event, { cena: null, cenyModely: null });
	if (throttled) return throttled;
	const { request, locals } = event;
	// … parse → cenovaHladina → cena → return …
};
```

Testy: `tests/konfigurator-cena-akcia.test.ts` (obe vetvy + retry-after + poradie kľúčov).

## Zámerne NEEXTRAHOVANÉ (per #426/#428 design)

- **Zaokrúhlenie NA mriežku** (`zaokruhliNahor` pergola/zimná záhrada `Math.ceil` vs `zaokruhliNaMriezku`
  bazén/oplotenie `Math.round`) je per-produkt RÔZNE — ostáva PER-MODUL, drží nezávislú parity-garanciu
  každého modulu. Aj byte-identický pár bazén/oplotenie `zaokruhliNaMriezku` nechaj per-modul.
- **PLNÝ `vypocetAction(event, parse, cenaFn)`** — 4 akcie majú RÔZNE návratové tvary (pergola nesie
  `vysledok`, zimná záhrada nemá `cenyModely`) + rôzne parsery; plná únifikácia by MENILA tvary
  odpovedí (behaviorálna zmena). Zdieľa sa LEN identická throttle predohra.
