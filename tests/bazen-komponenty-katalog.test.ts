// #368 — DRIFT-GUARD: zamyká `KATALOG` (BPK*) na autoritatívnu 98-riadkovú tabuľku
// od Dominika `ir.attachment 14674` (kanál 207 msg 1768496). Zoznam nižšie je NEZÁVISLE
// prepísaný z tej tabuľky (poradie riadkov = poradie kódov), takže je to skutočný guard,
// nie tautológia proti kódu: tiché pridanie/odobratie/preusporiadanie BPK kódu v
// `bazen-komponenty.ts` tu padne. Zhoda kód-po-kóde overená v #368 (57/57, identické poradie).
import { describe, it, expect } from 'vitest';
import { pocitajBazenKomponenty, BPK_KODY, type BazenKompVstup } from '../src/lib/bazen-komponenty';

// Autoritatívny zoznam — presne 57 BPK kódov v poradí tabuľky att 14674.
// Sekcie: PODVOZKY | ARETÁCIA (typ/strana) | automatická | uzamykateľná |
// NEZARADENÉ | VÝKLOPNÉ ČELO | VETRACIA KLAPKA | DVERE | KRYTKY (RAL + veľkosti).
const TABULKA_14674: readonly string[] = [
	// PODVOZKY
	'BPK00074',
	'BPK00076',
	'BPK00078',
	'BPK00079',
	'BPK00080',
	'BPK00081',
	'BPK00097',
	'BPK00098',
	// ARETÁCIA S1 (telo/páčka/púzdro/pružiny/skrutka)
	'BPK00082',
	'BPK00084',
	'BPK00085',
	'BPK00086',
	'BPK00087',
	'BPK00088',
	// automatická aretácia (zobáčik/kolík/krúžok/púzdro/pružina)
	'BPK00089',
	'BPK00090',
	'BPK00091',
	'BPK00092',
	'BPK00093',
	// západky + uzamykateľná
	'BPK20259',
	'BPK202510',
	'BPK202416',
	'BPK202519',
	// NEZARADENÉ príslušenstvo
	'BPK00100',
	'BPK00101',
	'BPK20252',
	'BPK20253',
	'BPK00107',
	'BPK00108',
	'BPK202513',
	'BPK202514',
	'BPK202515',
	'BPK202521',
	// VÝKLOPNÉ ČELO
	'BPK202516',
	'BPK202517',
	'BPK202520',
	// VETRACIA KLAPKA
	'BPK202518',
	// DVERE (dorazy + dverové kladkové krytky)
	'BPK202540',
	'BPK202539',
	'BPK202536',
	'BPK202533',
	'BPK202535',
	'BPK202537',
	// KRYTKY (RAL 9006/7016 — kladkový profil, aretačné, nožičkové)
	'BPK202522',
	'BPK20251',
	'BPK202523',
	'BPK20258',
	'BPK202524',
	'BPK20256',
	'BPK202525',
	'BPK20257',
	'BPK202526',
	'BPK20254',
	'BPK202527',
	'BPK20255',
	'BPK202531',
	'BPK202529'
];

function v(over: Partial<BazenKompVstup> = {}): BazenKompVstup {
	return {
		pocetSekcii: 3,
		dvojkolaj: false,
		exclusive: false,
		dvere: false,
		vyklopneCeloOn: false,
		vetraciaKlapka: false,
		aretaciaTyp: 'manualna',
		aretaciaStrana: 'P',
		uzamykatelna: false,
		ralKrytiek: 'R9006',
		pantFarba: 'ELOX',
		velka: 0,
		stredna: 0,
		mala: 0,
		...over
	};
}

describe('#368 — KATALOG drift-guard proti tabuľke att 14674', () => {
	it('BPK_KODY = presne 57 kódov v poradí tabuľky (množina + poradie)', () => {
		expect(BPK_KODY.length).toBe(57);
		expect(TABULKA_14674.length).toBe(57);
		// poradie AJ obsah 1:1 s tabuľkou
		expect([...BPK_KODY]).toEqual([...TABULKA_14674]);
		// žiadne duplikáty v katalógu
		expect(new Set(BPK_KODY).size).toBe(BPK_KODY.length);
	});

	it('každý deklarovaný kód je DOSIAHNUTEĽNÝ (union variantov = celá tabuľka)', () => {
		// varianty pokrývajú všetky vzájomne sa vylučujúce voľby (jedno/dvoj, strana L/P,
		// manuál/auto, uzamykateľná, RAL R9006/R7016, pant ELOX/9005, dvere, klapka, čelo,
		// exclusive, veľkosti sekcií) — ich zjednotenie musí vydať presne celý katalóg.
		const varianty: Partial<BazenKompVstup>[] = [
			{ dvojkolaj: false, aretaciaStrana: 'P', velka: 1, stredna: 1, mala: 1 },
			{ dvojkolaj: true },
			{ aretaciaStrana: 'L' },
			{ aretaciaTyp: 'automaticka' },
			{ uzamykatelna: true },
			{ ralKrytiek: 'R7016', velka: 1, stredna: 1, mala: 1 },
			{ exclusive: true },
			{ dvere: true, ralKrytiek: 'R7016' },
			{ dvere: true, ralKrytiek: 'R9006' },
			{ vyklopneCeloOn: true, pantFarba: 'ELOX' },
			{ vyklopneCeloOn: true, pantFarba: '9005' },
			{ vetraciaKlapka: true }
		];
		const union = new Set<string>();
		for (const over of varianty) for (const p of pocitajBazenKomponenty(v(over))) union.add(p.kod);
		// nič nedosiahnuteľné (mŕtvy kód) a nič mimo tabuľky
		expect([...union].sort()).toEqual([...TABULKA_14674].sort());
	});

	it('žiadny kód mimo tabuľky sa nikdy nevydá', () => {
		const povolene = new Set(TABULKA_14674);
		const g = pocitajBazenKomponenty(
			v({ dvere: true, vyklopneCeloOn: true, vetraciaKlapka: true, uzamykatelna: true, velka: 2 })
		);
		for (const p of g) expect(povolene.has(p.kod)).toBe(true);
	});
});
