// Paralelný E2E beh (post-deploy, `E2E_WORKERS` > 1) — specy, ktoré MENIA ZDIEĽANÚ konfiguráciu
// appky, bežia v samostatnom Playwright projekte `seriove` (1 worker) AŽ PO paralelnej časti
// (`playwright.config.ts`). Zdieľaný stav = to, čo čítajú výpočty VŠETKÝCH ostatných specov:
//   • editor vzorcov `/zasklenia/nastavenia` (`ulozit-vzorce`) — mení offsety cfg_rez / glass_types
//     (napr. Kladkový odsadenie → iná výška skla v nárezáku súbežného testu),
//   • povolené hrúbky Odoo skiel (`pridat-hrubku` / `odobrat-hrubku`) — mení ponuku „Sklo (základ)".
// Proti LIVE (PROD) sú tieto zápisy za `skipAkLive`, takže tam je split len poistka; proti
// NE-live cieľu (preview/staging s BASE_URL) by bez neho súbežný editor menil čísla ostatným.
// Nový spec so zápisom do editora → pridaj ho sem; stráži `tests/e2e-seriove.test.ts`
// (`MUTUJE_CFG` nad textom specov).

/** Zápisové ovládače zdieľanej konfigurácie (testid-y v specoch). */
export const MUTUJE_CFG = /\b(?:ulozit-vzorce|pridat-hrubku|odobrat-hrubku)\b/;

/** Specy (názov súboru v `e2e/`), ktoré bežia sériovo po paralelnej časti. */
export const SERIOVE_SPECY: readonly string[] = [
	'app.spec.ts',
	'audit3.spec.ts',
	'cfg-editor-sklo-mirror.spec.ts',
	'sietka-standard-editor.spec.ts',
	'sklo-hrubky-579.spec.ts'
];
