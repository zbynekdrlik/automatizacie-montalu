// „Použiť znova" — Patrik 2026-07-31: „môže znova zavolať to, čo použil minule, len
// zmení zákazníka, viacerí zákazníci si objednávajú to isté".
//
// Testy strážia tri veci:
//   1. že sa prenesie CELÉ zadanie (vrátane polí, ktoré menia Money odpis),
//   2. že sa NEPRENESIE ZAK / OP / zákazník — práve tie sa menia,
//   3. že hodnota, ktorú konfigurácia už nepozná (sklo po migrácii v19), sa zahodí
//      a nahlási, namiesto aby potichu prešla do formulára.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// vlastná DB — test si zapisuje do histórie a nesmie sa biť s inými testami
// (dedup kľúč modul+zak+op+live je UNIQUE)
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-znova-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'z.db');

const { db } = await import('../src/lib/server/db');
const { znovaZOdpisu } = await import('../src/lib/server/znova');

/** vloží záznam do histórie priamo (test si stavia vlastný podklad, nič neodpisuje) */
function vlozOdpis(zak: string, op: string, detail: unknown, caka = 0): number {
	return Number(
		db
			.prepare(
				`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
				 VALUES ('zasklenia', ?, ?, 'Zákazník A', ?, 0, '/tmp', 'x.xlsx', 'h', ?, 'test')`
			)
			.run(zak, op, caka, JSON.stringify(detail)).lastInsertRowid
	);
}

const DETAIL_JEDEN = {
	system: 'Robust',
	styl: '3K',
	s: 3000,
	v: 2400,
	sklo: 'Izolačné sklo 4/16/4 číre Stopsol',
	skloZaklad: 'Izolačné sklo 4/16/4 číre',
	otvaranie: 'P - L',
	kovanieL: 'Kľučka',
	kovanieP: '',
	kovanieStred: '',
	kovanieStredOkno: 'L',
	poznamka: 'poznámka\nna dva riadky',
	ral: '7016',
	klin: { dlzka: 500, sirka: 100, v1: 200, v2: 300, ks: 2 },
	kolajnica: { horna: 3100 },
	jednostrannaFab: true,
	pridavnaKolajnica: true,
	vrtanieZamku: 1200
};

describe('znovaZOdpisu — jeden posuv', () => {
	let id: number;
	beforeAll(() => {
		id = vlozOdpis('ZAK-ZNOVA-1', '01', DETAIL_JEDEN, 1);
	});

	it('prenesie celé zadanie posuvu', () => {
		const v = znovaZOdpisu(id)?.vstup;
		expect(v).toBeTruthy();
		expect(v!.system).toBe('Robust');
		expect(v!.styl).toBe('3K');
		expect(v!.s).toBe(3000);
		expect(v!.v).toBe(2400);
		expect(v!.otvaranie).toBe('P - L');
		expect(v!.kovanieL).toBe('Kľučka');
		expect(v!.poznamka).toBe('poznámka\nna dva riadky');
		expect(v!.ral).toBe('7016');
		// staré záznamy (pred #472) majú `klin: {...}` (jeden) → objArr ho zabalí do poľa
		expect(v!.kliny).toEqual([{ dlzka: 500, sirka: 100, v1: 200, v2: 300, ks: 2 }]);
		expect(v!.vrtanieZamku).toBe(1200);
	});

	it('MONEY-KRITICKÉ: prenesie polia, ktoré menia odpis', () => {
		const v = znovaZOdpisu(id)!.vstup!;
		expect(v.jednostrannaFab).toBe(true);
		expect(v.pridavnaKolajnica).toBe(true);
		expect(v.kolajnica).toEqual({ horna: 3100 });
	});

	it('sklo sa rozdelí späť na základné a presné zloženie', () => {
		const v = znovaZOdpisu(id)!.vstup!;
		expect(v.sklo).toBe('Izolačné sklo 4/16/4 číre');
		expect(v.skloPresne).toBe('Izolačné sklo 4/16/4 číre Stopsol');
	});

	it('KĽÚČOVÉ: ZAK, OP ani zákazník sa NEPRENESÚ', () => {
		const v = znovaZOdpisu(id)!.vstup!;
		expect(v.zak).toBe('');
		expect(v.op).toBe('');
		expect(v.zakaznik).toBe('');
	});

	it('príznak „čaká" sa prenesie zo záznamu', () => {
		expect(znovaZOdpisu(id)!.vstup!.caka).toBe(true);
	});

	it('zdroj nesie, z čoho sa predvypĺňa (pre hlášku obsluhe)', () => {
		const z = znovaZOdpisu(id)!;
		expect(z.zdroj.zak).toBe('ZAK-ZNOVA-1');
		expect(z.zdroj.op).toBe('01');
		expect(z.chybajuce).toEqual([]);
	});
});

describe('znovaZOdpisu — hodnoty, ktoré už neplatia', () => {
	it('sklo, ktoré systém už neponúka, sa ZAHODÍ a nahlási', () => {
		// kalené 8 mm bolo v Robuste do migrácie v19 (Patrik: Robust je IZO-only)
		const id = vlozOdpis('ZAK-ZNOVA-2', '01', {
			...DETAIL_JEDEN,
			sklo: 'Kalené 8mm',
			skloZaklad: 'Kalené 8mm'
		});
		const z = znovaZOdpisu(id)!;
		expect(z.vstup!.sklo).toBe('');
		expect(z.chybajuce.join(' ')).toMatch(/Kalené 8mm/);
		expect(z.chybajuce.join(' ')).toMatch(/neponúka/);
	});

	it('štýl, ktorý v konfigurácii nie je, sa nahlási (ale zadanie sa nezahodí)', () => {
		const id = vlozOdpis('ZAK-ZNOVA-3', '01', { ...DETAIL_JEDEN, styl: '9K' });
		const z = znovaZOdpisu(id)!;
		expect(z.chybajuce.join(' ')).toMatch(/9K/);
		expect(z.vstup!.s).toBe(3000);
	});
});

describe('znovaZOdpisu — zimná záhrada (viac posuvov)', () => {
	it('prenesie všetky posuvy aj spoločné polia', () => {
		const id = vlozOdpis('ZAK-ZNOVA-4', '01', {
			zimnaZahrada: true,
			pocetPosuvov: 2,
			poznamka: 'zimná',
			ral: '9016',
			jednostrannaFab: false,
			pridavnaKolajnica: true,
			posuvy: [
				{
					posuv: 1,
					system: 'Robust',
					styl: '2K',
					s: 2000,
					v: 2200,
					sklo: 'Izolačné sklo 4/16/4 číre',
					otvaranie: 'P - L'
				},
				{
					posuv: 2,
					system: 'Robust',
					styl: '3K',
					s: 3000,
					v: 2200,
					sklo: 'Izolačné sklo 4/16/4 číre',
					otvaranie: 'L - P',
					klin: null,
					kolajnica: null
				}
			]
		});
		const m = znovaZOdpisu(id)!.multiVstup!;
		expect(m.posuvy).toHaveLength(2);
		expect(m.posuvy[0]!.styl).toBe('2K');
		expect(m.posuvy[1]!.s).toBe(3000);
		expect(m.ral).toBe('9016');
		expect(m.pridavnaKolajnica).toBe(true);
		expect(m.zak).toBe('');
	});
});

describe('znovaZOdpisu — čo NEVRACIA nič', () => {
	it('neexistujúce id, nezmyselné id a iný modul', () => {
		expect(znovaZOdpisu(999999)).toBeNull();
		expect(znovaZOdpisu(0)).toBeNull();
		expect(znovaZOdpisu(-1)).toBeNull();
		const id = Number(
			db
				.prepare(
					`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
					 VALUES ('pergola', 'ZAK-P', '01', 'X', 0, 0, '/tmp', 'x.xlsx', 'h', '{}', 'test')`
				)
				.run().lastInsertRowid
		);
		expect(znovaZOdpisu(id)).toBeNull();
	});

	it('pokazený detail nezhodí appku', () => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
					 VALUES ('zasklenia', 'ZAK-ROZBITE', '01', 'X', 0, 0, '/tmp', 'x.xlsx', 'h', '{nie json', 'test')`
				)
				.run().lastInsertRowid
		);
		expect(znovaZOdpisu(id)).toBeNull();
	});
});

describe('MIGRÁCIA v19: Robust je IZO-only', () => {
	it('kalené 8/10 mm sa už neponúkajú v žiadnom systéme', () => {
		const skla = db.prepare('SELECT nazov, system FROM glass_types').all() as {
			nazov: string;
			system: string;
		}[];
		expect(skla.some((g) => g.nazov === 'Kalené 8mm')).toBe(false);
		expect(skla.some((g) => g.nazov === 'Kalené 10mm')).toBe(false);
	});

	it('Robust má stále svoje izolačné skladby', () => {
		const skla = db.prepare("SELECT nazov FROM glass_types WHERE system = 'Robust'").all() as {
			nazov: string;
		}[];
		expect(skla.map((g) => g.nazov)).toContain('Izolačné sklo 4/16/4 číre');
		expect(skla.length).toBeGreaterThan(0);
	});
});
