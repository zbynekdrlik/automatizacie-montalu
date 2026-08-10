// Pergola — zákaznícky NÁVRHOVÝ výkres (#138): rozmerový formulár → SVG výkres →
// tlač. Do Money NIČ nezapisuje — existujúci `/pergola` (CAD nárez → Money odpis) sa
// touto route nedotýka. b2b je blokovaný cez existujúci `/pergola` prefix v
// `b2b-access.ts` (denylist, nie allowlist) — táto podrouta naň spadá automaticky
// (drift guard: `tests/b2b-route-coverage.test.ts`).
import type { Actions, PageServerLoad } from './$types';
import { parsePergolaNavrhVstup } from '$lib/server/pergola-navrh-vstup';

export const load: PageServerLoad = async () => {
	// Dátum = SERVEROVÝ čas (rovnaká disciplína ako #114/#137) — nepočíta sa na
	// klientovi, aby neuplávalo, keby stránka ostala otvorená cez polnoc.
	return { datumIso: new Date().toISOString() };
};

export const actions: Actions = {
	vykres: async ({ request, locals }) => {
		const { vstup, error } = parsePergolaNavrhVstup(await request.formData());
		// predvyplň "vypracoval" prihláseným menom, keď ho operátor nechal prázdne
		if (!vstup.vypracoval) vstup.vypracoval = locals.user?.username ?? '';
		if (error) return { step: 'form' as const, error, vstup };
		return { step: 'vykres' as const, vstup, error: null as string | null };
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca ako
	// v ostatných moduloch (FIX/Pergola odpis) — obyčajný <a href> by ho vynuloval
	upravit: async ({ request }) => {
		const { vstup } = parsePergolaNavrhVstup(await request.formData());
		return { step: 'form' as const, vstup };
	}
};
