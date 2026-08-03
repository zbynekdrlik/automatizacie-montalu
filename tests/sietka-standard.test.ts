// Sieťka na Štandarde / Štandard + (#110) — Patrik, Odoo kanál 207, 2026-08-03
// (msg #1616278, #1616281, #1616282, #1616283, #1616285) + dva jeho vlastné
// nárezáky (fotky, att-9808/att-9809). Vektory nižšie sú overené PRIAMO proti tým
// nárezákom — pozri #110 komentár (design) pre presné číslovanie riadkov.
//
// Ground truth (ten istý posuv 3000×1850, ŠTANDARD PLUS V2 3K):
//   BEZ sieťky:  koľajnice 1+1, šírka prírezov (ZASP202415) 942,5×6, krajová
//                (ZASP20244) 1817×2, nos (ZASP00024) 1817×4, dorazová
//                (ZASP202419) 1841×2.
//   SO sieťkou:  presne tá istá tabuľka + delta: šírka 942,5×(6→8), krajová
//                1817×(2→3), nos 1817×(4→5), dorazová 1841×(2→3). Koľajnice
//                nedotknuté.
import { describe, it, expect } from 'vitest';
import { parseSietka, sanitizeSietka } from '../src/lib/server/vstup';
import { maSietkaSystemVyber, SIETKA_SYSTEM_ALT, rozmerSietovinyPre } from '../src/lib/sietka';
import {
	buildCFG,
	computeFlat,
	computeMulti,
	safeCompute,
	sietkaStandardExtra,
	type SysRow,
	type RezRow
} from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

describe('#110 — Štandard + sieťka toho istého systému (ground truth nárezák)', () => {
	it('BEZ sieťky — presná tabuľka z jeho nárezáka (msg #1616285)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, null)!;
		const rezy = (kod: string) => r.material.find((m) => m.kod === kod)?.rezy;
		expect(rezy('ZASP00027')).toEqual([{ rozmer: 3000, ks: 1 }]); // koľajnica vrch
		expect(rezy('ZASP00030')).toEqual([{ rozmer: 3000, ks: 1 }]); // koľajnica spodok
		expect(rezy('ZASP202415')).toEqual([{ rozmer: 943, ks: 6 }]); // šírka prírezov (942,5 zaokr.)
		expect(rezy('ZASP20244')).toEqual([{ rozmer: 1817, ks: 2 }]); // krajová
		expect(rezy('ZASP00024')).toEqual([{ rozmer: 1817, ks: 4 }]); // nos
		expect(rezy('ZASP202419')).toEqual([{ rozmer: 1841, ks: 2 }]); // dorazová
	});

	it('SO sieťkou (rovnaký systém) — presná delta: +2 šírka, +1 krajová, +1 nos, +1 dorazová, koľajnice nedotknuté (msg #1616284)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const rezy = (kod: string) => r.material.find((m) => m.kod === kod)?.rezy;
		expect(rezy('ZASP00027')).toEqual([{ rozmer: 3000, ks: 1 }]); // nedotknutá
		expect(rezy('ZASP00030')).toEqual([{ rozmer: 3000, ks: 1 }]); // nedotknutá
		expect(rezy('ZASP202415')).toEqual([{ rozmer: 943, ks: 8 }]); // 6→8, zlúčené do 1 riadku
		expect(rezy('ZASP20244')).toEqual([{ rozmer: 1817, ks: 3 }]); // 2→3
		expect(rezy('ZASP00024')).toEqual([{ rozmer: 1817, ks: 5 }]); // 4→5
		expect(rezy('ZASP202419')).toEqual([{ rozmer: 1841, ks: 3 }]); // 2→3
		// žiadne cudzie kódy (starého systému) sa v odpise NEOBJAVIA — sieťka je
		// rovnakého systému ako posuv
		expect(r.odpis.some((o) => o.kod === 'ZASP00018' || o.kod === 'ZASP00021')).toBe(false);
	});

	it('sabotáž: keby delta chýbala, tento test by ju odhalil (kontrolný dôkaz)', () => {
		// simuluje regresiu — porovná SO proti BEZ priamo, nie proti hardcoded číslu,
		// aby bolo jasné, že asercia vyššie skutočne závisí od implementácie
		const bez = computeFlat(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, null)!;
		const so = computeFlat(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		expect(so.odpis).not.toEqual(bez.odpis);
		const ks = (r: typeof bez, kod: string) => r.material.find((m) => m.kod === kod)?.rezy[0]?.ks;
		expect(ks(so, 'ZASP202415')! - ks(bez, 'ZASP202415')!).toBe(2);
		expect(ks(so, 'ZASP20244')! - ks(bez, 'ZASP20244')!).toBe(1);
		expect(ks(so, 'ZASP00024')! - ks(bez, 'ZASP00024')!).toBe(1);
		expect(ks(so, 'ZASP202419')! - ks(bez, 'ZASP202419')!).toBe(1);
	});

	it('rovnaká delta platí aj pre starý Štandard (rovnaký systém, vlastné kódy)', () => {
		const bez = computeFlat(cfg, 'Štandard|3K', 3000, 1850, false, 0, false, undefined, null)!;
		const so = computeFlat(cfg, 'Štandard|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const rezy = (r: typeof bez, kod: string) => r.material.find((m) => m.kod === kod)?.rezy;
		expect(rezy(bez, 'ZASP00018')).toEqual([{ rozmer: 1817, ks: 2 }]); // starý krajová
		expect(rezy(so, 'ZASP00018')).toEqual([{ rozmer: 1817, ks: 3 }]);
		expect(rezy(bez, 'ZASP00021')).toEqual([{ rozmer: 1841, ks: 2 }]); // starý dorazová
		expect(rezy(so, 'ZASP00021')).toEqual([{ rozmer: 1841, ks: 3 }]);
	});

	it('computeFlat vs computeMulti (rovnaký posuv) dávajú bit-identický odpis so sieťkou', () => {
		const flat = computeFlat(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const multi = computeMulti(cfg, [
			{
				sysStyl: 'Štandard +|3K',
				S: 3000,
				V: 1850,
				redukciaZero: false,
				sietka: { uchyt: 'ziadny' }
			}
		])!;
		expect(multi.odpis).toEqual(flat.odpis);
	});
});

describe('#110 — sieťka INÉHO systému (Štandard ↔ Štandard +), Patrikov výber', () => {
	it('starý sieťka na PLUS posuve: +1 nos (zdieľaný) + 1 starý doraz + 1 starý koncový + 2×šírka +16,5mm (msg #1616285)', () => {
		const so = computeFlat(cfg, 'Štandard +|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny',
			system: 'Štandard'
		})!;
		const rezy = (kod: string) => so.material.find((m) => m.kod === kod)?.rezy;
		// posuvove PLUS riadky ostávajú na BEZ-úrovni (delta ide cez CUDZIE kódy)
		expect(rezy('ZASP20244')).toEqual([{ rozmer: 1817, ks: 2 }]);
		expect(rezy('ZASP202419')).toEqual([{ rozmer: 1841, ks: 2 }]);
		// nos je zdieľaný kód → +1 na TEJ ISTEJ položke
		expect(rezy('ZASP00024')).toEqual([{ rozmer: 1817, ks: 5 }]);
		// nové riadky s KÓDMI starého systému
		expect(rezy('ZASP00018')).toEqual([{ rozmer: 1817, ks: 1 }]); // starý koncový
		expect(rezy('ZASP00021')).toEqual([{ rozmer: 1841, ks: 1 }]); // starý doraz
		// šírka prírezov: základných 6 ks nedotknutých (942,5≈943) + 2 ks navyše s
		// Patrikovou PEVNOU konštantou +16,5 mm → 942,5+16,5 = 959 (jeho doslovné číslo)
		expect(rezy('ZASP202415')).toEqual([
			{ rozmer: 943, ks: 6 },
			{ rozmer: 959, ks: 2 }
		]);
	});

	it('opačný smer (plus sieťka na starom posuve) je SYMETRICKÝ (−16,5mm) — NEPOTVRDENÉ Patrikom, viď #110 „Otvorené"', () => {
		const so = computeFlat(cfg, 'Štandard|3K', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny',
			system: 'Štandard +'
		})!;
		const rezy = (kod: string) => so.material.find((m) => m.kod === kod)?.rezy;
		// starého posuvu vlastná šírka (952 = round((3000-143)/3)) + 2 ks −16,5mm
		expect(rezy('ZASP202415')).toEqual([
			{ rozmer: 952, ks: 6 },
			{ rozmer: 936, ks: 2 }
		]);
		expect(rezy('ZASP20244')).toEqual([{ rozmer: 1817, ks: 1 }]); // plus koncový, nový riadok
		expect(rezy('ZASP202419')).toEqual([{ rozmer: 1841, ks: 1 }]); // plus doraz, nový riadok
	});

	it('5K/6K posuv + starý sieťka nie je dostupné (starý Štandard existuje len do 4K) — presná chyba, nie tichý pád', () => {
		const { r, err } = safeCompute(cfg, 'Štandard +|5K', 5000, 2000, false, 0, false, undefined, {
			uchyt: 'ziadny',
			system: 'Štandard'
		});
		expect(r).toBeNull();
		expect(err).toMatch(/Štandard.*5K.*k dispozícii/);
	});

	it('sietkaStandardExtra: nerelevantný systém (Robust) vráti prázdnu deltu bez chyby', () => {
		expect(sietkaStandardExtra(cfg, 'Robust', '3K', { uchyt: 'ziadny' }, 4645, 2320, 3)).toEqual({
			rezy: [],
			err: null
		});
	});
});

describe('#110 — IZO sklo: sieťka ide BEZ rozširujúceho profilu (msg #1616281)', () => {
	it('Rozširujúci profil (ZASP202439) je BEZ sieťky a SO sieťkou bit-identický', () => {
		const bez = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 1850, false, 0, false, undefined, null)!;
		const so = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 1850, false, 0, false, undefined, {
			uchyt: 'ziadny'
		})!;
		const rezy = (r: typeof bez) => r.material.find((m) => m.kod === 'ZASP202439')?.rezy;
		expect(rezy(so)).toEqual(rezy(bez));
		expect(rezy(bez)).toEqual([
			{ rozmer: 939, ks: 6 },
			{ rozmer: 1689, ks: 6 }
		]);
	});
});

describe('#110 — sklo tabuľky: riadok „sieťka" (+3mm šírka, +3mm výška) LEN pre Štandard-rodinu', () => {
	it('rozmerSietovinyPre: Štandard-rodina používa +3/+3, Robust/Slide +2/+1', () => {
		expect(rozmerSietovinyPre('Štandard +', 957, 1735)).toEqual({ sirka: 960, vyska: 1738 });
		expect(rozmerSietovinyPre('Štandard', 957, 1735)).toEqual({ sirka: 960, vyska: 1738 });
		expect(rozmerSietovinyPre('Robust', 957, 1735)).toEqual({ sirka: 959, vyska: 1736 });
	});
});

describe('#110 — UI pomocné funkcie a round-trip', () => {
	it('maSietkaSystemVyber: len Štandard/Štandard +, nie Robust/Slide', () => {
		expect(maSietkaSystemVyber('Štandard')).toBe(true);
		expect(maSietkaSystemVyber('Štandard +')).toBe(true);
		expect(maSietkaSystemVyber('Robust')).toBe(false);
		expect(maSietkaSystemVyber('Slide')).toBe(false);
	});

	it('SIETKA_SYSTEM_ALT: dvojica sa mapuje na seba navzájom', () => {
		expect(SIETKA_SYSTEM_ALT['Štandard']).toBe('Štandard +');
		expect(SIETKA_SYSTEM_ALT['Štandard +']).toBe('Štandard');
	});

	it('parseSietka: system sa prenesie, keď je zadaný ako string', () => {
		const { sietka } = parseSietka({ on: '1', uchyt: 'ziadny', system: 'Štandard' });
		expect(sietka?.system).toBe('Štandard');
	});

	it('sanitizeSietka: system sa zahodí, keď je zhodný s posuvom (default = rovnaký)', () => {
		const s = sanitizeSietka('Štandard +', { uchyt: 'ziadny', system: 'Štandard +' });
		expect(s?.system).toBeUndefined();
	});

	it('sanitizeSietka: system sa zahodí, keď posuv NEMÁ výber (Robust/Slide) — round-trip cez skript. POST', () => {
		const s = sanitizeSietka('Robust', { uchyt: 'ziadny', system: 'Štandard' } as never);
		expect(s?.system).toBeUndefined();
	});

	it('sanitizeSietka: platný cudzí systém sieťky (Štandard) na PLUS posuve prežije', () => {
		const s = sanitizeSietka('Štandard +', { uchyt: 'ziadny', system: 'Štandard' });
		expect(s?.system).toBe('Štandard');
	});

	it('sanitizeSietka: nezmyselná hodnota systému sieťky (Robust na Štandard+) sa zahodí', () => {
		const s = sanitizeSietka('Štandard +', { uchyt: 'ziadny', system: 'Robust' } as never);
		expect(s?.system).toBeUndefined();
	});
});
