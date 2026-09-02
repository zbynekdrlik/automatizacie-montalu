// Seed dáta + seed funkcie — extrahované z `migracie.ts` (#294), aby `migracie.ts` zostal pod
// 1000-riadkovým stropom (large-file-split). Rovnaký vzor ako #183 (db.ts → migracie.ts):
// PURE MOVE, nulová zmena správania. Funkcie berú `db`/`hashPassword` ako PARAMETRE (parameter
// injection, nie import z `migracie.ts`) → žiadny cyklický import v ani jednom smere. Konštanty
// aj funkcie sú exportované, lebo `migracie.ts` ich volá z migračných blokov (`migrate()`) aj na
// konci (`seedData`/`seedUsers`).
import type Database from 'better-sqlite3';
import seed from './cfg_seed.json';
import { logger } from './log';

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
 * v35 → v36 (#5825): durable APPEND-ONLY log pushov odpisu do Odoo modelu `montalu.material.odpis`
 * (`/json/2 create_from_app`, epic #5808 „aj-aj" cutover). NA ROZDIEL od `odoo_zakazka_push` (v34,
 * upsert per (zak,op)) je toto append-only log — každý import/release/reimport toho istého
 * `content_hash` je NOVÝ riadok, replay STRIKTNE v poradí `id` per hash (`povolitReimport` robí
 * import→release→import legitímnym; upsert+re-arm by zbalil históriu a rozišiel Odoo stav s Money).
 * `id INTEGER PRIMARY KEY AUTOINCREMENT` = monotónne, nikdy nerecyklované id. ŽIADEN poison-pill drop,
 * žiaden časový strop — odpis sa nesmie stratiť; retry cez `next_attempt_at` (exponenciálny backoff),
 * `pending=0` len pri úspechu alebo payload-permanentnej chybe (riadok ostáva pre audit/surface).
 * CREATE je v SQLite transakčné (pád sa čisto prehrá). MONEY-NEUTRÁLNE (len SQLite).
 */
export function migrateOdooOdpisPush(db: Database.Database, bump: (v: number) => void): void {
	if ((db.pragma('user_version', { simple: true }) as number) >= 36) return;
	db.transaction(() => {
		db.exec(`
			CREATE TABLE odoo_odpis_push (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				content_hash TEXT NOT NULL,
				action TEXT NOT NULL,
				payload TEXT NOT NULL,
				payload_version INTEGER NOT NULL DEFAULT 1,
				pending INTEGER NOT NULL DEFAULT 1,
				attempts INTEGER NOT NULL DEFAULT 0,
				next_attempt_at TEXT,
				last_error TEXT NOT NULL DEFAULT '',
				odoo_id INTEGER,
				sale_order_id INTEGER,
				posted_at TEXT,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				updated_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE INDEX idx_odoo_odpis_push_pending ON odoo_odpis_push(pending, next_attempt_at);
			CREATE INDEX idx_odoo_odpis_push_hash ON odoo_odpis_push(content_hash, id);
		`);
		bump(36);
	})();
}
