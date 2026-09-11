// Seed dáta + seed funkcie — extrahované z `migracie.ts` (#294), aby `migracie.ts` zostal pod
// 1000-riadkovým stropom (large-file-split). Rovnaký vzor ako #183 (db.ts → migracie.ts):
// PURE MOVE, nulová zmena správania. Funkcie berú `db`/`hashPassword` ako PARAMETRE (parameter
// injection, nie import z `migracie.ts`) → žiadny cyklický import v ani jednom smere. Konštanty
// aj funkcie sú exportované, lebo `migracie.ts` ich volá z migračných blokov (`migrate()`) aj na
// konci (`seedData`/`seedUsers`).
import type Database from 'better-sqlite3';
import seed from './cfg_seed.json';
import { logger } from './log';
import { jeIzoSklo } from '../styl';

const log = logger('migrate');

// Deluxe sklá (Float kalené) — len na plán/objednávku, NIE v Money odpise; žiadna
// redukcia (redukcia_zero = 0). 6/10 mm zodpovedá priemeru kladky štýlu.
export const DELUXE_GLASS = [
	{ nazov: 'Float kalené 6 mm', poradie: 10 },
	{ nazov: 'Float kalené 10 mm', poradie: 20 }
];

// Štandard + sklá — len na plán/objednávku, NIE v Money odpise (žiadna redukcia).
// basic štýly berú jednoduché sklo (4/6/10 mm), IZO štýly izolačné 4.8.4, opona
// jednoduché Float 4 mm (spec: "type Float 4"). Systém je jeden ('Štandard +')
// naprieč basic/IZO/opona štýlmi — rovnako ako Deluxe má jeden 'Deluxe' systém
// naprieč 2K…6K; geometria (basic/IZO/opona) sa vyberá ŠTÝLOM, nie sklom.
export const STANDARD_GLASS = [
	{ nazov: 'Float sklo 4 mm', poradie: 10 },
	{ nazov: 'Float sklo 6 mm', poradie: 20 },
	{ nazov: 'Float sklo 10 mm', poradie: 30 },
	{ nazov: 'Izolačné sklo 4.8.4', poradie: 40 }
];

// Slide 6 mm sklá — skladba S REDUKCIOU (Patrik, 2026-07-27): „ak je redukcia, vieme
// tam dať čokoľvek o hrúbke 6 mm" (6 mm číre, 6 mm kalené, 3.3.1, 3.3.2). Do zoznamu
// chcel presne tieto tri; ostatné 6 mm varianty rieši obchodník poznámkou. `hrubka`
// zostáva 0 — používa ju len Deluxe na výber kladkového/klzného profilu, Slide žiadny
// hrúbko-závislý profil nemá.
export const SLIDE_GLASS_6MM = [
	{ nazov: '6mm číre', poradie: 30 },
	{ nazov: '6mm mliečne', poradie: 40 },
	{ nazov: '3.3.1', poradie: 50 }
];

// Sklá podľa systému: Robust = izolačné 4/16/4, Slide = izolačné 4/8/4
// (Slide 4/8/4 = skladba 16 mm BEZ redukcie → obe ju nulujú) + 6 mm sklá S redukciou.
// Redukcia 6mm je sklozavislý profil, ktorý má LEN Slide, takže `redukcia_zero` na
// sklách iných systémov je bez účinku. Kalené 8/10 mm tu UŽ NIE SÚ — Robust je IZO-only
// (Patrik 2026-07-31: „pri robuste mi ponúka kalené sklá 8-10mm" ako chybu); do žiadneho
// iného systému nepatria, Deluxe má vlastné „Float kalené 6/10 mm".
export function seedGlass(db: Database.Database): void {
	const ins = db.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
	);
	db.transaction(() => {
		ins.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust');
		ins.run('Izolačné sklo 4/16/4 číre', 0, 20, 'Robust');
		ins.run('Izolačné sklo 4/8/4 mliečne', 1, 10, 'Slide');
		ins.run('Izolačné sklo 4/8/4 číre', 1, 20, 'Slide');
		for (const g of SLIDE_GLASS_6MM) ins.run(g.nazov, 0, g.poradie, 'Slide');
		// Kalené 8/10 mm sa NESEEDUJÚ — Robust je IZO-only (Patrik 2026-07-31, migrácia
		// v19). Keby tu ostali, seed by ich po každom štarte vrátil späť a migrácia by
		// sa navonok tvárila, že nič nespravila.
	})();
}

export function seedData(db: Database.Database): void {
	const sysCount = (db.prepare('SELECT COUNT(*) c FROM cfg_sys').get() as { c: number }).c;
	if (sysCount === 0) {
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		db.transaction(() => {
			for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
			for (const r of seed.rez)
				insRez.run(
					r.sysStyl,
					r.poradie,
					r.typ,
					r.kod,
					r.nazov,
					r.dim,
					r.koef,
					r.offset,
					r.delitN,
					r.kerf,
					r.pocetKs,
					r.sklozavisle,
					(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500
				);
		})();
	}
	const glassCount = (db.prepare('SELECT COUNT(*) c FROM glass_types').get() as { c: number }).c;
	if (glassCount === 0) seedGlass(db);
}

export function seedUsers(db: Database.Database, hashPassword: (password: string) => string): void {
	const userCount = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
	if (userCount === 0) {
		const spec = process.env.SEED_USERS || '';
		const ins = db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)');
		// seed-audit (#246): účty založené SEED-om (nie človekom) dostanú audit riadok
		// action='seed' — inak by boli v audite nerozoznateľné od ničoho. actor='' =
		// bez session kontextu (rovnaká konvencia ako addUser). INSERT users + audit
		// v jednej transakcii, nech seed účet nikdy nevznikne bez svojho audit riadku.
		const audit = db.prepare(
			"INSERT INTO user_audit (actor, action, target_username, detail) VALUES ('', 'seed', ?, '')"
		);
		const seeded: string[] = [];
		db.transaction(() => {
			for (const pair of spec.split(',').filter(Boolean)) {
				const idx = pair.indexOf(':');
				if (idx < 1) continue;
				const uname = pair.slice(0, idx).trim();
				// heslo (pair.slice(idx+1)) sa NIKDY neloguje — len meno účtu
				ins.run(uname, hashPassword(pair.slice(idx + 1)));
				audit.run(uname);
				seeded.push(uname);
			}
		})();
		if (seeded.length > 0) log.info('seedUsers', { usernames: seeded });
	}
}

/**
 * v29 → v30: opečiatkovanie orientačnej ceny + verzie cenníka pri PODANÍ dopytu (#309).
 * Extrahované z `migrate()` (large-file-split — `migracie.ts` bol pri 1000-r. strope). Guard
 * `< 30` + `db.transaction` + feature-detect `dopyt` sú vnútri; `bump` (parameter injection)
 * zapíše `user_version` + logMig. Re-download PDF ponuky dovtedy prepočítaval cenu zo ŽIVEJ
 * matice (`cennik-pergola.json`), takže zmena matice retroaktívne prepísala „historické" PDF;
 * pri podaní teraz uložíme MO cenu (`cena_*`), model a verziu cenníka (`cennik_verzia`) a regen
 * preferuje uloženú hodnotu. MONEY-NEUTRÁLNE (LEN MO, žiadna VO cena/Money kód). Feature-detect
 * (vzor v27 `odpis_log`): minimálne migračné fixtures skáču za v25 bez `dopyt` — ALTER sa preskočí;
 * na reálnej DB `dopyt` VŽDY existuje (v25). Všetky stĺpce nullable (NULL = neopečiatkovaný riadok).
 */
// v30 → v31 (#299): evidencia RUČNÉHO presunu parkovaného (`caka=1`) odpisu zo staging „NA ODPIS"
// do ostrého Money import dir. `caka=1` súbor visí v `NA ODPIS/<subdir>`; Money ho neimportuje, kým
// ho ČLOVEK ručne nepresunie do rootu `dlv-import` — krok MIMO appky. Keďže `caka` je po inserte
// NEMENNÉ, presunutý odpis dovtedy ostával navždy „parkovaný" (#308 readback ho vylučoval, #294
// ledger nemal signál o presune). Nový nullable stĺpec `presunute_at` nesie čas, kedy appka
// detekovala zmiznutie staged súboru (`detectManualStagingMoves`, /odpisy load); NULL = nepresunutý.
// Money-NEUTRÁLNE. Feature-detect guard (vzor v27 `maOdpisLog`) — minimálne migračné fixtúry
// `odpis_log` nestavajú; reálna prod DB ju má od v1/v2, takže ALTER prebehne. Celé v `db.transaction`
// (vzor v24/v25/v27): ALTER je v SQLite transakčné → pád sa čisto prehrá. Extrahované sem
// (large-file-split, aby `migracie.ts` zostal pod 1000-riadkovým stropom), vzor `migrateDopytCenaStamp`.
export function migrateManualMoveColumn(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 31) return;
	const maOdpisLog =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='odpis_log'").get() !==
		undefined;
	db.transaction(() => {
		if (maOdpisLog) {
			db.exec('ALTER TABLE odpis_log ADD COLUMN presunute_at TEXT;');
		}
		bump(31);
	})();
}

export function migrateDopytCenaStamp(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 30) return;
	const maDopyt =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dopyt'").get() !==
		undefined;
	db.transaction(() => {
		if (maDopyt) {
			db.exec(`
				ALTER TABLE dopyt ADD COLUMN cena_druh TEXT;
				ALTER TABLE dopyt ADD COLUMN cena_bez_dph REAL;
				ALTER TABLE dopyt ADD COLUMN cena_s_dph REAL;
				ALTER TABLE dopyt ADD COLUMN cena_hlbka_grid_m REAL;
				ALTER TABLE dopyt ADD COLUMN cena_sirka_grid_m REAL;
				ALTER TABLE dopyt ADD COLUMN cena_model TEXT;
				ALTER TABLE dopyt ADD COLUMN cennik_verzia TEXT;
			`);
		}
		bump(30);
	})();
}

/**
 * v31 → v32: typ cenovej HLADINY opečiatkovanej ceny dopytu (#318). Nový nullable stĺpec
 * `cena_hladina` ('VO' = veľkoobchodná pečiatka od prihláseného b2b účtu; NULL = MO/starý riadok)
 * dopĺňa cenovú pečiatku #309, aby re-download PDF reprodukoval nielen VO cenu, ale aj jej typ
 * (label „Veľkoobchodná cena") historicky. Aditívne + idempotentné: ALTER s NULL defaultom je O(1)
 * a neprepíše žiadny existujúci riadok (všetky ostanú MO/NULL). Feature-detect `dopyt` (vzor v30):
 * minimálne migračné fixtures skáču za v25 bez `dopyt` → ALTER sa preskočí; reálna prod DB `dopyt`
 * má od v25. Celé v `db.transaction` (ALTER je v SQLite transakčné → pád sa čisto prehrá).
 * MONEY-NEUTRÁLNE (len marker MO/VO na verejnej PREDAJNEJ cene, žiadny Money kód). Extrahované sem
 * (large-file-split — `migracie.ts` je na 1000-riadkovom strope), vzor `migrateDopytCenaStamp`.
 */
export function migrateDopytCenaHladina(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 32) return;
	const maDopyt =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dopyt'").get() !==
		undefined;
	db.transaction(() => {
		if (maDopyt) {
			db.exec('ALTER TABLE dopyt ADD COLUMN cena_hladina TEXT;');
		}
		bump(32);
	})();
}

/**
 * v27 → v28: Deluxe 5K vrchná (horná) koľajnica mala nesprávny Money kód (PREČÍSLOVANÉ z v27 na
 * v28 — #296 pôvodne pridala v27, kolidovalo s #294 odpis_imported ledgerom, ktorý dev medzitým
 * dostal tiež ako v27). ZASP202434 → správne ZASP202427 (nahlásil zákazník Patrik Javorský, Odoo
 * kanál 207, msg 1734424, 2026-08-24: „Delux 5K ma zlú vrchnú koľajnicu je tam ZASP202434 ma tam
 * byť ZASP202427"). SET kód (+ názov) z (opraveného) cfg_seed per (sys_styl, poradie) — presný
 * vzor v12/v15. MENÍ Money odpis Deluxe 5K objednávok (kód vrchnej koľajnice) — zákazníkom
 * potvrdená oprava. Idempotentné (SET z cfg_seed), fyzický profil (6000mm tyč) nezmenený.
 * Extrahované sem (large-file-split — `migracie.ts` na 1000-riadkovom strope, #318), PURE MOVE
 * vzor `migrateDopytCenaStamp`; volané inline na pôvodnej pozícii (pred v29 blokom).
 */
export function migrateDeluxe5KRail(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 28) return;
	const updRail = db.prepare(
		'UPDATE cfg_rez SET kod = ?, nazov = ? WHERE sys_styl = ? AND poradie = ?'
	);
	db.transaction(() => {
		for (const r of seed.rez)
			if (r.sysStyl === 'Deluxe|5K' && r.poradie === 10)
				updRail.run(r.kod, r.nazov, r.sysStyl, r.poradie);
		bump(28);
	})();
}

/**
 * v32 → v33: záväzná objednávka z verejného konfigurátora (#319). Objednávka je escalácia
 * dopytu — ukladá sa do TEJ ISTEJ tabuľky `dopyt` s príznakom `je_objednavka=1` + fakturačnými
 * údajmi + súhlasom s podmienkami. Znovupoužije cenovú pečiatku #309/#318 (`cena_*`/`cena_hladina`
 * — objednaná cena je zapečatená vrátane MO/VO hladiny) aj celý Odoo lead pipeline #278; lead sa
 * len VETVÍ podľa `je_objednavka` (opportunity vs lead). Nové stĺpce: `je_objednavka` (1=objednávka,
 * NULL/0=dopyt), fakturačné meno/adresa/IČO/DIČ, `suhlas_podmienky` (1=súhlas). Aditívne +
 * idempotentné: ALTER s NULL defaultom je O(1) a neprepíše žiadny existujúci riadok (všetky ostanú
 * dopyty s NULL). Feature-detect `dopyt` (vzor v30/v32): minimálne migračné fixtures skáču za v25
 * bez `dopyt` → ALTER sa preskočí; reálna prod DB `dopyt` má od v25. Celé v `db.transaction` (ALTER
 * je v SQLite transakčné → pád sa čisto prehrá). MONEY-NEUTRÁLNE: CRM/objednávková evidencia, žiadny
 * odpis ani zápis do Money. Extrahované sem (large-file-split — `migracie.ts` je na 1000-riadkovom
 * strope), vzor `migrateDopytCenaHladina`.
 */
export function migrateObjednavka(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 33) return;
	const maDopyt =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dopyt'").get() !==
		undefined;
	db.transaction(() => {
		if (maDopyt) {
			db.exec(`
				ALTER TABLE dopyt ADD COLUMN je_objednavka INTEGER;
				ALTER TABLE dopyt ADD COLUMN fakt_meno TEXT;
				ALTER TABLE dopyt ADD COLUMN fakt_adresa TEXT;
				ALTER TABLE dopyt ADD COLUMN fakt_ico TEXT;
				ALTER TABLE dopyt ADD COLUMN fakt_dic TEXT;
				ALTER TABLE dopyt ADD COLUMN suhlas_podmienky INTEGER;
			`);
		}
		bump(33);
	})();
}

/**
 * v33 → v34: durable retry queue pre Odoo zákazka-push (#349, follow-up #340). Nová tabuľka
 * `odoo_zakazka_push` sleduje stav pushu interného zoznamu materiálu na `sale.order` per
 * (zákazka, objednávka): či čaká na (re)post (`pending`), počet GENUINE zlyhaní (`attempts` —
 * poison-pill ako #278; `no-order` sa NEpočíta, je časovo ohraničené cez `created_at`), poslednú
 * chybu a čas posledného úspešného postu. Umožňuje štartový + arrival sweep dopostnúť zaostalé
 * pushe pri dlhšom výpadku Odoo (MVP #340 sa self-healol len pri ĎALŠOM odpise zákazky). Retry
 * NEUKLADÁ telo note — re-derivuje AKTUÁLNY snapshot (`pushZakazkaToOdoo`), takže „posledný vyhráva".
 * Fresh CREATE (guard `< 34`), žiadny feature-detect (nová tabuľka, nie ALTER existujúcej). Celé v
 * `db.transaction` (CREATE je v SQLite transakčné → pád sa čisto prehrá). MONEY-NEUTRÁLNE:
 * CRM/integračná evidencia, žiadny odpis ani zápis do Money. Extrahované sem (large-file-split —
 * `migracie.ts` je pri 1000-riadkovom strope), vzor `migrateObjednavka`.
 */
export function migrateOdooZakazkaPush(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 34) return;
	db.transaction(() => {
		db.exec(`
			CREATE TABLE odoo_zakazka_push (
				zak_norm TEXT NOT NULL,
				op_norm TEXT NOT NULL,
				zak TEXT NOT NULL,
				op TEXT NOT NULL,
				pending INTEGER NOT NULL DEFAULT 0,
				attempts INTEGER NOT NULL DEFAULT 0,
				last_error TEXT NOT NULL DEFAULT '',
				posted_at TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now')),
				PRIMARY KEY (zak_norm, op_norm)
			);
			CREATE INDEX idx_odoo_zakazka_push_pending ON odoo_zakazka_push(pending, attempts);
		`);
		bump(34);
	})();
}

/**
 * v34 → v35 (#384): stĺpec `produkt` na tabuľke `dopyt` — jednotný verejný konfigurátor ukladá ku
 * každému dopytu/objednávke produktový rad (kód katalógu `KONF_PRODUKTY`; NULL = starý pergolový
 * dopyt). Robí PDF titul + názov Odoo leadu produkt-aware a interný zoznam produkt-zobraziteľný.
 * Additívne + idempotentné (ADD COLUMN TEXT, NULL default). Feature-detect existencie `dopyt`
 * (minimálne migračné fixtures skáču za v25 bez `dopyt` tabuľky) — vzor `migrateDopytCenaHladina`.
 */
export function migrateDopytProdukt(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 35) return;
	const maDopyt =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dopyt'").get() !==
		undefined;
	db.transaction(() => {
		if (maDopyt) {
			db.exec('ALTER TABLE dopyt ADD COLUMN produkt TEXT;');
		}
		bump(35);
	})();
}

/**
 * v35 → v36 (#440, HOTFIX): per-sklo korekcia rozmeru skla. Nový nullable stĺpec
 * `sklo_korekcia` na `glass_types` — ABSOLÚTNY override systémovej korekcie `cfg_sys.sklo_offset`
 * (NULL = použiť systémový offset, čo je bit-identické doterajšie správanie). Umožňuje Patrikovi
 * nastaviť korekciu solo pre 16 mm vs 6 mm sklo v Slide (msg 1783582), namiesto jednej hodnoty
 * na celý systém. ADD COLUMN INTEGER BEZ default → všetky existujúce riadky ostanú NULL (žiadna
 * zmena čísel; kontraktové compute vektory nedotknuté). Idempotentné: PRAGMA table_info kontrola,
 * ALTER len ak stĺpec chýba. Feature-detect existencie `glass_types` (vzor `migrateManualMoveColumn`
 * pre `odpis_log`): minimálne migračné fixtures, ktoré `glass_types` nestavajú, ALTER preskočia;
 * reálna prod DB ju má od v1 (recreate vo v22). Celé v `db.transaction` (ALTER je v SQLite transakčné
 * → pád sa čisto prehrá). MONEY-NEUTRÁLNE: mení sa len vypočítaný rozmer skla pri nastavenom override,
 * mechanika Money zápisu/dedup nedotknutá. Extrahované sem (large-file-split — `migracie.ts` je pri
 * 1000-riadkovom strope), vzor `migrateDopytProdukt`.
 */
export function migrateGlassKorekcia(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 36) return;
	const maGlass =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='glass_types'").get() !==
		undefined;
	db.transaction(() => {
		if (maGlass) {
			const cols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map(
				(c) => c.name
			);
			if (!cols.includes('sklo_korekcia'))
				db.exec('ALTER TABLE glass_types ADD COLUMN sklo_korekcia INTEGER;');
		}
		bump(36);
	})();
}

/**
 * v36 → v37 (#443): trieda skladby posuvu podľa HRÚBKY skla (6 mm vs 16 mm) namiesto
 * per-sklo korekcie. Patrik (Odoo msg 1789477/1789479): pri 50–100 skladbách z Odoo je
 * per-sklo os (#440) neudržateľná — pre nárezák je podstatná LEN trieda skladby (6mm/16mm),
 * nie konkrétne sklo. Nový nullable stĺpec `glass_types.hrubka_trieda` (6|16|NULL — trieda
 * SKLADBY, nekoliduje s `hrubka` — Deluxe-only fyzická 6/10 mm) + nová tabuľka
 * `cfg_sklo_trieda(system, trieda, korekcia)` — korekcia sa nastaví RAZ na (systém × trieda).
 *
 * Backfill zo SKUTOČNE KURÁTOROVANÝCH dát, nikdy z názvu naslepo:
 *  - Slide: z `redukcia_zero` (1 = IZO 4/8/4 = trieda 16, presne Patrikovo zoskupenie).
 *  - Štandard +: z `jeIzoSklo(nazov)` — ten istý regex, ktorý dnes vyberá basic/IZO
 *    nárezák (jednorazové zrkadlo pri migrácii, jediný zdroj pravdy).
 *  - Robust / Deluxe / 'ALL': honest-null — trieda sa neuplatňuje, správanie nezmenené.
 *
 * Promócia jednotných per-sklo `sklo_korekcia` (#440) na triedu — bit-parity (Patrik mohol
 * hodnoty od 1.9. nastaviť): pre každú (system, trieda) skupinu, ak KAŽDÉ jej sklo má
 * ROVNAKÚ non-NULL korekciu, povýš na `cfg_sklo_trieda` a vynuluj per-sklo overridy
 * (efektívne číslo sa nemení — reťaz `skloKorekcia ?? triedaKorekcia ?? systémová` dá to
 * isté). Nejednotné skupiny sa NEDOTKNÚ — ostanú ako viditeľný per-sklo override.
 *
 * Celé v `db.transaction` (ALTER/CREATE sú v SQLite transakčné → pád sa čisto prehrá).
 * Feature-detect `glass_types` (vzor v36 `migrateGlassKorekcia`) — minimálne migračné
 * fixtures, ktoré ju nestavajú, ALTER/backfill preskočia; reálna prod DB ju má od v1.
 * MONEY-NEUTRÁLNE: mení sa len vypočítaný rozmer skla + výber basic/IZO nárezáku pri
 * KLASIFIKOVANOM skle, žiadny Money kód/dedup sa nedotýka. Design komentár + zamietnuté
 * alternatívy na #443. Extrahované sem (large-file-split — `migracie.ts` je pri
 * 1000-riadkovom strope), vzor `migrateGlassKorekcia`.
 */
export function migrateHrubkaTrieda(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 37) return;
	const maGlass =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='glass_types'").get() !==
		undefined;
	db.transaction(() => {
		if (maGlass) {
			const cols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map(
				(c) => c.name
			);
			if (!cols.includes('hrubka_trieda'))
				db.exec('ALTER TABLE glass_types ADD COLUMN hrubka_trieda INTEGER;');
		}
		db.exec(`
			CREATE TABLE IF NOT EXISTS cfg_sklo_trieda (
				system TEXT NOT NULL,
				trieda INTEGER NOT NULL CHECK (trieda IN (6, 16)),
				korekcia INTEGER NOT NULL,
				PRIMARY KEY (system, trieda)
			);
		`);
		if (maGlass) {
			// 1) Slide: kurátorovaná os je `redukcia_zero` — NIKDY odvodenie z názvu.
			db.exec(`
				UPDATE glass_types SET hrubka_trieda = CASE WHEN redukcia_zero = 1 THEN 16 ELSE 6 END
				WHERE system = 'Slide';
			`);
			// 2) Štandard +: IZO-nosť podľa toho istého regexu, ktorý dnes vyberá basic/IZO
			// nárezák (jeIzoSklo) — jediný zdroj pravdy, jednorazové zrkadlo pri migrácii.
			const std = db
				.prepare("SELECT id, nazov FROM glass_types WHERE system = 'Štandard +'")
				.all() as { id: number; nazov: string }[];
			const updTrieda = db.prepare('UPDATE glass_types SET hrubka_trieda = ? WHERE id = ?');
			for (const g of std) updTrieda.run(jeIzoSklo(g.nazov) ? 16 : 6, g.id);
			// 3) Robust / Deluxe / 'ALL' → honest-null (nedotknuté, žiadna klasifikácia).

			// 4) Promócia jednotných per-sklo `sklo_korekcia` na triedu (parity-safe).
			const insTrieda = db.prepare(
				'INSERT OR REPLACE INTO cfg_sklo_trieda (system, trieda, korekcia) VALUES (?, ?, ?)'
			);
			const nullKorekcia = db.prepare(
				'UPDATE glass_types SET sklo_korekcia = NULL WHERE system = ? AND hrubka_trieda = ?'
			);
			for (const system of ['Slide', 'Štandard +']) {
				for (const trieda of [6, 16] as const) {
					const rows = db
						.prepare('SELECT sklo_korekcia FROM glass_types WHERE system = ? AND hrubka_trieda = ?')
						.all(system, trieda) as { sklo_korekcia: number | null }[];
					if (rows.length === 0) continue;
					const prva = rows[0]!.sklo_korekcia;
					const jednotna = rows.every((r) => r.sklo_korekcia === prva) ? prva : null;
					if (jednotna !== null) {
						insTrieda.run(system, trieda, jednotna);
						nullKorekcia.run(system, trieda);
					}
				}
			}
		}
		bump(37);
	})();
}

/**
 * v37 → v38 (#369): rozvin profilu do cenového snapshotu — pre výpočet spotreby
 * farby na lakovanie (`spotreba [kg] = rozvin [m²/bm] × dĺžka [bm] × 0,150`).
 * Rozvin = merná jednotka `m2` na Money artikli (m² povrchu na 1 bm), doťahovaný
 * `ceny-snapshot.py`; appka ho importuje do `material_prices.rozvin`. Aditívny
 * nullable stĺpec (O(1), neprepíše žiadny riadok — `database-migrations.md`),
 * feature-detect tabuľky (minimálne migračné fixtúry `material_prices` nemajú).
 * Money-NEUTRÁLNE — čisto display-only, žiadny odpis/write sa nemení.
 */
export function migrateMaterialRozvin(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 38) return;
	const maMaterial =
		db
			.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='material_prices'")
			.get() !== undefined;
	db.transaction(() => {
		if (maMaterial) {
			const cols = (
				db.prepare('PRAGMA table_info(material_prices)').all() as { name: string }[]
			).map((c) => c.name);
			if (!cols.includes('rozvin')) db.exec('ALTER TABLE material_prices ADD COLUMN rozvin REAL;');
		}
		bump(38);
	})();
}

/** #445: Štandard Drevo — second Standard nárezák for firm Drevostavby. 4K variant with priečka
 *  (ZASP00113 priečkový profil) + U-profiles (ZASP202439 in 3 roles: šírka, výška priečka,
 *  výška plný). Spodná koľajnica ZASP202432 (same as IZO). Centered priečka expressed via
 *  koef=0.5 on V dimension. Money-RELEVANT (new ZASP codes in odpis). Aditívne + idempotentné
 *  (hasSys guard). Sklá NEseedujeme — Drevo zdieľa katalóg cez glassTypesForSystem alias. */
export function migrateDrevostavby(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 40) return;
	// Feature-detect: minimálne migračné fixtures (v29 a pod.) nemajú cfg_sys/cfg_rez
	const maCfgSys =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfg_sys'").get() !==
		undefined;
	const maCfgRez =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cfg_rez'").get() !==
		undefined;
	if (!maCfgSys || !maCfgRez) {
		bump(40);
		return;
	}
	const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
	const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = db.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	db.transaction(() => {
		for (const s of seed.sys) {
			if (!s.sysStyl.startsWith('Štandard Drevo|')) continue;
			if (hasSys.get(s.sysStyl)) continue;
			insSys.run(s.sysStyl, s.N, s.skloOffset);
			for (const r of seed.rez.filter((x) => x.sysStyl === s.sysStyl))
				insRez.run(
					r.sysStyl,
					r.poradie,
					r.typ,
					r.kod,
					r.nazov,
					r.dim,
					r.koef,
					r.offset,
					r.delitN,
					r.kerf,
					r.pocetKs,
					r.sklozavisle,
					(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
					(r as { skloHrubka?: number }).skloHrubka ?? 0
				);
		}
		bump(40);
	})();
}

/** #417 faza 2: per-profil odpad (offcut) z narezov ulozeny pri odpise, aby ho Odoo note builder
 *  vedel precitat pri re-derivacii / retry (#349). FK CASCADE na odpis_log — uvolnenie odpisu
 *  zmaze aj odpad. Len zasklenia a sietka maju ffdPack waste data; moduly bez offcut (pergola,
 *  bazen, clip) tabulku nepouzivaju. Money-NEUTRALNE. */
/** v25 → v26: sledovanie zrkadlenia dopytu do Odoo CRM leadu (#278). MONEY-NEUTRÁLNE.
 *  Extrahované sem z migracie.ts (large-file-split) — pure move. */
export function migrateOdooLeadColumns(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 26) return;
	const maDopyt =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dopyt'").get() !==
		undefined;
	if (!maDopyt) {
		bump(26);
		return;
	}
	db.transaction(() => {
		db.exec(`
			ALTER TABLE dopyt ADD COLUMN odoo_lead_id INTEGER;
			ALTER TABLE dopyt ADD COLUMN odoo_attempts INTEGER NOT NULL DEFAULT 0;
			ALTER TABLE dopyt ADD COLUMN odoo_last_error TEXT NOT NULL DEFAULT '';
		`);
		bump(26);
	})();
}

/** #496: objednávka skla podklad — per-zákazka glass order items + file attachments.
 *  Money-NEUTRÁLNE (objednávka u dodávateľa, nie odpis). Handoff kontrakt pre Odoo subdev. */
export function migrateObjednavkaSkla(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 41) return;
	db.transaction(() => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS objednavka_skla (
				id INTEGER PRIMARY KEY,
				zak TEXT NOT NULL,
				zak_norm TEXT NOT NULL,
				op TEXT NOT NULL DEFAULT '',
				modul TEXT NOT NULL,
				popis TEXT NOT NULL DEFAULT '',
				sirka_mm REAL NOT NULL,
				vyska_mm REAL,
				v_lavo_mm REAL,
				v_pravo_mm REAL,
				pocet INTEGER NOT NULL DEFAULT 1,
				typ_skla TEXT NOT NULL DEFAULT '',
				sikmy INTEGER NOT NULL DEFAULT 0,
				m2 REAL,
				rezim TEXT NOT NULL DEFAULT 'rozmery' CHECK(rezim IN ('rozmery','atyp')),
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				created_by TEXT NOT NULL DEFAULT ''
			);
			CREATE INDEX IF NOT EXISTS idx_objednavka_skla_zak ON objednavka_skla(zak_norm);
			CREATE TABLE IF NOT EXISTS objednavka_skla_subory (
				id INTEGER PRIMARY KEY,
				polozka_id INTEGER NOT NULL REFERENCES objednavka_skla(id) ON DELETE CASCADE,
				nazov TEXT NOT NULL,
				typ TEXT NOT NULL DEFAULT '',
				velkost INTEGER NOT NULL DEFAULT 0,
				data BLOB NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX IF NOT EXISTS idx_objednavka_skla_subory_pol ON objednavka_skla_subory(polozka_id);
		`);
		bump(41);
	})();
}

export function migrateOdpisOdpad(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 39) return;
	const maOdpisLog =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='odpis_log'").get() !==
		undefined;
	db.transaction(() => {
		if (maOdpisLog) {
			db.exec(`
				CREATE TABLE IF NOT EXISTS odpis_odpad (
					id INTEGER PRIMARY KEY,
					odpis_log_id INTEGER NOT NULL REFERENCES odpis_log(id) ON DELETE CASCADE,
					profil_kod TEXT NOT NULL,
					profil_nazov TEXT NOT NULL,
					odpad_mm INTEGER NOT NULL,
					material_mm INTEGER NOT NULL,
					tyce INTEGER NOT NULL
				);
				CREATE INDEX IF NOT EXISTS idx_odpis_odpad_log ON odpis_odpad(odpis_log_id);
			`);
		}
		bump(39);
	})();
}

/** #364: predajná cena z Money cenníka PCMO na `material_prices` — display-only orientačná
 *  cena, hlavne pre BPK bazénové komponenty (61/173 kódov), ale PCMO pokrýva aj PCD/PRK/ZAS.
 *  Money-NEUTRÁLNE (appka nikdy do Money nepíše). Aditívny `ALTER … ADD COLUMN` (O(1)). */
export function migrateMaterialPredajPcmo(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 42) return;
	// material_prices existuje od v21; minimálne fixtúry ju nemusia mať → feature-detect
	const maTable =
		db
			.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='material_prices'")
			.get() !== undefined;
	db.transaction(() => {
		if (maTable) {
			db.exec('ALTER TABLE material_prices ADD COLUMN predaj_pcmo REAL');
		}
		bump(42);
	})();
}

/**
 * v42 → v43: rozšírenie katalógu skiel — plná škála výberu pre nárezový plán (#235).
 * Patrik (msg 1815122, 8.9.): „Budem potrebovať v nárezovom pláne možnosť výberu všetkého" —
 * rezané (Float 4/6/10), lepené (3.3.1/3.3.2), IZO (4-8-4/4-16-4), ESG kalené; vyhotovenia
 * číre/mliečne/stopsol. Pridáva nové riadky do Robust (14), Slide (12), Štandard+ (12).
 * Deluxe bez zmeny (špecifický Float kalené 6/10 pre kladka/klzný výber).
 *
 * Money-neutralita:
 * - Robust: žiadny sklozávislý profil → KAŽDÉ sklo je Money-identické (len popis na plán)
 * - Slide: redukcia_zero + hrubka_trieda nastavené: IZO→(1,16), single/laminated/ESG→(0,6)
 * - Štandard+: jeIzoSklo klasifikácia + hrubka_trieda: IZO→16, non-IZO→6
 * - money_kod=NULL pre všetky nové typy (honest-null, „cena nedostupná")
 *
 * Idempotentné: INSERT OR IGNORE vďaka UNIQUE(nazov, system).
 */
export function migrateGlassCatalogExpansion(
	db: Database.Database,
	bump: (v: number) => void
): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 43) return;
	// Feature-detect: minimálne migračné fixtúry nemusia mať glass_types
	const maTable =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='glass_types'").get() !==
		undefined;
	db.transaction(() => {
		if (maTable) {
			// INSERT OR IGNORE — UNIQUE(nazov, system) zabezpečí idempotentnosť.
			// hrubka_trieda nemusí existovať v minimálnych fixtúrach (pridáva ju v37) →
			// feature-detect; ak chýba, INSERT bez nej (v37 ju pridá + backfillne neskôr
			// na reálnej DB; na minimálnych fixtúrach je inertná).
			const cols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map(
				(c) => c.name
			);
			const hasTrieda = cols.includes('hrubka_trieda');
			const ins = hasTrieda
				? db.prepare(
						`INSERT OR IGNORE INTO glass_types
						 (nazov, redukcia_zero, poradie, system, hrubka, hrubka_trieda)
						 VALUES (?, ?, ?, ?, 0, ?)`
					)
				: db.prepare(
						`INSERT OR IGNORE INTO glass_types
						 (nazov, redukcia_zero, poradie, system, hrubka)
						 VALUES (?, ?, ?, ?, 0)`
					);
			// Wrapper: ak hrubka_trieda existuje, posielaj 5 args; ak nie, 4 args (trieda sa ignoruje).
			const add = (
				nazov: string,
				redukciaZero: number,
				poradie: number,
				system: string,
				trieda: number | null
			) => {
				if (hasTrieda) ins.run(nazov, redukciaZero, poradie, system, trieda);
				else ins.run(nazov, redukciaZero, poradie, system);
			};

			// ── Robust ── Money-neutrálne (žiadny sklozávislý profil)
			// hrubka_trieda=NULL (Robust nie je klasifikovaný)
			add('Izolačné sklo 4/16/4 stopsol', 0, 22, 'Robust', null);
			add('Izolačné sklo 4/8/4 číre', 0, 30, 'Robust', null);
			add('Izolačné sklo 4/8/4 mliečne', 0, 32, 'Robust', null);
			add('Izolačné sklo 4/8/4 stopsol', 0, 34, 'Robust', null);
			add('Float sklo 4 mm', 0, 40, 'Robust', null);
			add('Float sklo 6 mm', 0, 42, 'Robust', null);
			add('Float sklo 10 mm', 0, 44, 'Robust', null);
			add('3.3.1', 0, 50, 'Robust', null);
			add('3.3.1 mliečne', 0, 52, 'Robust', null);
			add('3.3.2', 0, 55, 'Robust', null);
			add('3.3.2 mliečne', 0, 57, 'Robust', null);
			add('ESG kalené 4 mm', 0, 70, 'Robust', null);
			add('ESG kalené 6 mm', 0, 72, 'Robust', null);
			add('ESG kalené 10 mm', 0, 74, 'Robust', null);

			// ── Slide ── redukcia_zero + hrubka_trieda musia sedieť:
			//   IZO (4/8/4, 4/16/4) → redukcia_zero=1, hrubka_trieda=16
			//   single/laminated/ESG → redukcia_zero=0, hrubka_trieda=6
			add('Izolačné sklo 4/8/4 stopsol', 1, 22, 'Slide', 16);
			add('Izolačné sklo 4/16/4 číre', 1, 24, 'Slide', 16);
			add('Izolačné sklo 4/16/4 mliečne', 1, 26, 'Slide', 16);
			add('Izolačné sklo 4/16/4 stopsol', 1, 28, 'Slide', 16);
			add('3.3.1 mliečne', 0, 52, 'Slide', 6);
			add('3.3.2', 0, 55, 'Slide', 6);
			add('3.3.2 mliečne', 0, 57, 'Slide', 6);
			add('Float sklo 4 mm', 0, 60, 'Slide', 6);
			add('Float sklo 10 mm', 0, 62, 'Slide', 6);
			add('ESG kalené 4 mm', 0, 70, 'Slide', 6);
			add('ESG kalené 6 mm', 0, 72, 'Slide', 6);
			add('ESG kalené 10 mm', 0, 74, 'Slide', 6);

			// ── Štandard + ── (zdieľaný so „Štandard" a „Štandard Drevo" cez GLASS_SYSTEM_ALIAS)
			// hrubka_trieda: IZO → 16, non-IZO → 6 (vzor v37 backfill z jeIzoSklo)
			add('3.3.1 mliečne', 0, 45, 'Štandard +', 6);
			add('3.3.2', 0, 47, 'Štandard +', 6);
			add('3.3.2 mliečne', 0, 49, 'Štandard +', 6);
			add('Izolačné sklo 4/8/4 číre', 0, 50, 'Štandard +', 16);
			add('Izolačné sklo 4/8/4 mliečne', 0, 52, 'Štandard +', 16);
			add('Izolačné sklo 4/8/4 stopsol', 0, 54, 'Štandard +', 16);
			add('Izolačné sklo 4/16/4 číre', 0, 56, 'Štandard +', 16);
			add('Izolačné sklo 4/16/4 mliečne', 0, 58, 'Štandard +', 16);
			add('Izolačné sklo 4/16/4 stopsol', 0, 60, 'Štandard +', 16);
			add('ESG kalené 4 mm', 0, 70, 'Štandard +', 6);
			add('ESG kalené 6 mm', 0, 72, 'Štandard +', 6);
			add('ESG kalené 10 mm', 0, 74, 'Štandard +', 6);
		}
		bump(43);
	})();
}

/**
 * v43 → v44: vyčistenie orphaned glass_types pre Štandard+ (#504, Patrik 10.9.).
 * v43 (migrateGlassCatalogExpansion) pridala plnú škálu skiel cez INSERT OR IGNORE ale
 * nevyčistila staré v9 seed záznamy (STANDARD_GLASS):
 *  - "Float sklo 10 mm" — v43 namiesto neho pridáva "ESG kalené 10 mm"
 *  - "Izolačné sklo 4.8.4" — nahradená v43 variantmi "Izolačné sklo 4/8/4 číre/mliečne/stopsol"
 * Money-neutrálne: obe sú nahradené Money-identickými variantmi (glass-catalog rule).
 */
export function migrateCleanupStandardPlusOrphans(
	db: Database.Database,
	bump: (v: number) => void
): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 44) return;
	const maTable =
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='glass_types'").get() !==
		undefined;
	db.transaction(() => {
		if (maTable) {
			db.prepare(
				"DELETE FROM glass_types WHERE system = 'Štandard +' AND nazov IN ('Float sklo 10 mm', 'Izolačné sklo 4.8.4')"
			).run();
		}
		bump(44);
	})();
}

// v44 → v45: Plán rezov — uloženie vygenerovaného plánu (#505, prečíslovaná z pôvodnej
// v43→v44 kvôli kolízii s #504 v44). Dominik chce uložiť výsledok optimalizátora
// (vstupná tabuľka + nastavenia) pod názvom, znovu otvoriť a vytlačiť. Ukladáme VSTUPY
// (cad_text + dlzka_tyce + rezna_medzera) — pri otvorení rekomputujeme cez
// spocitajPlanRezov(). ZAK je len textový label (voliteľné, brány sú externý nákup),
// nie FK. Money-NEUTRÁLNE.
export function migratePlanRezovUlozene(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 45) return;
	db.transaction(() => {
		db.exec(`
			CREATE TABLE IF NOT EXISTS plan_rezov_ulozene (
				id INTEGER PRIMARY KEY,
				nazov TEXT NOT NULL,
				zak TEXT NOT NULL DEFAULT '',
				cad_text TEXT NOT NULL,
				dlzka_tyce INTEGER NOT NULL DEFAULT 6000,
				rezna_medzera REAL NOT NULL DEFAULT 4,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				created_by TEXT NOT NULL DEFAULT ''
			);
			CREATE INDEX IF NOT EXISTS idx_plan_rezov_ulozene_nazov
				ON plan_rezov_ulozene(nazov);
		`);
		bump(45);
	})();
}

/**
 * v45 → v46: pridanie stĺpca `nakup_skladova_karta` do `material_prices` (#506,
 * prečíslovaná z pôvodnej v44→v45 kvôli kolízii s #505 v45).
 * Artikly_Artikl.PosledniCena — posledná nákupná cena na skladovej karte Money.
 * Pre BPK kusové komponenty JEDINÝ nákupný zdroj (NC cenník = 0/173).
 * Appka ho používa ako FALLBACK keď nakupCennik (NC) je null.
 * Vzor #364 (predaj_pcmo) — ALTER TABLE ADD COLUMN, O(1), žiadny rewrite.
 */
export function migrateMaterialNakupSkladovaKarta(
	db: Database.Database,
	bump: (v: number) => void
): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 46) return;
	const maTable =
		db
			.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='material_prices'")
			.get() !== undefined;
	db.transaction(() => {
		if (maTable) {
			db.exec('ALTER TABLE material_prices ADD COLUMN nakup_skladova_karta REAL');
		}
		bump(46);
	})();
}

/**
 * v46 → v47: Štandard + opona IZO nárezák — 3 nové sysStyl (#504 round 3, Patrik
 * úloha 854, msg 1823604 „Nárezový plán 2016 IZO + 2mm.xlsx"). 2×4K opona IZO je
 * 1:1 z reálneho Money nárezáku, 2×2K/2×3K sú ODVODENÉ z rovnakého vzoru (v pláne
 * čestne označené „odvodené" cez `odvodenyOdpisWarn`). Predtým (round 2) opona IZO
 * neexistovala a `sklaDoPonuky` IZO pri opone správne filtroval — teraz nárezák
 * existuje, takže `existuje('Štandard +|2x*K IZO')` sa preklopí a IZO sa v ponuke
 * objaví BEZ zmeny kódu v styl.ts. Money-korektnosť: pridávajú sa LEN dáta, žiaden
 * nový profilový kód (všetkých 12 už používajú existujúce Štandard+ štýly).
 *
 * Vzor v9 (Štandard + seed): idempotentný `hasSys` guard, insert z `seed` do
 * cfg_sys/cfg_rez. Fresh DB dostane riadky už cez v9 (číta AKTUÁLNY cfg_seed),
 * takže na fresh je táto migrácia no-op; existujúca prod DB (>= v9) ich dostane tu.
 * Feature-detect tabuliek (minimálne migračné fixtúry cfg_sys/cfg_rez nemusia mať).
 */
export function migrateOponaIzo(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 47) return;
	const maTables = db
		.prepare(
			"SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name IN ('cfg_sys','cfg_rez')"
		)
		.get() as { c: number };
	const NOVE = ['Štandard +|2x2K IZO', 'Štandard +|2x3K IZO', 'Štandard +|2x4K IZO'];
	db.transaction(() => {
		if (maTables.c === 2) {
			const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
			const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
			const insRez = db.prepare(
				`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			);
			// vzor v9: iteruj priamo FILTROVANÝ seed (s je vždy definované) + hasSys guard
			for (const s of seed.sys.filter((x) => NOVE.includes(x.sysStyl))) {
				if (hasSys.get(s.sysStyl)) {
					// už existuje (fresh DB cez v9, alebo ručne cez /nastavenia) → NEprepisuj;
					// loguj, aby bolo v prod audite vidno, že Excel-overený riadok nedostal prednosť
					log.info('migrateOponaIzo: sysStyl už existuje — preskočené', { sysStyl: s.sysStyl });
					continue;
				}
				insSys.run(s.sysStyl, s.N, s.skloOffset);
				log.info('migrateOponaIzo: opona IZO zoseedované', { sysStyl: s.sysStyl });
				for (const r of seed.rez.filter((x) => x.sysStyl === s.sysStyl))
					insRez.run(
						r.sysStyl,
						r.poradie,
						r.typ,
						r.kod,
						r.nazov,
						r.dim,
						r.koef,
						r.offset,
						r.delitN,
						r.kerf,
						r.pocetKs,
						r.sklozavisle,
						(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
						0 // opona IZO nemá hrúbko-závislé profily (sklo_hrubka=0, ako ne-opona IZO)
					);
			}
		}
		bump(47);
	})();
}
