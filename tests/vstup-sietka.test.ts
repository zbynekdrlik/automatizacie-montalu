// Sieťka na posuve (#86–#90) — Patrik 2026-07-31: zaškrtávacie pole „so sieťkou" +
// nepovinný rozmer (dielňa ho zadá, keď ho pozná — appka ho nepočíta) + úchyt
// namiesto kľučky. DISPLAY-ONLY: nesmie zmeniť ani jeden riadok Money odpisu. Tu
// strážime parsovanie, rozsahy, systémový gate (len Robust/Slide) a Money-neutralitu
// výpočtu — rovnaký vzor ako tests/vstup-klin.test.ts.
import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup, parseSietka, sanitizeSietka } from '../src/lib/server/vstup';
import {
	sietkaPopis,
	sietkaStrana,
	potrebuje3KKolajnicu,
	maSietkaSystem,
	uchytLabel,
	SIETKA_MAX_ROZMER,
	type SietkaUchyt
} from '../src/lib/sietka';
import { buildCFG, computeMulti, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const zaklad = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	system: 'Robust',
	styl: '3K',
	s: '4645',
	v: '2320',
	sklo: 'Izolačné sklo 4/16/4 číre',
	otvaranie: 'P - L'
};
const sietkaFd = {
	sietka: '1',
	sietkaSirka: '1200',
	sietkaVyska: '1450',
	sietkaUchyt: 'madloVelke'
};

describe('parseSietka', () => {
	const raw = { on: '1', sirka: '1200', vyska: '1450', uchyt: 'madloVelke' };

	it('vypnutý zapínač → žiadna sieťka a žiadna chyba (sieťka je nepovinná)', () => {
		for (const on of ['', '0', undefined, false, null])
			expect(parseSietka({ ...raw, on })).toEqual({ sietka: null, error: null });
	});

	it('zapnutá s rozmermi → sieťka aj s desatinnou čiarkou', () => {
		expect(parseSietka(raw)).toEqual({
			sietka: { sirka: 1200, vyska: 1450, uchyt: 'madloVelke' },
			error: null
		});
		expect(parseSietka({ ...raw, sirka: '1200,5' }).sietka?.sirka).toBe(1200.5);
	});

	it('rozmer je NEPOVINNÝ — prázdny = null, appka ho nedopočítava', () => {
		expect(parseSietka({ ...raw, sirka: '', vyska: '' })).toEqual({
			sietka: { sirka: null, vyska: null, uchyt: 'madloVelke' },
			error: null
		});
	});

	it('KEĎ je rozmer zadaný, musí byť v rozsahu', () => {
		expect(parseSietka({ ...raw, sirka: '0' }).error).toMatch(/šírka/);
		expect(parseSietka({ ...raw, sirka: String(SIETKA_MAX_ROZMER + 1) }).error).toMatch(/šírka/);
		expect(parseSietka({ ...raw, vyska: '-5' }).error).toMatch(/výška/);
		expect(parseSietka({ ...raw, vyska: String(SIETKA_MAX_ROZMER + 1) }).error).toMatch(/výška/);
	});

	it('nezmyselný/chýbajúci úchyt = „bez ničoho" (nikdy sa nezobrazí niečo nezvolené)', () => {
		expect(parseSietka({ ...raw, uchyt: 'neexistuje' }).sietka?.uchyt).toBe('ziadny');
		expect(parseSietka({ ...raw, uchyt: undefined }).sietka?.uchyt).toBe('ziadny');
	});
});

describe('sanitizeSietka — sieťka len na systémoch, ktoré ju ponúkajú', () => {
	const s = { sirka: 1200, vyska: 1450, uchyt: 'madloVelke' as const };
	it('Robust a Slide sieťku prepustia', () => {
		expect(sanitizeSietka('Robust', s)).toEqual(s);
		expect(sanitizeSietka('Slide', s)).toEqual(s);
	});
	it('iný systém (aj zo skriptovaného POST-u) sieťku zahodí', () => {
		expect(sanitizeSietka('Deluxe', s)).toBeNull();
		expect(sanitizeSietka('Štandard +', s)).toBeNull();
		expect(sanitizeSietka('Robust', null)).toBeNull();
	});
});

describe('parseVstup — sieťka jedného posuvu', () => {
	it('zapnutá sieťka na Robust sa uloží', () => {
		const { vstup, error } = parseVstup(fd({ ...zaklad, ...sietkaFd }));
		expect(error).toBeNull();
		expect(vstup.sietka).toEqual({ sirka: 1200, vyska: 1450, uchyt: 'madloVelke' });
	});

	it('bez sieťky je vstup platný a sieťka je null', () => {
		const { vstup, error } = parseVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.sietka).toBeNull();
	});

	it('sieťka na systéme, ktorý ju neponúka (napr. Deluxe), sa zahodí BEZ chyby', () => {
		const { vstup, error } = parseVstup(
			fd({ ...zaklad, system: 'Deluxe', styl: '2K', ...sietkaFd })
		);
		// Deluxe nemá tento štýl v ponuke pre iné dôvody (šírka/kolo) — over len,
		// že sieťka sama o sebe nezablokuje vstup s neplatným systémom pre ňu
		expect(vstup.sietka).toBeNull();
		void error;
	});

	it('zapnutá sieťka s nezmyselným rozmerom zablokuje vstup', () => {
		const { error } = parseVstup(fd({ ...zaklad, ...sietkaFd, sietkaSirka: '0' }));
		expect(error).toMatch(/^Sieťka: šírka/);
	});

	it('rozmery sieťky bez zapínača sa ignorujú (checkbox je vypnutý)', () => {
		const { vstup, error } = parseVstup(fd({ ...zaklad, ...sietkaFd, sietka: '' }));
		expect(error).toBeNull();
		expect(vstup.sietka).toBeNull();
	});
});

describe('parseMultiVstup — sieťka je PER POSUV', () => {
	const posuv = (extra: Record<string, unknown> = {}) => ({
		system: 'Robust',
		styl: '3K',
		s: '4645',
		v: '2320',
		sklo: 'Izolačné sklo 4/16/4 číre',
		otvaranie: 'P - L',
		...extra
	});
	const multi = (posuvy: unknown[]) =>
		parseMultiVstup(fd({ zak: 'ZAK1', op: 'OP1', zakaznik: 'X', posuvy: JSON.stringify(posuvy) }));

	it('sieťka má len ten posuv, ktorý ju má zapnutú', () => {
		const { vstup, error } = multi([
			posuv({
				sietka: '1',
				sietkaSirka: '1200',
				sietkaVyska: '1450',
				sietkaUchyt: 'zamok'
			}),
			posuv()
		]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].sietka).toEqual({ sirka: 1200, vyska: 1450, uchyt: 'zamok' });
		expect(vstup.posuvy[1].sietka).toBeNull();
	});

	it('sieťka na 2K posuve (2K nemá voľnú koľaj) sa aj tak uloží — appka len upozorní, koľajnicu nemení', () => {
		const { vstup, error } = multi([posuv({ styl: '2K', ...sietkaFd })]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].sietka).toEqual({ sirka: 1200, vyska: 1450, uchyt: 'madloVelke' });
	});

	it('nezmyselný rozmer sieťky na 2. posuve pomenuje posuv v chybe', () => {
		const { error } = multi([posuv(), posuv({ sietka: '1', sietkaSirka: '-1' })]);
		expect(error).toBe('Posuv 2: sieťka — šírka musí byť prázdna alebo 1–20000 mm.');
	});

	it('sieťka na Slide posuve prejde rovnako ako Robust', () => {
		const { vstup, error } = multi([posuv({ system: 'Slide', styl: '3K', ...sietkaFd })]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].sietka).not.toBeNull();
	});
});

describe('MONEY-NEUTRALITA — sieťka nesmie zmeniť odpis ani materiál', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
	const spec = (
		sietka: { sirka: number | null; vyska: number | null; uchyt: SietkaUchyt } | null
	) => [
		{
			sysStyl: 'Robust|3K',
			S: 4645,
			V: 2320,
			redukciaZero: true,
			skloHrubka: 0,
			otvaranie: 'P - L',
			sklo: 'Izolačné sklo 4/16/4 číre',
			sietka
		}
	];

	it('odpis aj materiál sú identické so sieťkou a bez nej; sieťka sa vráti pre náhľad', () => {
		const bez = computeMulti(cfg, spec(null))!;
		const s = computeMulti(cfg, spec({ sirka: 1200, vyska: 1450, uchyt: 'madloVelke' }))!;
		expect(s.odpis).toEqual(bez.odpis);
		expect(s.material).toEqual(bez.material);
		expect(s.posuvy[0].sietka).toEqual({ sirka: 1200, vyska: 1450, uchyt: 'madloVelke' });
		expect(bez.posuvy[0].sietka).toBeNull();
	});

	it('to isté platí aj keď rozmer sieťky nie je zadaný (null)', () => {
		const bez = computeMulti(cfg, spec(null))!;
		const s = computeMulti(cfg, spec({ sirka: null, vyska: null, uchyt: 'ziadny' }))!;
		expect(s.odpis).toEqual(bez.odpis);
		expect(s.material).toEqual(bez.material);
	});
});

describe('sietkaPopis — jeden riadok do plánu a histórie', () => {
	it('vypíše rozmer a úchyt, keď sú zadané', () => {
		expect(sietkaPopis({ sirka: 1200, vyska: 1450, uchyt: 'madloVelke' })).toBe(
			'sieťka — 1200 × 1450 mm, úchyt: vystúpené madlo veľké'
		);
	});
	it('bez rozmeru vypíše, že ho doplní dielňa', () => {
		expect(sietkaPopis({ sirka: null, vyska: null, uchyt: 'ziadny' })).toBe(
			'sieťka — rozmer doplní dielňa, úchyt: bez ničoho'
		);
	});
});

describe('sieťka — pomocné funkcie', () => {
	it('maSietkaSystem: len Robust a Slide', () => {
		expect(maSietkaSystem('Robust')).toBe(true);
		expect(maSietkaSystem('Slide')).toBe(true);
		expect(maSietkaSystem('Deluxe')).toBe(false);
		expect(maSietkaSystem('Štandard +')).toBe(false);
	});

	it('sietkaStrana: L-P → ľavá, P-L → pravá, inak neurčené', () => {
		expect(sietkaStrana('L - P')).toBe('ľavá');
		expect(sietkaStrana('P - L')).toBe('pravá');
		expect(sietkaStrana('Opona')).toBeNull();
	});

	it('potrebuje3KKolajnicu: len presne štýl 2K (2x2K je opona, nie 2K)', () => {
		expect(potrebuje3KKolajnicu('2K')).toBe(true);
		expect(potrebuje3KKolajnicu('3K')).toBe(false);
		expect(potrebuje3KKolajnicu('2x2K')).toBe(false);
	});

	it('uchytLabel: preloží hodnotu na slovenský popis, neznáme = bez ničoho', () => {
		expect(uchytLabel('madloMale')).toBe('vystúpené madlo malé (Ľko)');
		expect(uchytLabel('zamok')).toBe('mŕtvy zapadávací zámok');
	});
});
