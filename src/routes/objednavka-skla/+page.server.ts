// #496/#546: Landing page — „Objednávka skla" (zákazka + voliteľné OP). Server validuje
// `normZak`/`normOp` (žiadny Odoo lookup — servisná objednávka bez sale.order), NIČ neukladá, len
// presmeruje na podklad `/objednavka-skla/<zak>` (s `?op=<OP>` len keď bolo OP zadané — podklad si
// ho predvyplní do poľa OP). Money-NEUTRÁLNE (objednávka u dodávateľa skla, žiadny odpis).
// #577 (Patrik, Odoo úloha 1181): stránka slúži aj ako VYHĽADÁVAČ existujúceho podkladu podľa
// zákazky → OP je NEPOVINNÉ. OP pre Odoo sa berie z odpisu zákazky, inak z poľa OP na podklade
// (`nastavOp`); bez akéhokoľvek OP podklad pri odoslaní vyzve „zadajte OP objednávky".
import { redirect } from '@sveltejs/kit';
import { logger } from '$lib/server/log';
import { normOp, normZak } from '$lib/server/money';
import type { Actions, PageServerLoad } from './$types';

const log = logger('objednavka-skla-index');

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
		// OP nepovinné (#577). `normOp` prijme každé neprázdne OP (OP…, OPDL…, holé číslo → OP<číslo>),
		// rovnako ako `nastavOp` na podklade — prázdne/„samé medzery" = bez OP.
		const op = normOp(opRaw);
		// zak v URL ostáva v pôvodnom (trimnutom) tvare — podklad load ho normalizuje pri lookup-e
		const ciel = `/objednavka-skla/${encodeURIComponent(zakRaw)}`;
		log.info('otvorenie podkladu z úvodnej stránky', { zak: zakRaw, op: op || null });
		redirect(303, op ? `${ciel}?op=${encodeURIComponent(op)}` : ciel);
	}
} satisfies Actions;
