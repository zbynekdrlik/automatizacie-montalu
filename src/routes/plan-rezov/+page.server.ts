// Plán rezov (#482 + #505 save/print) — univerzálny optimalizátor rezov z CAD tabuľky.
// #505: uloženie plánu pod názvom, zoznam uložených, zmazanie. Money-NEUTRÁLNE.
// Interné-only — b2b má /plan-rezov v B2B_FORBIDDEN_PREFIXES
// (drift guard: tests/b2b-route-coverage.test.ts).
// Parser žije v $lib/server/plan-rezov-vstup.ts (nova-stranka §1).
// SvelteKit form actions: `default` a pomenované sa NEDAJÚ miešať (sveltekit-actions.md)
// → všetky pomenované: spocitat, ulozit, zmazat.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { parsePlanRezovFormData } from '$lib/server/plan-rezov-vstup';
import { spocitajPlanRezov } from '$lib/server/plan-rezov';
import { ulozPlan, listPlany, zmazPlan } from '$lib/server/plan-rezov-ulozene';

export const load: PageServerLoad = async ({ locals }) => {
	return {
		plany: listPlany(),
		user: (locals as { user?: { username: string } }).user?.username ?? ''
	};
};

export const actions = {
	spocitat: async ({ request }) => {
		const fd = await request.formData();
		const parsed = parsePlanRezovFormData(fd);
		if ('error' in parsed) return fail(400, { vysledok: null, error: parsed.error });

		return {
			vysledok: spocitajPlanRezov(parsed.vstup, parsed.preskocene),
			error: null
		};
	},

	ulozit: async ({ request, locals }) => {
		const fd = await request.formData();
		const nazov = String(fd.get('nazov') ?? '').trim();
		if (!nazov) return fail(400, { saveError: 'Zadaj názov plánu.' });
		if (nazov.length > 200)
			return fail(400, { saveError: 'Názov je príliš dlhý (max 200 znakov).' });

		const zak = String(fd.get('zak') ?? '').trim();
		const cadText = String(fd.get('cadText') ?? '').trim();
		if (!cadText) return fail(400, { saveError: 'Chýba CAD text na uloženie.' });

		const dlzkaTyce = Number(fd.get('dlzkaTyce') ?? 6000);
		const reznaMedzera = Number(fd.get('reznaMedzera') ?? 4);

		const user = (locals as { user?: { username: string } }).user?.username ?? '';

		const id = ulozPlan({
			nazov,
			zak: zak || undefined,
			cadText,
			dlzkaTyce: Number.isFinite(dlzkaTyce) ? dlzkaTyce : 6000,
			reznaMedzera: Number.isFinite(reznaMedzera) ? reznaMedzera : 4,
			createdBy: user
		});

		return { saved: true, savedId: id, saveError: null };
	},

	zmazat: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!Number.isFinite(id) || id <= 0) return fail(400, { deleteError: 'Neplatné id.' });
		zmazPlan(id);
		return { deleted: true };
	}
} satisfies Actions;
