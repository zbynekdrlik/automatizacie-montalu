// 1:1 vektory z n8n verzie: vzorová zákazka A + Štepanovský (reálne páry overené
// proti Money exportom), single-variant >7500 fix, combo prepočet a copy-back.
import { describe, it, expect } from 'vitest';
import {
	transform,
	parseInput,
	parseCad,
	applyCombos,
	buildCopyBack,
	parseChoice,
	minCoverCombo,
	coverCombos,
	fmtBars,
	validatePergola
} from '../src/lib/server/pergola';

const BARTONICEK = [
	'18004 PRIECKOVY PROFIL 105\t9\t3871',
	'18005 ZAKLAPAVACIA LISTA CELNA\t16\t685',
	'18006 PRITLACNA LISTA\t9\t3894',
	'18007 MASKOVACIA LISTA\t7\t3894',
	'18008 MASKOVACIA LISTA KRAJOVA\t2\t3894',
	'18013 PROFIL 110x110 V2\t3\t2165',
	'18016 PROFIL 110x43 V2\t2\t3812',
	'18016 PROFIL 110x43 V2\t2\t2510',
	'18019 KOTVIACI PROFIL HORNY V2\t1\t5930',
	'18021 ZLABOVY PROFIL 110 V2\t1\t5930'
].join('\n');

const STEPANOVSKY = [
	'18005 ZAKLAPAVACIA LISTA CELNA\t10\t722',
	'18005 ZAKLAPAVACIA LISTA CELNA\t14\t694',
	'18006 PRITLACNA LISTA\t13\t2651',
	'18007 MASKOVACIA LISTA\t11\t2651',
	'18008 MASKOVACIA LISTA KRAJOVA\t2\t2651',
	'18013 PROFIL 110x110 V2\t4\t2215',
	'18016 PROFIL 110x43 V2\t3\t2547',
	'18016 PROFIL 110x43 V2\t3\t2627',
	'18021 ZLABOVY PROFIL 110 V2\t1\t9120',
	'18102 PRIECKOVY PROFIL 105\t13\t2625',
	'18104 KOTVIACI PROFIL HORNY\t1\t9120'
].join('\n');

const got = (text: string) => {
	const r = transform(text);
	const g: Record<string, number> = {};
	r.out.forEach((o) => {
		if (o.qty) g[o.prp] = o.qty;
	});
	return { r, g };
};

describe('transform — 1:1 s overenými Money pármi', () => {
	it('vzorová zákazka A (bin-pack, tab formát)', () => {
		const { r, g } = got(BARTONICEK);
		expect(r.unresolved).toEqual([]);
		expect(g).toEqual({
			PRP00044: 67.5,
			PRP00047: 67.5,
			PRP00040: 52.5,
			PRP202410: 15,
			PRP00042: 15,
			PRP20246: 15,
			PRP20242: 7.5,
			PRP202525: 6,
			PRP20259: 6
		});
	});

	it('Štepanovský (kombinácia 9120 > 7500 + light mapovanie)', () => {
		const { r, g } = got(STEPANOVSKY);
		expect(r.unresolved).toEqual([]);
		expect(g).toEqual({
			PRP202526: 4.5,
			PRP202525: 6,
			PRP202510: 4.5,
			PRP20259: 6,
			PRP00046: 52.5,
			PRP20242: 15,
			PRP202410: 22.5,
			PRP00047: 52.5,
			PRP00040: 45,
			PRP00042: 7.5,
			PRP20246: 22.5
		});
		// žľab 9120 aj kotviaci 9120 → 2 combo prípady na výber
		expect(r.comboCases.length).toBe(2);
		expect(r.comboCases[0].minimal).toEqual([4500, 6000]);
	});

	it('single-variant rez > 7500 sa počíta ceil(p/bar), nie 1 tyč (fix 2026-06-30)', () => {
		const { g } = got('18016 PROFIL 110x43 V2\t1\t10000');
		expect(g['PRP202410']).toBe(15); // 2 tyče × 7.5
	});

	it('parser zvláda tab aj medzerový formát a čiarku v reze', () => {
		expect(parseInput('18016 PROFIL 110x43 V2\t2\t2510').length).toBe(1);
		expect(parseInput('18016 PROFIL 110x43 V2 2 2510,5')[0].cut_mm).toBe(2510.5);
		expect(parseInput('nezmysel bez cisla')).toEqual([]);
	});

	it('neznámy CAD kód → unresolved + validácia ho hlási', () => {
		const r = transform('99999 NEZNAMY PROFIL\t1\t2000');
		expect(r.unresolved.length).toBe(1);
		expect(validatePergola('Z', 'O', 'Zak', '99999 NEZNAMY PROFIL\t1\t2000', r)).toContain(
			'Nenamapované'
		);
	});

	it('validácia: prázdny vstup / chýbajúce polia (vrátane zákazníka)', () => {
		const r = transform('');
		expect(validatePergola('', 'O', 'Zak', '', r)).toContain('ZAK');
		expect(validatePergola('Z', 'O', '', '', r)).toContain('ákazník');
		expect(validatePergola('Z', 'O', 'Zak', '', r)).toContain('prázdny');
		const ok = transform(BARTONICEK);
		expect(validatePergola('Z', '', 'Zak', BARTONICEK, ok)).toContain('OP');
		expect(validatePergola('Z', 'O', 'Zak', BARTONICEK, ok)).toBeNull();
	});

	it('nerozpoznaný riadok NIE JE ticho zahodený — validácia ho vymenuje', () => {
		const text = BARTONICEK + '\n18006 PRITLACNA LISTA\tO\t3894';
		const { skipped } = parseCad(text);
		expect(skipped.length).toBe(1);
		const r = transform(text);
		const err = validatePergola('Z', 'O', 'Zak', text, r);
		expect(err).toContain('Nerozpoznané');
		expect(err).toContain('18006');
	});

	it('duplicitné combo prípady: kľúčovanie indexom, labely rozlíšené (kus 1/2)', () => {
		const text = '18021 ZLABOVY PROFIL 110 V2\t2\t9120';
		const r = transform(text);
		expect(r.comboCases.length).toBe(2);
		expect(r.comboCases[0].fieldLabel).toContain('(kus 1)');
		expect(r.comboCases[1].fieldLabel).toContain('(kus 2)');
		// rôzne voľby pre každý kus sa aplikujú NEZÁVISLE
		const q = applyCombos(
			r,
			new Map([
				[0, [7500, 4500]],
				[1, [4500, 6000]]
			])
		);
		expect(q['PRP202524']).toBe(7.5); // jeden kus na 7500
		expect(q['PRP202525']).toBe(6); // druhý kus drží 6000
		expect(q['PRP202526']).toBe(9); // 2× 4500
		const cb = buildCopyBack(
			text,
			r,
			new Map([
				[0, [7500, 4500]],
				[1, [4500, 6000]]
			])
		);
		expect(cb.lines[0].barsStr).toBe('2(4,5m) 1(6m) 1(7,5m)');
	});
});

describe('kombinácie tyčí (žľab/kotviaci > 7500)', () => {
	const avail = [4500, 6000, 7500];

	it('minCoverCombo: najmenšia dĺžka, potom počet', () => {
		expect(minCoverCombo(9120, avail)).toEqual([4500, 6000]); // 10500 najmenej
		expect(minCoverCombo(16000, avail)).toEqual([4500, 6000, 6000]);
	});

	it('coverCombos ponúka alternatívy zoradené podľa odpadu', () => {
		const opts = coverCombos(9120, avail);
		expect(opts[0].bars).toEqual([6000, 4500]);
		expect(opts.map((o) => o.bars.join('+'))).toContain('7500+4500');
		expect(opts.map((o) => o.bars.join('+'))).toContain('6000+6000');
	});

	it('applyCombos: zmena voľby presunie metre medzi PRP kódmi', () => {
		const { r } = got(STEPANOVSKY);
		const zlabIdx = r.comboCases.findIndex((c) => c.code === '18021');
		// default (minimal 4500+6000): PRP202526=4.5, PRP202525=6
		const qDefault = applyCombos(r, new Map());
		expect(qDefault['PRP202526']).toBe(4.5);
		// voľba 7500+4500 → 7500-ka pribudne, 6000-ka zmizne
		const q = applyCombos(r, new Map([[zlabIdx, [7500, 4500]]]));
		expect(q['PRP202524']).toBe(7.5);
		expect(q['PRP202525'] || 0).toBe(0);
		expect(q['PRP202526']).toBe(4.5);
	});

	it('parseChoice číta radio hodnotu, inak minimal', () => {
		expect(parseChoice('7500+4500 mm (12 m)', [4500, 6000])).toEqual([7500, 4500]);
		expect(parseChoice(undefined, [4500, 6000])).toEqual([4500, 6000]);
		expect(parseChoice('blbost', [4500, 6000])).toEqual([4500, 6000]);
	});
});

describe('copy-back pre Solid Edge', () => {
	it('jeden riadok na kód v poradí vstupu, formát count(dĺžka m)', () => {
		const r = transform(BARTONICEK);
		const { lines, totalBars } = buildCopyBack(BARTONICEK, r, new Map());
		expect(lines[0].code).toBe('18004');
		expect(lines[0].barsStr).toBe('9(7,5m)');
		// 18016: 2×3812 + 2×2510 FFD → 2 tyče 7500
		expect(lines.find((l) => l.code === '18016')!.barsStr).toBe('2(7,5m)');
		expect(totalBars).toBeGreaterThan(0);
	});

	it('combo voľba sa premietne do copy-backu', () => {
		const r = transform(STEPANOVSKY);
		const zlabIdx = r.comboCases.findIndex((c) => c.code === '18021');
		const def = buildCopyBack(STEPANOVSKY, r, new Map());
		expect(def.lines.find((l) => l.code === '18021')!.barsStr).toBe('1(4,5m) 1(6m)');
		const alt = buildCopyBack(STEPANOVSKY, r, new Map([[zlabIdx, [7500, 4500]]]));
		expect(alt.lines.find((l) => l.code === '18021')!.barsStr).toBe('1(4,5m) 1(7,5m)');
	});

	it('fmtBars formát', () => {
		expect(fmtBars({ 4500: 1, 6000: 2, 7500: 0 })).toBe('1(4,5m) 2(6m)');
	});

	// „📋 Kopírovať počet tyčí" kopíruje POSLEDNÝ STĹPEC — jeden riadok na kód v
	// poradí zobrazenej karty. Kontrakt je poradie + počet riadkov: keby sa
	// rozišli, vložený stĺpec by v Solid Edge sadol na iné profily.
	it('cadLastCol = barsStr riadky spojené \\n, presne v poradí copyLines', () => {
		const r = transform(BARTONICEK);
		const { lines } = buildCopyBack(BARTONICEK, r, new Map());
		const cadLastCol = lines.map((l) => l.barsStr).join('\n');
		expect(cadLastCol.split('\n').length).toBe(lines.length);
		expect(cadLastCol).toBe(
			[
				'9(7,5m)', // 18004
				'2(7,5m)', // 18005
				'9(7,5m)', // 18006
				'7(7,5m)', // 18007
				'2(7,5m)', // 18008
				'1(7,5m)', // 18013
				'2(7,5m)', // 18016
				'1(6m)', // 18019
				'1(6m)' // 18021
			].join('\n')
		);
		// prvý a posledný riadok stĺpca patria prvému a poslednému kódu karty
		expect(cadLastCol.split('\n')[0]).toBe(lines[0].barsStr);
		expect(cadLastCol.split('\n').at(-1)).toBe(lines.at(-1)!.barsStr);
	});
});
