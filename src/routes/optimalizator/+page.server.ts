// Nárezový optimalizátor (#212) — samostatná kalkulačka. DISPLAY-ONLY: žiadny
// Money odpis, žiadne katalógové kódy, žiadny DB zápis. Interné-only — b2b má
// /optimalizator v `B2B_FORBIDDEN_PREFIXES` (drift guard: tests/b2b-route-coverage.test.ts).
// Parser žije v $lib/server/optimalizator-vstup.ts (SvelteKit dovolí exportovať
// z +page.server.ts len load/actions/…) — viď nova-stranka pasca #1.
import type { Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { parseOptimalizatorVstup } from '$lib/server/optimalizator-vstup';
import { optimalizuj } from '$lib/server/optimalizator';

export const actions: Actions = {
	// jednotný tvar návratu ({ vysledok, error }, jedno je vždy null) — čistý typ
	// pre use:enhance callback bez union-narrowingu
	default: async ({ request }) => {
		const parsed = parseOptimalizatorVstup(await request.formData());
		if ('error' in parsed) return fail(400, { vysledok: null, error: parsed.error });
		return { vysledok: optimalizuj(parsed.vstup), error: null };
	}
};
