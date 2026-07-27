// SQLite databáza — zdroj pravdy pre konfiguráciu vzorcov, dedup odpisov,
// užívateľov a audit trail. better-sqlite3 = synchrónne transakcie a UNIQUE
// constrainty (dedup je constraint v DB, nie kontrola v kóde).
import Database from 'better-sqlite3';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import seed from './cfg_seed.json';
import type { SysRow, RezRow, Cfg } from './compute';
import { buildCFG } from './compute';

const DB_PATH = process.env.DATABASE_PATH || './data/app.db';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = scryptSync(password, salt, 64).toString('hex');
	return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const check = scryptSync(password, salt, 64);
	const expected = Buffer.from(hash, 'hex');
	return check.length === expected.length && timingSafeEqual(check, expected);
}

function migrate() {
	const version = db.pragma('user_version', { simple: true }) as number;

	if (version < 1) {
		db.exec(`
			CREATE TABLE users (
				id INTEGER PRIMARY KEY,
				username TEXT NOT NULL UNIQUE,
				pass_hash TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now'))
			);
			CREATE TABLE sessions (
				token TEXT PRIMARY KEY,
				user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				expires_at INTEGER NOT NULL
			);
			CREATE TABLE cfg_sys (
				id INTEGER PRIMARY KEY,
				sys_styl TEXT NOT NULL UNIQUE,
				n INTEGER NOT NULL,
				sklo_offset REAL NOT NULL
			);
			CREATE TABLE cfg_rez (
				id INTEGER PRIMARY KEY,
				sys_styl TEXT NOT NULL,
				poradie INTEGER NOT NULL,
				typ TEXT NOT NULL CHECK (typ IN ('profil','sklo')),
				kod TEXT NOT NULL DEFAULT '',
				nazov TEXT NOT NULL,
				dim TEXT NOT NULL CHECK (dim IN ('S','V')),
				koef REAL NOT NULL DEFAULT 1,
				offset REAL NOT NULL DEFAULT 0,
				delit_n INTEGER NOT NULL DEFAULT 0,
				kerf REAL NOT NULL DEFAULT 0,
				pocet_ks REAL NOT NULL DEFAULT 0,
				sklozavisle INTEGER NOT NULL DEFAULT 0,
				dlzka_tyce REAL NOT NULL DEFAULT 7500
			);
			CREATE INDEX idx_cfg_rez_sys ON cfg_rez(sys_styl, poradie);
			CREATE TABLE glass_types (
				id INTEGER PRIMARY KEY,
				nazov TEXT NOT NULL UNIQUE,
				redukcia_zero INTEGER NOT NULL DEFAULT 0,
				poradie INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE cfg_audit (
				id INTEGER PRIMARY KEY,
				ts TEXT NOT NULL DEFAULT (datetime('now')),
				username TEXT NOT NULL,
				sys_styl TEXT NOT NULL,
				zmeny TEXT NOT NULL
			);
			CREATE TABLE odpis_log (
				id INTEGER PRIMARY KEY,
				modul TEXT NOT NULL,
				zak TEXT NOT NULL,
				op TEXT NOT NULL,
				zakaznik TEXT NOT NULL,
				caka INTEGER NOT NULL DEFAULT 0,
				live INTEGER NOT NULL,
				target TEXT NOT NULL,
				filename TEXT NOT NULL,
				content_hash TEXT NOT NULL DEFAULT '',
				detail TEXT NOT NULL DEFAULT '{}',
				created_by TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (modul, zak, op, live)
			);
			CREATE TABLE problem_reports (
				id INTEGER PRIMARY KEY,
				ts TEXT NOT NULL DEFAULT (datetime('now')),
				username TEXT NOT NULL DEFAULT '',
				oblast TEXT NOT NULL DEFAULT '',
				popis TEXT NOT NULL
			);
		`);
		db.pragma('user_version = 2');
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 2) {
		// v1 → v2: odpis_log zovšeobecnený pre všetky moduly — dedup kľúč obsahuje
		// modul (jedna ZAK môže mať legitímne pergolu AJ bazén AJ zasklenia).
		// ATOMICKY (BEGIN/COMMIT) + idempotentne (DROP IF EXISTS) — prerušená
		// migrácia na produkčnej DB nesmie zanechať polovičný stav ani crash-loop.
		db.exec(`
			BEGIN;
			DROP TABLE IF EXISTS odpis_log2;
			CREATE TABLE odpis_log2 (
				id INTEGER PRIMARY KEY,
				modul TEXT NOT NULL,
				zak TEXT NOT NULL,
				op TEXT NOT NULL,
				zakaznik TEXT NOT NULL,
				caka INTEGER NOT NULL DEFAULT 0,
				live INTEGER NOT NULL,
				target TEXT NOT NULL,
				filename TEXT NOT NULL,
				content_hash TEXT NOT NULL DEFAULT '',
				detail TEXT NOT NULL DEFAULT '{}',
				created_by TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				UNIQUE (modul, zak, op, live)
			);
			INSERT INTO odpis_log2 (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at)
				SELECT id, 'zasklenia', zak, op, zakaznik, caka, live, target, filename, content_hash,
					json_object('system', system, 'styl', styl, 's', s, 'v', v, 'sklo', sklo, 'otvaranie', otvaranie),
					created_by, created_at
				FROM odpis_log;
			DROP TABLE odpis_log;
			ALTER TABLE odpis_log2 RENAME TO odpis_log;
			PRAGMA user_version = 2;
			COMMIT;
		`);
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 3) {
		// v2 → v3: sklá majú systém (Robust = 4/16/4, Slide = 4/8/4) + Slide
		// „4/8/4 číre" nuluje Redukciu 6mm. Sklá sú konfigurácia (nie user dáta),
		// bezpečne ich preseedujeme na nový systémovo-rozlíšený set.
		db.exec(`
			BEGIN;
			ALTER TABLE glass_types ADD COLUMN system TEXT NOT NULL DEFAULT 'ALL';
			DELETE FROM glass_types;
			PRAGMA user_version = 3;
			COMMIT;
		`);
		seedGlass();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 5) {
		// v3 → v5: pridaj systémy/štýly z cfg_seed, ktoré v DB ešte nie sú (v4: Robust
		// 4K + 2x4K; v5: Slide opona 2x2K + 2x3K). Existujúce štýly sa NEDOTÝKAJÚ (mohli
		// byť ručne upravené v editore vzorcov). Idempotentné — pridá len chýbajúce
		// sysStyl aj ich rez riadky (bezpečne re-spustiteľné pri každom novom štýle).
		const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		db.transaction(() => {
			for (const s of seed.sys) {
				// Deluxe sa seeduje až v <6 (potrebuje stĺpec dlzka_tyce, ktorý tu ešte nemusí existovať)
				if (s.sysStyl.startsWith('Deluxe')) continue;
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
						r.sklozavisle
					);
			}
			db.pragma('user_version = 5');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 6) {
		// v5 → v6: Deluxe zasklenie (posuvná sklenená stena) — 10 štýlov + per-profil
		// dĺžka tyče (kladka/klzný 3600, 5K horná koľajnica 6000; Money-kritické, lebo
		// odpis = tyče × dĺžka tyče). Pridá stĺpec dlzka_tyce (existujúce Robust/Slide
		// riadky → default 7500, nezmenené) a naseeduje Deluxe štýly aj ich sklá.
		// Idempotentné: ALTER len ak stĺpec chýba, štýl/sklo len ak ešte nie sú.
		const hasCol = (
			db.prepare('PRAGMA table_info(cfg_rez)').all() as { name: string }[]
		).some((c) => c.name === 'dlzka_tyce');
		// ALTER PRED prepare(insRez) — prepare validuje SQL proti aktuálnej schéme,
		// takže stĺpec musí existovať skôr. Idempotentné cez hasCol; ak by seed
		// transakcia nižšie zlyhala, re-run preskočí ALTER (hasCol) a doseeduje.
		if (!hasCol) db.exec('ALTER TABLE cfg_rez ADD COLUMN dlzka_tyce REAL NOT NULL DEFAULT 7500');
		const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const hasGlass = db.prepare('SELECT 1 FROM glass_types WHERE nazov = ?');
		const insGlass = db.prepare(
			'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
		);
		db.transaction(() => {
			for (const s of seed.sys) {
				if (!s.sysStyl.startsWith('Deluxe')) continue;
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
						(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500
					);
			}
			for (const g of DELUXE_GLASS) if (!hasGlass.get(g.nazov)) insGlass.run(g.nazov, 0, g.poradie, 'Deluxe');
			// zosúlaď dĺžku tyče s cfg_seed pre VŠETKY riadky. v<5 seed beží skôr než
			// existuje stĺpec dlzka_tyce, takže non-Deluxe riadky by inak dostali len
			// ALTER default 7500 — ak by non-Deluxe profil niekedy potreboval ≠7500,
			// tu sa to premietne (fresh aj upgrade rovnako). dlzka_tyce NIE je
			// user-editovateľná, takže prepis neprepíše ručnú úpravu vzorca. Dnes no-op.
			const updBar = db.prepare('UPDATE cfg_rez SET dlzka_tyce = ? WHERE sys_styl = ? AND poradie = ?');
			for (const r of seed.rez)
				updBar.run((r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500, r.sysStyl, r.poradie);
			db.pragma('user_version = 6');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 7) {
		// v6 → v7: Deluxe — HRÚBKA SKLA (6/10 mm) vyberá kladka/klzný profil, nie štýl.
		// v6 mala 5K6/5K10/6K6/6K10 ako 4 štýly + malé typy napevno 10mm; Dominik
		// (2026-07-10): 6/10 je vlastnosť SKLA, platí pre všetkých 8 štýlov (2K…6K),
		// aby nárezáky neboli duplicitné 6/10. (Deluxe sa reže na 90° — rieši compute
		// per profil cez system==='Deluxe'.) Pridá sklo_hrubka (cfg_rez: 0=vždy,
		// 6/10=len pre danú hrúbku) a hrubka (glass_types). Deluxe je čerstvé (žiadne
		// reálne odpisy) → bezpečne ZMAŽ všetky Deluxe cfg a re-seeduj 8 štýlov z
		// cfg_seed. Robust/Slide sa NEDOTÝKA. Idempotentné cez PRAGMA + DELETE-then-seed.
		const rezCols = (db.prepare('PRAGMA table_info(cfg_rez)').all() as { name: string }[]).map(
			(c) => c.name
		);
		if (!rezCols.includes('sklo_hrubka'))
			db.exec('ALTER TABLE cfg_rez ADD COLUMN sklo_hrubka INTEGER NOT NULL DEFAULT 0');
		const glassCols = (
			db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]
		).map((c) => c.name);
		if (!glassCols.includes('hrubka'))
			db.exec('ALTER TABLE glass_types ADD COLUMN hrubka INTEGER NOT NULL DEFAULT 0');
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		db.transaction(() => {
			db.prepare("DELETE FROM cfg_rez WHERE sys_styl LIKE 'Deluxe|%'").run();
			db.prepare("DELETE FROM cfg_sys WHERE sys_styl LIKE 'Deluxe|%'").run();
			for (const s of seed.sys) {
				if (!s.sysStyl.startsWith('Deluxe')) continue;
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
			// Deluxe Float kalené: hrúbka skla vyberá profil (6 → kladka/klzný 6mm, 10 → 10mm)
			db.prepare("UPDATE glass_types SET hrubka = 6 WHERE nazov = 'Float kalené 6 mm'").run();
			db.prepare("UPDATE glass_types SET hrubka = 10 WHERE nazov = 'Float kalené 10 mm'").run();
			db.pragma('user_version = 7');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 8) {
		// v7 → v8: B2B veľkoobchodná rola. Aditívne — appka je v ostrom používaní,
		// existujúci users → 'internal' (default), interný tok sa nemení. Feature je
		// neaktívny, kým nevznikne prvý 'b2b' účet. Idempotentné cez PRAGMA + column check.
		const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
			(c) => c.name
		);
		if (!userCols.includes('role'))
			db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'internal'");
		db.pragma('user_version = 8');
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 9) {
		// v8 → v9: Štandard + zasklenie — nový systém (basic 2K…6K, IZO 2K IZO…6K IZO,
		// opona 2x2K/2x3K/2x4K = 13 štýlov). Aditívne — Robust/Slide/Deluxe sa
		// NEDOTÝKAJÚ. Kopíruje presne v6 vzor (Deluxe seed): idempotentné cez
		// hasSys/hasGlass guardy, žiadny ALTER (dlzka_tyce aj sklo_hrubka už existujú z v6/v7).
		const hasSys = db.prepare('SELECT 1 FROM cfg_sys WHERE sys_styl = ?');
		const insSys = db.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
		const insRez = db.prepare(
			`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const hasGlass = db.prepare('SELECT 1 FROM glass_types WHERE nazov = ?');
		const insGlass = db.prepare(
			'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
		);
		db.transaction(() => {
			for (const s of seed.sys) {
				if (!s.sysStyl.startsWith('Štandard +')) continue;
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
			for (const g of STANDARD_GLASS)
				if (!hasGlass.get(g.nazov)) insGlass.run(g.nazov, 0, g.poradie, 'Štandard +');
			db.pragma('user_version = 9');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 10) {
		// v9 → v10: oprava šírky skla Štandard + (Dominik 2026-07-14: skla o 2 mm užšie).
		// Do vzorca šírky skla vypadla +2 mm rezná rezerva (má byť G+14) → offset bol
		// o 2N nižší. Sklo NIE je v Money odpise — mení sa len informatívny rozmer rezu.
		// Idempotentné: SETuje offset na SPRÁVNU hodnotu z (opraveného) cfg_seed per
		// (sys_styl, poradie), takže fresh DB (už správne nasedený) ostane, starý sa opraví.
		const updOff = db.prepare('UPDATE cfg_rez SET offset = ? WHERE sys_styl = ? AND poradie = ?');
		db.transaction(() => {
			for (const r of seed.rez)
				if (r.sysStyl.startsWith('Štandard +') && r.nazov === 'Sklo šírka')
					updOff.run(r.offset, r.sysStyl, r.poradie);
			db.pragma('user_version = 10');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 11) {
		// v10 → v11: oprava NÁZVOV profilov Štandard + podľa Money katalógu (Dominik
		// 2026-07-15: kód sedí, ale názov je domotaný — „Kladkový prírez", „Krajový
		// profil", „X IZO (o veľkosť väčšia)"…). Názov je len zobrazenie na pláne —
		// Money odpis matchuje na KÓD, takže Money-safe. Idempotentné: SET názov na
		// hodnotu z (opraveného) cfg_seed per (sys_styl, poradie).
		const updNaz = db.prepare('UPDATE cfg_rez SET nazov = ? WHERE sys_styl = ? AND poradie = ?');
		db.transaction(() => {
			for (const r of seed.rez)
				if (r.sysStyl.startsWith('Štandard +') && r.typ === 'profil')
					updNaz.run(r.nazov, r.sysStyl, r.poradie);
			db.pragma('user_version = 11');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 12) {
		// v11 → v12: Štandard + IZO spodná koľajnica späť na NORMÁLNU (Dominik 2026-07-15:
		// veľkosť koľajnice NEurčuje IZO — o 1 väčšiu dá až nový checkbox „prídavná
		// koľajnica"). IZO 2K/3K/4K/5K malo automaticky väčšiu → SET kód+názov spodnej
		// koľajnice z (opraveného) cfg_seed per (sys_styl, poradie). MENÍ Money odpis
		// IZO objednávok (kód spodnej koľajnice) — schválené Dominikom. Idempotentné.
		const updRail = db.prepare(
			'UPDATE cfg_rez SET kod = ?, nazov = ? WHERE sys_styl = ? AND poradie = ?'
		);
		db.transaction(() => {
			for (const r of seed.rez)
				if (/^Štandard \+\|\d+K IZO$/.test(r.sysStyl) && /spodná/i.test(r.nazov))
					updRail.run(r.kod, r.nazov, r.sysStyl, r.poradie);
			db.pragma('user_version = 12');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 13) {
		// v12 → v13: Slide opona (2x2K + 2x3K) — oprava SKLA (+ jemné doladenie nosového
		// a oponového rezu) podľa reálnych Excelov od Dominika (2026-07-23). Predtým bola
		// geometria odvodená z Robust opony (Money Slide oponu nemá) → sklo nesedelo.
		// Opravené offsety: sklo šírka (2x3K 142,5 / 2x2K 40,6), sklo výška (V−67),
		// nosový + oponový rez (V−67, −2 mm). MONEY-NEUTRÁLNE: odpis (kódy + počty tyčí +
		// metre) je IDENTICKÝ pred/po — overené na celej mriežke rozmerov (S 3000–8000 ×
		// V 1800–2600 × obe sklá). Sklo NIE je v Money odpise; nosový/oponový −2 mm nikdy
		// nepreklopí počet tyčí. KÓDY sa NEMENIA (Money katalóg potvrdil, že appka ich má
		// správne). Rámový šírkový rez sa NEMENÍ v tejto migrácii — jeho oprava by menila
		// billing ZASP00088, čaká na samostatné potvrdenie Dominikom. Idempotentné: SET
		// offset z (opraveného) cfg_seed per (sys_styl, poradie); nezmenené riadky no-op.
		const updOff = db.prepare('UPDATE cfg_rez SET offset = ? WHERE sys_styl = ? AND poradie = ?');
		db.transaction(() => {
			for (const r of seed.rez)
				if (r.sysStyl === 'Slide|2x2K' || r.sysStyl === 'Slide|2x3K')
					updOff.run(r.offset, r.sysStyl, r.poradie);
			db.pragma('user_version = 13');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 14) {
		// v13 → v14: Slide opona rámový šírkový rez podľa reálneho Excelu od Dominika
		// (potvrdené 2026-07-23): „dĺžka rezu" = (S−12)/N (offset −12), namiesto z-Robustu
		// odvodeného (S+127,47)/6 resp. +21. MENÍ Money billing profilu ZASP00088 (rámový):
		// na ~0,5 % (2x2K) resp. ~5,7 % (2x3K) rozmerov o 1–2 tyče MENEJ (kratší rez → menej
		// tyčí). SCHVÁLENÉ Dominikom (appka predtým rámový mierne prebíjala). Idempotentné:
		// SET offset z (opraveného) cfg_seed pre rámový (poradie 20) Slide 2x2K/2x3K.
		// ⚠️ TÁTO MIGRÁCIA BOLA POSTAVENÁ NA ZLOM STĹPCI EXCELU (`Q` „dĺžka rezu" namiesto
		// `E` „rozmer") — opravuje ju v15 nižšie. Blok zostáva pre správnu postupnosť
		// user_version na už nasadenej DB; v15 hodnoty prepíše.
		const updOff = db.prepare('UPDATE cfg_rez SET offset = ? WHERE sys_styl = ? AND poradie = ?');
		db.transaction(() => {
			for (const r of seed.rez)
				if ((r.sysStyl === 'Slide|2x2K' || r.sysStyl === 'Slide|2x3K') && r.poradie === 20)
					updOff.run(r.offset, r.sysStyl, r.poradie);
			db.pragma('user_version = 14');
		})();
	}

	if ((db.pragma('user_version', { simple: true }) as number) < 15) {
		// v14 → v15: Slide opona — OPRAVA v14 + oponový kód. Dvojica nálezov od pracovníka
		// z dielne (2026-07-27), oboje overené proti zdroju:
		//
		// 1) RÁMOVÝ REZ: Excel od Dominika má na ten istý profil DVA stĺpce — `E` „rozmer"
		//    (čo sa reálne reže: (S+142,5)/N resp. (S+40,6)/N, V−67) a `Q` „dĺžka rezu"
		//    (odpisové stĺpce: (S−12)/N, V−65). v14 vzala `Q`; dielňa reže podľa `E`
		//    (pracovník: „5000×2000 → 857 a 1933, od vás 1935 a 831"). `Q` je v Exceli
		//    zastaraný leftover — dôkaz: nosový riadok si `Q` berie referenciou z `E`
		//    (=E15), rámový má v `Q` ručne zadané staré −65/−12. Rámový `E` = sklo + 83
		//    (skloOffset), čo presne zodpovedá už overeným sklo offsetom z v13.
		//    MENÍ Money billing ZASP00088 NAHOR: 3,8 % rozmerov (6218/162324 na mriežke
		//    S 3000–8000 × V 1800–2600 × obe sklá × 2 štýly), vždy len nahor, max +15 m.
		//    Je to čestná korekcia — reže sa dlhší kus, než na aký v14 počítala tyče, čiže
		//    appka po v14 rámový PODúčtovala. Ruší zníženie zavedené vo v14.
		//
		// 2) OPONOVÝ KÓD: ZASP00006 → ZASP20249. Money katalóg: ZASP00006 = „Oponový profil
		//    Surový", Model_UserData = **Zasklenie Robust** (dodávateľ FINAL, 2021);
		//    ZASP20249 = „Oponový profil surový", Model_UserData = **Zasklenie Slide**
		//    (Cortizo, 2024). Slide opona bola odvodená z Robustu, takže dosiaľ odpisovala
		//    ROBUSTOVÝ článok. Množstvo (1 ks, V−67) sa nemení — mení sa len článok, na
		//    ktorý ide odpis. (Excel má v tom riadku ZASP00091, čo je podľa katalógu
		//    „Redukcia 6 mm" — preklep v Exceli; pracovník potvrdil ZASP20249.)
		//
		// Idempotentné: SET z (opraveného) cfg_seed per (sys_styl, poradie).
		const updOff = db.prepare('UPDATE cfg_rez SET offset = ? WHERE sys_styl = ? AND poradie = ?');
		const updKod = db.prepare(
			'UPDATE cfg_rez SET kod = ?, nazov = ? WHERE sys_styl = ? AND poradie = ?'
		);
		db.transaction(() => {
			for (const r of seed.rez) {
				if (r.sysStyl !== 'Slide|2x2K' && r.sysStyl !== 'Slide|2x3K') continue;
				if (r.poradie === 20 || r.poradie === 21) updOff.run(r.offset, r.sysStyl, r.poradie);
				if (r.poradie === 25) updKod.run(r.kod, r.nazov, r.sysStyl, r.poradie);
			}
			db.pragma('user_version = 15');
		})();
	}

	seedData();
	seedUsers();
}

// Deluxe sklá (Float kalené) — len na plán/objednávku, NIE v Money odpise; žiadna
// redukcia (redukcia_zero = 0). 6/10 mm zodpovedá priemeru kladky štýlu.
const DELUXE_GLASS = [
	{ nazov: 'Float kalené 6 mm', poradie: 10 },
	{ nazov: 'Float kalené 10 mm', poradie: 20 }
];

// Štandard + sklá — len na plán/objednávku, NIE v Money odpise (žiadna redukcia).
// basic štýly berú jednoduché sklo (4/6/10 mm), IZO štýly izolačné 4.8.4, opona
// jednoduché Float 4 mm (spec: "type Float 4"). Systém je jeden ('Štandard +')
// naprieč basic/IZO/opona štýlmi — rovnako ako Deluxe má jeden 'Deluxe' systém
// naprieč 2K…6K; geometria (basic/IZO/opona) sa vyberá ŠTÝLOM, nie sklom.
const STANDARD_GLASS = [
	{ nazov: 'Float sklo 4 mm', poradie: 10 },
	{ nazov: 'Float sklo 6 mm', poradie: 20 },
	{ nazov: 'Float sklo 10 mm', poradie: 30 },
	{ nazov: 'Izolačné sklo 4.8.4', poradie: 40 }
];

// Sklá podľa systému: Robust = izolačné 4/16/4, Slide = izolačné 4/8/4
// (Slide „4/8/4 číre" nuluje Redukciu 6mm — sklozavislé profily sa nepočítajú),
// kalené sklá platia pre oba systémy (system = 'ALL').
function seedGlass() {
	const ins = db.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
	);
	db.transaction(() => {
		ins.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust');
		ins.run('Izolačné sklo 4/16/4 číre', 0, 20, 'Robust');
		ins.run('Izolačné sklo 4/8/4 mliečne', 0, 10, 'Slide');
		ins.run('Izolačné sklo 4/8/4 číre', 1, 20, 'Slide');
		ins.run('Kalené 8mm', 0, 30, 'ALL');
		ins.run('Kalené 10mm', 0, 40, 'ALL');
	})();
}

function seedData() {
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
	if (glassCount === 0) seedGlass();
}

function seedUsers() {
	const userCount = (db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c;
	if (userCount === 0) {
		const spec = process.env.SEED_USERS || '';
		const ins = db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)');
		for (const pair of spec.split(',').filter(Boolean)) {
			const idx = pair.indexOf(':');
			if (idx < 1) continue;
			ins.run(pair.slice(0, idx).trim(), hashPassword(pair.slice(idx + 1)));
		}
	}
}

migrate();

// ---- konfigurácia vzorcov ----

export function loadCfg(): Cfg {
	const sys = (db.prepare('SELECT sys_styl, n, sklo_offset FROM cfg_sys').all() as {
		sys_styl: string;
		n: number;
		sklo_offset: number;
	}[]).map<SysRow>((r) => ({ sysStyl: r.sys_styl, N: r.n, skloOffset: r.sklo_offset }));
	const rez = (db
		.prepare(
			'SELECT sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka FROM cfg_rez ORDER BY sys_styl, poradie'
		)
		.all() as Record<string, unknown>[]).map<RezRow>((r) => ({
		sysStyl: r.sys_styl as string,
		poradie: r.poradie as number,
		typ: r.typ as 'profil' | 'sklo',
		kod: r.kod as string,
		nazov: r.nazov as string,
		dim: r.dim as 'S' | 'V',
		koef: r.koef as number,
		offset: r.offset as number,
		delitN: r.delit_n as 0 | 1,
		kerf: r.kerf as number,
		pocetKs: r.pocet_ks as number,
		sklozavisle: r.sklozavisle as 0 | 1,
		dlzkaTyce: r.dlzka_tyce as number,
		skloHrubka: r.sklo_hrubka as number
	}));
	return buildCFG(sys, rez);
}

export function listSysStyly(): { sysStyl: string; system: string; styl: string; N: number }[] {
	return (db.prepare('SELECT sys_styl, n FROM cfg_sys ORDER BY sys_styl').all() as {
		sys_styl: string;
		n: number;
	}[]).map((r) => ({
		sysStyl: r.sys_styl,
		system: r.sys_styl.split('|')[0],
		styl: r.sys_styl.split('|')[1],
		N: r.n
	}));
}

export interface GlassType {
	nazov: string;
	redukciaZero: boolean;
	system: string;
	/** hrúbka skla (mm): Deluxe Float kalené = 6/10 (vyberá kladka/klzný profil); inak 0 */
	hrubka: number;
}

export function listGlassTypes(): GlassType[] {
	return (db
		.prepare('SELECT nazov, redukcia_zero, system, hrubka FROM glass_types ORDER BY poradie')
		.all() as { nazov: string; redukcia_zero: number; system: string; hrubka: number }[]).map((r) => ({
		nazov: r.nazov,
		redukciaZero: !!r.redukcia_zero,
		system: r.system,
		hrubka: r.hrubka
	}));
}

/** Sklá platné pre daný systém. Deluxe: LEN vlastné (Float kalené 6/10, hrúbka
 *  vyberá profil) — spoločné 'ALL' sklá (Kalené 8mm/10mm) nemajú Deluxe profil.
 *  Štandard +: rovnako LEN vlastné (Float 4/6/10 + Izolačné 4.8.4) — spoločné
 *  'ALL' sklá nemajú Štandard + profil (rovnaký dôvod ako Deluxe).
 *  Robust/Slide: vlastné + spoločné 'ALL'. */
export function glassTypesForSystem(system: string): GlassType[] {
	if (system === 'Deluxe' || system === 'Štandard +')
		return listGlassTypes().filter((g) => g.system === system);
	return listGlassTypes().filter((g) => g.system === system || g.system === 'ALL');
}

// ---- user-admin (B2B veľkoobchodné účty) ----

export function listUsers() {
	return db
		.prepare('SELECT id, username, role, created_at FROM users ORDER BY role, username')
		.all() as { id: number; username: string; role: string; created_at: string }[];
}

export function addUser(
	username: string,
	password: string,
	role: 'internal' | 'b2b'
): { error: string | null } {
	const u = username.trim();
	if (!u) return { error: 'Meno účtu je povinné.' };
	if (password.length < 6) return { error: 'Heslo musí mať aspoň 6 znakov.' };
	// NOCASE: zabráň dvom účtom líšiacim sa len veľkosťou písmen (login je tiež
	// case-insensitive) — inak by 'Obchod@…' aj 'obchod@…' koexistovali a mýlili.
	const exists = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(u);
	if (exists) return { error: `Účet „${u}" už existuje.` };
	db.prepare('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)').run(
		u,
		hashPassword(password),
		role
	);
	return { error: null };
}

/** Zmaže LEN b2b účet (interné účty nie — ochrana proti lockoutu). Sessions padnú cez CASCADE. */
export function deleteB2BUser(id: number): { error: string | null } {
	const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined;
	if (!row) return { error: 'Účet neexistuje.' };
	if (row.role !== 'b2b') return { error: 'Zmazať sa dajú len B2B účty.' };
	db.prepare('DELETE FROM users WHERE id = ?').run(id);
	return { error: null };
}
