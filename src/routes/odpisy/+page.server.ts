import type { Actions, PageServerLoad } from './$types';
import { listOdpisy, releaseOdpis, povolitReimport } from '$lib/server/money';
import { detectManualStagingMoves } from '$lib/server/money-presun';
import {
	getDlvReadbackMeta,
	readbackStav,
	type ReadbackVysledok
} from '$lib/server/money-readback';
import type { DlvReadbackMeta } from '$lib/server/money-readback';
import { logger } from '$lib/server/log';

const log = logger('odpisy');

export const load: PageServerLoad = async () => {
	// #299: detekuj RUČNÝ presun parkovaných (`caka=1`) odpisov zo staging „NA ODPIS" do Money importu
	// PRED čítaním histórie + readbacku, aby oboje videli aktuálny stav (presunutý odpis vstúpi do
	// readback matchingu + dostane UI marker). READ-ONLY na staging (len `fs.existsSync`). NIKDY nesmie
	// zhodiť stránku — /odpisy hostí „Uvoľniť" (jedinú cestu k oprave duplikátov), takže IO chyba
	// degraduje na „nič sa nedetekovalo", nie na 500.
	try {
		const presuny = detectManualStagingMoves();
		if (presuny.length > 0)
			log.info('detekované ručné presuny zo staging do Money importu (#299)', {
				pocet: presuny.length,
				ids: presuny.map((p) => p.id)
			});
	} catch (e) {
		log.error('detekcia ručného presunu zlyhala — /odpisy ostáva funkčné', { error: e });
	}
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
	// Readback NESMIE zhodiť /odpisy — táto stránka hostí „Uvoľniť" (jedinú cestu k oprave duplikátov),
	// takže DB/IO chyba pri readbacku degraduje na „neoverené", NIKDY na 500 (#298 review).
	let stav = new Map<number, ReadbackVysledok>();
	let readbackMeta: DlvReadbackMeta | null = null;
	try {
		stav = readbackStav(odpisy.filter((o) => o.live).map((o) => o.id));
		readbackMeta = getDlvReadbackMeta();
	} catch (e) {
		log.error('readback zlyhal — degradujem na „neoverené", stránka ostáva funkčná', { error: e });
	}
	return {
		odpisy: odpisy.map((o) => ({ ...o, readback: stav.get(o.id) ?? null })),
		readbackMeta
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
