// Bazén — zákaznícky NÁVRHOVÝ výkres, FÁZA 1 (#139): rozmerový formulár → SVG
// výkres → tlač. Do Money NIČ nezapisuje — existujúci `/bazen` (Money odpis) sa
// touto route nedotýka. Na rozdiel od /pergola/navrh a /zasklenia/navrh táto
// route NIE JE pre b2b prístupná (zadanie #139: "pre b2b stránka prístupná
// nebude") — žiadna výnimka v `B2B_ALLOWED_EXCEPTIONS`, blokuje ju existujúci
// `/bazen` prefix v `b2b-access.ts` denylist automaticky (drift guard:
// tests/b2b-route-coverage.test.ts).
import type { Actions, PageServerLoad } from './$types';
import { parseBazenNavrhVstup } from '$lib/server/bazen-navrh-vstup';

export const load: PageServerLoad = async () => {
	// Dátum = SERVEROVÝ čas (rovnaká disciplína ako #114/#137/#138/#162) —
	// nepočíta sa na klientovi, aby neuplávalo, keby stránka ostala otvorená
	// cez polnoc.
	return { datumIso: new Date().toISOString() };
};

export const actions = {
	vykres: async ({ request, locals }) => {
		const { vstup, error } = parseBazenNavrhVstup(await request.formData());
		// predvyplň "vypracoval" prihláseným menom, keď ho operátor nechal prázdne
		if (!vstup.vypracoval) vstup.vypracoval = locals.user?.username ?? '';
		if (error) return { step: 'form' as const, error, vstup };
		return { step: 'vykres' as const, vstup, error: null as string | null };
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca
	// ako v ostatných moduloch (pergola/navrh, zasklenia/navrh) — obyčajný
	// <a href> by ho vynuloval
	upravit: async ({ request }) => {
		const { vstup } = parseBazenNavrhVstup(await request.formData());
		return { step: 'form' as const, vstup };
	}
} satisfies Actions;
