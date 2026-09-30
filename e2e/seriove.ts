// Paralelný E2E beh (post-deploy, `E2E_WORKERS` > 1) — niektoré specy bežia v samostatnom
// Playwright projekte `seriove` (1 worker) AŽ PO paralelnej časti (`playwright.config.ts`).
// DVE kategórie, každá z INÉHO dôvodu (stráži `tests/e2e-seriove.test.ts` nad textom specov):
//
// 1. `SERIOVE_SPECY` — MENIA ZDIEĽANÚ konfiguráciu appky (`MUTUJE_CFG`). Zdieľaný stav = to, čo
//    čítajú výpočty VŠETKÝCH ostatných specov:
//      • editor vzorcov `/zasklenia/nastavenia` (`ulozit-vzorce`) — mení offsety cfg_rez / glass_types
//        (napr. Kladkový odsadenie → iná výška skla v nárezáku súbežného testu),
//      • povolené hrúbky Odoo skiel (`pridat-hrubku` / `odobrat-hrubku`) — mení ponuku „Sklo (základ)".
//    Proti LIVE (PROD) sú tieto zápisy za `skipAkLive`, takže tam je split len poistka; proti
//    NE-live cieľu (preview/staging s BASE_URL) by bez neho súbežný editor menil čísla ostatným.
//
// 2. `SERIOVE_3D` — ČAKAJÚ na reálnu three.js/WebGL scénu (`RENDERUJE_3D`). Na GitHub runneri
//    (4 vCPU, bez GPU) renderuje Chromium softvérovo (swiftshader) — pri 3 súbežných workeroch CPU
//    vyhladovie a čakanie na scénu padne na timeoute, hoci appka je v poriadku (#599: post-deploy
//    0.25.60, `zasklenia-zakaznicky` `waitForFunction` 60 s; 0.25.59 prešiel = závislé od záťaže).
//    Oprava je izolácia záťaže, NIE retry ani vyšší timeout. Marker = test čaká na vyrenderovanú
//    scénu: `data-viz-ready` (tier scény hotový), `vizual3d-canvas` (screenshot/rozmer canvasu),
//    `zakaznicky-obrazok` (PNG zachytené z 3D scény). Stránka, ktorá 3D panel len namountuje a test
//    na scénu nečaká (napr. `zasklenia-navrh` výkres), na nej timeoutnúť nemôže → ostáva paralelne.
//
// Nový spec so zápisom do editora → `SERIOVE_SPECY`; nový spec čakajúci na 3D scénu → `SERIOVE_3D`.

/** Zápisové ovládače zdieľanej konfigurácie (testid-y v specoch). */
export const MUTUJE_CFG = /\b(?:ulozit-vzorce|pridat-hrubku|odobrat-hrubku)\b/;

/** Čakanie na vyrenderovanú three.js scénu (atribút / testid-y v specoch). */
export const RENDERUJE_3D = /\bdata-viz-ready\b|\bvizual3d-canvas\b|\bzakaznicky-obrazok\b/;

/** Specy (názov súboru v `e2e/`) meniace zdieľanú konfiguráciu. */
export const SERIOVE_SPECY: readonly string[] = [
	'app.spec.ts',
	'audit3.spec.ts',
	'cfg-editor-sklo-mirror.spec.ts',
	'sietka-standard-editor.spec.ts',
	'sklo-hrubky-579.spec.ts'
];

/** Specy (názov súboru v `e2e/`) čakajúce na CPU-ťažkú 3D/WebGL scénu. */
export const SERIOVE_3D: readonly string[] = [
	'konfigurator-bazen.spec.ts',
	'konfigurator-pergola.spec.ts',
	'konfigurator-vyber.spec.ts',
	'vizual-showroom.spec.ts',
	'vizual3d.spec.ts',
	'zasklenia-zakaznicky.spec.ts'
];

/** Všetko, čo beží v projekte `seriove` (zjednotenie oboch kategórií, bez duplicít). */
export const SERIOVE_VSETKY: readonly string[] = [...new Set([...SERIOVE_SPECY, ...SERIOVE_3D])];
