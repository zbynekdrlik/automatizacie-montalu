// #496/#546: Landing page — „Nová objednávka len skla" (zákazka + OP). Server validuje
// `normZak`/`normOp` (žiadny Odoo lookup — servisná objednávka bez sale.order), NIČ neukladá, len
// presmeruje na podklad `/objednavka-skla/<zak>?op=<OP>` (podklad si `?op=` predvyplní do poľa OP).
// Money-NEUTRÁLNE (objednávka u dodávateľa skla, žiadny odpis).
import { redirect } from '@sveltejs/kit';
import { normOp, normZak } from '$lib/server/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	return {};
};

export const actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const zakRaw = String(form.get('zak') ?? '').trim();
		const opRaw = String(form.get('op') ?? '').trim();
		// normZak overí, že po normalizácii ostane platné číslo zákazky (odmietne prázdne/„samé medzery")
		if (!normZak(zakRaw)) return { error: 'Zadajte platné číslo zákazky.' };
		// OP je pre servisnú objednávku bez odpisu POVINNÉ (jediné priradenie k Odoo objednávke)
		const op = normOp(opRaw);
		if (!op) return { error: 'Zadajte platné OP objednávky.' };
		// zak v URL ostáva v pôvodnom (trimnutom) tvare — podklad load ho normalizuje pri lookup-e
		redirect(303, `/objednavka-skla/${encodeURIComponent(zakRaw)}?op=${encodeURIComponent(op)}`);
	}
} satisfies Actions;
