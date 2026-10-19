// História účtov pre `/pouzivatelia` (#613 druhá časť) — čítanie `user_audit`, ktorý dovtedy appka
// len zapisovala (`addUser` / `changeUserRole` / `deleteB2BUser` / `seedUsers` / od v59 aj
// `setPassword`). Vzor „História zmien" editora vzorcov (`getAuditLog`, cfg-editor.ts): posledných
// N riadkov, najnovšie hore. Stránka je len pre interných (load + hooks denylist).
import { db } from './db';
import { formatDatumCasSk, sqliteUtcToIso } from '../datum';

/** Koľko posledných udalostí ukáže `/pouzivatelia` (história je prehľad, nie archív). */
export const HISTORIA_UCTOV_LIMIT = 50;

/**
 * Popis každej akcie, ktorú pripúšťa CHECK `user_audit.action` (v59). Nová akcia v CHECK bez
 * popisu = padne drift guard `tests/ucty-historia-613.test.ts`.
 */
export const POPIS_AKCIE_UCTU: Readonly<Record<string, string>> = {
	create: 'účet vytvorený',
	role_change: 'zmena roly',
	delete: 'účet zmazaný',
	seed: 'účet založený pri štarte',
	password_reset: 'heslo zmenené'
};

/** Slovenský popis akcie; neznáma hodnota ostane surová (riadok z histórie nikdy nezmizne). */
export function popisAkcieUctu(action: string): string {
	// `hasOwn`: zdedené kľúče (`constructor`, `toString`…) nie sú popis akcie
	const popis = Object.hasOwn(POPIS_AKCIE_UCTU, action) ? POPIS_AKCIE_UCTU[action] : undefined;
	return popis ?? action;
}

export interface UdalostUctu {
	id: number;
	/** čas v Europe/Bratislava („5.1.2026 14:32") — `ts` v DB je UTC bez zóny (timestamps.md) */
	kedy: string;
	/** kto akciu vykonal; prázdny = bez prihláseného používateľa (seed) */
	kto: string;
	akcia: string;
	ucet: string;
	/** doplnok akcie (`role=b2b`, `internal→b2b`); pri zmene hesla vždy prázdny */
	detail: string;
}

/** Posledných `limit` udalostí účtov, najnovšie hore (`id` rastie s časom zápisu). */
export function historiaUctov(limit = HISTORIA_UCTOV_LIMIT): UdalostUctu[] {
	const riadky = db
		.prepare(
			'SELECT id, ts, actor, action, target_username, detail FROM user_audit ORDER BY id DESC LIMIT ?'
		)
		.all(limit) as {
		id: number;
		ts: string;
		actor: string;
		action: string;
		target_username: string;
		detail: string;
	}[];
	return riadky.map((r) => ({
		id: r.id,
		kedy: formatDatumCasSk(sqliteUtcToIso(r.ts)),
		kto: r.actor,
		akcia: popisAkcieUctu(r.action),
		ucet: r.target_username,
		detail: r.detail
	}));
}
