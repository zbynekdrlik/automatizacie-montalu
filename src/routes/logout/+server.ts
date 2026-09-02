import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logout, SESSION_COOKIE } from '$lib/server/auth';
import { base } from '$app/paths';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) logout(token);
	// #5822: delete path MUSÍ sedieť s set path (`base || '/'`), inak sa cookie nezmaže.
	cookies.delete(SESSION_COOKIE, { path: base || '/' });
	redirect(303, base + '/login');
};
