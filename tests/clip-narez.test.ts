// CLIP „Rozpis rezov na tyče" adaptér (#554) — clipMaterialRows(kusy) → MaterialRow[]
// z ffdPack (rovnaká 7500 mm tyč ako CLIP compute, kotúč KOTUC). DISPLAY-ONLY:
// pílový plán je optimalizované rozloženie (bin-packing), odpis do Money ostáva
// per-riadkový ROUNDUP (clip.ts, kontrakt #372) — tento adaptér Money NIKDY nemení.
// Vektory z Patrikovho Excelu (podklad 37649): izo 3 výplne, zábradlie 3000×1200
// (výplň 957×1144), priečky 1003 / 1997.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClip, computeClipMulti, type ClipVstup } from '../src/lib/clip';
import { clipMaterialRows } from '../src/lib/server/clip-narez';

function vstup(over: Partial<ClipVstup> = {}): ClipVstup {
	return {
		zak: 'Z',
		op: 'O',
		zakaznik: 'T',
		caka: false,
		typ: 'izo',
		variant: 3,
		sirka: 3000,
		vyska: 1200,
		ral: '',
		...over
	};
}

const R = 'ZASP00116';
const P = 'ZASP00125';
const ZI = 'ZASP00119';

describe('clipMaterialRows — Excel fixtúra izo 3000×1200 (3 výplne)', () => {
	const rows = clipMaterialRows([computeClip(vstup())]);

	it('produkuje 3 profilové riadky (rám, priečka, zasklievací) — drobné položky NIE', () => {
		expect(rows.map((r) => r.kod)).toEqual([R, P, ZI]);
		// žiadny null kód (drobné položky sa do pílového plánu nedostanú)
		expect(rows.every((r) => typeof r.kod === 'string' && r.kod.length > 0)).toBe(true);
	});

	it('rám ZASP00116 — rezy 2×3000 + 2×1152, ffdPack = 2 tyče', () => {
		const ram = rows.find((r) => r.kod === R)!;
		expect(ram.rezy).toEqual([
			{ rozmer: 3000, ks: 2 },
			{ rozmer: 1152, ks: 2 }
		]);
		expect(ram.tyce).toBe(2);
		expect(ram.barLen).toBe(7500);
		expect(ram.odpadMm).toBe(6680);
		expect(ram.odpadPct).toBe(44.5);
		expect(ram.bary).toHaveLength(2);
		// prvá tyč zbalí 3000+3000+1152 (3 kusy), druhá zvyšný 1152
		expect(ram.bary[0]!.kusy).toHaveLength(3);
		expect(ram.bary[1]!.kusy).toHaveLength(1);
	});

	it('priečka ZASP00125 — 2×1152, 1 tyč', () => {
		const p = rows.find((r) => r.kod === P)!;
		expect(p.rezy).toEqual([{ rozmer: 1152, ks: 2 }]);
		expect(p.tyce).toBe(1);
		expect(p.odpadMm).toBe(5188);
		expect(p.odpadPct).toBe(69.2);
	});

	it('zasklievací ZASP00119 — 6×964,7 + 6×1120, 2 tyče', () => {
		const z = rows.find((r) => r.kod === ZI)!;
		expect(z.rezy).toEqual([
			{ rozmer: 964.7, ks: 6 },
			{ rozmer: 1120, ks: 6 }
		]);
		expect(z.tyce).toBe(2);
		expect(z.odpadMm).toBe(2444);
		expect(z.odpadPct).toBe(16.3);
	});

	it('CLIP rez je rovný (90°) — ako v Exceli (obdĺžniková kresba)', () => {
		expect(rows.every((r) => r.sikmyRez === false)).toBe(true);
	});
});

describe('clipMaterialRows — B0 (N=1) bez priečky', () => {
	it('rám + zasklievací, žiadny ZASP00125 (priečka)', () => {
		const rows = clipMaterialRows([computeClip(vstup({ variant: 1 }))]);
		expect(rows.map((r) => r.kod)).toEqual([R, ZI]);
		expect(rows.find((r) => r.kod === P)).toBeUndefined();
	});
});

describe('clipMaterialRows — multi zdieľa tyče naprieč kusmi (ako zasklenia multi)', () => {
	it('2× identický kus = zdieľané tyče (menej než 2× samostatné)', () => {
		const one = clipMaterialRows([computeClip(vstup({ variant: 1, sirka: 3000, vyska: 1000 }))]);
		const two = clipMaterialRows([
			computeClip(vstup({ variant: 1, sirka: 3000, vyska: 1000 })),
			computeClip(vstup({ variant: 1, sirka: 3000, vyska: 1000 }))
		]);
		const ramOne = one.find((r) => r.kod === R)!;
		const ramTwo = two.find((r) => r.kod === R)!;
		// dvojnásobok kusov v zdieľanom pláne
		const rezyKsTwo = ramTwo.rezy.reduce((s, x) => s + x.ks, 0);
		const rezyKsOne = ramOne.rezy.reduce((s, x) => s + x.ks, 0);
		expect(rezyKsTwo).toBe(rezyKsOne * 2);
		// zdieľané balenie: 2× kusy sa nemusia zbaliť do 2× toľko tyčí (packing)
		expect(ramTwo.tyce).toBeLessThanOrEqual(ramOne.tyce * 2);
	});

	it('kombinuje kódy naprieč rôznymi typmi kusov', () => {
		const rows = clipMaterialRows([
			computeClip(vstup({ typ: 'izo', variant: 1 })),
			computeClip(vstup({ typ: 'klasika', variant: 2 }))
		]);
		const kody = rows.map((r) => r.kod);
		expect(kody).toContain(R);
		expect(kody).toContain('ZASP202413'); // klasika zasklievací (z 2. kusu)
		expect(kody).toContain(ZI); // izo zasklievací (z 1. kusu)
	});
});

describe('clipMaterialRows — DISPLAY-ONLY: Money odpis (computeClip) sa NEMENÍ', () => {
	it('odpis polozky sú byte-identické pred aj po volaní adaptéra (guard)', () => {
		const v = computeClip(vstup());
		const before = JSON.parse(JSON.stringify(v.polozky));
		clipMaterialRows([v]);
		clipMaterialRows([v, v]);
		expect(v.polozky).toEqual(before);
		// kontraktný vektor odpisu (Excel 37649): ZASP00116=2, ZASP00125=1, ZASP00119=2
		expect(v.polozky.map((p) => [p.kod, p.qty])).toEqual([
			[R, 2],
			[P, 1],
			[ZI, 2]
		]);
	});

	it('computeClipMulti odpis sa adaptérom nemení', () => {
		const multi = computeClipMulti([vstup(), vstup({ typ: 'klasika', variant: 2 })]);
		const before = JSON.parse(JSON.stringify(multi.polozky));
		clipMaterialRows(multi.kusy);
		expect(multi.polozky).toEqual(before);
	});
});

describe('clipMaterialRows — Money-neutralita (žiadny Money/odpis modul ho neimportuje)', () => {
	const SRC = path.resolve(__dirname, '../src');
	function walk(dir: string): string[] {
		const out: string[] = [];
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) out.push(...walk(p));
			else if (/\.(ts|svelte)$/.test(e.name)) out.push(p);
		}
		return out;
	}

	it('adaptér neimportuje Money (money.ts / writeOdpis-call / server/ceny)', () => {
		const src = fs.readFileSync(path.join(SRC, 'lib/server/clip-narez.ts'), 'utf8');
		// import-špecifické (nie substring v komentári — vysvetlivka smie slovo spomenúť)
		expect(src).not.toMatch(/from\s+['"]\$lib\/server\/money['"]/);
		expect(src).not.toMatch(/from\s+['"]\$lib\/server\/ceny['"]/);
		// žiadne volanie writeOdpis( / saveOdpis( (Money zápis)
		expect(src).not.toMatch(/writeOdpis\s*\(/);
		expect(src).not.toMatch(/saveOdpis\w*\s*\(/);
	});

	it('žiadny Money/odpisový modul neimportuje clip-narez', () => {
		const moneyModules = walk(path.join(SRC, 'lib/server')).filter((f) =>
			/(money|compute-odpis|ceny|odpad-store)\.ts$/.test(f)
		);
		expect(moneyModules.length).toBeGreaterThan(0);
		for (const f of moneyModules) {
			const src = fs.readFileSync(f, 'utf8');
			expect(src, `${path.basename(f)} nesmie importovať clip-narez`).not.toMatch(/clip-narez/);
		}
	});
});
