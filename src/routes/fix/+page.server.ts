// Šikmý FIX (do boku pergoly) — modul kreslí VÝKRES KONŠTRUKCIE, nič viac.
// Zadanie 2026-07-27: „stačí, že budeš vytvárať rovnakú konštrukciu ako na tých
// výkresoch a oni už vedia podľa toho rezať." Preto tu NIE JE žiadny zápis do
// Money: modul nemá (a ani nemôže mať) odpis — karty Cortizo COR-60 CE v Money
// katalógu neexistujú (overené read-only SQL 2026-07-27).
import type { Actions } from './$types';
import { pocitajFix, rovnomernePolia, FIX_MAX_POLI } from '$lib/fix';
import { parseFixVstup } from '$lib/server/fix-vstup';

export const actions = {
	vykres: async ({ request }) => {
		const { vstup, error } = parseFixVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		return {
			step: 'vykres' as const,
			vstup,
			r: pocitajFix(vstup.s, vstup.v1, vstup.v2, vstup.polia)
		};
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), aby sa
	// zadanie nevynulovalo — tá istá pasca ako v ostatných moduloch
	upravit: async ({ request }) => {
		const { vstup } = parseFixVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	// rovnomerné rozdelenie šírky na N polí — pre klienta bez JS (progressive
	// enhancement); s JS to spraví formulár sám
	rozdelit: async ({ request }) => {
		const form = await request.formData();
		const { vstup } = parseFixVstup(form);
		const raw = parseFloat(String(form.get('pocetPoli') ?? '').replace(',', '.'));
		const n = Math.max(1, Math.min(FIX_MAX_POLI, Math.round(Number.isFinite(raw) ? raw : 1)));
		return { step: 'form' as const, vstup: { ...vstup, polia: rovnomernePolia(vstup.s, n) } };
	}
} satisfies Actions;
