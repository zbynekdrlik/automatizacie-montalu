---
paths:
  - "src/lib/vykres/**"
  - "src/lib/components/vykres/**"
  - "src/routes/vykresy/**"
---

# Návrhové výkresy (kóta helper, výkresový hárok) — gotchy z #137

## Route-scoped `@page` tlač cez SvelteKit route-CSS-splitting — NIE cez app.css

Landscape (alebo akýkoľvek iný neštandardný) `@page` blok patrí do `<style>` toho
KONKRÉTNEHO `+page.svelte`, nikdy do zdieľaného `app.css`. SvelteKit bundluje
komponentový `<style>` blok do route-špecifického CSS chunku — nahrá sa LEN keď
používateľ navštívi tú konkrétnu route, takže `@page` deklarácia v ňom sa nikdy
nedotkne inej stránky. Overené e2e AJ naživo (Playwright CSSOM): `/zasklenia`
zostáva `a4` (portrait, z app.css), `/vykresy/preview` má NAVYŠE `a4 landscape`
(z jej vlastného `<style>` bloku) — obe naraz existujú v dokumente, ale platí len
tá z aktuálne nahranej route.

```svelte
<style>
	@media print {
		@page {
			size: A4 landscape;
			margin: 6mm;
		}
	}
</style>
```

**CSS minifikátor pri builde ZAHADZUJE `portrait`** (je to CSS default, takže ho
minifikácia vynecháva ako nadbytočný) — `@page { size: A4 portrait; }` v zdroji
vyjde v builde ako `@page { size: a4; }`. Test/nástroj, ktorý číta vyrenderovanú
CSS a hľadá literálny reťazec `"portrait"`, NIKDY nič nenájde — kontroluj len
neprítomnosť `"landscape"` (alebo prítomnosť aspoň JEDNÉHO `@page` pravidla ako
dôkaz, že hľadanie vôbec funguje), nie prítomnosť `"portrait"`.

**CSSOM čítanie `@page` pravidiel musí REKURZÍVNE prehľadať `@media` bloky** —
`document.styleSheets[i].cssRules` vracia `@media print { @page {...} }` ako JEDEN
`CSSMediaRule` s `@page` VNORENÝM v `.cssRules`, nie ako top-level `CSSPageRule`.
Plochý (nerekurzívny) prechod `sheet.cssRules` nenájde nič a test potichu prejde
naprázdno (falošne pozitívny). Viď `e2e/navrh-vykres.spec.ts` `najdiPageSizes()`.

## SVG eliptický oblúk: sweep/largeArc flag — NEODHADUJ, over round-trip testom

Pri `A rx ry x-axis-rotation large-arc-flag sweep-flag x y` v SVG `<path d>` je
ĽAHKÉ dostať `sweep-flag` opačne — vizuálne oba výbery "vyzerajú ako oblúk", len
jeden ide správnym smerom. Neuhádzaj/neodhaduj podľa oka: over PRIAMYM výpočtom
podľa SVG spec F.6.5 (endpoint→center parameterizácia) — zo zadaných `(x1,y1)`,
`(x2,y2)`, `r`, `largeArc`, `sweep` prepočítaj stred kružnice a porovnaj so
zamýšľaným `(cx,cy)`. `tests/kota.test.ts` (`arcCenterFromEndpoints`) je hotová
referenčná implementácia tohto round-trip testu — skopíruj ju, nepíš nanovo. V
`kota.ts` (`x = cos, y = -sin` konvencia kvôli obrátenej SVG y-osi) je správna
hodnota `sweep = 0` pre "oblúk v smere rastúceho matematického uhla" — zmena tejto
konvencie (napr. inú `x/y` parametrizáciu) VYŽADUJE prepočítať sweep nanovo, nie
skopírovať `0`.

## `perpOffset` vo wrapper funkciách (`horizontalDimension`/`verticalDimension`)

Obe funkcie berú GEOMETRICKÉ body (nie už-odsadenú pozíciu) + `perpOffset` —
posunutie kolmo na smer čiary sa počíta VNÚTRI, spolu s odkazovými (witness)
čiarami. Ak pridávaš ďalší wrapper nad `lineDimension`, drž sa tejto konvencie
(geometria + `perpOffset`, nie predpočítaná offsetnutá pozícia) — inak sa
odkazové čiary nedajú dopočítať konzistentne a `Kota.svelte` (ktorý na `witnesses`
z `lineDimension`/`verticalDimension` spolieha) ich nebude vedieť vykresliť.
