// #594 (Odoo úloha 1219, att 39386): podklad ukázal lokálne „Float kalené 10 mm" ako „nepriradené —
// vyber typ" s 3 kandidátmi (ESG Float extračirý 10mm · ESG Float čirý 10mm · ESG Matelux čirý 10mm).
// Extračiré (low-iron) NIE je číre a Matelux (satinované) je matné = mliečne → lokálne číre sklo sa
// má spárovať JEDNOZNAČNE na „ESG Float čirý 10mm". Vektory = živý PROD katalóg 29.9.2026.
//
// Money-neutralita: výber VÝPOČTOVÉHO skla Odoo voľby (`sklo-odoo.ts`) nesmie nové odtiene poznať
// (`odtien: 'vypoctovy'`) — inak by sa napr. „ESG Matelux čirý 6mm" v Štandard + počítalo ako
// NEkalené Float 6 mm (iný Money odpis) namiesto doterajšieho „ESG kalené 6 mm".
import { describe, it, expect } from 'vitest';
import {
	matchOdooGlassType,
	glassTint,
	naviazanieRiadku,
	type OdooTypLike
} from '../src/lib/server/glass-match';

const t = (value: string, name: string, category: string, composition = ''): OdooTypLike => ({
	value,
	name,
	category,
	composition
});

// výsek živého PROD `montalu.glass.type` (29.9.2026)
const ODOO_10: OdooTypLike[] = [
	t('OP011E', 'ESG Float extračirý 10mm', 'esg'),
	t('OP005E', 'ESG Float čirý 10mm', 'esg'),
	t('OP029E', 'ESG Matelux čirý 10mm', 'esg'),
	t('OP016E', 'ESG Float bronz/šedý 10mm', 'esg')
];
const ODOO_6: OdooTypLike[] = [
	t('OP009', 'Float extračirý 6mm', 'rezane', '6 extračirý'),
	t('OP003', 'Float čirý 6mm', 'rezane', '6'),
	t('OP027', 'Matelux čirý 6mm', 'rezane', '6 matelux'),
	t('OP009E', 'ESG Float extračirý 6mm', 'esg'),
	t('OP003E', 'ESG Float čirý 6mm', 'esg'),
	t('OP027E', 'ESG Matelux čirý 6mm', 'esg')
];

describe('#594 glassTint — extračiré a Matelux', () => {
	it('„extračirý"/„extra čiré"/„extra clear" → vlastný odtieň extracire (nie číre)', () => {
		expect(glassTint('ESG Float extračirý 10mm')).toBe('extracire');
		expect(glassTint('Float extračiré 6 mm')).toBe('extracire');
		expect(glassTint('Float extra čiré 6 mm')).toBe('extracire');
		expect(glassTint('Float Extra Clear 6mm')).toBe('extracire');
		// review #594: slovenský tvar s „í" a spojovník
		expect(glassTint('Float extra číre 6 mm')).toBe('extracire');
		expect(glassTint('Float Extra-Clear 6mm')).toBe('extracire');
	});
	it('„Matelux" (satinované) → mliecne (matné), aj keď názov nesie „čirý"', () => {
		expect(glassTint('ESG Matelux čirý 10mm')).toBe('mliecne');
		expect(glassTint('Matelux čirý 6mm')).toBe('mliecne');
	});
	it('obyčajné „čirý" ostáva cire', () => {
		expect(glassTint('ESG Float čirý 10mm')).toBe('cire');
	});
});

describe('#594 matchOdooGlassType — číre ≠ extračiré, Matelux = matné', () => {
	it('„Float kalené 10 mm" → JEDNOZNAČNE „ESG Float čirý 10mm" (úloha 1219)', () => {
		const m = matchOdooGlassType('Float kalené 10 mm', ODOO_10);
		expect(m.istota).toBe('jednoznacne');
		expect(m.typ?.value).toBe('OP005E');
		expect(m.typ?.name).toBe('ESG Float čirý 10mm');
		// podklad: riadok „Float kalené 10 mm" už nemá 3 kandidátov, ale jediného
		expect(naviazanieRiadku('Float kalené 10 mm', ODOO_10, 'odoo').kandidati).toEqual([ODOO_10[1]]);
	});
	it('lokálne číre sa NIKDY nespáruje na extračiré (ani rezané, ani kalené)', () => {
		expect(matchOdooGlassType('Float sklo 6 mm', ODOO_6).typ?.value).toBe('OP003');
		expect(matchOdooGlassType('ESG kalené 6 mm', ODOO_6).typ?.value).toBe('OP003E');
	});
	it('lokálne extračiré sa páruje LEN na extračiré (nikdy na číre)', () => {
		expect(matchOdooGlassType('ESG kalené 6 mm extračiré', ODOO_6).typ?.value).toBe('OP009E');
	});
	it('lokálne mliečne sa páruje na Matelux (matné)', () => {
		expect(matchOdooGlassType('ESG kalené 6 mm mliečne', ODOO_6).typ?.value).toBe('OP027E');
	});
	it("odtien 'vypoctovy' = os odtieňa spred #594 (extračiré aj Matelux ako číre) — len pre výpočet", () => {
		const m = matchOdooGlassType('Float kalené 10 mm', ODOO_10, { odtien: 'vypoctovy' });
		expect(m.istota).toBe('viac');
		expect(m.kandidati.map((k) => k.value).sort()).toEqual(['OP005E', 'OP011E', 'OP029E']);
		// bronz ostáva odtieň aj pre výpočet (nič spred #594 sa nemení)
		expect(m.kandidati.some((k) => k.value === 'OP016E')).toBe(false);
	});
});
