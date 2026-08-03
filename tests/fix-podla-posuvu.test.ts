// Rozpočítanie polí fixu PODĽA POSUVU (issue #85) — Patrik poslal rozpočítanie pre
// Robust/Slide/Štandard (Odoo 207, msg #1614896, výkres #1614897): „Hore mam 'posuv'
// a potom si len pretiahnem stred priečky do fixu" — hranica poľa fixu = STRED
// priečky (stretu krídel) posuvu, nie jej okraj. Ground truth z výkresu (3 polia,
// 2 priečky, krajný odskok symetricky z oboch krajov):
//
//   systém    | krajný odskok | polovica priečky | celá priečka (2×)
//   Robust    |        106,6  |            39,25  |              78,5
//   Slide     |         82,5  |            27,15  |              54,3
//   Štandard  |           59  |              21  |                42
//
// `PRIECKA` je čisto informatívna (hranicu poľa nemení — viď komentár vo fix.ts),
// takže tu sa netestuje na súčte, len že konštanta zodpovedá výkresu.
import { describe, it, expect } from 'vitest';
import {
	rozpocitajPodlaPosuvu,
	rovnomernePolia,
	KRAJNY,
	PRIECKA,
	FIX_SYSTEMY,
	jeFixSystem,
	jeFixDelenie,
	type FixSystem
} from '../src/lib/fix';

describe('KRAJNY / PRIECKA — konštanty priamo z Patrikovho výkresu', () => {
	it('Robust: krajný 106,6 / priečka 78,5 (2× 39,25)', () => {
		expect(KRAJNY.Robust).toBe(106.6);
		expect(PRIECKA.Robust).toBe(78.5);
		expect(PRIECKA.Robust).toBe(39.25 * 2);
	});
	it('Slide: krajný 82,5 / priečka 54,3 (2× 27,15)', () => {
		expect(KRAJNY.Slide).toBe(82.5);
		expect(PRIECKA.Slide).toBe(54.3);
		expect(Math.abs(PRIECKA.Slide - 27.15 * 2)).toBeLessThan(1e-9);
	});
	it('Štandard: krajný 59 / priečka 42 (2× 21)', () => {
		expect(KRAJNY.Štandard).toBe(59);
		expect(PRIECKA.Štandard).toBe(42);
		expect(PRIECKA.Štandard).toBe(21 * 2);
	});
});

describe('rozpocitajPodlaPosuvu — reprodukcia výkresu (3 polia, 2 priečky) pre všetky systémy', () => {
	const casy: [FixSystem, number][] = [
		['Robust', 2000],
		['Slide', 1500],
		['Štandard', 1000]
	];
	for (const [system, S] of casy) {
		it(`${system} S=${S}: krajné polia = KRAJNY, stred = zvyšok, súčet = S`, () => {
			const polia = rozpocitajPodlaPosuvu(S, system, 3);
			const krajny = KRAJNY[system];
			expect(polia).toEqual([krajny, S - 2 * krajny, krajny]);
			expect(polia.reduce((a, b) => a + b, 0)).toBeCloseTo(S, 6);
		});
	}
});

describe('rozpocitajPodlaPosuvu — hraničné a odvodené prípady (n=2 a n>=4 POTVRDENÉ Patrikom #85)', () => {
	it('n=1: žiadna priečka, celá šírka je jedno pole (zhodné s rovnomernePolia)', () => {
		expect(rozpocitajPodlaPosuvu(2400, 'Robust', 1)).toEqual([2400]);
		expect(rozpocitajPodlaPosuvu(2400, 'Robust', 1)).toEqual(rovnomernePolia(2400, 1));
	});

	it('n=2 (POTVRDENÉ Patrikom, Odoo 207 #1618564): dve polia = presne STRED (50/50), systém sa ignoruje', () => {
		// "Ak sú dve polia sklo ide priamo na stred je jedno čí tam posuv je nie je"
		// — KRAJNY/PRIECKA sa pri n=2 vôbec nepoužívajú, delí sa vždy presne na polovicu.
		expect(rozpocitajPodlaPosuvu(2000, 'Štandard', 2)).toEqual([1000, 1000]);
		expect(rozpocitajPodlaPosuvu(3000, 'Robust', 2)).toEqual([1500, 1500]);
		expect(rozpocitajPodlaPosuvu(1500, 'Slide', 2)).toEqual([750, 750]);
		// nepárny súčet (nedeliteľný na 0,1 mm rovnako) — súčet musí sedieť PRESNE na S
		const polia = rozpocitajPodlaPosuvu(2001, 'Štandard', 2);
		expect(polia[0] + polia[1]).toBe(2001);
		expect(Math.abs(polia[0] - polia[1])).toBeLessThanOrEqual(0.1);
	});

	it('n=4: symetrické — krajné = krajny, stredné dve rovnaké', () => {
		const polia = rozpocitajPodlaPosuvu(3000, 'Robust', 4);
		expect(polia[0]).toBe(106.6);
		expect(polia[3]).toBe(106.6);
		expect(polia[1]).toBe(polia[2]);
		expect(polia.reduce((a, b) => a + b, 0)).toBeCloseTo(3000, 6);
	});

	it('n=5: tri stredné polia takmer rovnaké (do 0,1 mm), súčet presne S', () => {
		const polia = rozpocitajPodlaPosuvu(4000, 'Robust', 5);
		expect(polia[0]).toBe(106.6);
		expect(polia[4]).toBe(106.6);
		expect(polia.length).toBe(5);
		const stred = polia.slice(1, 4);
		const max = Math.max(...stred);
		const min = Math.min(...stred);
		expect(max - min).toBeLessThanOrEqual(0.1);
		expect(polia.reduce((a, b) => a + b, 0)).toBeCloseTo(4000, 6);
	});

	it('n=6 (POTVRDENÉ Patrikom, Odoo 207 #1618564, „štandard 6 okien"): každá vnútorná priečka berie rovnaké 21+21, stred = hranica', () => {
		// "by som to delil rovnako ako pri 3 oknách ... pri štandardne 21 a 21
		// obsadenie a pričku beriem na stred" — repeat pravidla z n=3: krajné
		// polia = KRAJNY (nezmenené), VŠETKY vnútorné polia navzájom PRESNE
		// rovnaké (žiadne "rozloženie zvyšku", len opakovanie toho istého
		// stred-je-hranica pravidla) — Štandard, S=3000: krajny=59,
		// 4 vnútorné polia = (3000 - 2*59) / 4 = 720,5 každé.
		const polia = rozpocitajPodlaPosuvu(3000, 'Štandard', 6);
		expect(polia).toEqual([59, 720.5, 720.5, 720.5, 720.5, 59]);
		expect(polia.reduce((a, b) => a + b, 0)).toBe(3000);
	});

	it('n=6: súčet je VŽDY presne S (invariant, rovnaký ako rovnomernePolia)', () => {
		for (const system of FIX_SYSTEMY) {
			for (const S of [1200, 3300, 5000, 7777.7]) {
				const polia = rozpocitajPodlaPosuvu(S, system, 6);
				expect(polia.length).toBe(6);
				expect(polia.reduce((a, b) => a + b, 0)).toBeCloseTo(S, 6);
			}
		}
	});

	it('rozsah 1..8 polí naprieč všetkými systémami vždy sedí na S (žiadny mód nesmie porušiť invariant)', () => {
		for (const system of FIX_SYSTEMY) {
			for (let n = 1; n <= 8; n++) {
				const polia = rozpocitajPodlaPosuvu(4200, system, n);
				expect(polia.length).toBe(n);
				expect(polia.reduce((a, b) => a + b, 0)).toBe(4200);
			}
		}
	});
});

describe('rovnomerne (existujúci mód) ostáva BYTE-IDENTICKÝ — tvrdá poistka proti regresii', () => {
	it('rovnomernePolia sa nezmenilo (rovnaké vstupy → rovnaké výstupy ako pred #85)', () => {
		expect(rovnomernePolia(3200, 6)).toEqual([533.3, 533.3, 533.3, 533.3, 533.3, 533.5]);
		expect(rovnomernePolia(2795, 3)).toEqual([931.7, 931.7, 931.6]);
		expect(rovnomernePolia(1000, 1)).toEqual([1000]);
	});
});

describe('jeFixSystem / jeFixDelenie — strážia skriptovaný POST (obchádza HTML5 select)', () => {
	it('platné systémy prejdú, neplatné/cudzie hodnoty nie', () => {
		expect(jeFixSystem('Robust')).toBe(true);
		expect(jeFixSystem('Slide')).toBe(true);
		expect(jeFixSystem('Štandard')).toBe(true);
		expect(jeFixSystem('Deluxe')).toBe(false);
		expect(jeFixSystem('')).toBe(false);
		expect(jeFixSystem(undefined)).toBe(false);
	});
	it('platné delenia prejdú, neplatné nie', () => {
		expect(jeFixDelenie('rovnomerne')).toBe(true);
		expect(jeFixDelenie('posuv')).toBe(true);
		expect(jeFixDelenie('ine')).toBe(false);
		expect(jeFixDelenie(null)).toBe(false);
	});
});
