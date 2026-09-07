// Plán rezov (#482) — univerzálny optimalizátor rezov z CAD tabuľky.
// DISPLAY-ONLY: žiadny Money odpis, žiadne katalógové kódy, žiadny DB zápis.
// Interné-only — b2b má /plan-rezov v B2B_FORBIDDEN_PREFIXES
// (drift guard: tests/b2b-route-coverage.test.ts).
// Parser žije v $lib/server/plan-rezov-vstup.ts (nova-stranka §1).
import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { parsePlanRezovFormData } from '$lib/server/plan-rezov-vstup';
import { spocitajPlanRezov } from '$lib/server/plan-rezov';

export const actions = {
	default: async ({ request }) => {
		const fd = await request.formData();
		const parsed = parsePlanRezovFormData(fd);
		if ('error' in parsed) return fail(400, { vysledok: null, error: parsed.error });

		return {
			vysledok: spocitajPlanRezov(parsed.vstup, parsed.preskocene),
			error: null
		};
	}
} satisfies Actions;
