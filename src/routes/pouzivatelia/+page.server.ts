// Interná správa účtov — vytváranie/mazanie B2B veľkoobchodných účtov. Stránka
// je len pre interných (denylist v hooks.server.ts presmeruje b2b skôr, než sem
// príde požiadavka; kontrola v load/actions je obrana do hĺbky, viď zasklenia).
import { redirect, fail } from '@sveltejs/kit';
import { isB2B } from '$lib/server/auth';
import { listUsers, addUser, deleteB2BUser } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (isB2B(locals.user)) redirect(303, '/zasklenia');
	return { users: listUsers(), me: locals.user?.username };
};

export const actions: Actions = {
	pridat: async ({ request, locals }) => {
		if (isB2B(locals.user)) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const username = String(fd.get('username') ?? '');
		const password = String(fd.get('password') ?? '');
		const { error } = addUser(username, password, 'b2b');
		if (error) return fail(400, { error });
		return { ok: `B2B účet „${username.trim()}" vytvorený.` };
	},
	zmazat: async ({ request, locals }) => {
		if (isB2B(locals.user)) return fail(403, { error: 'Nedostupné.' });
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		const { error } = deleteB2BUser(id);
		if (error) return fail(400, { error });
		return { ok: 'Účet zmazaný.' };
	}
};
