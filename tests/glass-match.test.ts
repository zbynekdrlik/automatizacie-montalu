// #556: matcher lokálne (výpočtové) sklo → Odoo `montalu.glass.type` (cenníkový typ). ČISTÁ
// funkcia bez IO. Vektory z REÁLNEHO Odoo katalógu (validator 20.9., Patrik úloha 951 msg
// 1849693): 29 typov (izolacne/esg/vsg); acceptačné „Izolačné sklo 4/8/4- číre (Ug=1,1)" má
// `cennik_code=False`, `composition="4/8/4"`; nejednoznačné „4-16-4" → 2 typy (001 AL / 003 TH),
// „4-16-4-16-4" → 4 typy; obyčajné floaty nemajú v Odoo náprotivok. FIXTURE nižšie je verný výsek
// tých 29 živých typov (mená/zloženia/cennik_code podľa validátora) — testuje SPRÁVANIE matchera
// (jednoznacne/viac/ziadne), nie doslovný počet riadkov.
import { describe, it, expect } from 'vitest';
import {
	matchOdooGlassType,
	normalizeComposition,
	localGlassCategory,
	naviazanieRiadku,
	cennikPopis,
	type OdooTypLike
} from '../src/lib/server/glass-match';

// Verný výsek 29 živých Odoo `montalu.glass.type` (value = cennik_code || name).
const ODOO: OdooTypLike[] = [
	// acceptačné sklo — bez cennik_code → value = name
	{
		value: 'Izolačné sklo 4/8/4- číre (Ug=1,1)',
		name: 'Izolačné sklo 4/8/4- číre (Ug=1,1)',
		composition: '4/8/4',
		category: 'izolacne'
	},
	// nejednoznačná skupina 4-16-4 (AL vs teplý rámik TH)
	{
		value: '001',
		name: 'Izolačné sklo 4/16/4 číre AL',
		composition: '4/16/4',
		category: 'izolacne'
	},
	{
		value: '003',
		name: 'Izolačné sklo 4/16/4 číre TH (teplý rámik)',
		composition: '4/16/4',
		category: 'izolacne'
	},
	// jednoznačné izolačné 4-12-4
	{ value: '020', name: 'Izolačné sklo 4/12/4 číre', composition: '4/12/4', category: 'izolacne' },
	// trojsklo 4-16-4-16-4 — 4 varianty (nejednoznačné)
	{
		value: '030',
		name: 'Trojsklo 4/16/4/16/4 číre',
		composition: '4/16/4/16/4',
		category: 'izolacne'
	},
	{
		value: '031',
		name: 'Trojsklo 4/16/4/16/4 TH',
		composition: '4/16/4/16/4',
		category: 'izolacne'
	},
	{
		value: '032',
		name: 'Trojsklo 4/16/4/16/4 Ug=0,6',
		composition: '4/16/4/16/4',
		category: 'izolacne'
	},
	{
		value: '033',
		name: 'Trojsklo 4/16/4/16/4 warm',
		composition: '4/16/4/16/4',
		category: 'izolacne'
	},
	// ESG jednosklo 6 mm (jednoznačné)
	{ value: 'E6', name: 'ESG 6 mm číre', composition: '6', category: 'esg' },
	// VSG (lepené) 3.3.1
	{ value: 'V331', name: 'VSG 3.3.1 číre', composition: '3.3.1', category: 'vsg' }
];

describe('normalizeComposition (#556)', () => {
	it('kanonizuje lomítka/pomlčky/bodky/medzery na "A-B-C"', () => {
		expect(normalizeComposition('4/8/4')).toBe('4-8-4');
		expect(normalizeComposition('4 - 16 - 4')).toBe('4-16-4');
		expect(normalizeComposition('4.8.4')).toBe('4-8-4');
		expect(normalizeComposition('5esg/14/5esg')).toBe('5-14-5');
		expect(normalizeComposition('4/16/4/16/4')).toBe('4-16-4-16-4');
	});
	it('extrahuje zloženie z voľnotextového lokálneho názvu (ignoruje slová)', () => {
		expect(normalizeComposition('Izolačné sklo 4/16/4 číre')).toBe('4-16-4');
		expect(normalizeComposition('Izolačné sklo 4/8/4- číre (Ug=1,1)')).toBe('4-8-4');
	});
	it('jednosklo "N mm" → "N"', () => {
		expect(normalizeComposition('Float kalené 6 mm')).toBe('6');
		expect(normalizeComposition('6')).toBe('6');
	});
	it('VSG kódy 3.3.1 / 44.2 → normalizované číselné', () => {
		expect(normalizeComposition('3.3.1')).toBe('3-3-1');
		expect(normalizeComposition('44.2')).toBe('44-2');
	});
	it('prázdne / bez čísla → ""', () => {
		expect(normalizeComposition('')).toBe('');
		expect(normalizeComposition('sklo bez čísla')).toBe('');
	});
	it('slovo medzi číslom a oddeľovačom NEparsuje ako zloženie (review #556)', () => {
		// „4 dvere / 8" nie je zloženie — písmená musia byť PRIPOJENÉ k číslu (ako „5esg/14")
		expect(normalizeComposition('4 dvere / 8')).toBe('');
	});
});

describe('localGlassCategory (#556)', () => {
	it('názov obsahuje "izol" → izolacne', () => {
		expect(localGlassCategory('Izolačné sklo 4/8/4 číre')).toBe('izolacne');
	});
	it('"kalené"/"ESG" → esg', () => {
		expect(localGlassCategory('Float kalené 6 mm')).toBe('esg');
		expect(localGlassCategory('ESG 8 mm')).toBe('esg');
	});
	it('"VSG"/kód d.d.d → vsg', () => {
		expect(localGlassCategory('VSG 3.3.1 číre')).toBe('vsg');
		expect(localGlassCategory('Lepené 44.2')).toBe('vsg');
	});
	it('obyčajný float bez kalenia → float (bez Odoo náprotivku)', () => {
		expect(localGlassCategory('Float číre 6 mm')).toBe('float');
	});
	it('lepené-kalené „VSG … kalené" → vsg (vsg PRED esg, review #556)', () => {
		expect(localGlassCategory('VSG 33.1 kalené')).toBe('vsg');
	});
});

describe('matchOdooGlassType (#556)', () => {
	it('jednoznačná zhoda (acceptačné 4/8/4) → istota=jednoznacne, typ = name (cennik_code chýba)', () => {
		const m = matchOdooGlassType('Izolačné sklo 4/8/4 číre', ODOO);
		expect(m.istota).toBe('jednoznacne');
		expect(m.typ?.value).toBe('Izolačné sklo 4/8/4- číre (Ug=1,1)');
		expect(m.kandidati).toHaveLength(1);
	});
	it('nejednoznačné 4-16-4 (AL/TH) → istota=viac, typ=null, dvaja kandidáti', () => {
		const m = matchOdooGlassType('Izolačné sklo 4/16/4 číre', ODOO);
		expect(m.istota).toBe('viac');
		expect(m.typ).toBeNull();
		expect(m.kandidati.map((k) => k.value).sort()).toEqual(['001', '003']);
	});
	it('trojsklo 4-16-4-16-4 → istota=viac, štyria kandidáti', () => {
		const m = matchOdooGlassType('Izolačné sklo 4/16/4/16/4 trojsklo', ODOO);
		expect(m.istota).toBe('viac');
		expect(m.kandidati).toHaveLength(4);
	});
	it('jednoznačné ESG jednosklo → typ E6', () => {
		const m = matchOdooGlassType('Float kalené 6 mm', ODOO);
		expect(m.istota).toBe('jednoznacne');
		expect(m.typ?.value).toBe('E6');
	});
	it('VSG 3.3.1 → jednoznačné V331', () => {
		const m = matchOdooGlassType('VSG 3.3.1 číre', ODOO);
		expect(m.istota).toBe('jednoznacne');
		expect(m.typ?.value).toBe('V331');
	});
	it('obyčajný float (bez Odoo náprotivku) → istota=ziadne, typ=null', () => {
		const m = matchOdooGlassType('Float číre 6 mm', ODOO);
		expect(m.istota).toBe('ziadne');
		expect(m.typ).toBeNull();
		expect(m.kandidati).toHaveLength(0);
	});
	it('izolačné bez zhody zloženia → ziadne', () => {
		const m = matchOdooGlassType('Izolačné sklo 6/20/6 číre', ODOO);
		expect(m.istota).toBe('ziadne');
	});
	it('nikdy tichý výber pri viac (typ ostáva null)', () => {
		const m = matchOdooGlassType('Izolačné sklo 4/16/4 číre', ODOO);
		expect(m.typ).toBeNull();
	});
});

describe('naviazanieRiadku (podklad badge + kandidáti, #556)', () => {
	it('source=odoo + lokálny názov (nezhoduje sa so žiadnou value) + viac → nepriradene + kandidáti', () => {
		const n = naviazanieRiadku('Izolačné sklo 4/16/4 číre', ODOO, 'odoo');
		expect(n.nepriradene).toBe(true);
		expect(n.kandidati.map((k) => k.value).sort()).toEqual(['001', '003']);
	});
	it('source=odoo + typSkla JE Odoo value → nie nepriradene', () => {
		const n = naviazanieRiadku('001', ODOO, 'odoo');
		expect(n.nepriradene).toBe(false);
		expect(n.kandidati).toHaveLength(0);
	});
	it('source=local (Odoo nedostupné) → nikdy nepriradene (bez Odoo dát nič nenaväzujeme)', () => {
		const n = naviazanieRiadku('Izolačné sklo 4/16/4 číre', ODOO, 'local');
		expect(n.nepriradene).toBe(false);
	});
	it('prázdny typSkla → nie nepriradene', () => {
		expect(naviazanieRiadku('', ODOO, 'odoo').nepriradene).toBe(false);
	});
});

describe('cennikPopis (nárezák popis, #556)', () => {
	it('jednoznačné → cenníkový name', () => {
		expect(cennikPopis('Izolačné sklo 4/8/4 číre', ODOO, 'odoo')).toBe(
			'Izolačné sklo 4/8/4- číre (Ug=1,1)'
		);
	});
	it('viac → prvý kandidát + "(+N)"', () => {
		expect(cennikPopis('Izolačné sklo 4/16/4 číre', ODOO, 'odoo')).toBe(
			'Izolačné sklo 4/16/4 číre AL (+1)'
		);
	});
	it('ziadne → ""', () => {
		expect(cennikPopis('Float číre 6 mm', ODOO, 'odoo')).toBe('');
	});
	it('source=local → "" (fallback = bez popisu)', () => {
		expect(cennikPopis('Izolačné sklo 4/8/4 číre', ODOO, 'local')).toBe('');
	});
});
