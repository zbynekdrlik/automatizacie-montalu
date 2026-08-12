---
paths:
  - "src/lib/vykres/**"
  - "src/lib/components/vykres/**"
  - "src/routes/vykresy/**"
  - "src/lib/pergola-navrh.ts"
  - "src/lib/components/PergolaNavrhVykres.svelte"
  - "src/routes/pergola/navrh/**"
  - "src/lib/zasklenia-navrh.ts"
  - "src/lib/components/ZaskleniaNavrhVykres.svelte"
  - "src/routes/zasklenia/navrh/**"
  - "src/lib/bazen-navrh.ts"
  - "src/lib/components/BazenNavrhVykres.svelte"
  - "src/lib/components/vykres/PodpisovaLista.svelte"
  - "src/routes/bazen/navrh/**"
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

## RAL farebná logika žije v `$lib/vykres/ral.ts` (#162), nie v `pergola-navrh.ts`

Rovnaký precedens ako `iso.ts` vyššie: `RAL_PALETA`/`farbaKonstrukcie`/
`ciarovaFarba`/`VykresRezim` boli pôvodne v `pergola-navrh.ts` (#150), ale sú
generické (nič pergola-špecifické) — od #162 (zasklenia návrh, druhý konzument)
žijú v `$lib/vykres/ral.ts`. `pergola-navrh.ts` ich re-exportuje POD PÔVODNÝMI
menami (`RAL_PALETA`, `PergolaVykresRezim`, `PERGOLA_REZIM_DEFAULT`, …), takže
existujúce importy sa nemenili. Nový konzument (tretí návrhový výkres) importuje
priamo z `$lib/vykres/ral.ts`, nikdy cez `pergola-navrh.ts`.

## `getByTestId` na outer `<g>` wrapper A vnútornom prvku s TOU ISTOU hodnotou = strict-mode violation

Keď `content` snippet obalí pod-pohľad do `<g data-testid="zn-x">{@render
podpohlad(...)}</g>` (bežný vzor — `pn-elevation`/`pn-section`/… v pergole,
`zn-elevacia`/`zn-klin`/… v zaskleniach), a TEN SAMÝ podpohľad má vo svojom
vnútri PRESNE JEDEN `<text>`/`<rect>`/… element, je LÁKAVÉ dať tomu vnútornému
elementu ROVNAKÝ `data-testid` ako má outer `<g>` (najmä keď sa snippet volá
napr. `ralText` a jeho JEDINÝ element je ten "RAL" text). Playwright's
`getByTestId` vtedy resolvne OBOM (g aj text majú rovnaký atribút) →
`strict mode violation: resolved to 2 elements` na `toHaveText()`/podobných
asserciách vyžadujúcich presne jeden match (#162, `zn-ral` kolidovalo, opravené
na outer `zn-ral` / inner `zn-ral-text`). Vzor, ktorý sa v tomto module už
dodržiava a treba ho dodržať aj pri NOVÝCH pod-pohľadoch: outer `<g>` dostane
"kategóriový" testid (`zn-klin`, `zn-elevacia`), KAŽDÝ vnútorný element
dostane VLASTNÝ, odlišný (typicky `-text`/`-obrys`/`-v1`/… suffix) — nikdy tú
istú reťazcovú hodnotu na dvoch úrovniach vnorenia.

## Popisok `<Kota>` MUSÍ čítať zo skutočne NAKRESLENEJ geometrie (poľa), nikdy priamo z formulárových polí (#139)

Keď sa geometria počíta do POĽA (napr. `sekcieVysky()` v `bazen-navrh.ts`,
kaskáda výšok sekcií) a kresba potom vykresľuje AJ dimenzujúcu `<Kota>` pri
krajných prvkoch, popisok kóty musí čítať `pole[0]`/`pole[pole.length-1]`
(presne to, čo sa fyzicky nakreslilo), NIKDY priamo `vstup.hodnotaA`/
`vstup.hodnotaB`, ktoré do výpočtu poľa vstupovali. Dôvod: okrajové prípady
funkcie (napr. `sekcieVysky(1, vyskaMax, vyskaMin)` pri JEDNEJ sekcii vráti
LEN `[vyskaMax]` — druhý vstup sa vôbec nepoužije, lebo jedna sekcia
nekaskáduje) môžu vyrobiť pole, kde krajná hodnota NESEDÍ s pôvodným
formulárovým poľom. Priame čítanie z `vstup.*` v tomto prípade vytlačí kótu s
TEXTOM, ktorý nezodpovedá NAKRESLENEJ dĺžke čiary (review nález #139 — 1
sekcia, `vyskaMax≠vyskaMin`, čiara dlhá `vyskaMax`mm ale popisok ukazoval
`vyskaMin`). Fix je vždy čítať z výstupu geometrickej funkcie, nikdy zo
surového vstupu, ktorý do nej vošiel.

## Ručný override MUSÍ posunúť aj POZÍCIU (nie len popisok kóty) — inak kóta meria niečo iné, než je nakreslené (#139)

Keď formulár ponúka ručný prepis jednej hodnoty (napr. `sirkaSekcieOverride`
— appka nepozná skutočné vnorenie sekcií, viď kóty šírky sekcie vyššie v tomto
súbore), NESTAČÍ poslať override LEN do `<Kota text={fmtMm(override)}>` a
nechať POZÍCIU (hranicu/deliacu čiaru) nezmenenú na schematickom rovnomernom
delení — vizuálne to vyzerá, akoby kóta merala nakreslenú hranicu, ale číslo,
ktoré ukazuje, je INÉ (OP260027 vzor: reálna prvá sekcia 2140mm, schematické
delenie 10500/5=2100mm). Fix (`sekciePozicie()`'s 3. voliteľný parameter):
override MUSÍ posunúť SKUTOČNÚ hranicu vo výpočte pozícií, zvyšná dĺžka sa
rovnomerne rozdelí medzi ostatné (stále schematické) sekcie — kóta a kresba
potom ukazujú TÚ ISTÚ vec.

## Text-blok vedľa pečiatky: zúženie REGIÓNU nič nevynucuje — treba `<clipPath>` (#139)

Keď voľnotextový blok (napr. textový popis MODEL/VÝPLŇ/…) zdieľa hárok s
`titleBlock` (pečiatka, bottom-right roh) a jeho pravý okraj sa numericky
zhoduje s pravým okrajom pečiatky (`region.x + region.w === oblast.x +
oblast.w === tbX + tbW`), NESTAČÍ len zúžiť `region.w` tak, aby končil pred
`tbX` — SVG `<text>` nie je orezaný podľa "regiónu", ktorý mu len určuje
POZÍCIU, nie hranicu renderovania. Dlhá voľnotextová hodnota (max-length pole,
napr. 60 znakov) sa môže vykresliť ĎALEKO za `region.w` a skončiť POD
nepriehľadnou bielou pečiatkou (`TitleBlock.svelte` má vlastný `fill="#fff"`
rám, ktorý prekreslí čokoľvek pod sebou). Fix: pridaj `<clipPath>` (rovnaká
technika ako `TitleBlock.svelte`'s per-pole clip rects, `uid` z
`$props.id()` proti kolízii viacerých inštancií na stránke) OKOLO textového
bloku, veľkosťou zodpovedajúci zúženému regiónu — tá HRANICU renderovania
skutočne vynúti.

## `podpisovaLista` (#139) — nová opt-in vlastnosť `VykresovyHarok`, vzor pre ďalší podobný prvok

Signatúrna lišta dielne ("Rezal/Opracoval/Kompletoval/Balil-Gumoval") sa
kreslí PRIAMO cez `VykresovyHarok` (nie cez konzumentov `content` snippet) —
rovnaký precedens ako `titleBlock`: opt-in prop (`podpisovaLista?: boolean`,
default `false`), pozícia zrkadlová k pečiatke (top-right namiesto
bottom-right rohu kresliacej oblasti). Konzument, ktorý ju zapne, si MUSÍ vo
vlastnom `content` layoute vynechať zodpovedajúci roh (presne rovnaká
disciplína ako "vynechaj roh s pečiatkou" pri `titleBlock`) — `VykresovyHarok`
sám o sebe layout konzumenta nijako neobmedzuje/nekliparuje. Ďalší podobný
"hárkový" (nie kresebný) prvok pridávaj rovnakým vzorom: nová opt-in prop na
`VykresovyHarok`, vlastný malý komponent v `$lib/components/vykres/`, default
`false` (existujúci konzumenti sa nemenia).
