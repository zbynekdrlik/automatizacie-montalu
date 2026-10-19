// Prihlásenie + session cookies. Všetky stránky appky sú za loginom —
// formuláre zapisujú do Money importu, verejný prístup bol nález auditu.
import { randomBytes } from 'node:crypto';
import { db, verifyPassword, hashPassword, chybaHesla, MAX_PASSWORD_LEN } from './db';
import { resetLoginThrottleForUser } from './login-throttle';
import { logger } from './log';

const log = logger('auth');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dní — interný nástroj, dlhá session
export const SESSION_COOKIE = 'am_session';

// #251 SEC-missed: horný limit dĺžky vstupu PRED scrypt — obrovský password by
// inak nútil scrypt hashovať megabajty (DoS zosilnenie) a nafukoval by logy.
// MAX_PASSWORD_LEN žije v db.ts (#613: zdieľa ho aj pravidlo hesla `addUser`/`setPassword`
// a db.ts nemôže importovať auth.ts — cyklus); re-export drží doterajší import cez auth.
export const MAX_USERNAME_LEN = 200;
export { MAX_PASSWORD_LEN };

// #251 SEC-2: konštantný dummy hash (platný `salt:hash` formát, 16-byte soľ +
// 64-byte hash) proti ktorému scrypt beží aj pri NEZNÁMOM mene — inak sa login
// pri neznámom účte vráti pred scrypt a merateľný časový rozdiel = enumerácia
// mien. Hodnota nikdy nesedí (nie je to hash žiadneho hesla) — slúži len na to,
// aby verifyPassword vykonal jeden scrypt s rovnakou cenou ako pri zlom hesle.
const DUMMY_HASH =
	'00000000000000000000000000000000:' +
	'0000000000000000000000000000000000000000000000000000000000000000' +
	'0000000000000000000000000000000000000000000000000000000000000000';

export type UserRole = 'internal' | 'b2b';

export interface SessionUser {
	id: number;
	username: string;
	role: UserRole;
}

export function login(username: string, password: string, ip?: string): string | null {
	// #251 SEC-missed: obranný limit dĺžky aj tu (choke-point pre každého volajúceho,
	// nielen HTTP akcia) — vráti null PRED DB/scrypt; heslo sa NIKDY neloguje.
	if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
		log.warn('login zlyhal', { username: username.slice(0, 40), ip, reason: 'too_long' });
		return null;
	}
	const uname = username.trim();
	// COLLATE NOCASE: mená (najmä e-maily) sú case-insensitive — mobil kapitalizuje
	// prvé písmeno, takže 'Obchod@…' sa musí prihlásiť na uložené 'obchod@…'.
	// NOCASE je ASCII-only, čo pre e-mailové/ASCII mená stačí.
	const user = db
		.prepare('SELECT id, username, pass_hash FROM users WHERE username = ? COLLATE NOCASE')
		.get(uname) as { id: number; username: string; pass_hash: string } | undefined;
	// dôvod sa rozlišuje kvôli logu (neznáme meno vs. zlé heslo); heslo sa NIKDY neloguje
	if (!user) {
		// #251 SEC-2: aj pri neznámom mene vykonaj jeden scrypt (proti dummy hashu),
		// aby čas odpovede nezradil, či účet existuje (obrana proti enumerácii mien).
		verifyPassword(password, DUMMY_HASH);
		log.warn('login zlyhal', { username: uname, ip, reason: 'unknown_user' });
		return null;
	}
	if (!verifyPassword(password, user.pass_hash)) {
		log.warn('login zlyhal', { username: uname, ip, reason: 'bad_password' });
		return null;
	}
	const token = randomBytes(32).toString('hex');
	db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
		token,
		user.id,
		Date.now() + SESSION_TTL_MS
	);
	log.info('login ok', { username: user.username, ip });
	return token;
}

export function logout(token: string) {
	// meno sa dohľadá kvôli logu PRED zmazaním; token sa NIKDY neloguje
	const row = db
		.prepare('SELECT u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
		.get(token) as { username: string } | undefined;
	db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
	log.info('logout', { username: row?.username });
}

export function getSessionUser(token: string | undefined): SessionUser | null {
	if (!token) return null;
	const row = db
		.prepare(
			`SELECT u.id, u.username, u.role, s.expires_at FROM sessions s
			 JOIN users u ON u.id = s.user_id WHERE s.token = ?`
		)
		.get(token) as { id: number; username: string; role: UserRole; expires_at: number } | undefined;
	if (!row) return null;
	if (row.expires_at < Date.now()) {
		logout(token);
		return null;
	}
	return { id: row.id, username: row.username, role: row.role };
}

/**
 * #613: interný admin nastaví EXISTUJÚCEMU účtu nové heslo — bez znalosti starého. Dovtedy sa
 * heslo dalo nastaviť len pri založení účtu, takže zabudnuté heslo = nepoužiteľný účet (PROD
 * 19.10.: `predaj` 4× bad_password). Priamy SQL na VPS je zakázaný (access-control §4) a appka
 * nemá e-mailový kanál, preto reset robí admin na `/pouzivatelia`.
 *
 * - rovnaké pravidlo (`chybaHesla`) a rovnaký `hashPassword` (scrypt) ako `addUser`
 * - meno case-insensitive + `.trim()` ako `login()` (admin môže napísať „Predaj")
 * - v JEDNEJ transakcii UPDATE `pass_hash` + DELETE VŠETKÝCH relácií účtu + `user_audit` riadok
 *   — prihlásenia so starým heslom prestanú platiť okamžite (pri vlastnom účte aj adminova
 *   aktuálna relácia); zlyhanie ktoréhokoľvek kroku (aj zápisu auditu) vráti všetko späť
 * - TRVALÝ audit (druhá časť #613, migrácia v59): `user_audit` action `password_reset`, actor =
 *   admin, target = meno účtu z DB, `detail` prázdny, čas = `ts` default — NIKDY heslo ani hash;
 *   `/pouzivatelia` ho ukáže v histórii účtov („heslo zmenené"). Rovnaký tvar ako audit
 *   `addUser` / `changeUserRole` / `deleteB2BUser` (db.ts).
 * - vynuluje login-throttle lockout toho mena naprieč IP — kto sa zamkol skúšaním starého
 *   hesla, prihlási sa novým hneď (nie až po LOCKOUT_MS); až PO úspešnej transakcii
 * - `auth` INFO „heslo zmenené administrátorom" (admin, účet, počet zrušených relácií, throttle
 *   záznamy) ostáva ako prevádzkový log vedľa trvalého auditu. NIKDY heslo ani hash.
 *
 * Autorizáciu (len interný) robí VOLAJÚCI — akcia `noveHeslo` na `/pouzivatelia`.
 */
export function setPassword(
	username: string,
	password: string,
	admin: string
): { error: string; username?: undefined } | { error: null; username: string } {
	const uname = username.trim();
	const zamietni = (error: string, reason: string) => {
		log.warn('nové heslo zamietnuté', { admin, username: uname.slice(0, 40), reason });
		return { error };
	};
	if (!uname) return zamietni('Meno účtu je povinné.', 'empty_username');
	const chyba = chybaHesla(password);
	if (chyba) return zamietni(chyba, 'weak_password');
	const user = db
		.prepare('SELECT id, username FROM users WHERE username = ? COLLATE NOCASE')
		.get(uname) as { id: number; username: string } | undefined;
	if (!user) return zamietni('Účet neexistuje.', 'unknown_user');
	const passHash = hashPassword(password);
	const zruseneRelacie = db.transaction(() => {
		db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(passHash, user.id);
		const zrusene = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id).changes;
		db.prepare(
			'INSERT INTO user_audit (actor, action, target_username, detail) VALUES (?, ?, ?, ?)'
		).run(admin, 'password_reset', user.username, '');
		return zrusene;
	})();
	const throttleZaznamy = resetLoginThrottleForUser(user.username);
	log.info('heslo zmenené administrátorom', {
		admin,
		username: user.username,
		zruseneRelacie,
		throttleZaznamy
	});
	return { error: null, username: user.username };
}

/** Priebežné čistenie expirovaných sessions (volané z hooks pri requestoch). */
export function pruneSessions() {
	const res = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
	if (res.changes > 0) log.info('pruneSessions', { deleted: res.changes });
}

/**
 * Open-redirect ochrana pre ?next= po prihlásení: len relatívna cesta v rámci
 * appky. Blokuje '//evil' aj '/\evil' — prehliadače normalizujú '\' na '/'
 * v Location hlavičke, takže '/\x' sa správa ako protokol-relatívne '//x'.
 */
export function safeNext(next: string | null): string {
	return next && /^\/(?![/\\])/.test(next) ? next : '/zasklenia';
}

export function isB2B(user: SessionUser | null): boolean {
	return user?.role === 'b2b';
}

export function isInternal(user: SessionUser | null): boolean {
	return !!user && user.role !== 'b2b';
}
