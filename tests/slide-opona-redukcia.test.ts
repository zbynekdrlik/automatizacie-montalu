// Slide opona — REDUKCIA 6 mm (ZASP00091). Geometria bola odvodená z Robustu (offset
// 2x3K 127,47 / 2x2K 21, V−65), takže vychádzala takmer rovná rámovému profilu.
// Podklad od dielne (2026-07-27):
//  - pracovník: „robí sa aj zo 6 mm alebo 3.3.1, ale to sa reže priamo s rámovým
//    profilom v celku" → v jeho Exceli má redukcia PRÁZDNY rozmer a rovnaké počty
//    ako rámový (2x3K 12 + 12 ks);
//  - Dominik (presné číslo): redukcia = „šírka prírezu mínus 72,4", a potvrdil, že
//    −72,4 platí AJ NA VÝŠKU.
// Takže: redukcia = rámový rez − 72,4 v OBOCH smeroch, počty nezmenené.
// Money-relevantné (ZASP00091 je skutočný článok), preto exaktné vektory.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
// redukciaZero = false → redukcia sa počíta (tenké sklo); true → nuluje sa (IZO číre)
const plan = (styl: string, S: number, V: number, redukciaZero = false) =>
	computeFlat(cfg, 'Slide|' + styl, S, V, redukciaZero, 0)!;
const profil = (styl: string, S: number, V: number, kod: string, redukciaZero = false) =>
	plan(styl, S, V, redukciaZero).material.find((m) => m.kod === kod);
const metre = (styl: string, S: number, V: number, kod: string, redukciaZero = false) =>
	plan(styl, S, V, redukciaZero).odpis.find((o) => o.kod === kod)?.metre;

describe('Slide opona — redukcia 6 mm = prírez − 72,4 (obe dimenzie)', () => {
	it('2x3K 5000×2200: redukcia 785 / 2061 (rámový 857 / 2133 mínus 72,4)', () => {
		const ram = profil('2x3K', 5000, 2200, 'ZASP00088')!;
		const red = profil('2x3K', 5000, 2200, 'ZASP00091')!;
		expect(ram.rezy.map((r) => Math.round(r.rozmer))).toEqual([857, 2133]);
		expect(red.rezy.map((r) => Math.round(r.rozmer))).toEqual([785, 2061]);
		// počty kusov sú rovnaké ako rámový — reže sa s ním „v celku"
		expect(red.rezy.map((r) => r.ks)).toEqual(ram.rezy.map((r) => r.ks));
		expect(red.rezy.map((r) => r.ks)).toEqual([12, 12]);
	});

	it('2x2K 5000×2200: redukcia 1188 / 2061 (rámový 1260 / 2133 mínus 72,4)', () => {
		const ram = profil('2x2K', 5000, 2200, 'ZASP00088')!;
		const red = profil('2x2K', 5000, 2200, 'ZASP00091')!;
		expect(ram.rezy.map((r) => Math.round(r.rozmer))).toEqual([1260, 2133]);
		expect(red.rezy.map((r) => Math.round(r.rozmer))).toEqual([1188, 2061]);
		expect(red.rezy.map((r) => r.ks)).toEqual([8, 8]);
	});

	it('rozdiel redukcia vs rámový je PRESNE 72,4 mm v oboch dimenziách a pre oba štýly', () => {
		for (const styl of ['2x2K', '2x3K']) {
			for (const [S, V] of [
				[5000, 2200],
				[3000, 2050],
				[6940, 2200]
			]) {
				const p = plan(styl, S, V);
				const ram = p.material.find((m) => m.kod === 'ZASP00088')!;
				const red = p.material.find((m) => m.kod === 'ZASP00091')!;
				for (let i = 0; i < 2; i++)
					expect(ram.rezy[i].rozmer - red.rezy[i].rozmer, `${styl} ${S}×${V} dim${i}`).toBeCloseTo(
						72.4,
						6
					);
			}
		}
	});

	it('odpis ZASP00091 do Money — exaktné metre pri 5000×2200', () => {
		// FFD balenie (tyč 7500, kotúč 4): 2x3K 12×784,68 + 12×2060,6 → 5 tyčí;
		// 2x2K 8×1187,75 + 8×2060,6 → 4 tyče (predtým 5 = nadhodnotené)
		expect(metre('2x3K', 5000, 2200, 'ZASP00091')).toBe(37.5);
		expect(metre('2x2K', 5000, 2200, 'ZASP00091')).toBe(30);
	});

	it('IZO číre (redukciaZero) redukciu stále nuluje — 0 ks a žiadne metre do Money', () => {
		const red = profil('2x3K', 5000, 2200, 'ZASP00091', true)!;
		expect(red.rezy.map((r) => r.ks)).toEqual([0, 0]);
		expect(metre('2x3K', 5000, 2200, 'ZASP00091', true)).toBe(0);
	});

	it('oprava sa NEDOTKLA ostatných profilov (rámový/koľajnica/nosový/oponový odpis)', () => {
		const p = plan('2x3K', 5000, 2200);
		const by = Object.fromEntries(p.odpis.map((o) => [o.kod, o.metre]));
		expect(by).toMatchObject({
			ZASP00088: 37.5, // rámový
			ZASP00100: 15, // koľajnica 3K
			ZASP202410: 22.5, // nosový
			ZASP20249: 7.5 // oponový (Slide článok)
		});
		// sklo je nezávislé od redukcie
		expect(p.sklo).toMatchObject({ sirka: 774, vyska: 2050, pocet: 6 });
	});
});
