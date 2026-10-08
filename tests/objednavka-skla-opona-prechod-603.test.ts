// #603 prechod: podklad objednávky skla založený PRED #603 má pri opone staré rozdelenie z producenta
// (otvor len na krajných sklách: 2×3K = „s otvorom" 2 ks + „bez" 4 ks, 2×2K = 2 + 2). Nový producent
// dá 4 + 2 (2×2K = 4 + 0). Idempotentné „Pridať sklá" páruje aj kusy → bez prevodu by opakované
// pridanie objednávku ZDVOJILO (dvojitá objednávka u dodávateľa skla). Staré rozdelenie toho istého
// posuvu (pozícia, rozmer, typ, rovnaký celok) sa PREVEDIE na nové: riadok „s otvorom" dostane nové
// kusy (id + prílohy ostanú), riadok „bez" nové kusy, a keď ho nové rozdelenie nemá, zmaže sa.
// Ručne upravené riadky (atyp) sa neprevádzajú. Money-NEUTRÁLNE.
import { describe, it, expect } from 'vitest';

process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money

const { actions } = await import('../src/routes/zasklenia/+page.server');
const {
	listSklaPreZakazku,
	pridajSklaHromadneIdempotentne,
	sklaPosuvu,
	pridajSubor,
	listSubory,
	nastavRezim,
	nastavSpec
} = await import('../src/lib/server/objednavka-skla');
const { GLASS_SPEC_OFF } = await import('../src/lib/server/odoo-rozpis-lines');
const { render } = await import('svelte/server');
const { default: SklaPridaneBanner } =
	await import('../src/lib/components/SklaPridaneBanner.svelte');

const USER = { id: 1, username: 'tester', role: 'internal' as const };
const S_OTVOROM = 'Zasklenie 1 — s otvorom ⌀46';

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

const opona = (styl: string, s: string) => ({
	op: '01',
	zakaznik: 'X',
	system: 'Deluxe',
	styl,
	s,
	v: '2000',
	sklo: 'Float kalené 10 mm',
	otvaranie: 'Opona',
	farbaKovania: 'R7016'
});

/** Geometria + typ skla, ktoré producent pre daný vstup vyrobí (z čerstvej zákazky, nie literál). */
async function geometria(vstup: Record<string, string>, zak: string) {
	await callAction('pridatSkla', { ...vstup, zak });
	const [r] = listSklaPreZakazku(zak);
	return { sirka: r!.sirkaMm, vyska: r!.vyskaMm!, typSkla: r!.typSkla };
}

/** Riadky spred #603: rovnaký producent, ale pravidlo bez opony (= dnešné L - P, len krajné sklá). */
function stareRozdelenie(zak: string, g: Awaited<ReturnType<typeof geometria>>, N: number) {
	const riadky = sklaPosuvu(
		'Zasklenie 1',
		{ system: 'Deluxe', sklo: { sirka: g.sirka, vyska: g.vyska, pocet: N }, otvaranie: 'L - P' },
		{ zak, op: '01', typSkla: g.typSkla, createdBy: 'test' }
	);
	pridajSklaHromadneIdempotentne(riadky);
	const rows = listSklaPreZakazku(zak);
	return {
		s: rows.find((p) => p.spec.holesQty > 0)!,
		bez: rows.find((p) => p.spec.holesQty === 0)
	};
}

const kusy = (zak: string) =>
	listSklaPreZakazku(zak)
		.map((p) => `${p.popis}|${p.pocet}|${p.spec.holesQty}`)
		.sort();

describe('#603 prechod — staré rozdelenie opony sa nezdvojí, prevedie sa', () => {
	it('2×3K: staré 2 + 4 → 4 s otvorom (to isté id + príloha + poloha) + 2 bez (to isté id)', async () => {
		const g = await geometria(opona('2x3K', '6000'), 'ZAK-603-G6');
		const stare = stareRozdelenie('ZAK-603-P6', g, 6);
		expect(kusy('ZAK-603-P6')).toEqual([`${S_OTVOROM}|2|1`, 'Zasklenie 1|4|0']);
		pridajSubor(stare.s.id, 'vykres.pdf', 'application/octet-stream', Buffer.from('%PDF-1.4'));

		const r = await callAction('pridatSkla', { ...opona('2x3K', '6000'), zak: 'ZAK-603-P6' });
		expect(r.step).toBe('nahlad');
		expect(kusy('ZAK-603-P6')).toEqual([`${S_OTVOROM}|4|1`, 'Zasklenie 1|2|0']);
		const rows = listSklaPreZakazku('ZAK-603-P6');
		const s = rows.find((p) => p.spec.holesQty > 0)!;
		const bez = rows.find((p) => p.spec.holesQty === 0)!;
		expect(s.id).toBe(stare.s.id);
		expect(bez.id).toBe(stare.bez!.id);
		expect(listSubory(s.id)).toHaveLength(1);
		expect(s.m2!).toBeCloseTo((g.sirka * g.vyska * 4) / 1e6, 10);
		expect(bez.m2!).toBeCloseTo((g.sirka * g.vyska * 2) / 1e6, 10);
		expect(s.otvor).toEqual({ odHranyMm: 50, odSpodkuMm: 1050, priemerMm: 46 });
		expect((r.sklaPridane as { pridane: number }).pridane).toBe(1);

		// ďalšie kliknutie už nič nemení
		const znova = await callAction('pridatSkla', { ...opona('2x3K', '6000'), zak: 'ZAK-603-P6' });
		expect((znova.sklaPridane as { pridane: number }).pridane).toBe(0);
		expect(kusy('ZAK-603-P6')).toEqual([`${S_OTVOROM}|4|1`, 'Zasklenie 1|2|0']);
	});

	it('2×2K: staré 2 + 2 → jediný riadok s otvorom 4 ks, riadok „bez" sa zmaže', async () => {
		const g = await geometria(opona('2x2K', '4000'), 'ZAK-603-G4');
		const stare = stareRozdelenie('ZAK-603-P4', g, 4);
		expect(kusy('ZAK-603-P4')).toEqual([`${S_OTVOROM}|2|1`, 'Zasklenie 1|2|0']);

		await callAction('pridatSkla', { ...opona('2x2K', '4000'), zak: 'ZAK-603-P4' });
		const rows = listSklaPreZakazku('ZAK-603-P4');
		expect(rows.map((p) => [p.id, p.popis, p.pocet, p.spec.holesQty])).toEqual([
			[stare.s.id, S_OTVOROM, 4, 1]
		]);
	});

	it('multi: staré rozdelenie opony v posuve sa prevedie rovnako', async () => {
		const posuv = {
			system: 'Deluxe',
			styl: '2x4K',
			s: '7000',
			v: '2000',
			sklo: 'Float kalené 10 mm',
			otvaranie: 'Opona'
		};
		const multi = (zak: string) =>
			callAction('pridatSklaMulti', {
				zak,
				op: '01',
				zakaznik: 'X',
				farbaKovania: 'R7016',
				posuvy: JSON.stringify([posuv])
			});
		await multi('ZAK-603-GM');
		const [r0] = listSklaPreZakazku('ZAK-603-GM');
		const g = { sirka: r0!.sirkaMm, vyska: r0!.vyskaMm!, typSkla: r0!.typSkla };
		stareRozdelenie('ZAK-603-PM', g, 8);
		expect(kusy('ZAK-603-PM')).toEqual([`${S_OTVOROM}|2|1`, 'Zasklenie 1|6|0']);
		await multi('ZAK-603-PM');
		expect(kusy('ZAK-603-PM')).toEqual([`${S_OTVOROM}|4|1`, 'Zasklenie 1|4|0']);
	});

	it('iný celok kusov (iný posuv na tej istej pozícii) sa neprevádza', async () => {
		const g = await geometria(opona('2x3K', '6000'), 'ZAK-603-GC');
		// staré rozdelenie posuvu s 5 tabuľami (2 + 3) — nový posuv má 6 → nie je to ten istý posuv
		const stare = stareRozdelenie('ZAK-603-PC', g, 5);
		await callAction('pridatSkla', { ...opona('2x3K', '6000'), zak: 'ZAK-603-PC' });
		const rows = listSklaPreZakazku('ZAK-603-PC');
		expect(rows.find((p) => p.id === stare.s.id)!.pocet).toBe(2);
		expect(rows.find((p) => p.id === stare.bez!.id)!.pocet).toBe(3);
	});

	it('nejednoznačné staré riadky (dva „bez" alebo dva „s otvorom") sa neprevádzajú', async () => {
		const g = await geometria(opona('2x3K', '6000'), 'ZAK-603-GN');
		const ident = { zak: 'ZAK-603-PN', op: '01', typSkla: g.typSkla, createdBy: 'test' };
		const riadok = (popis: string, pocet: number, holesQty: number) => ({
			...ident,
			modul: 'zasklenia',
			popis,
			sirkaMm: g.sirka,
			vyskaMm: g.vyska,
			pocet,
			holesQty,
			holeSize: holesQty > 0 ? ('d50' as const) : undefined
		});
		const nezmenene = async (zak: string, stare: ReturnType<typeof riadok>[]) => {
			pridajSklaHromadneIdempotentne(stare.map((r) => ({ ...r, zak })));
			const pred = listSklaPreZakazku(zak).map((p) => [p.id, p.pocet] as const);
			expect(pred).toHaveLength(stare.length);
			await callAction('pridatSkla', { ...opona('2x3K', '6000'), zak });
			const po = listSklaPreZakazku(zak);
			for (const [id, pocet] of pred) expect(po.find((p) => p.id === id)!.pocet).toBe(pocet);
		};
		// s otvorom 2 + bez 4 by dali celok 6, ale „bez" riadky sú dva (4 + 1)
		await nezmenene('ZAK-603-PN', [
			riadok(S_OTVOROM, 2, 1),
			riadok('Zasklenie 1', 4, 0),
			riadok('Zasklenie 1', 1, 0)
		]);
		// s otvorom 3 + bez 3 by dali celok 6, ale „s otvorom" riadky sú dva (3 + 1)
		await nezmenene('ZAK-603-PD', [
			riadok(S_OTVOROM, 3, 1),
			riadok(S_OTVOROM, 1, 1),
			riadok('Zasklenie 1', 3, 0)
		]);
	});

	/** Prechod odmietnutý: podklad ostane PRESNE ako bol (nič sa nepridá — inak by sa objednávka
	 *  zdvojila) a výsledok akcie pozíciu nahlási na upozornenie v banneri. */
	async function odmietnuty(zak: string, styl: string, s: string, pred: string[]) {
		const r = await callAction('pridatSkla', { ...opona(styl, s), zak });
		expect(kusy(zak)).toEqual(pred);
		const sp = r.sklaPridane as { pridane: number; prechodOdmietnuty: string[] };
		expect(sp.pridane).toBe(0);
		expect(sp.prechodOdmietnuty).toHaveLength(1);
		expect(sp.prechodOdmietnuty[0]).toMatch(/^Zasklenie 1 \(/);
		return sp.prechodOdmietnuty[0]!;
	}

	it('ručne upravený (atyp) riadok sa neprevádza ani nezdvojí — upozornenie', async () => {
		const g = await geometria(opona('2x3K', '6000'), 'ZAK-603-GA');
		const stare = stareRozdelenie('ZAK-603-PA', g, 6);
		nastavRezim(stare.s.id, 'atyp');
		const dovod = await odmietnuty('ZAK-603-PA', '2x3K', '6000', [
			`${S_OTVOROM}|2|1`,
			'Zasklenie 1|4|0'
		]);
		expect(dovod).toContain('atyp');
	});

	it('riadok „bez", ktorý by sa mazal, má prílohu → neprevádza sa, príloha ostane — upozornenie', async () => {
		const g = await geometria(opona('2x2K', '4000'), 'ZAK-603-GF');
		const stare = stareRozdelenie('ZAK-603-PF', g, 4);
		pridajSubor(stare.bez!.id, 'foto.pdf', 'application/octet-stream', Buffer.from('%PDF-1.4'));
		const dovod = await odmietnuty('ZAK-603-PF', '2x2K', '4000', [
			`${S_OTVOROM}|2|1`,
			'Zasklenie 1|2|0'
		]);
		expect(listSubory(stare.bez!.id)).toHaveLength(1);
		expect(dovod).toContain('príloh');
	});

	it('ručne zmenené otvory na riadku „s otvorom" (#521 spec) sa neprepíšu — upozornenie', async () => {
		const g = await geometria(opona('2x3K', '6000'), 'ZAK-603-GS');
		const stare = stareRozdelenie('ZAK-603-PS', g, 6);
		nastavSpec(stare.s.id, { ...GLASS_SPEC_OFF, holesQty: 2, holeSize: 'd50' });
		const dovod = await odmietnuty('ZAK-603-PS', '2x3K', '6000', [
			`${S_OTVOROM}|2|2`,
			'Zasklenie 1|4|0'
		]);
		expect(dovod).toContain('otvory');
	});

	it('banner zobrazí odmietnutý prechod (pozícia + dôvod + čo urobiť)', () => {
		const html = render(SklaPridaneBanner, {
			props: {
				sklaPridane: {
					pridane: 0,
					zak: 'Z',
					upozornenieCudzie: null,
					prechodOdmietnuty: ['Zasklenie 1 (ručne upravený riadok — atyp)']
				},
				pridaneText: 'p',
				nicText: 'n'
			}
		}).body;
		expect(html).toContain('data-testid="skla-prechod-odmietnuty"');
		expect(html).toContain('Zasklenie 1 (ručne upravený riadok — atyp)');
		const bez = render(SklaPridaneBanner, {
			props: {
				sklaPridane: { pridane: 0, zak: 'Z', upozornenieCudzie: null },
				pridaneText: 'p',
				nicText: 'n'
			}
		}).body;
		expect(bez).not.toContain('skla-prechod-odmietnuty');
	});
});
