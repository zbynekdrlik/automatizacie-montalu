// Prihlásenie + session cookies. Všetky stránky appky sú za loginom —
// formuláre zapisujú do Money importu, verejný prístup bol nález auditu.
import { randomBytes } from 'node:crypto';
import { db, verifyPassword } from './db';

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dní — interný nástroj, dlhá session
export const SESSION_COOKIE = 'am_session';

export type UserRole = 'internal' | 'b2b';

export interface SessionUser {
	id: number;
	username: string;
	role: UserRole;
}

export function login(username: string, password: string): string | null {
	const user = db
		.prepare('SELECT id, username, pass_hash FROM users WHERE username = ?')
		.get(username.trim()) as { id: number; username: string; pass_hash: string } | undefined;
	if (!user || !verifyPassword(password, user.pass_hash)) return null;
	const token = randomBytes(32).toString('hex');
	db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
		token,
		user.id,
		Date.now() + SESSION_TTL_MS
	);
	return token;
}

export function logout(token: string) {
	db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
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
	db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
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
