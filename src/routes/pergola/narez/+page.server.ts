// Pergola — materiál/nárez z rozmerov (#155). DISPLAY-ONLY: do Money NIČ nezapisuje
// (žiadny import server/money ani server/pergola — statický guard v
// tests/pergola-narez-money-safety.test.ts). Rovnaký vzor ako /bazen/navrh:
// formulár → výsledok, žiadny zápisový krok. Parser žije v $lib/server (nova-stranka §1).
import type { Actions } from './$types';
import { parsePergolaNarezVstup } from '$lib/server/pergola-narez-vstup';

export const actions: Actions = {
	spocitat: async ({ request }) => {
		const { vstup, error } = parsePergolaNarezVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		return { step: 'vysledok' as const, vstup, error: null as string | null };
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca ako
	// v ostatných moduloch (obyčajný <a href> by ho vynuloval — nova-stranka §4)
	upravit: async ({ request }) => {
		const { vstup } = parsePergolaNarezVstup(await request.formData());
		return { step: 'form' as const, vstup };
	}
};
