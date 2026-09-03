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

Naživo vyzeralo, že jednotka "levituje" nad dlažbou (viditeľná medzera,
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

**KRITICKÉ (#325): PRODUKTOVO-ŠPECIFICKÁ scénická výbava sa MUSÍ gatovať za prop —
`Vizual3D` je ZDIEĽANÝ (pergola `VizualPergolaZakaznik` AJ zasklenia `Vizual3DPanel` +
`/zasklenia/navrh*`).** #325 pridalo pergola „dom" (dvere/okno) a napojilo `vytvorDom`
BEZPODMIENEČNE do `postavScenu` → dom sa renderoval aj vo VŠETKÝCH zasklenia scénach a
fyzicky prenikal cez sklo produktu (chytil to až adversariálny review, NIE testy —
zasklenia 3D nemá geometrickú kolíznu kontrolu). Vzor opravy: boolean prop na `Vizual3D`
(`zobrazDom = false`), pravdu posiela LEN produktový wrapper, ktorý tú výbavu chce; a
zmena zdieľanej factory (`vytvorStenu` dostalo `sDverami` režim) musí ZACHOVAŤ pôvodné
správanie pre ostatné rodiny (default = staré). Pred pridaním AKEJKOĽVEK ne-generickej
geometrie do `postavScenu` over `grep -rl Vizual3D src --include=*.svelte` — koľko rodín
ju zdieľa.

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

## AR náhľad + GLB export — ODOBRATÉ (#337)

**AR (`<model-viewer>`, `@google/model-viewer`) + serverový GLB export (`glb.ts`,
`filereader-polyfill.ts`, endpoint `/konfigurator/model.glb`, stránka `/konfigurator/ar`)
boli KOMPLETNE odstránené v #337** (owner „zapis si issue odobrat ten AR"). model-viewer
vendoroval vlastný three, takže žil na samostatnej stránke; celé to je preč. Ostáva LEN
projektový three@0.185 3D náhľad na `/konfigurator` (#276/#325). Ak by sa AR niekedy
vracalo, obnov model-viewer/GLB vzor z histórie #286/#337 (multi-instance-three pasca:
model-viewer NIKDY na tej istej stránke ako projektový three — dva `THREE.WARNING`
= zero-console E2E padne).

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

## Post-processing leštiaci layer (#288) — EffectComposer, softvérový gate, detect-gpu ekvivalent

**Three-native `EffectComposer`, NIE pmndrs/postprocessing.** Pipeline (`postproc.ts`
`vytvorComposer`): `RenderPass → GTAOPass (ground-truth AO) → UnrealBloomPass (jemný,
len high) → OutputPass → SMAAPass`. Dôvod voľby: renderer je **on-demand** (žiadny 60fps
loop — `tikaj()` sa sám ukončí), takže jediná výhoda pmndrs/postprocessing (zlučovanie
passov pre per-frame perf) sa NEUPLATNÍ, kým jej cena (~100 KB+ bundle + nová závislosť na
mobil-first verejnej route) áno. GTAO je three-native ekvivalent N8AO.

**Poradie passov je load-bearing pre RAL vernosť.** Medzipassy renderujú do offscreen
HalfFloat targetu (linear — three tam tone mapping NEaplikuje). `OutputPass` je JEDINÉ
miesto tone-mappingu a **číta `renderer.toneMapping`** (`OutputPass.js` má
`NEUTRAL_TONE_MAPPING` define) → `NeutralToneMapping` z #285 ostáva → RAL farby sedia.
`SMAAPass` je POSLEDNÝ (renderToScreen) — AA na výslednom tone-mapnutom sRGB (na to je
navrhnuté), NIE pred OutputPass. Dvojité tone-mapovanie sa nedeje (medzipassy sú offscreen).

**`composer.dispose()` NEuvoľní render targety passov** — uvoľní LEN interné read/write
targety + copyPass. GTAO/bloom/SMAA majú vlastné targety → `vytvorComposer` si drží pole
passov a `dispose()` volá `pass.dispose?.()` na KAŽDOM pred `composer.dispose()`. Bez toho
GPU pamäť unikne pri každom unmount/context-lost (leak test `__VIZ_CONTEXTS===1` by to
nezachytil — počíta WebGL kontexty, nie targety).

**SOFTVÉROVÝ gate (#290 pokračovanie) — composer LEN na HARDVÉRI.** `postprocPovoleny`
(kvalita.ts) = `nastavenia.postproc` (mid/high) A `!jeSoftverovyRenderer(renderer)`.
SwiftShader (CI/lokálny headless Chromium) má malý CELKOVÝ alokačný rozpočet — viac-RT
post-processing tam RISKUJE incomplete framebuffer. Preto composer cieli na REÁLNE
zákaznícke GPU; softvérový/CI render ide **nezmenenou priamou cestou** (`renderer.render`)
→ 0 regresie existujúcich mid/high E2E na SwiftShaderi. Konštrukcia composera je v
`try/catch` s TICHÝM fallbackom na priamy render (vzor #285 HDRI). **Snapshot (`snimka.ts`)
ostáva PRIAMY render** — tlačový PNG @2–3× cez GTAO/bloom mip-reťazec by riskoval #290
alokáciu aj na hardvéri; supersample downscale dáva dosť AA.

**`jeSoftverovyRenderer` sa presunul zo `snimka.ts` do `kvalita.ts`** (jediný zdroj pravdy
klasifikácie renderer-stringu — zdieľa ho supersample strop, GPU-tier detekcia AJ postproc
gate). `snimka.ts` ho re-exportuje (existujúce importy + testy funkčné).

**detect-gpu EKVIVALENT (nie knižnica).** `klasifikujGpu(renderer)` — kurátorská tabuľka
slabe/mobilne/integrovane/diskretne/neznamy z `UNMASKED_RENDERER_WEBGL`. `detekujTier`
používa reálny GPU ako PRIMÁRNY mid-vs-high signál (namiesto CPU-jadrá/DPR viewport
heuristiky), s fallbackom na pôvodnú heuristiku pri `neznamy`. **Prečo nie knižnica
`detect-gpu`:** default `getGPUTier()` fetchuje benchmark DB z CDN = externý runtime fetch
→ poruší Money-guard (`zbierajExterneRequesty` → `[]`), plus stovky KB na mobil-first route.
Ekvivalent = 0 závislosti, 0 fetchu, pure + testovateľné. `SLABE_GPU_RE` zmenené na
`/Mali|Adreno\D*[1-5]\d\d\b|PowerVR/i` (`\D*` znáša reálny „Adreno (TM) 4xx"), zachováva
`Adreno 330→low`/`Adreno 660→nie` (zamknuté vo `vizual-kamera-kvalita`).

**Softvérový lokálny Chromium NEUKÁŽE composer živo** — Playwright na headless boxe hlási
`ANGLE (Google, ... SwiftShader ...)`, takže gate composer vypne (`data-viz-postproc="false"`).
Na živé A/B (GTAO/SMAA/bloom vs priamy render) DOČASNE forceni composer window flagom
(`__VIZ_FORCE_POSTPROC` v gate riadku `inicializuj`), over screenshotom + 0 console, a
**REVERTNI pred commitom** (vzor `__VIZDEBUG`). Overené: composer sa na SwiftShaderi pri
screen-res postaví + renderuje bez GL warningu (viditeľne hladšie hrany + kontaktné AO),
sklo (transmission) sa vykreslí IDENTICKY (žiadne composer artefakty). Trvalý diagnostický
atribút `data-viz-postproc` (paralela `data-viz-ready`) → E2E `overPostprocGate` overí, že
na softvéri je gate OFF (regresný guard #290).

**Review-driven gotchy (#288 adversariálny review):**

- **GPU renderer-string klasifikácia — `(TM)` tolerancia UNIFORMNE + integrované-s-diskrétnym-
  menom PRED diskrétnym testom.** Android/Windows hlásia „(TM)" medzi menom a číslom (`Adreno
  (TM) 660`, `Radeon (TM) RX 480`, `Arc(TM) Graphics`) — každý vendor regex musí použiť `\D*` /
  `(?:\s*\(TM\))?`, nielen Adreno. A POZOR na integrované GPU s „diskrétnym" menom: AMD APU
  „Radeon Vega N Graphics", Intel Core Ultra „Arc(TM) Graphics" (bez Ax/Bx modelu), NVIDIA entry
  „GeForce MX/GT" — MUSIA sa chytiť PRED diskrétnym pravidlom (`INTEGROVANE_IGPU_RE` v
  `klasifikujGpu`), inak dostanú najťažší tier na tenkom zariadení. Diskrétny Arc/Vega sa odlíši
  modelom/absenciou „Graphics" suffixu. `\bXe\b` (nie `Xe`) aby „Xeon" neprešlo Intel iGPU pravidlom.
- **Optional LAZY CHUNK import potrebuje VLASTNÝ `.catch(()=>null)`** — `try/catch` okolo
  KONŠTRUKCIE composera nezachytí zlyhanie `await import(...)` pass modulov (samostatný chunk,
  flaky mobil). Bez `.catch` padne import do vonkajšieho catchu `inicializuj` → `tier='none'` →
  zákazník stratí CELÝ náhľad. Graceful-degrade optional asset PRESNE ako `nacitajHDRI` (→ null).
- **Snapshot `finally` obnoví obrazovku PRIAMYM `renderer.render()`** (bez composera) — po
  `zachytObrazok` treba composer-aware `render()`, inak na hardvéri obrazovka po PNG exporte
  stratí GTAO/SMAA/bloom do ďalšej interakcie (on-demand engine sám neprekresľuje).
- **Composer továreň (`vytvorComposer`) je testovateľná FAKE ctormi** — berie všetky THREE
  ctory injekciou, takže build vetvy + leak dispose slučka sa overia bez WebGL (`tests/vizual-
  postproc.test.ts`, 100 %). NEVYLUČUJ ju z coverage ako `snimka.ts` (tá má reálny `gl.readPixels`).
- **Slovenské komentáre: pozor na CYRILLIC HOMOGLYFY + soft hyphen (U+00AD).** Prekliky pri
  písaní vsunú Cyrillic `е`/`о`/`живо` čo VYZERÁ ako Latin ale rozbije grep. Skenuj pred commitom:
  `python3 -c "import re,sys; [print(f,i) for f in sys.argv[1:] for i,l in enumerate(open(f),1) if re.search(r'[Ѐ-ӿ­]',l)]" <súbory>`.

**Integrácia paralelných vizual lanes (poučenie #288↔#290/#291).** Keď dve vizual lanes
GATUJÚ na tej istej klasifikácii renderera (#290 supersample strop + #288 postproc gate),
mergnú sa v ZDROJI čisto práve preto, že `jeSoftverovyRenderer` žije v JEDNOM module
(`kvalita.ts`, jediný zdroj pravdy) — `snimka.ts` ho len re-exportuje. Jediný očakávaný
konflikt pri takej integrácii je **APPEND-BOTH v `vizual3d.md`** (obe lanes pripísali
vlastnú `##` sekciu na koniec) — vyrieš zachovaním OBOCH sekcií (nič nevyhadzuj), a po
merge over, že OBE správania koexistujú cez `kvalita.ts`: supersample strop 2× na softvéri
AJ postproc gate OFF na softvéri (`overPostprocGate` E2E + `vizual-snimka`/`vizual-kvalita-gpu`
testy). Ak by budúca lane presunula klasifikáciu späť do viacerých modulov, vráti sa
zdrojový konflikt — drž ju v `kvalita.ts`.

**CI chunk-size guard je JEDNOKOŠÍKOVÝ — projektový three ≤ 220KB (#337 odobral druhý košík).**
Krok „3D vizuál chunk gzip" v `.github/workflows/ci.yml` sčíta gzip všetkých three-marker chunkov
(`ACESFilmicToneMapping`, `RoomEnvironment`, `OrbitControls`, `mergeGeometries`, `PMREMGenerator`)
projektového viewera (#276, `/konfigurator`) a stráži **≤ 220KB** (aktuálne ~198KB). Do #337 bol
guard DVOJKOŠÍKOVÝ — druhý košík strážil `@google/model-viewer` (AR, vendoroval vlastný three,
~283KB ≤ 320KB); AR bol odobraný (#337), takže model-viewer bundle už neexistuje a druhý košík
je preč. Ak pridáš ĎALŠÍ vendorovaný-three 3D balík (nesie tie isté markery), MUSÍŠ znova
zaviesť samostatný košík — inak guard padne FALOŠNE (sčítanie dvoch nezávislých lazy balíkov do
jedného 220KB limitu). Pozn.: worktree/lane vetva NIKDY nebeží GitHub CI (spúšťa sa len na push
do `main`/`dev`), takže CI-only guardy (vrátane tohto chunk gate) sa prvýkrát ukážu AŽ pri
integrácii do `dev` — pri dotyku bundlu/deps over guard skript PRED merge, nespoliehaj sa na
„lane gates boli zelené".

## `$effect` musí čítať reaktívne vstupy PRED gate-om na NEreaktívnu `ziva` (#329)

Efekty vo `Vizual3D.svelte`, ktoré aplikujú živú zmenu (`prekresliRAL`/`prekresliSklo`),
volajú funkciu s gate-om `if (!ziva) return`. **`ziva` je obyčajný `let` (NIE `$state`)** a
napĺňa ho AŽ async `inicializuj()` (dynamic `import('three')` → HDRI → `postavScenu`), ktorý
dobehne desiatky ms po monte. Svelte 5 `$effect` sleduje LEN reaktívne čítania z POSLEDNÉHO
behu. Prvý beh efektu (mikrotask po monte) prebehne KÝM `ziva===null` → funkcia sa vráti PRED
čítaním `ralKod`/`skloVzhlad`/`tier` → efekt **nezaregistruje ŽIADNU závislosť → je navždy
mŕtvy.** Zmena farby/skla po monte (bez remountu rozmerov) sa už nikdy neaplikuje na materiál
(`data-viz-ral` prop-pass sa mení, ale scéna nie). Presne toto bol #329 („ked vyberiem farbu
nic sa nestane").

**Pravidlo: v takej funkcii čítaj reaktívne vstupy do lokálov HNEĎ NA ZAČIATKU, PRED
`!ziva` (alebo iným NEreaktívnym) gate-om:**

```js
function prekresliRAL() {
	const kod = ralKod;   // reaktívne čítanie PRVÉ → efekt ho zaregistruje aj pri prvom behu
	const t = tier;
	if (!ziva) return;    // NEreaktívny gate až POTOM
	… nastavRAL(…, kod, …);
}
```

Efekt `$effect(() => prekresliRAL())` tak zaregistruje `ralKod`/`tier` už pri prvom behu
(ziva===null) → pri každej ďalšej zmene sa spustí, `ziva` už je postavená. Efekt geometrie
(`geometrickyPodpis(vysledok)`) tým NEtrpí — číta prop `vysledok` PRED gate-om, takže žije
(to je aj dôkaz kontrastu). Regresný signál: `data-viz-ral-applied`/`data-viz-sklo-applied`
sa zapisuje LEN v `prekresliRAL`/`prekresliSklo` (miesto mutácie materiálu) — čestný dôkaz
skutočného prekreslenia, e2e naň asertuje po čistej zmene RAL/skla (nie prop-pass).

**Model → hrúbky profilov (#329 časť 2):** `PergolaModel` je LOKÁLNY typ v `geo/pergola.ts`
(vizuál leaf), NIE import z `$lib/konfigurator` — inak by `vizual-money-guard` import-graf
spadol (konfigurator nie je v jeho allowliste). `MODEL_PROFIL_SKALA` škáluje LEN vizuálne
prierezy (undefined→1.0, spätne kompatibilné); pozície sa počítajú z tých istých škálovaných
hodnôt → hrany ostávajú zarovnané; bbox/kóty/`svetlaVyska` sa NEmenia.

## Kamera „z hora" + intro glide + profi dom/scéna (#333)

- **NIKDY nemeň globálny `PRESETY.troStvrte` pre pergolu.** Preset je ZDIEĽANÝ so zasklenia scénou +
  `tests/vizual-kamera-kvalita.test.ts` drží výšku oka 1,3–1,9 m. Pergola „z hora" = SAMOSTATNÁ
  tabuľka `PRESETY_DOM` (troStvrte elev 28° vs 7°), `Vizual3D` vyberá `presety = zobrazDom ?
  PRESETY_DOM : PRESETY` (jednorazovo cez `untrack`, `zobrazDom` je fixné). Orbit limity [0,4..1,4]
  netreba meniť (default polar 62° je vnútri).
- **Intro glide guard je MODULE-scoped, nie inštančný.** `{#key vizKluc}` remountuje Vizual3D pri
  KAŽDEJ (debounced) zmene rozmeru → inštančný flag by intro prehral pri každej úprave. `let
  introUzBezal = false` v `<script module>` prežije remount → glide RAZ za načítanie. Badge kóty
  naopak MÁ nabehnúť pri každom remounte (inštančné `zobrazKotu()`). Intro ruší OrbitControls
  `'start'` (cez `tikaj`), prvá interakcia, `zachytObrazok` (snap na finál) a `cancelAnimationFrame`
  v onDestroy. Per-frame `poziciaKamery`+`controls.update()` (ako `aplikujPreset`), finálny
  `controls.update()` (sync spherical → prvý drag „neskočí").
- **Intro glide je GATED na HARDVÉROVÝ renderer** (`!jeSoftverovyRenderer(citajUnmaskedRenderer(gl))`,
  vzor #285/#288 polish gate). Na SOFTVÉROVOM WebGL (SwiftShader/CI) je 1,7 s rAF slučka
  renderujúca ťažkú scénu KONTENCIA na hlavnom vlákne — vytvorí ~1,7 s okno po monte, ktoré na CI
  RACE-ovalo s `konfigurator.spec.ts:408` „živý update" testom (debounced remount + caption update
  pri `vyplnFormular` sa dostali do intro okna → poll `pergola-caption-rozmer` timeout 6000 ms;
  flake — 40b7da1 CI prešiel keď skoré kroky testu okno prežili, 325e990 nie). Gate to odstráni
  (na softvéri sa scéna rovno ukáže na defaultnom presete, žiadny trhaný glide).
- **Vizual3D je ZDIEĽANÝ → NEimportuj `$lib/konfigurator*` doň** (money-guard allowlist §2.13 ich
  nepozná; guard by spadol). Triviálny format (mm→„4,0") inline priamo v komponente, nie import
  `konfigurator-jednotky`.
- **Dom + okolie = `scena-dom.ts`, stavba scény = `scena-build.ts` (large-file-split).** Pridaním
  intro/kóty/výzvy Vizual3D prekročil 1000-r. strop → `postavScenu` + `ZivaScena` extrahované do
  `scena-build.ts` (parameter injection cez `SceneCtx` — reaktívne vstupy + `onStart`/`onChange`
  callbacky pre OrbitControls). Profi dom (2-podlažná svetlá fasáda + sedlová plechová strecha zo
  2 naklonených slabov + ŠTÍTOVÉ trojuholníky proti „hollow gable" + raster okien + drevené dvere +
  sokel) a `vytvorOkolie` (trávnik + dlažbová terasa pod pergolou + odsaturované stromy) sú v
  `scena-dom.ts`, volané LEN pri `zobrazDom` (#325 vzor — zasklenia scéna netknutá).
- **DISPOSAL: KAŽDÁ geometria/materiál/TEXTÚRA do `disposables`** (Vizual3D ich pri každom `{#key}`
  remounte uvoľní) — inak unikne CELÝ dom per zmena rozmeru. Zdieľaný materiál/textúra (obidva
  sklony strechy) sa pushnú RAZ. `castShadow` len strecha+stromy+pergola (nie okná/priečky —
  shadow-map budget, low tier opt-out). Všetko procedurálne (žiadny externý asset — Money-guard +
  bundle). Perf tiery #285 cez `plochyGradientMiestoMap`/`tiene` (low = ploché farby, bez tieňov).

## Realistický zapustený dom + dvere (#336) — zapustenie sa faktuje DOPREDU, nie za fasádu

- **Fasáda je NEPRIEHĽADNÁ `PlaneGeometry` 5 mm PRED pôvodnou stenou → NEDÁ sa do nej vyrezať
  diera ani recesovať čokoľvek ZA ňu.** Diera (ShapeGeometry/CSG) by odhalila starú teplú stenu
  za svetlým prekrytím; sklo posunuté ZA fasádu (z < 5) by fasáda okludovala. Preto sa zapustenie
  faktuje DOPREDU: proud `ExtrudeGeometry` RÁM (z = fasáda..+90 mm, plná obruba SPOJENÁ s fasádou —
  žiadny plávajúci rám; vnútorné steny diery = svetlé ostenie) + SKLO/krídlo posunuté DOZADU k lícu
  fasády (z ≈ fasáda+12..17). Sklo je tak hlboko ZA čelom rámu → reálna PARALAXA pri otáčaní (najsilnejší
  cue, funguje AJ na low tieri — geometria, nie tieň), a VŠETKO je z ≥ fasáda (5) → nič neokludované.
  Regresný invariant: `min(sklo.position.z) ≥ mm(5)` (`vizual-scena-dom.test.ts`). Jeden zdroj pravdy
  `FASADA_Z_MM` = fasáda mesh `position.z` AJ `otvorCtx.fasadaZmm` (inak sa recess systém rozíde).
- **Tmavé odrazové sklo bez „čiernej diery" na low tieri = biely base + `vertexColors:true` + vertikálny
  VERTEX-COLOR gradient** (hore `0x4a5a63` → dole `0x28313a`). `THREE.Color(hex).r/g/b` sú LINEÁRNE
  (ColorManagement r0.185) a vertex colors sa čítajú lineárne → sadnú bez konverzie; materiál musí mať
  biely `color` (three násobí color×vertexColor). Mid/high pridá `scene.environment` odraz (`envMapIntensity
  1.7`, `metalness 0` = dielektrikum, `roughness 0.08`); low tier ukáže samotný gradient (faktuje odraz
  oblohy). Svetlá pastelová base = plochá modrá „lego" (root cause #336). Krížové delenie okien = dollhouse
  cue → zrušené (rám + max 1 zvislý mullion).
- **PASCA: susedné ZAPUSTENÉ okná sa PRENIKAJÚ, ak je rozstup stredov < šírka najširšieho prvku
  (parapet = okno+100).** Ploché nasadené okná (#333) sa prekrývali neviditeľne; proud extrude rámy z toho
  spravia 3D artefakt (rám bočného okna renderuje NA skle stredného). Pri rastri okien vždy: stredné vždy,
  bočné LEN keď `maxX ≥ okno+100` a `|x| ≥ okno+100` (mirror „vynechaj ak sa nezmestí" ako prízemné okno).
  Chytil to až adversariálny review pri S≈2000–2790, nie prvé testy — pridaj S=2000 no-overlap regresný test.
- **Kolízne clampy prízemných otvorov (#325) platia na NAJŠIRŠÍ sub-mesh, nie na sklo.** Parapet je okno+100,
  rám okno+70 → clamp počítaj z `oknoDolnaX + (oknoDolnaW+100)/2 ≤ budgetHalfXmm` (= `S/2−55`, 5 mm rezerva
  pod testovú hranicu `S/2−50`). Latová bočnica dverí (asymetria SalesQueze: vstup+laty vľavo, okno vpravo)
  sa VYNECHÁ keď `bocnicaVonkajsiaX > budgetHalfXmm`. Dvere majú min šírku 760 → pri `S < ~930` rám prečnieva
  stĺp (pre-existujúce, mimo produktového rozsahu, odovzdané #343).
- **Testovanie domu bez WebGL (Node vitest):** sklo = mesh s `geometry.attributes.color`; rám = `geometry.type
  === 'ExtrudeGeometry'`; krídlo dverí = BoxGeometry na x=0 s `material.map` a `position.y < mm(2500)` (POZOR:
  sklony STRECHY sú tiež Box+mapa na x=0 — odlíš nízkym y). Zdieľané materiály over cez `mesh.material ===
  <shared>` (počet lát/krídla). Nové procedurálne textúry (`vytvorDreveneDrevoTexturu` zvislá kresba,
  `vytvorOmietkaTexturu`) testuj recording-stub `FakeCtx` + `Math.random` mock v `try/finally` (vzor
  `vizual-textury.test.ts`).

## Bazénové zastrešenie — nová FREESTANDING rodina + oblúkové segmenty (#405)

Tretia zákaznícka rodina (`geo/bazen.ts` + `VizualBazenZakaznik` + `KonfBazenVizual`) — čistý reuse
generického pipeline (0 zmien `spec.ts`/`builder.ts`/`produkt-meshe.ts`), roly `ram`/`sklo`/
`kolajnica`. Rozmery/kaskáda z appkových helperov `sekcieVysky`/`sekciePozicie` (`$lib/bazen-navrh`,
už v money-guard allowliste). `presnost:'ilustracna'` (spec.ts to anticipuje: „neznámy oblúk bazéna").

- **FREESTANDING rodina = `zobrazStena={false}` na `Vizual3D` (#405, vzor #325).** `scena-build.ts`
  kreslila stenu ZA produktom BEZPODMIENEČNE (dobré pre zasklenia „pri stene" aj pergolový dom, ZLÉ
  pre voľne stojace bazénové zastrešenie — stena za ním pôsobí zavádzajúco). Nový prop `zobrazStena`
  (default `true` → pergola/zasklenia NEZMENENÉ) gatuje stenu: kreslí sa pri `zobrazDom || zobrazStena`
  (dom si fasádu vždy vyžaduje). `dom.skupina.position.z` číta samostatné `stenaZ` (nie `stena.position.z`,
  ktorá teraz žije vnútri podmieneného bloku). Toto je DRUHÝ family-gated scenery prepínač po `zobrazDom`
  — každá NE-generická scénická výbava do `postavScenu` MUSÍ byť za takýmto propom (Vizual3D je zdieľaný).
- **Oblúk = extrudovaný semi-eliptický ANULUS (pás), NIE zlepené tetivové boxy.** `oblukPasObrys(rx, ry,
  hrubka, body)`: vonkajšia semi-elipsa θ 0→π, potom vnútorná π→0 (uzavrie `builder` cez `closePath` →
  dve päty otvorené = arch shell). Hrúbka klampovaná `min(hrubka, 0.45rx, 0.45ry)` (inner < outer). Extrude
  pozdĺž Z (dĺžky), žiadna rotácia (X-Y profil je už v rovine). Menšia elipsa je CELÁ vnútri väčšej — to je
  kľúč pre vnorenie výplne (nižšie).
- **PASCA (🟡 review): výplň a rebro NESMÚ zdieľať vonkajšie líce oblúka — koplanárne povrchy → sklo sa
  kreslí NA rebro.** Rebrá (`ram`) sú na hraniciach segmentov, výplň (`sklo`) v strede — ale ak oba použijú
  `oblukPasObrys(rx, ry, …)`, ich vonkajší povrch je byte-identický v Z-pásme prekryvu (najmä krajné rebrá
  ~37,5 mm) → transparentné sklo blenduje cez hliník. FIX: výplň radiálne ODSAĎ dovnútra
  (`oblukPasObrys(rx − VYPLN_ODSADENIE_MM, ry − VYPLN_ODSADENIE_MM, …)`, ~25 mm) — sklo sadí do profilu
  (kanála), rebro ho z vonkajšej strany prekrýva. Zamkni unit testom `rozponX/vrcholY(sklo[i]) <
  rozponX/vrcholY(ram[i+1])` (koplanárne rebro segmentu i je ram[i+1], rovnaká výška `vysky[i]`).
- **Teleskopická kaskáda = KLESAJÚCA výška (nie klesajúca šírka).** V ZATVORENOM stave segmenty utesnia
  bazén po celej dĺžke → plná šírka `S` pre všetky; výškový krok (cez `sekcieVysky`, ilustračný `vyskaMin`
  z per-krok poklesu) je čestný teleskopický cue. Krok šírky by nechal medzery ku koľajniciam (zamietnuté v
  review). `vysky[0]=V` (najvyšší = zadaná výška), bbox `{S, V, D}`.
- **Živý update:** ROZMERY (vrátane výšky — mení bbox.h → treba refit) = DEBOUNCED snapshot → `{#key vizKluc}`
  remount; POČET SEGMENTOV = LIVE prop → mení `diely` → `geometrickyPodpis` effect → in-place
  `prestavGeometriuProduktu` (bbox nezmenený, žiadny remount); VÝPLŇ/RAL = in-place materiál. Deterministický
  E2E signál `data-viz-rozmer` na stabilnom `konf-baz-viz` uzle MIMO `{#key}` (vzor #361); leak guard
  `__VIZ_CONTEXTS===1` po remounte (stráži reštrukturalizovaný wall-disposal blok).
- **Segmenty clamp OBOJSTRANNE** (2..8) — spodný `Math.max(2,…)` NESTAČÍ, JSDoc sľubuje rozsah; `Math.min(8,…)`.
- `Vizual3D.svelte` narástol pridaním `zobrazStena` na ~921 r. (watch-list `large-file-split.md` hlási ~722,
  je stale) — pri ďalšom väčšom dotyku zváž split (intro/kóta/dom-vetvy sú kandidáti na extrakciu).
- Canvas `aria-label` bol natvrdo „3D náhľad zasklenia" pre VŠETKY rodiny → zmenené na rodinovo-neutrálne
  „3D náhľad produktu".

## Procedurálne PBR mikro-reliéf mapy — normal/roughness (#356)

`textury.ts` vie okrem albedo CanvasTextur generovať aj tileable NORMAL mapy z výškového
poľa (`normalMapaZVysky`, centrálna diferencia) + lineárne grayscale roughness mapy
(`linearnaGrayMapa`). Vzor rozšírenia realizmu BEZ binárnych assetov (owner §5.3, #356) —
hliník práškovaný orange-peel, dlažba zapustené škáry, sklo `clearcoatNormalMap`. Wiring:
`materialy.ts` (voliteľné mapy, spätne kompatibilné), `produkt-meshe.ts` (mid/high, dispose),
`scena.ts::vytvorZem` + `scena-dom.ts::vytvorOkolie` (zem/terasa normal). Tri PASCE, ktoré
chytil až adversariálny review (nie prvé testy):

### `CanvasTexture.flipY=true` → ZELENÝ (Y) kanál normal mapy má OPAČNÉ znamienko

`CanvasTexture` má default `flipY=true`, takže canvas riadok 0 (hore) sa nahráva na `v=1`
(`v = 1 - y/N`, `dv/dy = -1/N`). three TBN kladie zelený kanál pozdĺž +v, takže
`normal.y = -dh/dv = +N·dh/dy ∝ +(h[y+1] - h[y-1]) = (hDole - hHore)`. Naivné `ny =
-(h[y+1]-h[y-1])` (bez flipY korekcie) je INVERTOVANÉ → horizontálne ryhy sa vykreslia ako
HREBENE namiesto žliabkov (klasický DirectX-vs-OpenGL green-flip; vertikálne ryhy / X kanál
sú OK, flipY horizontálny smer netrápi). **Chytí to LEN sign test** (obe steny žliabku musia
mieriť DO stredu: horná stena horizontálnej škáry `G<128`, dolná `G>128`; ľavá stena
vertikálnej `R>128`, pravá `R<128`) — amplitúdový test (`|G-128|>0`) prejde aj pri inverzii.
POZOR: „oprava" prepísaním `-(hu-hd)` na `(hHore-hDole)` je NO-OP (algebraicky totožné) —
over znamienko RE-DERIVÁCIOU + sign testom, nie premenovaním premenných. Normal/roughness
mapy MUSIA mať `colorSpace = NoColorSpace` (lineárne dáta, nie sRGB).

### `BoxGeometry` UV je 0..1 NA PLOCHU → mapa sa natiahne na tenkom profile ~70:1

Default `BoxGeometry` UV mapuje 0..1 na KAŽDÚ plochu bez ohľadu na jej fyzický pomer strán.
Na tenkom hliníkovom profile (4200×50 mm) to natiahne textúru ~70:1 pozdĺž dĺžky → pri
`anisotropy=1` sa mapa mip-uje NA PLOCHO (reliéf zmizne), pri anizotropii ukáže smerové
pruhy. `builder.ts::metreUvBox` prepíše box UV na METRE (fyzická veľkosť plochy: px/nx→(d,h),
py/ny→(w,d), pz/nz→(w,h), poradie plôch three r0.185 px,nx,py,ny,pz,nz), potom `texture.repeat
= dlaždice/meter` tiluje svetovo-rovnomerne cez všetky plochy. Zjednocuje s `ExtrudeGeometry`
(tá už má svetové UV zo shape v mm→m). Neškodné pre materiály bez mapy (UV nečítajú). Dôsledok:
KAŽDÁ mapa na box-mesh potrebuje `RepeatWrapping` + `repeat` v dlaždice/m (default ClampToEdge
by metre-UV roztiahol/prilepil).

### Amplitúda normal mapy — meraj SKLON, nie byte-odchýlku

Práškovaný orange-peel má reálny sklon ~1–3°; vyššie číta hammered/plast (#276/#336 analógia).
`normalMapaZVysky` `sila` + material `normalScale` spolu určujú sklon — over MERANÍM
(priem. `atan(|nxy|/nz)` cez mapu), nie odhadom. #356 kalibrácia: hliník sila 0.2 + scale 0.7
≈ 3° priem. Dlažba grout môže byť strmšia (reálna škára). Sklo `clearcoatNormalMap` len na
clearcoat vrstve → číra transmisia/priehľad skla NEDOTKNUTÝ (žiadne matnenie).
