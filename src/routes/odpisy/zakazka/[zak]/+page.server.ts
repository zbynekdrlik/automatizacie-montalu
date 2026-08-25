// Cenový zoznam odpísaného materiálu k zákazke (#154, časti 1+2). Read-only
// agregácia uložených odoslaných odpisov zákazky (zakazka-ceny.ts) + denný Money
// cenový snapshot (enrichPolozky) + Money readback (overenie, že odpisy reálne
// prešli). b2b sa sem NIKDY nedostane (celý /odpisy prefix je denylistovaný
// v b2b-access.ts) a appka vyžaduje prihlásenie na každú inú stránku — ďalší
// guard tu nie je potrebný (rovnaká úvaha ako /odpisy/[id]).
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { zakazkaPrehlad } from '$lib/server/zakazka-ceny';
import { enrichPolozky } from '$lib/server/ceny';
import {
	getDlvReadbackMeta,
	readbackStav,
	type ReadbackVysledok
} from '$lib/server/money-readback';
import type { DlvReadbackMeta } from '$lib/server/money-readback';
import { logger } from '$lib/server/log';

const log = logger('zakazka-ceny');

export const load: PageServerLoad = async ({ params }) => {
	const prehlad = zakazkaPrehlad(params.zak);
	if (!prehlad) error(404, 'Zákazka sa nenašla — nemá žiadny odoslaný odpis.');

	// ceny LEN keď scope má uložené položky; inak čestné „nie sú k dispozícii"
	// (odpisy spred fázy 1 nemajú položky — nikdy prázdna tabuľka tváriaca sa kompletná)
	const ceny = prehlad.polozky.length > 0 ? enrichPolozky(prehlad.polozky) : null;

	// #298 readback: LIVE odpisy overí proti Money DLV snapshotu. NESMIE zhodiť
	// stránku — DB/IO chyba degraduje na „neoverené", NIKDY 500 (vzor /odpisy).
	let stav = new Map<number, ReadbackVysledok>();
	let readbackMeta: DlvReadbackMeta | null = null;
	try {
		stav = readbackStav(prehlad.odpisy.filter((o) => o.live).map((o) => o.id));
		readbackMeta = getDlvReadbackMeta();
	} catch (e) {
		log.error('readback zlyhal — degradujem na „neoverené", stránka ostáva funkčná', {
			zak: prehlad.zakNorm,
			error: e
		});
	}

	return {
		prehlad: {
			...prehlad,
			odpisy: prehlad.odpisy.map((o) => ({ ...o, readback: stav.get(o.id) ?? null }))
		},
		ceny,
		readbackMeta
	};
};
