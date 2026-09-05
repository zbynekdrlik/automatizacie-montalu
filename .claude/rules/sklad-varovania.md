---
paths:
  - "src/lib/components/SkladVarovania.svelte"
  - "e2e/sklad-varovania.spec.ts"
  - "e2e/sklad-vylucenie.spec.ts"
---

# SkladVarovania — cross-module wiring (#448/#451/#461)

Predodpisové skladové varovanie so zdieľaným komponentom `SkladVarovania.svelte`
naprieč 6 modulmi (zasklenia, sietka, pergola, bazén, clip, fix/cad).

## Komponent je MIMO formulára — dáta tečú cez bindable prop

`SkladVarovania` sa na KAŽDOM module renderuje MIMO `<form>` (je sourodenec
karty s tlačidlom „Odoslať odpis"). Preto akékoľvek dáta, ktoré komponent
produkuje a server ich potrebuje, MUSIA ísť cez rodičovský hidden input:

1. Komponent exponuje `vyluceneKody` (`$bindable('')`) — comma-separated kódy
   odobratých položiek, synced z interného `odobrate` Setu cez `$effect`.
2. Rodičovská stránka binduje prop: `<SkladVarovania bind:vyluceneKody={myVar} />`.
3. Vo formulári je `<input type="hidden" name="vylucene_kody" value={myVar} />`.
4. Server parsuje `vylucene_kody` z FormData → `Set<string>` → filtruje
   `job.polozky` pred `writeOdpis`.

NIKDY nerendruj hidden input VNÚTRI komponentu — nebol by v `<form>`.

## Dva mechanizmy odobratia — oba musia byť prítomné

| Mechanizmus | Kde funguje | Ako |
|---|---|---|
| `qty_` DOM manipulation | Len moduly s editovateľnými qty inputmi (pergola, bazén, clip, fix/cad) | `odobrat()` nastaví `input[name="qty_<kod>"]` na 0 |
| `vylucene_kody` hidden input | VŠETKY moduly (universálny) | Server filtruje polozky pred writeOdpis |

Na moduloch BEZ `qty_` inputov (zasklenia, sietka) je `vylucene_kody` JEDINOU
funkčnou cestou. Na moduloch S `qty_` inputmi fungujú OBA (belt-and-suspenders).

## Pri pridaní nového modulu s SkladVarovania

1. Pridaj `let vyluceneKody = $state('')` do `<script>`.
2. Binduj: `<SkladVarovania ... bind:vyluceneKody />`.
3. Do KAŽDÉHO submit formulára pridaj `<input type="hidden" name="vylucene_kody" value={vyluceneKody} />`.
4. V serveri pridaj `parseVyluceneKody` + `vylucPolozky` (vzor: zasklenia `+page.server.ts`).
5. Filtruj `job.polozky` PRED `writeOdpis`, ALE PO `contentHash` (planHash check).

## E2E test — ZASP00002 je Robust rámový profil

Pre sklad-varovanie E2E na /zasklenia (Robust 2K) seeduj `ZASP00002` do
`data/e2e-ceny.json` so `sklad: 0`. ZASP00018 je Štandard rám (NIE Robust)
— pasca z cfg_seed.json, kde kľúč je `sysStyl` (camelCase), nie oddelené polia.
