// Charakterizačný (golden) test pre #109 — commitnutý PRED refaktorom builderu
// PosuvSpec, zelený na PÔVODNOM kóde (compute() a computeMultiFrom() skladajú
// PosuvSpec ako dva NEZÁVISLÉ objektové literály). Po refaktore na zdieľaný
// buildPosuvSpec() musí prejsť s TÝM ISTÝM snapshotom bezo zmeny — to je dôkaz,
// že Money výstup (nárezový plán, kovanie, planHash odvodený z job.polozky) je
// BYTE-IDENTICKÝ pred aj po refaktore, na oboch cestách (jeden posuv aj viac
// posuvov naraz).
//
// Vektory zámerne NEHÁDŽU náhodné kombinácie — sú prevzaté / odvodené z už
// overených platných kombinácií v iných testoch (vstup-sietka, kolajnica-rucna,
// vstup-multi-roundtrip, kovanie-odpis, zasklenia-detail-sklo), aby matica pokryla
// systémy Robust/Slide/Deluxe/Štandard/Štandard + a VŠETKY voliteľné polia
// PosuvSpec (klin, ručná koľajnica, sieťka, prídavná koľajnica, otváranie, sklo,
// kovanie ľavá/pravá/stred, jednostranná FAB) bez toho, aby appka vektor odmietla
// ako neplatný.
//
// `nahlad`/`nahladMulti` sa použili zámerne namiesto `odoslat`/`odoslatMulti` —
// NIKDY nezapisujú (ani do TEST priečinka), a ich výstup (`plan`/`multi` obsahuje
// celý per-posuv `PosuvInfo`, `kovanie` položky a `planHash` z `job.polozky`) je
// presne to, čo by sa do Money odpísalo — netreba teda písať do MONEY_TEST_DIR ani
// riešiť duplicitnú ochranu v DB, aby bol dôkaz kompletný.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-posuvspec-golden-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { actions } = await import('../src/routes/zasklenia/+page.server');

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};

const USER = { id: 1, username: 'tester', role: 'internal' as const };

/** `vytvorene` je server clock (ISO timestamp behu testu) a `cielInfo.dir` je
 *  náhodný mkdtemp adresár tohto behu — ani jedno nie je súčasť Money výstupu
 *  (nezávisí od PosuvSpec). Oba sa zo snapshotu vynechávajú, inak by test padal na
 *  ČASE/ceste behu, nie na dátach ktoré tento refaktor môže zmeniť. */
function ocistene(r: Record<string, unknown>) {
	const { vytvorene: _vytvorene, ...rest } = r;
	const cielInfo = rest.cielInfo as Record<string, unknown> | undefined;
	if (cielInfo) {
		const { dir: _dir, ...cielInfoRest } = cielInfo;
		return { ...rest, cielInfo: cielInfoRest };
	}
	return rest;
}

async function nahlad(fields: Record<string, string>) {
	const r = (await actions.nahlad({
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd(fields) }),
		locals: { user: USER }
	} as Parameters<typeof actions.nahlad>[0])) as Record<string, unknown>;
	return ocistene(r);
}

async function nahladMulti(fields: Record<string, string>) {
	const r = (await actions.nahladMulti({
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd(fields) }),
		locals: { user: USER }
	} as Parameters<typeof actions.nahladMulti>[0])) as Record<string, unknown>;
	return ocistene(r);
}

// ---- jeden posuv (compute()) ----

const JEDEN_POSUV: Record<string, Record<string, string>> = {
	'robust-2K-plny (klin+sietka+kovanie+FAB obojstranná)': {
		zak: 'ZAK-G1',
		op: '01',
		zakaznik: 'Zákazník G1',
		system: 'Robust',
		styl: '2K',
		s: '4645',
		v: '2320',
		sklo: 'Izolačné sklo 4/16/4 číre',
		otvaranie: 'P - L',
		kovanieL: 'Obojstranná kľučka s FAB',
		kovanieP: 'Obojstranná kľučka s FAB',
		jednostrannaFab: '0',
		sietka: '1',
		sietkaUchyt: 'madloVelke',
		klin: '1',
		klinDlzka: '4645',
		klinSirka: '250',
		klinV1: '120',
		klinV2: '0',
		klinKs: '2',
		poznamka: 'test poznámka\nriadok 2',
		ral: 'RAL 7016 štruktúra'
	},
	'robust-2x2K-opona (kovanieStred, jednostranná FAB)': {
		zak: 'ZAK-G2',
		op: '01',
		zakaznik: 'Zákazník G2',
		system: 'Robust',
		styl: '2x2K',
		s: '5200',
		v: '2200',
		sklo: 'Izolačné sklo 4/16/4 mliečne',
		otvaranie: 'Opona',
		kovanieStred: 'Jednostranná kľučka z vnútra s FAB',
		kovanieStredOkno: 'P',
		jednostrannaFab: '1'
	},
	'slide-3K-6mm (sieťka, redukcia)': {
		zak: 'ZAK-G3',
		op: '01',
		zakaznik: 'Zákazník G3',
		system: 'Slide',
		styl: '3K',
		s: '3600',
		v: '2100',
		sklo: '6mm číre',
		otvaranie: 'L - P',
		sietka: '1',
		sietkaUchyt: 'zamok'
	},
	'deluxe-3K-kolajnica-rucna (kladka/klzný podľa skla)': {
		zak: 'ZAK-G4',
		op: '01',
		zakaznik: 'Zákazník G4',
		system: 'Deluxe',
		styl: '3K',
		s: '4200',
		v: '2250',
		sklo: 'Float kalené 10 mm',
		otvaranie: 'P - L',
		kolajnicaHorna: '2690',
		kolajnicaSpodna: '2695'
	},
	'standard-plus-4K-izo (prídavná koľajnica, sieťka so systémom)': {
		zak: 'ZAK-G5',
		op: '01',
		zakaznik: 'Zákazník G5',
		system: 'Štandard +',
		styl: '4K',
		s: '4800',
		v: '2100',
		sklo: 'Izolačné sklo 4.8.4',
		otvaranie: 'P - L',
		pridavnaKolajnica: '1',
		kolajnicaHorna: '2690',
		kolajnicaSpodna: '2695',
		sietka: '1',
		sietkaUchyt: 'madloVelke',
		sietkaSystem: 'Štandard'
	},
	'standard-2K-basic (minimálny vektor, žiadne voliteľné polia)': {
		zak: 'ZAK-G6',
		op: '01',
		zakaznik: 'Zákazník G6',
		system: 'Štandard',
		styl: '2K',
		s: '2509',
		v: '1930',
		sklo: 'Float sklo 6 mm',
		otvaranie: 'L - P'
	}
};

describe('golden #109 — jeden posuv (nahlad) — snapshot pred refaktorom PosuvSpec builderu', () => {
	for (const [nazov, fields] of Object.entries(JEDEN_POSUV)) {
		it(`${nazov} — plan/kovanie/planHash nezmenené`, async () => {
			const r = await nahlad(fields);
			expect(r).toMatchSnapshot();
		});
	}
});

// ---- viac posuvov (computeMultiFrom()) ----

const VIAC_POSUVOV: Record<string, Record<string, string>> = {
	'2 posuvy: robust-2K (klin+sietka+kovanie) + slide-3K-6mm (sieťka)': {
		zak: 'ZAK-GM1',
		op: '01',
		zakaznik: 'Zákazník GM1',
		pridavnaKolajnica: '0',
		jednostrannaFab: '1',
		poznamka: 'viacposuvová poznámka',
		ral: 'RAL 9010',
		posuvy: JSON.stringify([
			{
				system: 'Robust',
				styl: '2K',
				s: '4645',
				v: '2320',
				sklo: 'Izolačné sklo 4/16/4 číre',
				otvaranie: 'P - L',
				kovanieL: 'Obojstranná kľučka s FAB',
				kovanieP: 'Obojstranná kľučka s FAB',
				sietka: '1',
				sietkaUchyt: 'madloVelke',
				klin: '1',
				klinDlzka: '4645',
				klinSirka: '250',
				klinV1: '120',
				klinV2: '0',
				klinKs: '2'
			},
			{
				system: 'Slide',
				styl: '3K',
				s: '3600',
				v: '2100',
				sklo: '6mm číre',
				otvaranie: 'L - P',
				sietka: '1',
				sietkaUchyt: 'zamok'
			}
		])
	},
	'3 posuvy: deluxe-3K (kolajnica) + standard-plus-4K-izo (sieťka+prídavná koľajnica) + robust-2x2K-opona': {
		zak: 'ZAK-GM2',
		op: '01',
		zakaznik: 'Zákazník GM2',
		pridavnaKolajnica: '1',
		jednostrannaFab: '0',
		poznamka: '',
		ral: '',
		posuvy: JSON.stringify([
			{
				system: 'Deluxe',
				styl: '3K',
				s: '4200',
				v: '2250',
				sklo: 'Float kalené 10 mm',
				otvaranie: 'P - L',
				kolajnicaHorna: '2690',
				kolajnicaSpodna: '2695'
			},
			{
				system: 'Štandard +',
				styl: '4K',
				s: '4800',
				v: '2100',
				sklo: 'Izolačné sklo 4.8.4',
				otvaranie: 'P - L',
				kolajnicaHorna: '2690',
				kolajnicaSpodna: '2695',
				sietka: '1',
				sietkaUchyt: 'madloVelke',
				sietkaSystem: 'Štandard'
			},
			{
				system: 'Robust',
				styl: '2x2K',
				s: '5200',
				v: '2200',
				sklo: 'Izolačné sklo 4/16/4 mliečne',
				otvaranie: 'Opona',
				kovanieStred: 'Jednostranná kľučka z vnútra s FAB',
				kovanieStredOkno: 'P'
			}
		])
	}
};

describe('golden #109 — viac posuvov (nahladMulti) — snapshot pred refaktorom PosuvSpec builderu', () => {
	for (const [nazov, fields] of Object.entries(VIAC_POSUVOV)) {
		it(`${nazov} — multi/kovanie/planHash nezmenené`, async () => {
			const r = await nahladMulti(fields);
			expect(r).toMatchSnapshot();
		});
	}
});
