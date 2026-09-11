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
import { queuePlanRezovUpload } from '$lib/server/odoo-plan-rezov-upload';

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

		// #505 review finding (HIGH): validate cadText through parsePlanRezovFormData
		// — the same bounds (500k chars, MAX_RIADKOV, MAX_KUSOV_SPOLU 20k, dlzkaTyce>0,
		// reznaMedzera>=0) that spocitat enforces. Without this, a saved plan with
		// enormous ks would cause OOM on every detail GET (persistent DoS).
		const parsed = parsePlanRezovFormData(fd);
		if ('error' in parsed) return fail(400, { saveError: parsed.error });

		const user = (locals as { user?: { username: string } }).user?.username ?? '';

		const cadText = String(fd.get('cad') ?? '').trim();
		const id = ulozPlan({
			nazov,
			zak: zak || undefined,
			cadText,
			dlzkaTyce: parsed.vstup.dlzkaTyce,
			reznaMedzera: parsed.vstup.reznaMedzera,
			createdBy: user
		});

		// #511: po uložení pripni SKUTOČNÝ plán rezov (PDF bez cien) na kiosk „Rezanie" (sale.order)
		// cez montalu_narezak_upload. Fire-and-forget — NIKDY nezhodí uloženie plánu; no-op keď zákazka
		// prázdna / bez odpisu / upload vypnutý (env). Nahrádza starý odpis→rozpis narezak upload.
		queuePlanRezovUpload({
			zak,
			cadText,
			dlzkaTyce: parsed.vstup.dlzkaTyce,
			reznaMedzera: parsed.vstup.reznaMedzera
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
