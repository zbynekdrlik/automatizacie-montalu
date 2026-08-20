// Prihlásenie + session cookies. Všetky stránky appky sú za loginom —
// formuláre zapisujú do Money importu, verejný prístup bol nález auditu.
import { randomBytes } from 'node:crypto';
import { db, verifyPassword } from './db';
import { logger } from './log';

const log = logger('auth');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dní — interný nástroj, dlhá session
export const SESSION_COOKIE = 'am_session';

// #251 SEC-missed: horný limit dĺžky vstupu PRED scrypt — obrovský password by
// inak nútil scrypt hashovať megabajty (DoS zosilnenie) a nafukoval by logy.
export const MAX_USERNAME_LEN = 200;
export const MAX_PASSWORD_LEN = 200;

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
