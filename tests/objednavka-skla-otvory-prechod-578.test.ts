// #578 review 🟡: riadok „Zasklenie N" (N ks, bez otvorov) pridaný na podklad PRED rozlíšením otvorov
// sa pri opätovnom „Pridať sklá" nesmie zdvojiť — dva nové riadky (s otvorom + bez) by k nemu pridali
// ďalšie tabule (Deluxe 4K = 8 ks namiesto 4 → dvojitá objednávka u dodávateľa, presne to, čomu #563
// bráni). Starý riadok celého posuvu sa PREVEDIE na riadok „s otvorom" (id + prílohy ostanú) a
// pridá sa len zvyšok bez otvoru — výsledok = ako pri čerstvom pridaní. Money-NEUTRÁLNE.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-otvory-prechod-578-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { actions } = await import('../src/routes/zasklenia/+page.server');
const { listSklaPreZakazku, pridajSklo, pridajSubor, listSubory } =
	await import('../src/lib/server/objednavka-skla');
const { popisPozicie, zakladPozicie } = await import('../src/lib/objednavka-skla-pozicia');

const USER = { id: 1, username: 'tester', role: 'internal' as const };

function callAction(o: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	const event = {
		request: new Request('http://x/zasklenia', { method: 'POST', body: f }),
		locals: { user: USER }
	};
	const fn = actions.pridatSkla as unknown as (e: typeof event) => Promise<Record<string, unknown>>;
	return fn(event);
}

const deluxe = (styl: string, s: string) => ({
	op: '01',
	zakaznik: 'X',
	system: 'Deluxe',
	styl,
	s,
	v: '2000',
	sklo: 'Float kalené 10 mm',
	otvaranie: 'P - L',
	farbaKovania: 'R7016'
});

/** Geometria skla, ktorú producent pre daný vstup vyrobí (z čerstvej zákazky, nie literál). */
async function geometria(vstup: Record<string, string>, zak: string) {
	await callAction({ ...vstup, zak });
	const [r] = listSklaPreZakazku(zak);
	return { sirkaMm: r!.sirkaMm, vyskaMm: r!.vyskaMm!, typSkla: r!.typSkla };
}

/** Riadok spred #578: celý posuv jedným riadkom, bez otvorov. */
function staryRiadok(zak: string, g: Awaited<ReturnType<typeof geometria>>, pocet: number) {
	return pridajSklo({
		zak,
		op: '01',
		modul: 'zasklenia',
		popis: 'Zasklenie 1',
		...g,
		pocet,
		m2: (g.sirkaMm * g.vyskaMm * pocet) / 1e6,
		createdBy: 'test'
	});
}

describe('#578 prechod — starý riadok celého posuvu sa nezdvojí', () => {
	it('Deluxe 4K: starý „Zasklenie 1" 4 ks → riadok s otvorom (2 ks, to isté id + príloha) + 2 ks bez', async () => {
		const g = await geometria(deluxe('4K', '4000'), 'ZAK-578-G4');
		const stareId = staryRiadok('ZAK-578-P4', g, 4);
		pridajSubor(stareId, 'vykres.pdf', 'application/octet-stream', Buffer.from('%PDF-1.4'));

		const r = await callAction({ ...deluxe('4K', '4000'), zak: 'ZAK-578-P4' });
		expect(r.step).toBe('nahlad');
		const rows = listSklaPreZakazku('ZAK-578-P4');
		expect(rows.reduce((a, p) => a + p.pocet, 0)).toBe(4);
		expect(rows).toHaveLength(2);
		const s = rows.find((p) => p.spec.holesQty > 0)!;
		const bez = rows.find((p) => p.spec.holesQty === 0)!;
		expect(s.id).toBe(stareId);
		expect(s.popis).toBe('Zasklenie 1 — s otvorom ⌀46');
		expect(s.pocet).toBe(2);
		expect(s.spec.holeSize).toBe('d50');
		expect(s.m2!).toBeCloseTo((g.sirkaMm * g.vyskaMm * 2) / 1e6, 10);
		expect(listSubory(stareId)).toHaveLength(1);
		expect(bez.popis).toBe('Zasklenie 1');
		expect(bez.pocet).toBe(2);

		// a ďalšie kliknutie už nič nemení
		const znova = await callAction({ ...deluxe('4K', '4000'), zak: 'ZAK-578-P4' });
		expect((znova.sklaPridane as { pridane: number }).pridane).toBe(0);
		expect(listSklaPreZakazku('ZAK-578-P4')).toHaveLength(2);
	});

	it('Deluxe 2K: starý „Zasklenie 1" 2 ks → prevedie sa na jediný riadok s otvorom', async () => {
		const g = await geometria(deluxe('2K', '2000'), 'ZAK-578-G2');
		const stareId = staryRiadok('ZAK-578-P2', g, 2);
		await callAction({ ...deluxe('2K', '2000'), zak: 'ZAK-578-P2' });
		const rows = listSklaPreZakazku('ZAK-578-P2');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.id).toBe(stareId);
		expect(rows[0]!.pocet).toBe(2);
		expect(rows[0]!.spec.holesQty).toBe(1);
	});

	it('starý riadok s INÝM počtom (iný posuv) sa neprevádza — pridajú sa nové riadky', async () => {
		const g = await geometria(deluxe('4K', '4000'), 'ZAK-578-G3');
		const stareId = staryRiadok('ZAK-578-P3', g, 3);
		await callAction({ ...deluxe('4K', '4000'), zak: 'ZAK-578-P3' });
		const rows = listSklaPreZakazku('ZAK-578-P3');
		expect(rows).toHaveLength(3);
		const stary = rows.find((p) => p.id === stareId)!;
		expect(stary.pocet).toBe(3);
		expect(stary.spec.holesQty).toBe(0);
	});
});

describe('#578 pozícia a prípona otvoru', () => {
	it('prípona otvoru ľubovoľného priemeru ostáva; zakladPozicie ju odreže', () => {
		expect(popisPozicie('Zasklenie 2 — s otvorom ⌀56', 'zasklenia')).toBe(
			'Zasklenie 2 — s otvorom ⌀56'
		);
		expect(zakladPozicie('Zasklenie 2 — s otvorom ⌀46', 'zasklenia')).toBe('Zasklenie 2');
		expect(zakladPozicie('Zasklenie 2: Robust 3K', 'zasklenia')).toBe('Zasklenie 2');
		expect(zakladPozicie('FIX pole 1 — s otvorom ⌀46', 'fix')).toBe('FIX pole 1');
	});
});

describe('#578 neplatné otvory od producenta', () => {
	it('neznáma trieda priemeru alebo záporný počet = chyba pred zápisom', () => {
		const base = {
			zak: 'ZAK-578-BAD',
			modul: 'zasklenia',
			popis: 'Zasklenie 1',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			typSkla: 'Float kalené 10 mm',
			createdBy: 'test'
		};
		expect(() => pridajSklo({ ...base, holesQty: 1, holeSize: 'd99' as 'd50' })).toThrow();
		expect(() => pridajSklo({ ...base, holesQty: -1 })).toThrow();
		expect(listSklaPreZakazku('ZAK-578-BAD')).toHaveLength(0);
	});
});
