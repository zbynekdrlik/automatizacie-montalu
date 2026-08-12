---
paths:
  - "src/lib/vykres/**"
  - "src/lib/components/vykres/**"
  - "src/routes/vykresy/**"
  - "src/lib/pergola-navrh.ts"
  - "src/lib/components/PergolaNavrhVykres.svelte"
  - "src/routes/pergola/navrh/**"
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

## `<Kota>` s `y0===y1` (alebo `x0===x1` PRE ZVISLÚ kótu) = tichý degenerát → `each_key_duplicate`

Zadanie zhodných súradníc na oboch koncoch (typicky preklep — skopírovaný
`{y1}` shorthand namiesto `y0={y0}`) NEVYHODÍ chybu z `lineDimension` — vráti
nulovú-dĺžku geometriu, ktorej DVE witness čiary vyjdú identické (rovnaký bod,
rovnaký smer). Svelte to odhalí až za behu ako `each_key_duplicate` konzolovú
chybu v `Kota.svelte`'s `{#each geom.witnesses}` bloku — netriviálne dohľadať
spätne z chyby k príčine. Keď Kota kreslí "cez nič" alebo konzola hlási
`each_key_duplicate`, PRVÉ podozrenie: skontroluj, či `x0/y0/x1/y1` naozaj
tvoria nenulovú úsečku (#138).

## `angleDimension`'s `label` má FIXNÝ odsah `r+12` — nepoužiteľné v malej/kompaktnej scéne

`angleDimension(cx, cy, r, fromDeg, toDeg)` (kota.ts) počíta pozíciu popisku ako
`cx/cy ± (r+12)·cos/sin(stred uhla)` — konštanta `+12` je NAPEVNO v module, nedá
sa vyladiť len parametrom `r`. Vo `/vykresy/preview` deme to funguje (kresba
zaberá takmer celý hárok, 12mm je tam málo), ale v KOMPAKTNEJ scéne (viac
pohľadov na jednom hárku, každý len zlomok plochy — napr. #138 bočný rez REZ A)
môže `+12` vytlačiť popisok DESIATKY milimetrov mimo zamýšľanú oblasť (až za
okraj papiera). Vždy over `label.y` voči veľkosti svojej vlastnej oblasti PRED
nasadením; ak nesedí, POUŽI LEN `arc.arcPath` (vykresli oblúk) a popisok umiestni
RUČNE (malý pevný odsad od `cx,cy`, nie z `arc.label`).

## Playwright `toBeVisible()` na perfektne vodorovnej/zvislej SVG `<line>` = falošný FAIL

Element `<line x1 y1 x2 y2>`, ktorého jedna súradnica je na oboch koncoch ROVNAKÁ
(zvislý stĺp: `x1===x2`; vodorovný nosník: `y1===y2`), má bounding box s NULOVOU
šírkou alebo výškou — Playwright ho preto vyhodnotí ako `hidden`, hoci sa reálne
vykresľuje (viditeľný v screenshote). `toBeVisible()` na takomto prvku (napr.
`getByTestId(/post-\d/).first()`) FLAKY/vždy zlyhá. Namiesto toho over
PRÍTOMNOSŤ/POČET (`toHaveCount(N)`) — nikdy visibility-check na jednotlivom
perfektne osovo zarovnanom `<line>` (#138).

## `verticalDimension`'s `perpOffset` sign is easy to get backwards — verify with real coordinates, not by eye

Docstring says "kladné = doľava od smeru zhora nadol" (`kota.ts`), but a
flipped sign renders NO error — it just draws the dimension line/label
INSIDE the geometry it measures instead of beside it (#146: `perpOffset={-16}`
put the "3411" panel-length kóta at x=48.64mm, inside the rect `[35.64,
54.12]`; no test caught it, only a deep-review screenshot did). Before
shipping a NEW `Kota` placement, verify the ACTUAL rendered position
(`getBoundingClientRect`/raw SVG attrs via Playwright `browser_evaluate`)
against the geometry you're avoiding — don't trust "the sign looks right".

## Tight column (<~30mm) with `Kota` + adjacent text: `perpOffset` moves witness+tick+label TOGETHER — use `labelOffset` to decouple

`witnessLine`'s `gap`/`overshoot` (kota.ts, fixed 2mm/3mm, NOT exposed via
`DimensionOpts`) mean the witness's far end always reaches `perpOffset+3mm`
past the geometry point, no matter what `tick` is set to. In a narrow column
(#146's ~44mm panel-detail area: a caption AND a dimension both competing
for ~24mm of free space) a `perpOffset` big enough to clear an adjacent
text label ALSO drags the witness overshoot past the drawable region's own
edge (`oblast.x`) — two independent boundary constraints that `perpOffset`
alone can't satisfy at once. `opts.labelOffset` is a SEPARATE param (`kota.ts`
`lineDimension`, `label.x = midpoint + nx·labelOffset` — no coupling to the
witness geometry): use it to move JUST the label, e.g.
`opts={{ tick: 1, labelOffset: 0 }}` centers the label directly on the
dimension line instead of the default `-4` (which pulls it back TOWARD the
geometry — often straight back into the thing `perpOffset` just offset away
from). Verify tick span, witness far-end, AND label position separately
against the region's boundaries via raw SVG attributes — hand math is
error-prone here; #146's fix needed 3 render-verify iterations.

## Fixed `stroke-width` on a filled shape — validate against the FULL input domain, not just the demo fixture

A stroke-width constant that "leaves visible fill" when checked against ONE
sample (e.g. `OP260032`, or whatever the E2E fixture happens to use) is only
proven safe AT THAT SCALE. Any drawing whose element sizes derive from
`fitScale(...)` (this is true of every filled profile/rect in `vykres/*` —
posts, beams, panels) shrinks as the real-world dimensions grow toward the
input's own documented max (`ROZPATIE_MAX`/`HLBKA_MAX`/`VYSKA_MAX` etc. in
`pergola-navrh.ts`) — a helper's own defensive floor clamp (e.g. `stlpHalfW`'s
`Math.max(…, 0.5)`) can let the rendered shape shrink BELOW a stroke-width
that looked comfortably safe at the demo scale, silently swallowing the fill
again (#153: `STRUKTURA_STROKE=1.2mm` was safe at OP260032's ≈0.0165 scale,
but a still-valid `hlbka=6000` shrank the post to ~1.0-1.1mm — narrower than
the stroke). The existing E2E suite, which only exercises the fixed sample,
did NOT catch this — a fresh-context review that worked out the threshold
scale algebraically did. **Fix pattern:** never hardcode the stroke-width;
derive it from the shape's OWN rendered size, e.g.
`Math.min(FIXED_STROKE, rozmerPx * 0.5)` (`obrysStroke()` in
`PergolaNavrhVykres.svelte`) — guarantees visible fill at ANY valid scale,
not just the one your test fixture happens to use. When adding a NEW filled
structural shape (bazén/zasklenia or a future pergola view), either reuse
this pattern or add an E2E case at an EXTREME (but still-valid) input, not
only the standard demo values.

## 3D izometria (#138) — `$lib/vykres/iso.ts`

Generický 30° dimetrický/axonometrický projektor `{x,y,z}→{x,y}` (x=šírka,
y=výška HORE matematicky, z=hĺbka; výstup priamo v SVG y-dole súradniciach,
výška sa kreslí PRESNE zvisle). Znovupoužiteľný pre ďalší 3D náhľad (bazén/iné)
— nie je pergola-špecifický, žije preto v `$lib/vykres/`, nie v
`$lib/pergola-navrh.ts` (tam je len samotná 3D KONŠTRUKCIA pergoly — zoznam
úsečiek + kotvové body pre šípky/poznámky — postavená NAD týmto projektorom).
