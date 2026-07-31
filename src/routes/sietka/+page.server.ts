// Dodatočná sieťka BEZ posuvu (#89 — „90 % prípadov"). Rovnaký princíp ako /fix:
// vstup → výkres/tlač, Money NEZAPISUJE nič (kódy/kusy sieťky ešte nie sú potvrdené,
// pozri #86–#90). Prístupné aj pre b2b (Patrik: „hlavne pre externých") — nová cesta
// nie je v `B2B_FORBIDDEN_PREFIXES`, takže denylist ju necháva prejsť.
import type { Actions, PageServerLoad } from './$types';
import { listSysStyly } from '$lib/server/db';
import { parseSietkaSamostatnaVstup } from '$lib/server/sietka-samostatna';
import { SIETKA_SYSTEMY, potrebuje3KKolajnicu } from '$lib/sietka';

export const load: PageServerLoad = async () => {
	const styly = listSysStyly().filter((s) => SIETKA_SYSTEMY.includes(s.system));
	return { styly };
};

export const actions: Actions = {
	vypocitat: async ({ request }) => {
		const { vstup, error } = parseSietkaSamostatnaVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const styly = listSysStyly().filter((s) => SIETKA_SYSTEMY.includes(s.system));
		const g = styly.find((s) => s.system === vstup.system && s.styl === vstup.styl);
		if (!g) return { step: 'form' as const, error: 'Neznámy systém/štýl.', vstup };
		return {
			step: 'vysledok' as const,
			vstup,
			N: g.N,
			potrebuje3K: potrebuje3KKolajnicu(vstup.styl)
		};
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca
	// ako v ostatných moduloch — inak by sa zadanie vynulovalo
	upravit: async ({ request }) => {
		const { vstup } = parseSietkaSamostatnaVstup(await request.formData());
		return { step: 'form' as const, vstup };
	}
};
