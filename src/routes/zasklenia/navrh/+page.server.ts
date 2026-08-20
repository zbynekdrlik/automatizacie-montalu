// Zasklenia — zákaznícky NÁVRHOVÝ výkres (#162): rozmerový formulár → SVG
// výkres → tlač. Do Money NIČ nezapisuje — existujúci `/zasklenia` (nárezový
// plán → Money odpis) sa touto podroutou nedotýka. b2b JE pre túto route
// dostupná automaticky (na rozdiel od pergoly): `/zasklenia/*` nie je v
// `B2B_FORBIDDEN_PREFIXES` (len `/zasklenia/nastavenia` je) — drift guard:
// `tests/b2b-route-coverage.test.ts`.
import type { Actions, PageServerLoad } from './$types';
import { listSysStyly } from '$lib/server/db';
import { OTVARANIA } from '$lib/server/vstup';
import { parseZaskleniaNavrhVstup } from '$lib/server/zasklenia-navrh-vstup';

export const load: PageServerLoad = async () => {
	const styly = listSysStyly();
	const systemy = [...new Set(styly.map((s) => s.system))];
	return {
		styly,
		systemy,
		otvarania: OTVARANIA,
		// dátum = SERVEROVÝ čas (rovnaká disciplína ako #114/#137/#138) —
		// nepočíta sa na klientovi, aby neuplávalo, keby stránka ostala otvorená
		datumIso: new Date().toISOString()
	};
};

export const actions = {
	vykres: async ({ request }) => {
		const { vstup, error } = parseZaskleniaNavrhVstup(await request.formData(), listSysStyly());
		if (error) return { step: 'form' as const, error, vstup };
		return { step: 'vykres' as const, vstup, error: null as string | null };
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca
	// ako v ostatných moduloch (pergola/navrh, FIX, Pergola odpis) — obyčajný
	// <a href> by ho vynuloval
	upravit: async ({ request }) => {
		const { vstup } = parseZaskleniaNavrhVstup(await request.formData(), listSysStyly());
		return { step: 'form' as const, vstup };
	}
} satisfies Actions;
