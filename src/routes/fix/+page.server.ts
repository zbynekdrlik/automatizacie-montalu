// Šikmý FIX „z appky" (do boku pergoly) — TENTO režim (route /fix) kreslí VÝKRES
// KONŠTRUKCIE, nič viac: do Money odtiaľto NEJDE nič. Zadanie 2026-07-27: „stačí, že
// budeš vytvárať rovnakú konštrukciu ako na tých výkresoch a oni už vedia podľa toho rezať."
// Karty Cortizo COR-60 CE v Money katalógu neexistujú (overené read-only SQL 2026-07-27).
// #380: FIX modul má DRUHÝ režim „Fix z cadu" (route /fix/cad), ktorý z CAD nárezu ZAPISUJE
// Money odpis (reuse pergola CAD2DLV engine + katalóg, modul='fix'). Tá cesta žije ODDELENE
// v `$lib/server/fix-cad.ts`; tento formulár ostáva Money-clean (guard fix-money-safety.test.ts).
import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { pocitajFix, rovnomernePolia, FIX_MAX_POLI } from '$lib/fix';
import { parseFixVstup } from '$lib/server/fix-vstup';
import { isB2B } from '$lib/server/auth';
import { pridajSklaHromadne, type NoveSklo } from '$lib/server/objednavka-skla';
import { logger } from '$lib/server/log';

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
	},

	// ---- #496: Pridať sklá do objednávky skla (per pole fixu) ----
	pridatSkla: async ({ request, locals }) => {
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemá prístup k objednávke skla.' };
		}
		const { vstup, error } = parseFixVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		if (!vstup.zak.trim())
			return { step: 'form' as const, error: 'Zadaj číslo zákazky (ZAK).', vstup };
		const r = pocitajFix(vstup.s, vstup.v1, vstup.v2, vstup.polia);
		const sikmy = vstup.tvar === 'sikmy';
		const polozky: NoveSklo[] = r.polia.map((pole, i) => ({
			zak: vstup.zak,
			op: vstup.op,
			modul: 'fix',
			popis: `FIX pole ${i + 1}${vstup.nazov ? ' — ' + vstup.nazov : ''}`,
			sirkaMm: pole.sirka,
			// rovný = pravouhlé sklo (výška = vLavo = vPravo); šikmý = lichobežník
			vyskaMm: sikmy ? null : pole.vLavo,
			vLavoMm: sikmy ? pole.vLavo : null,
			vPravoMm: sikmy ? pole.vPravo : null,
			pocet: 1,
			typSkla: vstup.sklo,
			sikmy,
			m2: pole.m2,
			createdBy: locals.user?.username ?? ''
		}));
		const count = pridajSklaHromadne(polozky);
		logger('fix').info('skla pridane do objednavky', { zak: vstup.zak, count });
		redirect(303, '/objednavka-skla/' + encodeURIComponent(vstup.zak));
	}
} satisfies Actions;
