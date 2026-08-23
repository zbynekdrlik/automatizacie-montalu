# HDRI assety pre 3D vizuál (#285)

`kloofendal_puresky_1k.hdr` — vonkajšia obloha (partly cloudy puresky) pre
IBL/odlesky v zákazníckom 3D náhľade pergoly.

- **Zdroj:** Poly Haven — https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- **Licencia:** CC0 (public domain) — žiadna povinná atribúcia, žiadne obmedzenia.
- **Rozlíšenie:** 1k equirectangular Radiance HDR (~1,4 MB). 1k stačí — PMREM
  environment mapu aj tak rozmaže; vyššie rozlíšenie by len zbytočne nafúklo repo.

## Prečo commitnuté lokálne (a NIKDY externý runtime fetch)

Money-guard + offline-robustnosť: `src/lib/vizual/**` nesmie robiť žiadny externý
sieťový fetch v runtime. HDR sa servuje z VLASTNÉHO originu appky (`/hdri/…`,
`scena.ts::hdriUrl`) a načíta sa lazy cez `RGBELoader` až pri inicializácii 3D
scény (mid/high tier). Pri akejkoľvek chybe loadu scéna graceful padne na
procedurálny `RoomEnvironment` (0 bajtov zo siete) — asset teda nikdy nezhodí
render.

Toto je vedomé uvoľnenie pôvodnej §4 „v repe nie je ani jeden binárny obrázok"
zásady (#170) — majiteľ ho v #285 explicitne schválil pre showroom kvalitu
(reálne slnko/obloha v odleskoch na hliníku a skle).
