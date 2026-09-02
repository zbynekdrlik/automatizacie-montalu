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
import { resolveClientIp } from '$lib/server/client-ip';
import { base } from '$app/paths';

function lockMessage(remainingMs: number): string {
	const mins = Math.max(1, Math.ceil(remainingMs / 60000));
	return `Príliš veľa neúspešných pokusov. Skúste to znova o ${mins} min.`;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	// #5822: `safeNext` vracia base-LESS cestu (`next` je base-LESS, alebo fallback
	// `/zasklenia`); base pridám tu → same-origin absolútny Location aj pod `/automatizacie/`.
	if (locals.user) redirect(303, base + safeNext(url.searchParams.get('next')));
	return {};
};

export const actions = {
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

		// #264: getClientAddress() (XFF_DEPTH=1) vracia posledný XFF prvok = CF edge IP (peer
		// pripojený na Caddy), NIE reálneho klienta — appka je za Cloudflare. resolveClientIp
		// z edge + Cf-Connecting-Ip odvodí reálnu klientsku IP: dôveruje CF hlavičke len keď
		// edge je preukázateľne Cloudflare IP (spoof-safe), inak fallback na edge (CF-down-safe).
		// getClientAddress() môže hodiť (ADDRESS_HEADER nastavený + hlavička chýba) — login je
		// Money-zápisová brána, nesmie kvôli LOGOVANIU IP spadnúť (review #245).
		let edgeIp: string | undefined;
		try {
			edgeIp = getClientAddress();
		} catch {
			edgeIp = undefined;
		}
		const ip = resolveClientIp(edgeIp, request.headers.get('cf-connecting-ip'));

		// #251 SEC-1: lockout check PRED pokusom — aj SPRÁVNE heslo je počas lockoutu
		// odmietnuté do expirácie (kľúč (username, ip), nie globálny → reálny user z
		// inej IP nie je zamknutý). 200 render s lock správou (zero-console pravidlo).
		const remaining = lockoutRemainingMs(username, ip);
		if (remaining > 0) {
			return { error: lockMessage(remaining), username };
		}

		// exponenciálne oneskorenie podľa počtu doterajších neúspechov (spomalí brute-force)
		await applyLoginBackoff(username, ip);

		// #251 review 🔴: re-check lockout AJ PO backoff await. Bez toho súbežné
		// požiadavky prejdú počiatočnú kontrolu (všetky vidia failures<5) a vyhodnotia
		// N scryptov (concurrency bypass 5-pokusového limitu). scryptSync + recordFailure
		// nižšie sú synchrónne (žiadny await medzi týmto re-checkom a záznamom), takže
		// admission sa efektívne serializuje: 6. pokračovanie už vidí failures=5 → lock.
		const remainingAfterBackoff = lockoutRemainingMs(username, ip);
		if (remainingAfterBackoff > 0) {
			return { error: lockMessage(remainingAfterBackoff), username };
		}

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
			// #5822: scope cookie na base (`/automatizacie`) → same-origin iframe cookies fungujú
			// (SameSite=Lax stačí), a app session cookie sa neposiela na Odoo cesty. base='' ⇒ '/'.
			path: base || '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 30 * 24 * 3600
		});
		redirect(303, base + safeNext(url.searchParams.get('next')));
	}
} satisfies Actions;
