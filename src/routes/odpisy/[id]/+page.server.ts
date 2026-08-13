// Detail jedného odpisu (#154, fáza 1) — presné položky (1:1 s tým, čo odišlo do
// Money) + ich cenový zoznam. b2b sa sem NIKDY nedostane (celý /odpisy prefix je
// denylistovaný v hooks.server.ts) a appka vyžaduje prihlásenie na KAŽDÚ inú
// stránku — ďalší guard tu nie je potrebný (rovnaká úvaha ako pri iných interných
// read-only stránkach v tomto repe).
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getOdpis, listOdpisPolozky } from '$lib/server/money';
import { enrichPolozky } from '$lib/server/ceny';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Neplatný odpis.');
	const odpis = getOdpis(id);
	if (!odpis) error(404, 'Odpis sa nenašiel.');

	let detail: Record<string, unknown>;
	try {
		detail = JSON.parse(odpis.detail || '{}');
	} catch {
		detail = {};
	}

	// staršie odpisy (spred fázy 1) nemajú uložené položky — `ceny` je vtedy `null`
	// a stránka to ukáže ako "položky nie sú k dispozícii", nikdy prázdnu tabuľku
	// tváriacu sa, že sa nič neodpísalo
	const polozky = listOdpisPolozky(id);
	const ceny = polozky.length > 0 ? enrichPolozky(polozky) : null;

	return { odpis, detail, ceny };
};
