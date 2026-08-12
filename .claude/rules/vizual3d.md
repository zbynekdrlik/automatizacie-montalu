---
paths:
  - "src/lib/vizual/**"
  - "src/lib/components/vizual/**"
  - "e2e/vizual3d.spec.ts"
  - "e2e/zasklenia-zakaznicky.spec.ts"
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
