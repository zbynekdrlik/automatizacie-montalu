// Sieťka na posuve (#86–#90) — Patrik 2026-07-31 (Odoo, kanál Vyroba automatizacia),
// KOREKCIA 2026-08-02 (msg #1614821/#1614823/#1614827, kanál 207): sieťka je ĎALŠIE
// krídlo TOHO ISTÉHO posuvu ("úplne rovnaký rozmer ako každé iné okno v tom posuve"),
// nie samostatný objekt s ručne zadaným rozmerom. Od tejto korekcie MENÍ Money odpis
// na Robust/Slide (jeden súvislý beh krídel, nie opona): +2 rámové rezy (S aj V),
// +1 nosový rez, a pri 2K aj kód koľajnice (3K namiesto 2K). Rovnaký vzor testovania
// ako tests/vstup-klin.test.ts, len s presnou deltou namiesto Money-neutrality.
import { describe, it, expect } from 'vitest';
import { parseVstup, parseMultiVstup, parseSietka, sanitizeSietka } from '../src/lib/server/vstup';
import {
	sietkaPopis,
	sietkaStrana,
	potrebuje3KKolajnicu,
	maSietkaSystem,
	uchytLabel,
	rozmerSietoviny,
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
const sietkaFd = { sietka: '1', sietkaUchyt: 'madloVelke' };

describe('parseSietka', () => {
	const raw = { on: '1', uchyt: 'madloVelke' };

	it('vypnutý zapínač → žiadna sieťka a žiadna chyba (sieťka je nepovinná)', () => {
		for (const on of ['', '0', undefined, false, null])
			expect(parseSietka({ ...raw, on })).toEqual({ sietka: null, error: null });
	});

	it('zapnutá → sieťka s úchytom', () => {
		expect(parseSietka(raw)).toEqual({ sietka: { uchyt: 'madloVelke' }, error: null });
	});

	it('nezmyselný/chýbajúci úchyt = „bez ničoho" (nikdy sa nezobrazí niečo nezvolené)', () => {
		expect(parseSietka({ ...raw, uchyt: 'neexistuje' }).sietka?.uchyt).toBe('ziadny');
		expect(parseSietka({ ...raw, uchyt: undefined }).sietka?.uchyt).toBe('ziadny');
	});
});

describe('sanitizeSietka — sieťka len na systémoch, ktoré ju ponúkajú', () => {
	const s = { uchyt: 'madloVelke' as const };
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
		expect(vstup.sietka).toEqual({ uchyt: 'madloVelke' });
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
		const { vstup, error } = multi([posuv({ sietka: '1', sietkaUchyt: 'zamok' }), posuv()]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].sietka).toEqual({ uchyt: 'zamok' });
		expect(vstup.posuvy[1].sietka).toBeNull();
	});

	it('sieťka na 2K posuve (2K nemá voľnú koľaj) sa aj tak uloží — appka upozorní A odpíše 3K', () => {
		const { vstup, error } = multi([posuv({ styl: '2K', ...sietkaFd })]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].sietka).toEqual({ uchyt: 'madloVelke' });
	});

	it('sieťka na Slide posuve prejde rovnako ako Robust', () => {
		const { vstup, error } = multi([posuv({ system: 'Slide', styl: '3K', ...sietkaFd })]);
		expect(error).toBeNull();
		expect(vstup.posuvy[0].sietka).not.toBeNull();
	});
});

describe('MONEY-KOREKCIA — sieťka pridáva presnú deltu (Robust/Slide, #86 korekcia 2026-08-02)', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

	const spec = (
		sysStyl: string,
		S: number,
		V: number,
		sietka: { uchyt: SietkaUchyt } | null
	) => [
		{
			sysStyl,
			S,
			V,
			redukciaZero: true,
			skloHrubka: 0,
			otvaranie: 'P - L',
			sklo: 'Izolačné sklo 4/16/4 číre',
			sietka
		}
	];

	it('Robust|3K S=4645/V=2320: rám 6+6→8+8 ks, nos 4→5 ks, koľajnica nedotknutá', () => {
		const bez = computeMulti(cfg, spec('Robust|3K', 4645, 2320, null))!;
		const so = computeMulti(cfg, spec('Robust|3K', 4645, 2320, { uchyt: 'madloVelke' }))!;

		const ramBez = bez.material.find((m) => m.kod === 'ZASP00002')!;
		const ramSo = so.material.find((m) => m.kod === 'ZASP00002')!;
		expect(ramBez.rezy).toEqual([
			{ rozmer: 2250, ks: 6 },
			{ rozmer: 1580, ks: 6 }
		]);
		expect(ramSo.rezy).toEqual([
			{ rozmer: 2250, ks: 8 },
			{ rozmer: 1580, ks: 8 }
		]);

		const nosBez = bez.material.find((m) => m.kod === 'ZASP00010')!;
		const nosSo = so.material.find((m) => m.kod === 'ZASP00010')!;
		expect(nosBez.rezy).toEqual([{ rozmer: 2250, ks: 4 }]);
		expect(nosSo.rezy).toEqual([{ rozmer: 2250, ks: 5 }]);

		// koľajnica 3K → 3K nedotknutá (nie je 2K, žiadny swap)
		expect(so.odpis.find((o) => o.kod === 'ZASP00016')?.metre).toBe(15);
		expect(bez.odpis.find((o) => o.kod === 'ZASP00016')?.metre).toBe(15);

		// presný odpis (overené výpočtom, cross-checknuté ručne pre rám: 30→37,5 m)
		expect(bez.odpis).toEqual([
			{ kod: 'ZASP00016', nazov: 'Koľajnica 3K Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00002', nazov: 'Rámový profil Surový 7500 mm', metre: 30 },
			{ kod: 'ZASP00010', nazov: 'Nosový profil Surový 7500 mm', metre: 15 }
		]);
		expect(so.odpis).toEqual([
			{ kod: 'ZASP00016', nazov: 'Koľajnica 3K Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00002', nazov: 'Rámový profil Surový 7500 mm', metre: 37.5 },
			{ kod: 'ZASP00010', nazov: 'Nosový profil Surový 7500 mm', metre: 15 }
		]);

		expect(so.posuvy[0].sietka).toEqual({ uchyt: 'madloVelke' });
		expect(bez.posuvy[0].sietka).toBeNull();
	});

	it('Slide|3K S=3500/V=2001: rovnaká delta ako Robust, Redukcia nedotknutá', () => {
		const bez = computeMulti(cfg, spec('Slide|3K', 3500, 2001, null))!;
		const so = computeMulti(cfg, spec('Slide|3K', 3500, 2001, { uchyt: 'ziadny' }))!;

		expect(bez.odpis).toEqual([
			{ kod: 'ZASP00100', nazov: 'Koľajnica 3K Slide Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00088', nazov: 'Rámový profil Slide Surový 7500 mm', metre: 22.5 },
			{ kod: 'ZASP202410', nazov: 'Nosový profil Slide Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00091', nazov: 'Redukcia 6mm Surový 7500 mm', metre: 0 }
		]);
		expect(so.odpis).toEqual([
			{ kod: 'ZASP00100', nazov: 'Koľajnica 3K Slide Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00088', nazov: 'Rámový profil Slide Surový 7500 mm', metre: 30 },
			{ kod: 'ZASP202410', nazov: 'Nosový profil Slide Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00091', nazov: 'Redukcia 6mm Surový 7500 mm', metre: 0 }
		]);
	});

	it('Robust|2K S=2509/V=1930 + sieťka: koľajnica sa mení na 3K (ZASP00014→ZASP00016)', () => {
		const bez = computeMulti(cfg, spec('Robust|2K', 2509, 1930, null))!;
		const so = computeMulti(cfg, spec('Robust|2K', 2509, 1930, { uchyt: 'ziadny' }))!;

		expect(bez.odpis).toEqual([
			{ kod: 'ZASP00014', nazov: 'Koľajnica 2K Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00002', nazov: 'Rámový profil Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00010', nazov: 'Nosový profil Surový 7500 mm', metre: 7.5 }
		]);
		expect(so.odpis).toEqual([
			{ kod: 'ZASP00016', nazov: 'Koľajnica 3K Surový 7500 mm', metre: 15 },
			{ kod: 'ZASP00002', nazov: 'Rámový profil Surový 7500 mm', metre: 22.5 },
			{ kod: 'ZASP00010', nazov: 'Nosový profil Surový 7500 mm', metre: 7.5 }
		]);
		// 2K kód (ZASP00014) sa v odpise so sieťkou vôbec nevyskytuje — nahradený, nie pridaný
		expect(so.odpis.some((o) => o.kod === 'ZASP00014')).toBe(false);
	});

	it('Slide|2K + sieťka: koľajnica sa mení na 3K Slide variant (ZASP00097→ZASP00100)', () => {
		const so = computeMulti(cfg, spec('Slide|2K', 2551, 1601, { uchyt: 'ziadny' }))!;
		expect(so.odpis.some((o) => o.kod === 'ZASP00100')).toBe(true);
		expect(so.odpis.some((o) => o.kod === 'ZASP00097')).toBe(false);
	});

	it('bez sieťky je odpis aj materiál bit-identický s dneškom (regresný dôkaz)', () => {
		const vektory: [string, number, number][] = [
			['Robust|3K', 4645, 2320],
			['Slide|3K', 3500, 2001],
			['Robust|2K', 2509, 1930]
		];
		for (const [sysStyl, S, V] of vektory) {
			const a = computeMulti(cfg, spec(sysStyl, S, V, null))!;
			const b = computeMulti(cfg, spec(sysStyl, S, V, null))!;
			expect(a.odpis).toEqual(b.odpis);
			expect(a.material).toEqual(b.material);
		}
	});

	it('opona (2x*) štýly ostávajú Money-neutrálne — sietkaStrana nevie určiť stranu', () => {
		const bez = computeMulti(cfg, spec('Robust|2x3K', 5000, 2200, null))!;
		const so = computeMulti(cfg, spec('Robust|2x3K', 5000, 2200, { uchyt: 'madloVelke' }))!;
		expect(so.odpis).toEqual(bez.odpis);
		expect(so.material).toEqual(bez.material);
		expect(sietkaStrana('Opona')).toBeNull();
	});

	it('iné systémy (Deluxe/Štandard) ostávajú Money-neutrálne — sietka sa tam ani neponúka', () => {
		const bez = computeMulti(cfg, [
			{
				sysStyl: 'Deluxe|2K',
				S: 5000,
				V: 2000,
				redukciaZero: false,
				skloHrubka: 10,
				sietka: null
			}
		])!;
		const so = computeMulti(cfg, [
			{
				sysStyl: 'Deluxe|2K',
				S: 5000,
				V: 2000,
				redukciaZero: false,
				skloHrubka: 10,
				sietka: { uchyt: 'madloVelke' } as never
			}
		])!;
		expect(so.odpis).toEqual(bez.odpis);
	});
});

describe('rozmerSietoviny — Patrik 2026-08-02, potvrdené foto z nárezáka', () => {
	it('sklo +2mm šírka, +1mm výška (msg #1614828: sklo 1063×1795 → sieťka 1065×1796)', () => {
		expect(rozmerSietoviny(1063, 1795)).toEqual({ sirka: 1065, vyska: 1796 });
	});
});

describe('sietkaPopis — jeden riadok do plánu a histórie', () => {
	it('vypíše rozmer sieťoviny (odvodený zo skla) a úchyt', () => {
		expect(sietkaPopis({ uchyt: 'madloVelke' }, { sirka: 1447, vyska: 2116 })).toBe(
			'sieťka — 1447 × 2116 mm, úchyt: vystúpené madlo veľké'
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
