// Interná demo/preview stránka pre základ návrhových výkresov (#137) — ukazuje
// VykresovyHarok (rám + mriežka 1-16/A-L) + vyplnenú TitleBlock pečiatku + pár
// vzorových kót cez zdieľaný Kota.svelte helper. Skutočný produkčný konzument je
// #138+ (pergola/bazén NÁVRH); táto stránka je len na e2e/manuálne overenie
// vizuálnej zhody so vzormi + tlače A4 na šírku.
//
// Len pre interných — denylist v `b2b-access.ts` (B2B_FORBIDDEN_PREFIXES: '/vykresy')
// presmeruje b2b skôr, než sem príde požiadavka; táto kontrola je obrana do hĺbky
// (rovnaký vzor ako `pouzivatelia`/`zasklenia/nastavenia`).
import { redirect } from '@sveltejs/kit';
import { isB2B } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (isB2B(locals.user)) redirect(303, '/zasklenia');
	// Dátum = SERVEROVÝ čas (rovnaká disciplína ako #114 na nárezáku) — nepočíta sa
	// na klientovi, aby neuplávalo, keby stránka ostala otvorená.
	return { datumIso: new Date().toISOString() };
};
