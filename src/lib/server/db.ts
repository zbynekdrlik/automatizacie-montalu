// SQLite databáza — zdroj pravdy pre konfiguráciu vzorcov, dedup odpisov,
// užívateľov a audit trail. better-sqlite3 = synchrónne transakcie a UNIQUE
// constrainty (dedup je constraint v DB, nie kontrola v kóde).
//
// Migrácie (`PRAGMA user_version` sekvenčný reťazec) žijú v `./migracie` (#183 —
// presunuté odtiaľto, keď sa `db.ts` blížil k 1000-riadkovému stropu). TENTO
// súbor drží len pripojenie + query API (`loadCfg`/`listSysStyly`/user-admin).
import Database from 'better-sqlite3';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SysRow, RezRow, Cfg } from './compute';
import { buildCFG } from './compute';
import { migrate } from './migracie';

// exportované pre štartovací config log v hooks.server.ts (#245); jediný zdroj cesty k DB
export const DB_PATH = process.env.DATABASE_PATH || './data/app.db';

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

migrate(db, hashPassword);

// ---- konfigurácia vzorcov ----

export function loadCfg(): Cfg {
	const sys = (
		db.prepare('SELECT sys_styl, n, sklo_offset FROM cfg_sys').all() as {
			sys_styl: string;
			n: number;
			sklo_offset: number;
		}[]
	).map<SysRow>((r) => ({ sysStyl: r.sys_styl, N: r.n, skloOffset: r.sklo_offset }));
	const rez = (
		db
			.prepare(
				'SELECT sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka FROM cfg_rez ORDER BY sys_styl, poradie'
			)
			.all() as Record<string, unknown>[]
	).map<RezRow>((r) => ({
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
	return (
		db.prepare('SELECT sys_styl, n FROM cfg_sys ORDER BY sys_styl').all() as {
			sys_styl: string;
			n: number;
		}[]
	).map((r) => ({
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
	return (
		db
			.prepare('SELECT nazov, redukcia_zero, system, hrubka FROM glass_types ORDER BY poradie')
			.all() as { nazov: string; redukcia_zero: number; system: string; hrubka: number }[]
	).map((r) => ({
		nazov: r.nazov,
		redukciaZero: !!r.redukcia_zero,
		system: r.system,
		hrubka: r.hrubka
	}));
}

/** Starší „Štandard" (bez plus) má PRESNE ten istý katalóg skiel ako Štandard +
 *  (Float 4/6/10 + „3.3.1" + Izolačné 4.8.4). Oba systémy čítajú riadky uložené pod
 *  `system='Štandard +'` — NIE preto, že názvy sú globálne unikátne (od migrácie v22
 *  je `glass_types` UNIQUE(nazov, system), takže to isté sklo môže legitímne existovať
 *  vo viacerých systémoch — napr. „3.3.1" je aj Slide aj Štandard +), ale preto, že
 *  starý Štandard sem cez tento alias zámerne smeruje. Preto sa sklo NIKDY nesmie
 *  hľadať len podľa názvu naprieč systémami — vždy cez `glassTypesForSystem(system)`. */
const GLASS_SYSTEM_ALIAS: Record<string, string> = { Štandard: 'Štandard +' };

/** Sklá platné pre daný systém. Deluxe: LEN vlastné (Float kalené 6/10, hrúbka
 *  vyberá profil) — spoločné 'ALL' sklá (Kalené 8mm/10mm) nemajú Deluxe profil.
 *  Štandard + (a zdieľajúci ho Štandard): rovnako LEN vlastné (Float 4/6/10 + „3.3.1"
 *  + Izolačné 4.8.4) — spoločné 'ALL' sklá nemajú Štandard profil (dôvod ako Deluxe).
 *  Robust/Slide: vlastné + spoločné 'ALL'. */
export function glassTypesForSystem(system: string): GlassType[] {
	const sys = GLASS_SYSTEM_ALIAS[system] ?? system;
	if (sys === 'Deluxe' || sys === 'Štandard +')
		return listGlassTypes().filter((g) => g.system === sys);
	return listGlassTypes().filter((g) => g.system === sys || g.system === 'ALL');
}

/** Money kód skla (TS* v cenníku IZOS) pre daný variant — LEN pre display-only
 *  zobrazenie ceny skla v nárezáku (#225). Kľúčované RIADKOM `(nazov, system)` cez
 *  ten istý alias + own/ALL princíp ako `glassTypesForSystem`, NIKDY len podľa názvu
 *  naprieč systémami (glass-catalog rule). `null` = variant nemá namapovaný kód
 *  (väčšina; mapovanie je zámerne konzervatívne) → „cena nedostupná" (honest-null). */
export function glassMoneyKod(system: string, nazov: string): string | null {
	const sys = GLASS_SYSTEM_ALIAS[system] ?? system;
	const own = sys === 'Deluxe' || sys === 'Štandard +';
	const row = db
		.prepare(
			own
				? 'SELECT money_kod FROM glass_types WHERE nazov = ? AND system = ?'
				: // Robust/Slide: preferuj vlastný systém, potom spoločné 'ALL' (rovnaké
					// poradie zdrojov ako glassTypesForSystem)
					"SELECT money_kod FROM glass_types WHERE nazov = ? AND system IN (?, 'ALL') ORDER BY (system = 'ALL') LIMIT 1"
		)
		.get(nazov, sys) as { money_kod: string | null } | undefined;
	return row?.money_kod ?? null;
}

// ---- user-admin (interné + B2B veľkoobchodné účty) ----

export function listUsers() {
	return db
		.prepare('SELECT id, username, role, created_at FROM users ORDER BY role, username')
		.all() as { id: number; username: string; role: string; created_at: string }[];
}

/** Počet interných účtov — guard proti degradovaniu POSLEDNÉHO interného na B2B (#142). */
export function countInternalUsers(): number {
	return (db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'internal'").get() as { c: number })
		.c;
}

/**
 * `actor` = prihlasovacie meno toho, KTO účet zakladá — zapíše sa do `user_audit`
 * (#142: dohľadateľnosť „kto koho vytvoril/povýšil"). Prázdny reťazec je platný
 * (napr. seed/test bez session kontextu) — stĺpec je NOT NULL, nie POVINNÝ neprázdny.
 */
export function addUser(
	username: string,
	password: string,
	role: 'internal' | 'b2b',
	actor = ''
): { error: string | null } {
	const u = username.trim();
	if (!u) return { error: 'Meno účtu je povinné.' };
	if (password.length < 6) return { error: 'Heslo musí mať aspoň 6 znakov.' };
	// NOCASE: zabráň dvom účtom líšiacim sa len veľkosťou písmen (login je tiež
	// case-insensitive) — inak by 'Obchod@…' aj 'obchod@…' koexistovali a mýlili.
	const exists = db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE').get(u);
	if (exists) return { error: `Účet „${u}" už existuje.` };
	db.transaction(() => {
		db.prepare('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)').run(
			u,
			hashPassword(password),
			role
		);
		db.prepare(
			'INSERT INTO user_audit (actor, action, target_username, detail) VALUES (?, ?, ?, ?)'
		).run(actor, 'create', u, `role=${role}`);
	})();
	return { error: null };
}

/**
 * Zmena roly existujúceho účtu (#142 — dnes sa dalo len ručne v DB). Dve poistky:
 * - vlastnú rolu si aktér nemôže zmeniť (ochrana pred odrezaním — porovnáva sa `id`,
 *   nie username, aby prípadná zhoda mena case-insensitive login nezmiatla).
 * - posledný interný účet nemožno degradovať na B2B (appka by stratila správcu).
 * Nezmenená rola je no-op (žiadny UPDATE, žiadny audit riadok — nič sa nestalo);
 * `changed: false` to odlišuje, nech volajúci nehlási „zmenená", keď sa nič nezmenilo.
 */
export function changeUserRole(
	id: number,
	newRole: 'internal' | 'b2b',
	actor: { id: number; username: string }
): { error: string | null; changed: boolean } {
	const row = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id) as
		{ id: number; username: string; role: string } | undefined;
	if (!row) return { error: 'Účet neexistuje.', changed: false };
	if (row.id === actor.id) return { error: 'Vlastnú rolu si nemôžeš zmeniť.', changed: false };
	if (row.role === newRole) return { error: null, changed: false };
	if (row.role === 'internal' && newRole === 'b2b' && countInternalUsers() <= 1) {
		return { error: 'Posledný interný účet nemožno zmeniť na B2B.', changed: false };
	}
	db.transaction(() => {
		db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, id);
		db.prepare(
			'INSERT INTO user_audit (actor, action, target_username, detail) VALUES (?, ?, ?, ?)'
		).run(actor.username, 'role_change', row.username, `${row.role}→${newRole}`);
	})();
	return { error: null, changed: true };
}

/** Zmaže LEN b2b účet (interné účty nie — ochrana proti lockoutu). Sessions padnú cez CASCADE. */
export function deleteB2BUser(id: number): { error: string | null } {
	const row = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as
		{ role: string } | undefined;
	if (!row) return { error: 'Účet neexistuje.' };
	if (row.role !== 'b2b') return { error: 'Zmazať sa dajú len B2B účty.' };
	db.prepare('DELETE FROM users WHERE id = ?').run(id);
	return { error: null };
}
