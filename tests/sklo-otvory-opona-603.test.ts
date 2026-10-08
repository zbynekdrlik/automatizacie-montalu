// #603 (Odoo úloha 1370 „Delux opona", 7.10.2026): pri otváraní OPONA má Deluxe zámkový otvor ⌀46
// aj na DVOCH STREDOVÝCH sklách, kde sa polovice opony stretávajú — „2x2K 4 okna z vyrezom, 2x3K
// 4 okna výrez 2 bez, 2x4K 4 okna výrez 4 bez". ROZHODNUTÉ (stream, 8.10.): polia 0, N/2−1, N/2,
// N−1 (duplicity von); krajné ako doteraz (ľavé pri ľavej hrane, pravé pri pravej), stredové pri
// STREDOVEJ (stretávacej) hrane — ľavé stredové pri pravej, pravé stredové pri ľavej. L - P / P - L
// bez zmeny (2 krajné). JEDNO pravidlo → výkres, karta nárezáku, objednávka skla (holes_qty) aj PDF.
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import {
	otvoryVSkle,
	riadkySklaPosuvu,
	rozpisOtvorovSkla,
	stranyOtvorov,
	VRTANIE_ZAMKU_DEFAULT_MM
} from '../src/lib/sklo-otvory';
import Nahlad2D from '../src/lib/components/Nahlad2D.svelte';
import SkloOtvoryRozpis from '../src/lib/components/zasklenia/SkloOtvoryRozpis.svelte';

process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money

const { sklaPosuvu, listSklaPreZakazku } = await import('../src/lib/server/objednavka-skla');
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { buildGlassOrderForZak } = await import('../src/lib/server/odoo-glass-order-upload');

const L = (pole: number) => ({ pole, vlavo: true });
const P = (pole: number) => ({ pole, vlavo: false });

describe('#603 otvoryVSkle — opona: krajné + obe stredové sklá', () => {
	it('2×2K (N=4) opona → všetky 4 tabule, strany L P L P', () => {
		expect(otvoryVSkle('Deluxe', 4, 'Opona')).toEqual({
			tabule: [L(0), P(1), L(2), P(3)],
			sOtvorom: 4,
			otvorovNaTabulu: 1,
			velkost: 'd50'
		});
	});

	it('2×3K (N=6) opona → polia 0, 2, 3, 5 (stredové pri stretávacej hrane)', () => {
		const o = otvoryVSkle('Deluxe', 6, 'Opona');
		expect(o.tabule).toEqual([L(0), P(2), L(3), P(5)]);
		expect(o.sOtvorom).toBe(4);
	});

	it('2×4K (N=8) opona → polia 0, 3, 4, 7', () => {
		const o = otvoryVSkle('Deluxe', 8, 'Opona');
		expect(o.tabule).toEqual([L(0), P(3), L(4), P(7)]);
		expect(o.sOtvorom).toBe(4);
	});

	it('L - P / P - L bez zmeny — len krajné sklá', () => {
		for (const otv of ['L - P', 'P - L']) {
			expect(otvoryVSkle('Deluxe', 4, otv).tabule).toEqual([L(0), P(3)]);
			expect(otvoryVSkle('Deluxe', 6, otv).tabule).toEqual([L(0), P(5)]);
			expect(otvoryVSkle('Deluxe', 6, otv).sOtvorom).toBe(2);
		}
	});

	it('pri prekryve má krajná tabuľa prednosť (N=2 opona = 2 krajné, N=1 = 1)', () => {
		expect(otvoryVSkle('Deluxe', 2, 'Opona').tabule).toEqual([L(0), P(1)]);
		expect(otvoryVSkle('Deluxe', 1, 'Opona').tabule).toEqual([L(0)]);
	});

	it('ostatné systémy do skla nevŕtajú ani pri opone', () => {
		for (const sys of ['Robust', 'Slide', 'Štandard', 'Štandard +'])
			expect(otvoryVSkle(sys, 6, 'Opona').sOtvorom).toBe(0);
	});
});

describe('#603 karta nárezáku a riadky objednávky z TOHO ISTÉHO pravidla', () => {
	it('rozpisOtvorovSkla opona: 4/0, 4/2, 4/4 (presne text úlohy 1370)', () => {
		expect(rozpisOtvorovSkla('Deluxe', 4, 'Opona')).toBe(
			'z toho s otvorom ⌀46: 4 ks · bez otvoru: 0 ks'
		);
		expect(rozpisOtvorovSkla('Deluxe', 6, 'Opona')).toBe(
			'z toho s otvorom ⌀46: 4 ks · bez otvoru: 2 ks'
		);
		expect(rozpisOtvorovSkla('Deluxe', 8, 'Opona')).toBe(
			'z toho s otvorom ⌀46: 4 ks · bez otvoru: 4 ks'
		);
		expect(rozpisOtvorovSkla('Deluxe', 4, 'L - P')).toBe(
			'z toho s otvorom ⌀46: 2 ks · bez otvoru: 2 ks'
		);
	});

	it('riadkySklaPosuvu opona 2×3K → 4 s otvorom + 2 bez; 2×2K → len riadok s otvorom', () => {
		expect(riadkySklaPosuvu('Zasklenie 1', 'Deluxe', 6, 'Opona')).toEqual([
			{ popis: 'Zasklenie 1 — s otvorom ⌀46', pocet: 4, holesQty: 1, holeSize: 'd50' },
			{ popis: 'Zasklenie 1', pocet: 2, holesQty: 0, holeSize: '' }
		]);
		expect(riadkySklaPosuvu('Zasklenie 1', 'Deluxe', 4, 'Opona')).toEqual([
			{ popis: 'Zasklenie 1 — s otvorom ⌀46', pocet: 4, holesQty: 1, holeSize: 'd50' }
		]);
	});

	it('SkloOtvoryRozpis (SSR) číta otváranie', () => {
		const html = render(SkloOtvoryRozpis, {
			props: { system: 'Deluxe', pocet: 6, otvaranie: 'Opona', testid: 'x' }
		}).body;
		expect(html).toContain('z toho s otvorom ⌀46: 4 ks · bez otvoru: 2 ks');
	});

	it('sklaPosuvu: posuv nesie otváranie → opona 2×4K = 4 s otvorom (s polohou) + 4 bez', () => {
		const ident = { zak: 'Z', op: '01', typSkla: 'Float kalené 10 mm', createdBy: 't' };
		const sklo = { sirka: 1004, vyska: 1914, pocet: 8 };
		const opona = sklaPosuvu('Zasklenie 1', { system: 'Deluxe', sklo, otvaranie: 'Opona' }, ident);
		expect(opona.map((r) => [r.popis, r.pocet, r.holesQty])).toEqual([
			['Zasklenie 1 — s otvorom ⌀46', 4, 1],
			['Zasklenie 1', 4, 0]
		]);
		expect(opona[0]!.otvor).toEqual({
			odHranyMm: 50,
			odSpodkuMm: VRTANIE_ZAMKU_DEFAULT_MM,
			priemerMm: 46
		});
		const lp = sklaPosuvu('Zasklenie 1', { system: 'Deluxe', sklo, otvaranie: 'L - P' }, ident);
		expect(lp.map((r) => r.pocet)).toEqual([2, 6]);
	});

	it('PDF delenie strán (`stranyOtvorov`) = strany z pravidla pre každé N a otváranie', () => {
		for (const otv of ['L - P', 'P - L', 'Opona'])
			for (let N = 1; N <= 8; N++) {
				const o = otvoryVSkle('Deluxe', N, otv);
				const vlavo = o.tabule.filter((t) => t.vlavo).length;
				expect(stranyOtvorov(o.sOtvorom), `${otv} N=${N}`).toEqual({
					vlavo,
					vpravo: o.sOtvorom - vlavo
				});
			}
	});
});

describe('#603 Nahlad2D kreslí otvory opony na správnych sklách a stranách', () => {
	// stredy zámkových otvorov (prerušované kruhy) zľava doprava
	const stredy = (html: string) =>
		[...html.matchAll(/<circle cx="([\d.]+)"[^>]*stroke-dasharray/g)]
			.map((m) => Number(m[1]))
			.sort((a, b) => a - b);
	const nahlad = (N: number, otvaranie: string) =>
		render(Nahlad2D, {
			props: { S: 1000 * N, V: 2000, N, skloS: 950, skloV: 1900, system: 'Deluxe', otvaranie }
		}).body;

	it('2×3K opona → 4 otvory; stredové pri stretávacej hrane (zrkadlovo okolo stredu)', () => {
		const x = stredy(nahlad(6, 'Opona'));
		expect(x).toHaveLength(4);
		const [x0, x1, x2, x3] = x as [number, number, number, number];
		// zrkadlová súmernosť celej opony okolo stredu kresby
		expect(x0 + x3).toBeCloseTo(x1 + x2, 6);
		// stredové otvory ležia TESNE pri stretávacej hrane (bližšie než pol poľa) — pri zlej
		// strane by boli od seba celé pole
		const pol = (x3 - x0) / (2 * 6);
		expect(x2 - x1).toBeLessThan(pol);
	});

	it('2×2K opona → 4 otvory; L - P 4K → 2 otvory (bez zmeny)', () => {
		expect(stredy(nahlad(4, 'Opona'))).toHaveLength(4);
		expect(stredy(nahlad(4, 'L - P'))).toHaveLength(2);
	});

	it('popisy otvorov smerujú do skla — popisy dvoch stredových otvorov sa neprekrývajú', () => {
		// popis „⌀46" každého otvoru v poradí polí: x + ukotvenie textu
		const popisy = [
			...nahlad(6, 'Opona').matchAll(/<text x="([\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>⌀46</g)
		].map((m) => ({ x: Number(m[1]), kotva: m[2] }));
		// otvor pri ľavej hrane → text doprava (start), pri pravej → doľava (end)
		expect(popisy.map((p) => p.kotva)).toEqual(['start', 'end', 'start', 'end']);
		// ľavé stredové (pole 2) končí naľavo od začiatku pravého stredového (pole 3)
		expect(popisy[1]!.x).toBeLessThan(popisy[2]!.x);
	});
});

describe('#603 /zasklenia → objednávka skla + Odoo glass_order pri opone', () => {
	const USER = { id: 1, username: 'tester', role: 'internal' as const };
	function callAction(name: 'pridatSkla' | 'pridatSklaMulti', o: Record<string, string>) {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.append(k, v);
		const event = {
			request: new Request('http://x/zasklenia', { method: 'POST', body: f }),
			locals: { user: USER }
		};
		const fn = actions[name] as unknown as (e: typeof event) => Promise<Record<string, unknown>>;
		return fn(event);
	}
	const riadky = (zak: string) =>
		listSklaPreZakazku(zak)
			.map((p) => `${p.popis}|${p.pocet}|${p.spec.holesQty}`)
			.sort();

	it('single Deluxe 2×3K (štýl 2× = vždy opona) → 4 s otvorom + 2 bez; holes_qty do Odoo', async () => {
		const r = await callAction('pridatSkla', {
			zak: 'ZAK-603-S',
			op: '01',
			zakaznik: 'X',
			system: 'Deluxe',
			styl: '2x3K',
			s: '6000',
			v: '2000',
			sklo: 'Float kalené 10 mm',
			otvaranie: 'Opona',
			farbaKovania: 'R7016'
		});
		expect(r.step).toBe('nahlad');
		expect(riadky('ZAK-603-S')).toEqual(['Zasklenie 1 — s otvorom ⌀46|4|1', 'Zasklenie 1|2|0']);
		const items = (await buildGlassOrderForZak('ZAK-603-S'))!.order.items;
		const s = items.find((i) => i.description === 'Zasklenie 1 — s otvorom ⌀46')!;
		expect(s.qty).toBe(4);
		expect(s.holes_qty).toBe(1);
		expect(s.hole_size).toBe('d50');
	});

	it('multi: opona 2×2K → 4 s otvorom (bez riadku „bez"), L - P 4K → 2 + 2', async () => {
		const posuvy = JSON.stringify([
			{
				system: 'Deluxe',
				styl: '2x2K',
				s: '4000',
				v: '2000',
				sklo: 'Float kalené 10 mm',
				otvaranie: 'Opona'
			},
			{
				system: 'Deluxe',
				styl: '4K',
				s: '4000',
				v: '2000',
				sklo: 'Float kalené 10 mm',
				otvaranie: 'L - P'
			}
		]);
		await callAction('pridatSklaMulti', {
			zak: 'ZAK-603-M',
			op: '01',
			zakaznik: 'X',
			farbaKovania: 'R7016',
			posuvy
		});
		expect(riadky('ZAK-603-M')).toEqual([
			'Zasklenie 1 — s otvorom ⌀46|4|1',
			'Zasklenie 2 — s otvorom ⌀46|2|1',
			'Zasklenie 2|2|0'
		]);
	});
});
