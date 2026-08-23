---
paths:
  - "src/lib/vizual/**"
  - "src/lib/components/vizual/**"
  - "e2e/vizual3d.spec.ts"
  - "e2e/vizual-showroom.spec.ts"
  - "e2e/zasklenia-zakaznicky.spec.ts"
  - "tests/vizual-*.test.ts"
---

# `src/lib/vizual/**` — three.js 3D náhľad, gotchy (#170)

## WebGL capability probe NIKDY na skutočnom render canvase

`canvasEl.getContext('webgl2', {...})` na prvé zavolanie **ZAMKNE** context
attributes (antialias, alpha, atď.) pre celú životnosť toho canvasu — ak potom
`THREE.WebGLRenderer({canvas: canvasEl, antialias: tier-specifické, ...})`
vytvorí kontext s inými atribútmi, dostane tie ZAMKNUTÉ z prvej probe, nie tie,
ktoré si žiadal. Probe kvality/tieru VŽDY na samostatnom scratch elemente:

```js
const probe = document.createElement('canvas'); // NIE canvasEl
const gl = probe.getContext('webgl2');
```

## `renderer.forceContextLoss()` je NEVRATNÉ — dve odlišné cesty update vs unmount

Volanie `forceContextLoss()` a následné znovu-vytvorenie `WebGLRenderer` na
TOM ISTOM canvase padá (`TypeError` v `WebGLCapabilities`, kontext sa
nedá takto "reštartovať"). Preto DVE oddelené funkcie:

- **In-place update** (RAL zmena, preset, otvoriť/zatvoriť, akákoľvek zmena
  geometrie počas života komponentu) — `prestavGeometriuProduktu()`: zruší a
  znova postaví LEN produkt-meshe, renderer/scene/camera ostávajú živé.
- **True teardown** (skutočný unmount) — `uvolniScenu()`: volá
  `forceContextLoss()`, LEN pri odchode z komponentu.

Nikdy nevolaj `uvolniScenu()+inicializuj()` ako "rebuild" skratku pri zmene
vstupu — to je presne táto chyba.

## Zmena vstupu → geometria: porovnávaj ŠTRUKTÚRNE, nie referenciou

`zaskleniaSpec()` vždy vracia nové referencie objektov/polí (aj keď sa zmenil
len napr. `ralKod`, ktorý ovplyvňuje `poznámky`), takže referenčná rovnosť
(`===`) vždy vidí "zmenu" a spustí zbytočný plný rebuild. Použi štrukturálny
podpis (`JSON.stringify({bbox, diely})`) a porovnávaj TEN.

## `preserveDrawingBuffer` je ZÁMERNE OFF — canvas obsah sa testuje SCREENSHOTOM

Špecifikácia vyžaduje `preserveDrawingBuffer: false` (perf). Dôsledok: externé
`page.evaluate(() => gl.readPixels(...))` po `render()` číta VYMAZANÝ buffer
(je platný len bezprostredne po samotnom `render()` volaní vo vnútri appky, nie
keď doň Playwright siahne zvonka). Over netriviálny obsah cez
`page.getByTestId(testid).screenshot()` + kontrolu veľkosti PNG bajtov
(heuristika "nie je to prázdny/jednofarebný canvas"), nikdy nie
`gl.readPixels()` z testu.

## SVG `<foreignObject>` — Playwright `locator()`/`getByTestId()` naň NEREZOLVUJE

Element vnorený v `<foreignObject>` (napr. zachytený PNG vložený do
`VykresovyHarok` SVG rámu na `/zasklenia/navrh/zakaznicky`) DOKÁZATEĽNE
existuje (plain `document.querySelector` ho nájde, accessibility snapshot ho
vidí, screenshot ho ukazuje) — ale `page.locator(...).waitFor()`/
`toBeVisible()`/`toContainText()` naň NIKDY nerezolvuje. Over cez
`page.waitForFunction()`/`page.evaluate()` so surovým DOM API namiesto
bežného locator API — pozri `e2e/zasklenia-zakaznicky.spec.ts` hlavičkový
komentár + `pockajNaObrazok()`/`textObrazkovehoTestidu()` helpery ako vzor.

## Canvas veľkosť po `postavScenu()` nastav explicitne

`THREE.WebGLRenderer({canvas,...})` nemení veľkosť canvas ELEMENTU
automaticky. Spoliehanie sa len na `ResizeObserver`-ov prvý callback je
race-y (môže prísť skôr než je `ziva` nastavená) — canvas potom ostane
zaseknutý na default 300×150. Zavolaj `pripravVelkost()` explicitne HNEĎ po
`postavScenu()`.

## CI (softvérový WebGL) je výrazne pomalší než lokál pre "postav+zachyť" e2e testy

Testy, ktoré stavajú CELÚ 3D scénu na skrytom canvase a POTOM z nej
zachytávajú vysoké rozlíšenie (napr. zákaznícky tlačový list), potrebujú
`test.setTimeout(60000)` PRIAMO v tele testu — globálny `timeout: 30000`
z `playwright.config.ts` na CI runneri nestačí, aj keď lokálne aj ostatné
(ľahšie) e2e testy v tom istom behu prejdú bez problému.

## `MeshPhysicalMaterial` Beer–Lambert tint (#174) — PO KANÁLI mocnina farby, NIE exponenciála vzdialenosti; `.r/.g/.b` sú LINEÁRNE, nie sRGB

Two odlišné pasce, obe naživo spôsobili "sklo je stále mliečne/bez tintu"
aj po zmene `attenuationDistance`:

**1. Skrátenie `attenuationDistance` samo osebe je bezcenné pri bledom
`attenuationColor`.** Three.js počíta útlm cez `volumeAttenuation()`
(`node_modules/three/src/renderers/shaders/ShaderChunk/transmission_pars_fragment.glsl.js`):

```
attenuationCoefficient = -log(attenuationColor) / attenuationDistance
transmittance = exp(-attenuationCoefficient * dráhaVSkle)
             ≡ attenuationColor ^ (dráhaVSkle / attenuationDistance)
```

Toto je MOCNINA farby, nie samostatná exponenciála vzdialenosti. Pri takmer
bielom `attenuationColor` (zložky blízko 1) je `x^cokoľvek ≈ 1` bez ohľadu
na to, aké malé `attenuationDistance` zvolíš — nulový viditeľný útlm. Aby
bol útlm SKUTOČNE viditeľný pri realistickej hrúbke skla (mm rádovo),
`attenuationColor` musí byť genuinely SÝTY (nie pastelový), inak sa
"kratšia distance" v renderi prakticky nič nezmení.

**2. `THREE.Color`'s `.r/.g/.b` sú po `ColorManagement` sRGB→LINEÁRNOM
prevode (three@0.185+ defaultne zapnuté), NIE surové `hex/255` zlomky.**
`new THREE.Color(0x2f9478).r/.g/.b` NIE JE `(0x2f/255, 0x94/255, 0x78/255)`
= `(0.18, 0.58, 0.47)` — je to `(0.03, 0.30, 0.19)`, výrazne tmavšie na
každom kanáli. Prepočítavanie "ilustračných" transmitancia čísel v
komentári RUČNE zo surových sRGB zlomkov (namiesto skutočných `.r/.g/.b`)
dá čísla, ktoré vyzerajú vierohodne, ale sú chybné až 2× na kanál — presne
táto chyba sa dostala do komentára v `materialy.ts` a chytil ju až
adversariálny review (#174, issuecomment-5273628838).

**Ponaučenie:** pri písaní komentára s vypočítanými príkladovými číslami
pre čokoľvek odvodené z `THREE.Color`, buď ich počítaj cez
`new THREE.Color(hex).r/.g/.b` PRIAMO (nikdy ručne z hex bajtov), alebo —
lepšie — nehardcoduj ilustračné čísla vôbec a odkáž na unit test, ktorý
počíta skutočnú hodnotu priamo z materiálu (`tests/vizual-materialy.test.ts`
to robí správne cez `mat.attenuationColor[k]`).

## "Jednotka sa vznáša" (#174 ZNOVUOTVORENÉ) — NIKDY nepredpokladaj Y-posun,
## over ho ČÍSLAMI; skutočná príčina bola X/Z tvar kontaktného tieňa

Naживo vyzeralo, že jednotka "levituje" nad dlažbou (viditeľná medzera,
odpojená tieňová elipsa). Prirodzený prvý dohad — niečo má zlé svetové Y
(skupina posunutá, zem pod nulou, kamera vytvára zdanlivý posun) — bol
DOKÁZATEĽNE nesprávny: `postavGeometrie()`/`vytvorZem()`/`vytvorStenu()` sa
dajú zavolať priamo v Node (Vitest) bez canvasu (žiadny WebGL potrebný na
STAVBU geometrie, len na `renderer.render()`), takže Y-hypotézu over TAKTO
PRED akýmkoľvek predpokladom o kamere/FOV. Skutočná príčina bola X/Z tvar/
pozícia kontaktného tieňa (`vytvorKontaktnyTien`, `scena.ts`) — kruhový
radiálny gradient na ŠTVORCOVEJ ploche podľa `Math.max(w,d)`, ktorý pri
širokej/plytkej jednotke (pomer strán ~28:1) nedosiahol tvrdým jadrom ku
koncom koľajnice, PLUS X/Z posun celej roviny v smere svetla (fyzikálne
správne pre vrhnutý tieň, nesprávne pre kontaktný dekal — ten musí byť
VŽDY centrovaný na skutočnom pôdoryse).

**Naživo scene-introspekcia bez prestavby appky** — keď numerický Node test
nestačí (treba OVERIŤ, čo appka SKUTOČNE vykresľuje, nie čo by mala): dočasne
pridaj `(globalThis).__VIZDEBUG = ziva;` hneď po `ziva = postavScenu(...)` v
`Vizual3D.svelte` (`inicializuj()`), potom v Playwright `page.evaluate()`
volaj `window.__VIZDEBUG.scene.traverse(...)` a čítaj `mesh.position`/
`geometry.boundingBox` priamo zo živého rendereru. REVERTNI pred commitom —
toto je len diagnostický hák, nikdy sa nemerguje.

**Canvas/`document` polyfill pre testovanie `scena.ts` mimo `low` tieru** —
`vytvorKontaktnyTien` VŽDY volá `vytvorKontaktnyTienTexturu` (canvas 2D),
nezávisle od tieru (na rozdiel od `vytvorZem`/`vytvorStenu`, ktoré `low` tier
obíde plochou farbou). Testovanie POZÍCIE/GEOMETRIE (nie obsahu pixelov) v
Node vitest (žiadny jsdom v repe) potrebuje minimálny no-op stub —
`document.createElement('canvas')` vracajúci objekt s `getContext('2d')` →
objekt s no-op `createLinearGradient`/`createRadialGradient`/`fillRect`/
`createImageData`/`putImageData`. Viď `tests/vizual-scena.test.ts`'s
`FakeCanvas`/`FakeCtx` — bezpečné pre pozičné testy, NEPOKRÝVA skutočný obsah
textúry (to zostáva #177 follow-up).

**`jadroR`/`stred` v `vytvorKontaktnyTienTexturu` sú FRAKCIE CELEJ šírky
canvasu, nie polovice** — `jadroR = rozlisenie×0,24` je polomer v PIXELOCH
z `rozlisenie×rozlisenie` canvasu; pri UV mapovaní 0..1 na CELÚ rovinu sa
world-space polomer rovná `0,24 × CELÁ strana roviny` (nie `0,24 ×
polovica`). Presne TÁTO chyba (násobenie polovičným rozmerom namiesto
celým) sa dostala do prvého komentára tohto PR-u a chytil ju až
adversariálny review (#181) — rovnaká trieda chyby ako sRGB/lineárny gotcha
vyššie: over PRIAMYM prepočtom (`jadroR/rozlisenie × plná_strana_mm`),
nikdy netvrď frakciu "×2" alebo "z polovice" bez prepočtu.

## Testovanie `textury.ts` (procedurálne CanvasTexture) — NAHRÁVACÍ stub, nie no-op (#177)

`tests/vizual-scena.test.ts`'s `FakeCanvas`/`FakeCtx` je zámerne NO-OP (testuje
len POZÍCIU/GEOMETRIU meshov postavených NA textúre, obsah canvasu mu je
jedno). Na otestovanie SAMOTNÝCH `textury.ts` generátorov (aké farby/rozmery/
gradient vyprodukovali — presne toto #177 žiadalo) treba NAHRÁVACÍ stub:
`FakeCtx` ukladá `createLinearGradient`/`createRadialGradient` argumenty +
vrátený `FakeGradient`'s `addColorStop` páry + `fillRect` argumenty (vrátane
`this.fillStyle` v čase volania) + `putImageData`'s posledný `ImageData`.
Viď `tests/vizual-textury.test.ts`.

**`THREE.CanvasTexture`'s `.image` drží presne canvas, ktorý dostala do
konštruktora** (`three/src/textures/{Texture,CanvasTexture}.js`: `this.image
= image`) — takto sa dá z VRÁTENEJ `Texture` vytiahnuť náš `FakeCanvas` a
jeho nahratý `FakeCtx` bez toho, aby generátor musel čokoľvek exportovať
navyše: `const canvas = tex.image as FakeCanvas; const ctx =
canvas.getContext('2d');`.

**`needsUpdate` na `THREE.Texture` je LEN SETTER (žiadny getter)** —
`tex.needsUpdate` sa VŽDY vráti `undefined`, aj keď bol nastavený `true`
(`three/src/textures/Texture.js`: `set needsUpdate(value) { if (value ===
true) { this.version++; ... } }`, žiadny `get`). Over `tex.version >
0` namiesto toho.

**`vytvorDlazbuTexturu`/`vytvorStenuTexturu` používajú `Math.random()`**
(jitter/šum) — pre DETERMINISTICKÝ test na fixný `vi.spyOn(Math,
'random').mockReturnValue(<hodnota>)`, VŽDY v `try { … } finally {
spy.mockRestore(); }` (reštart musí prebehnúť aj keď assertion zlyhá, inak
zostane zmockovaný `Math.random` unikať do ĎALŠÍCH testov v tom istom
súbore). `vytvorOblohuTexturu`/`vytvorKontaktnyTienTexturu` sú čisto
deterministické už samy osebe (žiadny `Math.random`), netreba mockovať.

## `THREE.Light` farba/intenzita read-back — `getHex(SRGBColorSpace)`, nie bez argumentu

Na overenie, že `new THREE.DirectionalLight(0xfff4ea, 2.4)`/
`HemisphereLight(sky, ground, i)` dostali presne tie hex hodnoty, ktoré im
boli zadané: `light.color.getHex(THREE.SRGBColorSpace)` (round-trip presne
naspäť na pôvodný hex) — VOLANIE BEZ ARGUMENTU aplikuje implicitnú
colorspace konverziu a hodnota sa nezhoduje. `HemisphereLight` má navyše
`.groundColor` (rovnaký `getHex(SRGBColorSpace)` postup). Pri pozičných
svetlách (kľúčové svetlo §2.6 — FIXNÉ NAVŽDY, azimut/elevácia/vzdialenosť)
prepočítaj OČAKÁVANÚ pozíciu z DOKUMENTOVANÝCH hodnôt priamo v teste
(nezávislý `Math.cos`/`Math.sin` výpočet), nikdy len re-importuj
implementáciu — inak test nezachytí budúcu tichú zmenu konštánt.

## Rozšírenie vizuálu na NOVÚ produktovú rodinu (pergola #276) — vzor

Generická pipeline (`scena`/`kamera`/`builder`/`materialy`/`snimka`/`kvalita` +
`Vizual3D.svelte`) je **product-agnostic** — berie `VizVysledok`/`bbox`, nič
zasklenia-špecifické. Nová zákaznícka rodina = **reuse, neprepisuj**:

1. **Nový čistý `geo/<rodina>.ts`** (mm, THREE-free) → `VizVysledok`. Roly
   **reuse** (`ram` = kov/konštrukcia, `sklo` = sklo) → 0 zmien `spec.ts`,
   `builder.ts` ani render vetvy vo `Vizual3D.svelte` (tá kreslí len známe roly).
   Rozmery/uhly ber z APPKOVÝCH helperov (`pergola.ts` reuse `stlpyZPolí`/
   `vypocitajSklon`/`defaultPanelSirka` z `$lib/pergola-navrh`) — NIKDY paralelný
   prepočet (rovnaká disciplína ako `geo/zasklenia.ts` s `deliaceStlpiky`).
2. **Nový wrapper komponent** (`VizualPergolaZakaznik.svelte`) nad `Vizual3D` —
   čistý props kontrakt + presety/RAL/sklo chipy + PNG export (`exportujPNG`/
   `stiahniPNG` reuse `Vizual3D.zachytObrazok` → `snimka.ts`). Presety NEparametrizuj
   (mení `PresetKluc`/`bind:preset` naprieč Vizual3D+Vizual3DPanel = široký blast
   radius do #170); existujúce 3 presety + orbit polar limity (max ~67° elevácie)
   stačia, auto-fit rámuje podľa bboxu.
3. **Nová vizuálna schopnosť = ADITÍVNY optional prop**, spätne kompatibilný
   (`skloVzhlad` na `Vizual3D`, undefined = pôvodné zasklenia sklo). Živá zmena
   materiálu = mutácia + effect (analógia `prekresliRAL`/`nastavRAL` → `nastavSkloVzhlad`);
   defaulty pôvodného skla drž v ZDIEĽANÝCH konštantách, aby sa `vytvorSkloMaterial`
   a `nastavSkloVzhlad` nerozišli.

**Sklonený diel (strecha):** box s `rot: {x: alfa}` — `builder.postavGeometrie`
aplikuje `rotateX` PRED `translate`, takže `alfa = atan((SV−FV)/H)` sklopí `+Z`
koniec dole (predok, `y=FV`) a `−Z` koniec hore (stena, `y=SV`). `sin(alfa)·roofLen
= SV−FV`, `cos(alfa)·roofLen = H` → over rot.x PRIAMO v pure Node teste (žiadny
canvas/THREE potrebný na `DielSpec`).

**Money-guard:** nová `vizual/**` rodina smie importovať len allowlistované
ne-vizual moduly (`$lib/pergola-navrh`, `$lib/vykres/ral`, `$lib/vykres/kota`);
`$lib/pergola-navrh` už v allowliste `tests/vizual-money-guard.test.ts` bol
(autor #170 pergola reuse anticipoval). Nový allowlist zápis len s dôvodom.

## Showroom kvalita (#285) — HDRI/IBL, dielektrický hliník, reálne tiene, deprecated three API

**Práškovaný hliník = DIELEKTRIKUM, nie kov.** `vytvorHlinikMaterial`/`nastavRAL`
majú `metalness: 0` (nie 0.82), `roughness ~0.35`, `clearcoat ~0.3`. Práškovanie
je pigmentovaný LAK — svetlo sa odráža od farebnej vrstvy difúzne, nie kovovým
zrkadlom. Clearcoat dodá jemný farbou-NEzafarbený odlesk HDRI. `metalness 1`
čítalo ako chróm (slabina, ktorú rešerš #276 vytkla SalesQueze). Testy zamykajú
`metalness === 0` na oboch cestách (vytvor + nastavRAL prepnutie).

**HDRI/IBL z VLASTNÉHO originu, NIKDY runtime fetch.** `static/hdri/*.hdr`
(Poly Haven CC0, 1k ~1,4 MB — 1k stačí, PMREM aj tak rozmaže) sa lazy-loaduje
cez `HDRLoader` (`scena.ts::nacitajHDRI`, `hdriUrl(base)`) len na mid/high tieri.
`vytvorEnvironment` má DVOJITÝ graceful fallback na procedurálny `RoomEnvironment`:
(1) load error → `nacitajHDRI` vráti null; (2) `pmrem.fromEquirectangular` throw
(GPU quirk) → tichý try/catch. Oba TICHÉ (žiaden console výstup) — scéna sa nikdy
nezhodí kvôli vizuálnemu assetu a E2E zero-console drží. Vstupná HDR DataTexture
sa disposuje bezpodmienečne vo `finally`; PMREM env textúra ostáva v `disposables`.
Toto je vedomé uvoľnenie §4 „žiaden binárny obrázok v repe" (majiteľ schválil v #285).

**three r0.185 DEPRECATED API — chytené LEN živým renderom (E2E asertuje 0 warningov):**
- `RGBELoader` je deprecovaný alias (extends `HDRLoader`, waruje v konštruktore)
  → importuj `three/examples/jsm/loaders/HDRLoader.js` `{ HDRLoader }` priamo.
- `PCFSoftShadowMap` je deprecovaný (renderer waruje + aj tak spadne na
  `PCFShadowMap`) → `renderer.shadowMap.type = THREE.PCFShadowMap` + mäkkosť cez
  `light.shadow.radius`. `svelte-check`/`vitest` tieto NEchytia (sú runtime three
  warningy) — over ich ŽIVÝM renderom, nie len typmi.

**Reálne cast-shadow tiene (mid/high tier).** `renderer.shadowMap.enabled =
nastavenia.tiene`, kľúčové svetlo `castShadow` cez `nastavKluceoveSvetloTien`
(ortho frustum podľa bboxu, cieľ na strede produktu, `scene.add(key.target)` je
POVINNÉ — inak tieň mieri na 0,0,0). Hliník cast+receive, sklo len receive
(transmisné by vrhalo nefyzikálny nepriehľadný tieň), zem/stena receive.
**Shadow frustum sa dimenzuje RAZ pri mounte** (ako kontaktný dekal/stena/kamera
auto-fit) — `prestavGeometriuProduktu` (otvoriť/zatvoriť) mení len pozície, nie
obálku. Live zmena ROZMEROV bez re-mountu by potrebovala prestavať celú scénickú
výbavu spolu (pre-existujúce #170/#174 obmedzenie, nie #285).

**Tone mapping = `NeutralToneMapping`** (nie ACES/AgX) — kritérium je vernosť RAL
farieb (predajný konfigurátor). Khronos PBR Neutral necháva base farbu nejasových
plôch nezmenenú; AgX desaturuje celý rozsah. Jednoriadková zmena, keby review po
živom renderi preferoval AgX.

**Vizuálna verifikácia v build-only lane:** `vite dev` (dev server, NIE zakázaný
`vite build`/preview-build) + Playwright MCP → login (native-setter driven form,
viď `testing.md`) → `/zasklenia/navrh?viz=high|mid|low` (vynúti tier) → over
`data-viz-ready=true`, `__VIZ_CONTEXTS===1`, screenshot, console warnings. Toto
chytilo obidva deprecation warningy PRED CI. `?viz=` vynúti tier bez ohľadu na HW.

## Supersample strop 2× na softvérovom WebGL (SwiftShader CI) — per-dimension limity KLAMÚ (#290)

`MAX_TEXTURE_SIZE`/`MAX_RENDERBUFFER_SIZE` na SwiftShader hlásia 16384, ale
softvérový renderer má malý CELKOVÝ alokačný rozpočet — 3× supersample
(7200×4860 MSAA buffer) padne: `glRenderbufferStorageMultisample: Texture total
allocation size is too large` → `Framebuffer is incomplete` → GL warningy →
zero-console E2E assert zlyhá. 2× (4800×3240) je dokázane bezpečné.
Preto `supersampleFaktor(..., softverovyRenderer)`: 3× LEN na potvrdenom
hardvéri (`jeSoftverovyRenderer(UNMASKED_RENDERER)` cez
`WEBGL_debug_renderer_info`), fail-safe default = softvér → strop 2×.
NIKDY nerozhoduj kapacitu bufferov z per-dimension GL limitov samotných.
