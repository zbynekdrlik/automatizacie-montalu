// Interná správa účtov — vytváranie (interný/B2B voľbou role) + zmena roly +
// mazanie B2B veľkoobchodných účtov. Stránka je len pre interných (denylist v
// hooks.server.ts presmeruje b2b skôr, než sem príde požiadavka; kontrola v
// load/actions je obrana do hĺbky, viď zasklenia). `pridat` číta `role` z
// formulára — to je BEZPEČNÉ napriek tomu, že akcia je gate-nutá `isB2B` na
// prvom riadku: b2b aktér je odmietnutý PRED čítaním `role`, takže sfalšovaný
// POST role nemôže eskalovať (viď skill access-control §2/§4, #142).
import { redirect, fail } from '@sveltejs/kit';
import { isB2B } from '$lib/server/auth';
import { listUsers, addUser, deleteB2BUser, changeUserRole } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (isB2B(locals.user)) redirect(303, '/zasklenia');
	return { users: listUsers(), me: locals.user?.username };
};

function parseRole(v: FormDataEntryValue | null): 'internal' | 'b2b' | null {
	return v === 'internal' || v === 'b2b' ? v : null;
}

export const actions: Actions = {
	pridat: async ({ request, locals }) => {
		// !locals.user gate je tu obrana do hĺbky (hooks.server.ts už garantuje non-null
		// pre všetky non-public cesty) — zarovnané s zmenit_rolu nižšie (review nález #142).
		if (isB2B(locals.user) || !locals.user) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const username = String(fd.get('username') ?? '');
		const password = String(fd.get('password') ?? '');
		// default B2B, nech sa omylom nerozdá interný prístup — sedí so stavom pred
		// touto zmenou, keď formulár zakladal LEN B2B.
		const role = parseRole(fd.get('role')) ?? 'b2b';
		const { error } = addUser(username, password, role, locals.user.username);
		if (error) return fail(400, { error });
		const rolaLabel = role === 'b2b' ? 'B2B' : 'Interný';
		return { ok: `Účet „${username.trim()}" (${rolaLabel}) vytvorený.` };
	},
	zmazat: async ({ request, locals }) => {
		if (isB2B(locals.user) || !locals.user) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		const { error } = deleteB2BUser(id, locals.user.username);
		if (error) return fail(400, { error });
		return { ok: 'Účet zmazaný.' };
	},
	zmenit_rolu: async ({ request, locals }) => {
		if (isB2B(locals.user) || !locals.user) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		const role = parseRole(fd.get('role'));
		if (!role) return fail(400, { error: 'Neplatná rola.' });
		const { error, changed } = changeUserRole(id, role, {
			id: locals.user.id,
			username: locals.user.username
		});
		if (error) return fail(400, { error });
		const rolaLabel = role === 'b2b' ? 'B2B' : 'Interný';
		// no-op (rovnaká rola ako doteraz) hlási neutrálne, nie „zmenená" — nič sa nezmenilo
		return { ok: changed ? `Rola účtu zmenená na ${rolaLabel}.` : `Rola účtu je už ${rolaLabel}.` };
	}
};
