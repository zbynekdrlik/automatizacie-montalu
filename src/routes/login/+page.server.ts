import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	login,
	safeNext,
	SESSION_COOKIE,
	MAX_USERNAME_LEN,
	MAX_PASSWORD_LEN
} from '$lib/server/auth';
import {
	lockoutRemainingMs,
	applyLoginBackoff,
	recordFailure,
	recordSuccess
} from '$lib/server/login-throttle';

function lockMessage(remainingMs: number): string {
	const mins = Math.max(1, Math.ceil(remainingMs / 60000));
	return `Príliš veľa neúspešných pokusov. Skúste to znova o ${mins} min.`;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const username = String(form.get('username') || '');
		const password = String(form.get('password') || '');

		// #251 SEC-missed: limit dĺžky PRED throttle/scrypt. 400 na abnormálne dlhý
		// vstup (nikdy zadaný reálnym užívateľom cez formulár → žiadny console-error
		// dopad v bežnom toku, na rozdiel od zlého hesla, ktoré ostáva 200 nižšie).
		if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
			return fail(400, { error: 'Neplatný vstup.', username: username.slice(0, MAX_USERNAME_LEN) });
		}

		// getClientAddress() môže hodiť (ADDRESS_HEADER nastavený + hlavička chýba) — login je
		// Money-zápisová brána, nesmie kvôli LOGOVANIU IP spadnúť (review #245)
		let ip: string | undefined;
		try {
			ip = getClientAddress();
		} catch {
			ip = undefined;
		}

		// #251 SEC-1: lockout check PRED pokusom — aj SPRÁVNE heslo je počas lockoutu
		// odmietnuté do expirácie (kľúč (username, ip), nie globálny → reálny user z
		// inej IP nie je zamknutý). 200 render s lock správou (zero-console pravidlo).
		const remaining = lockoutRemainingMs(username, ip);
		if (remaining > 0) {
			return { error: lockMessage(remaining), username };
		}

		// exponenciálne oneskorenie podľa počtu doterajších neúspechov (spomalí brute-force)
		await applyLoginBackoff(username, ip);

		const token = login(username, password, ip);
		if (!token) {
			// zaznamenaj neúspech (môže potichu nastaviť lock — WARN log); správu ukáž
			// až NASLEDUJÚCI pokus (lock check vyššie), takže 5 pokusov dá bežnú chybu
			// a 6. pokus lock správu — presne per akceptácia #251.
			recordFailure(username, ip);
			// 200 render s chybou (nie fail(401)) — non-2xx na form POST loguje
			// v prehliadači console error a porušuje zero-console-errors pravidlo
			return { error: 'Nesprávne meno alebo heslo.', username };
		}
		recordSuccess(username, ip); // úspech → vyčisti počítadlo (žiadny zvyškový lock)
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
