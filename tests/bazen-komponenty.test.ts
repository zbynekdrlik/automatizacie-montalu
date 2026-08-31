// #355 — kusové komponenty bazéna (BPK*): pravidlá množstiev per kombinácia
// volieb. Zdroj pravidiel = Dominik att 14674 (kanál 207 msg 1768496).
import { describe, it, expect } from 'vitest';
import { pocitajBazenKomponenty, type BazenKompVstup } from '../src/lib/bazen-komponenty';
import { computeBazenAll } from '../src/lib/server/bazen';
import type { BazenVstup } from '../src/lib/server/bazen';

function v(over: Partial<BazenKompVstup> = {}): BazenKompVstup {
	return {
		pocetSekcii: 3,
		dvojkolaj: false, // jednokoľaj
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

/** kod → qty; kódy, ktoré sa nevrátili (0 ks → vynechané), nie sú v mape. */
const byKod = (over: Partial<BazenKompVstup> = {}) => {
	const m: Record<string, number> = {};
	for (const p of pocitajBazenKomponenty(v(over))) {
		expect(p.mj).toBe('ks'); // každý komponent je kusový
		m[p.kod] = p.qty;
	}
	return m;
};

describe('bazén komponenty — PODVOZKY (jedno/dvojkoľaj)', () => {
	it('jednokoľaj, 3 sekcie', () => {
		const g = byKod();
		expect(g['BPK00074']).toBe(6); // kladka D62: 2/sekcia jednokoľaj
		expect(g['BPK00076']).toBe(6); // kladka jednokoľaj: 2/sekcia
		expect(g['BPK00078']).toBe(2); // vodiaca kladka: sekcie-1
		expect(g['BPK00079']).toBe(2);
		expect(g['BPK00080']).toBe(2);
		expect(g['BPK00081']).toBe(2);
		expect(g['BPK00097']).toBe(6); // háčik: 2/sekcia jednokoľaj
		expect(g['BPK00098']).toBe(6);
	});
	it('dvojkoľaj zdvojnásobí kladky a vynuluje jednokoľajové', () => {
		const g = byKod({ dvojkolaj: true });
		expect(g['BPK00074']).toBe(12); // 4/sekcia dvojkoľaj
		expect(g['BPK00076']).toBeUndefined(); // len jednokoľaj
		expect(g['BPK00078']).toBeUndefined(); // vodiaca kladka len jednokoľaj
		expect(g['BPK00097']).toBe(12);
		expect(g['BPK00098']).toBe(12);
	});
	it('1 sekcia jednokoľaj → vodiaca kladka (sekcie-1=0) sa vynechá', () => {
		const g = byKod({ pocetSekcii: 1 });
		expect(g['BPK00074']).toBe(2);
		expect(g['BPK00078']).toBeUndefined();
	});
});

describe('bazén komponenty — ARETÁCIA (typ, strana, uzamykateľná)', () => {
	it('manuálna, strana P: telo/páčka/púzdro/skrutka = počet sekcií; pružina+západka len P', () => {
		const g = byKod();
		expect(g['BPK00082']).toBe(3);
		expect(g['BPK00084']).toBe(3);
		expect(g['BPK00085']).toBe(3);
		expect(g['BPK00088']).toBe(3);
		expect(g['BPK00086']).toBe(3); // pružina P
		expect(g['BPK00087']).toBeUndefined(); // pružina L
		expect(g['BPK202510']).toBe(3); // západka P
		expect(g['BPK20259']).toBeUndefined(); // západka L
		// automatické-only položky vynechané
		expect(g['BPK00089']).toBeUndefined();
		expect(g['BPK00093']).toBeUndefined();
	});
	it('strana ĽAVÁ prehodí pružinu a západku', () => {
		const g = byKod({ aretaciaStrana: 'L' });
		expect(g['BPK00087']).toBe(3); // pružina L
		expect(g['BPK00086']).toBeUndefined();
		expect(g['BPK20259']).toBe(3); // západka L
		expect(g['BPK202510']).toBeUndefined();
	});
	it('automatická: telo/páčka/púzdro/skrutka = 1; zobáčik+kolík = sekcie-1', () => {
		const g = byKod({ aretaciaTyp: 'automaticka' });
		expect(g['BPK00082']).toBe(1);
		expect(g['BPK00084']).toBe(1);
		expect(g['BPK00085']).toBe(1);
		expect(g['BPK00088']).toBe(1);
		expect(g['BPK00086']).toBe(1); // pružina P automatická = 1
		expect(g['BPK00089']).toBe(2); // zobáčik = sekcie-1
		expect(g['BPK00090']).toBe(2);
		expect(g['BPK00091']).toBe(2);
		expect(g['BPK00092']).toBe(2);
		expect(g['BPK00093']).toBe(2);
	});
	it('uzamykateľná NAHRÁDZA obyčajnú páčku (manuálna): páčka→0, uzamyk páčka+zámok = sekcie', () => {
		const g = byKod({ uzamykatelna: true });
		expect(g['BPK00084']).toBeUndefined(); // obyčajná páčka nahradená
		expect(g['BPK202416']).toBe(3); // uzamykateľná páčka = sekcie (manuálna)
		expect(g['BPK202519']).toBe(3); // zámok = sekcie
	});
	it('uzamykateľná + automatická: páčka→0, uzamyk páčka+zámok = sekcie-1', () => {
		const g = byKod({ uzamykatelna: true, aretaciaTyp: 'automaticka' });
		expect(g['BPK00084']).toBeUndefined();
		expect(g['BPK202416']).toBe(2); // sekcie-1
		expect(g['BPK202519']).toBe(2);
	});
});

describe('bazén komponenty — NEZARADENÉ + EXCLUSIVE + výklopné čelo/dvere spúšťače', () => {
	it('jednokoľaj: gumový doraz/sada 2/sekcia, doraz koľajnice=2, kartáčové=sekcie', () => {
		const g = byKod();
		expect(g['BPK00100']).toBe(6);
		expect(g['BPK00101']).toBe(6);
		expect(g['BPK20252']).toBe(3); // krytka koľajnice L jednokoľaj = sekcie
		expect(g['BPK20253']).toBe(3);
		expect(g['BPK00107']).toBe(2); // doraz koľajnice jednokoľaj
		expect(g['BPK202513']).toBe(3); // spojka D8 jednokoľaj = sekcie
		expect(g['BPK202521']).toBe(3); // kartáčové jednokoľaj = sekcie
		expect(g['BPK00108']).toBeUndefined(); // nie EXCLUSIVE
		expect(g['BPK202514']).toBeUndefined(); // madlo len ak výklopné čelo
		expect(g['BPK202515']).toBeUndefined(); // madlo uzamyk len ak dvere
	});
	it('dvojkoľaj: krytka/spojka koľajnice ×2, doraz koľajnice=4, gumový doraz+kartáčové vynechané', () => {
		const g = byKod({ dvojkolaj: true });
		expect(g['BPK20252']).toBe(6); // 2×sekcie
		expect(g['BPK202513']).toBe(6);
		expect(g['BPK00107']).toBe(4);
		expect(g['BPK00100']).toBeUndefined();
		expect(g['BPK202521']).toBeUndefined();
	});
	it('model EXCLUSIVE → spojka M8 = sekcie×4', () => {
		expect(byKod({ exclusive: true })['BPK00108']).toBe(12);
	});
	it('výklopné čelo zapnuté (ELOX): pant ELOX=3, matica=1, madlo=1; 9005 vynechaný', () => {
		const g = byKod({ vyklopneCeloOn: true });
		expect(g['BPK202516']).toBe(3); // pant ELOX
		expect(g['BPK202517']).toBeUndefined(); // pant 9005
		expect(g['BPK202520']).toBe(1); // krídlová matica
		expect(g['BPK202514']).toBe(1); // madlo
	});
	it('pant 9005 prehodí variant', () => {
		const g = byKod({ vyklopneCeloOn: true, pantFarba: '9005' });
		expect(g['BPK202517']).toBe(3);
		expect(g['BPK202516']).toBeUndefined();
	});
	it('vetracia klapka → trecí pant = 3', () => {
		expect(byKod({ vetraciaKlapka: true })['BPK202518']).toBe(3);
		expect(byKod()['BPK202518']).toBeUndefined();
	});
	it('dvere (R9006): dverový doraz=4, krytky L+P=1, madlo uzamykateľné=1; R7016 varianty vynechané', () => {
		const g = byKod({ dvere: true });
		expect(g['BPK202539']).toBe(4); // dverový doraz R9006
		expect(g['BPK202540']).toBeUndefined(); // R7016
		expect(g['BPK202533']).toBe(1); // krytka L R9006
		expect(g['BPK202537']).toBe(1); // krytka P R9006
		expect(g['BPK202536']).toBeUndefined(); // L R7016
		expect(g['BPK202535']).toBeUndefined(); // P R7016
		expect(g['BPK202515']).toBe(1); // madlo uzamykateľné
	});
});

describe('bazén komponenty — KRYTKY (RAL variant + veľkosti sekcií)', () => {
	it('R9006 (default) vyberie R9006 varianty, R7016 sú absent', () => {
		const g = byKod();
		expect(g['BPK20251']).toBe(3); // krytka kladk. profilu L R9006 jednokoľaj = sekcie
		expect(g['BPK20258']).toBe(3); // P R9006
		expect(g['BPK20256']).toBe(3); // aretácia L R9006 jednokoľaj = sekcie
		expect(g['BPK20257']).toBe(3); // aretácia P R9006
		expect(g['BPK202522']).toBeUndefined(); // R7016 varianty absent
		expect(g['BPK202524']).toBeUndefined();
	});
	it('R7016 prehodí všetky krytky na R7016 varianty', () => {
		const g = byKod({ ralKrytiek: 'R7016' });
		expect(g['BPK202522']).toBe(3); // krytka kladk. L R7016
		expect(g['BPK202523']).toBe(3); // P R7016
		expect(g['BPK202524']).toBe(3); // aretácia L R7016 jednokoľaj
		expect(g['BPK202525']).toBe(3);
		expect(g['BPK20251']).toBeUndefined();
		expect(g['BPK20256']).toBeUndefined();
	});
	it('dvojkoľaj: krytka kladkového profilu 2/sekcia; aretačné krytky (len jednokoľaj) vynechané', () => {
		const g = byKod({ dvojkolaj: true });
		expect(g['BPK20251']).toBe(6); // 2×sekcie
		expect(g['BPK20258']).toBe(6);
		expect(g['BPK20256']).toBeUndefined(); // aretácia krytky len jednokoľaj
		expect(g['BPK20257']).toBeUndefined();
	});
	it('krytky nožičiek per veľkosť (V=1,S=1,M=1): čelová=5, krajová=4', () => {
		const g = byKod({ velka: 1, stredna: 1, mala: 1 });
		// čelová: VEĽKÁ 2 + STREDNÁ 1 + MALÁ 2 = 5
		expect(g['BPK20254']).toBe(5); // čelová L R9006
		expect(g['BPK20255']).toBe(5); // čelová P R9006
		// krajová: VEĽKÁ 0 + STREDNÁ 2 + MALÁ 2 = 4
		expect(g['BPK202529']).toBe(4); // krajová R9006
	});
	it('krytky nožičiek R7016 variant + rôzne veľkosti (V=2,S=0,M=1): čelová=6, krajová=2', () => {
		const g = byKod({ ralKrytiek: 'R7016', velka: 2, stredna: 0, mala: 1 });
		// čelová: 2×2 + 1×0 + 2×1 = 6
		expect(g['BPK202526']).toBe(6); // čelová L R7016
		expect(g['BPK202527']).toBe(6);
		// krajová: 0×2 + 2×0 + 2×1 = 2
		expect(g['BPK202531']).toBe(2);
	});
	it('bez veľkostí sekcií sa nožičkové krytky vynechajú (0 ks)', () => {
		const g = byKod();
		expect(g['BPK20254']).toBeUndefined();
		expect(g['BPK202529']).toBeUndefined();
	});
});

describe('computeBazenAll — profily (BPP) ostávajú + komponenty (BPK) sa pripoja', () => {
	const base: BazenVstup = {
		zak: 'Z1',
		op: 'O1',
		zakaznik: 'Test',
		model: 'Premier',
		kolaj: 'Jednokolaj',
		pocetSekcii: 3,
		pocetPriecok: 0,
		dvere: false,
		vs4500: 0,
		vs6000: 0,
		ss4500: 0,
		ss6000: 0,
		ms4500: 0,
		ms6000: 0,
		dlzkaKolajnic: 10000,
		prieckovy4300: 0,
		prieckovy6000: 0,
		vyklopneCelo: 0,
		caka: false,
		aretaciaTyp: 'manualna',
		aretaciaStrana: 'P',
		uzamykatelna: false,
		ralKrytiek: 'R9006',
		pantFarba: 'ELOX',
		vetraciaKlapka: false
	};

	it('BPP profil má mj undefined (=m), BPK komponent má mj=ks; oba sú v rozpise', () => {
		const { out, error } = computeBazenAll(base);
		expect(error).toBeNull();
		const bpp = out.find((o) => o.kod === 'BPP202414'); // kladkový profil V2
		expect(bpp).toBeTruthy();
		expect(bpp!.mj).toBeUndefined();
		const bpk = out.find((o) => o.kod === 'BPK00074'); // kladka D62
		expect(bpk).toBeTruthy();
		expect(bpk!.mj).toBe('ks');
		expect(bpk!.qty).toBe(6);
		// komponenty prídu AŽ ZA profilmi
		const firstBpk = out.findIndex((o) => o.kod.startsWith('BPK'));
		const lastBpp = out.map((o) => o.kod.startsWith('BPP')).lastIndexOf(true);
		expect(firstBpk).toBeGreaterThan(lastBpp);
	});

	it('model Exclusive pridá spojku M8; Premier nie', () => {
		const excl = computeBazenAll({ ...base, model: 'Exclusive' }).out;
		expect(excl.find((o) => o.kod === 'BPK00108')?.qty).toBe(12);
		const prem = computeBazenAll(base).out;
		expect(prem.find((o) => o.kod === 'BPK00108')).toBeUndefined();
	});
});
