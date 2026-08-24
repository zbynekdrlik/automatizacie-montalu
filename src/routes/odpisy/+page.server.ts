import type { Actions, PageServerLoad } from './$types';
import { listOdpisy, releaseOdpis, povolitReimport } from '$lib/server/money';
import { readbackStav } from '$lib/server/money-readback';

export const load: PageServerLoad = async () => {
	// detail sa parsuje TU s ochranou — jeden pokazený riadok nesmie zhodiť
	// celú históriu (a „Uvoľniť" je jediná cesta k oprave duplikátov)
	const odpisy = listOdpisy(200).map((o) => {
		let d: Record<string, unknown>;
		try {
			d = JSON.parse(o.detail || '{}') as Record<string, unknown>;
		} catch {
			d = {};
		}
		return { ...o, d };
	});
	// #298 POST-import readback: LIVE odpisy overí proti Money DLV snapshotu (on-the-fly, lazy import).
	// TEST odpisy do Money nikdy nešli → bez záznamu (v UI sa readback stĺpec pre ne nezobrazí).
	const stav = readbackStav(odpisy.filter((o) => o.live).map((o) => o.id));
	return {
		odpisy: odpisy.map((o) => ({ ...o, readback: stav.get(o.id) ?? null }))
	};
};

export const actions = {
	// uvoľnenie dedup kľúča — legitímna oprava: zmaž import v Money, uvoľni tu,
	// pošli znova. Auditované v histórii zmien.
	uvolnit: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return { error: 'Neplatný záznam.' };
		const ok = releaseOdpis(id, locals.user?.username ?? '');
		return ok ? { uvolnene: true } : { error: 'Záznam sa nenašiel.' };
	},

	// OVERRIDE (#294): re-import IDENTICKÉHO obsahu. Použi LEN keď si import v Money NAOZAJ zmazal —
	// uvoľní dedup kľúč AJ povolí ledgeru jeden opätovný import rovnakého obsahu (bežné „Uvoľniť"
	// identický obsah blokuje ako poistku proti dvojitému importu). Auditované.
	povolitReimport: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return { error: 'Neplatný záznam.' };
		const ok = povolitReimport(id, locals.user?.username ?? '');
		return ok ? { reimportPovoleny: true } : { error: 'Záznam sa nenašiel.' };
	}
} satisfies Actions;
