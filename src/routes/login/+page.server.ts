import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { login, safeNext, SESSION_COOKIE } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const username = String(form.get('username') || '');
		const password = String(form.get('password') || '');
		const token = login(username, password);
		if (!token) {
			// 200 render s chybou (nie fail(401)) — non-2xx na form POST loguje
			// v prehliadači console error a porušuje zero-console-errors pravidlo
			return { error: 'Nesprávne meno alebo heslo.', username };
		}
		cookies.set(SESSION_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 30 * 24 * 3600
		});
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
