// Plán rezov (#482) — univerzálny optimalizátor rezov z CAD tabuľky.
// DISPLAY-ONLY: žiadny Money odpis, žiadne katalógové kódy, žiadny DB zápis.
// Interné-only — b2b má /plan-rezov v B2B_FORBIDDEN_PREFIXES
// (drift guard: tests/b2b-route-coverage.test.ts).
// Parser žije v $lib/server/plan-rezov-vstup.ts (nova-stranka §1).
import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { parsePlanRezovFormData, parsePlanRezov } from '$lib/server/plan-rezov-vstup';
import { spocitajPlanRezov } from '$lib/server/plan-rezov';

export const actions = {
	default: async ({ request }) => {
		const fd = await request.formData();
		const parsed = parsePlanRezovFormData(fd);
		if ('error' in parsed) return fail(400, { vysledok: null, error: parsed.error });

		// parsuj preskočené riadky pre info (už sparsované v parsePlanRezovFormData,
		// ale informácia o preskočených riadkoch sa stráca — re-parsuj surový text)
		const cadText = String(fd.get('cad') ?? '');
		const { preskocene } = parsePlanRezov(cadText);

		return {
			vysledok: spocitajPlanRezov(parsed.vstup, preskocene),
			error: null
		};
	}
} satisfies Actions;
