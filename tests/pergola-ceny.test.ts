// #232: ceny materiálu v pergolovom rozpise (CAD nárez `/pergola` + Rezervačný odpis
// `/pergola/narez`) — DISPLAY-ONLY, znovupoužitie infra #154/#225 (`enrichPolozky` →
// `CenyTabulka`). B2B NESMIE dostať cenový blok VÔBEC — `ceny` musí byť `undefined`
// (obrana do hĺbky ako Money-write hranica, presne ako zasklenia `cenyPre`). Interní
// naopak MUSIA dostať `ceny` s riadkami zodpovedajúcimi zobrazenému Money rozpisu
// (vrátane ručných riadkov #234). Honest-null: bez snapshotu je každá cena `null`
// a súčet sa prizná ako neúplný. VŠETKY ceny TU sú VYMYSLENÉ (repo je verejné).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-pergola-ceny-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'p.db');
const SNAP = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = SNAP;
delete process.env.MONEY_LIVE; // len náhľad/rozpis — nič sa nezapisuje

const { db } = await import('../src/lib/server/db'); // triggers migrate + seed
const cadActions = (await import('../src/routes/pergola/+page.server')).actions;
const narezActions = (await import('../src/routes/pergola/narez/+page.server')).actions;

const B2B_USER = { id: 1, username: 'vo', role: 'b2b' as const };
const INTERNAL_USER = { id: 2, username: 'admin', role: 'internal' as const };
type User = typeof B2B_USER | typeof INTERNAL_USER | null;

// material_prices je UPSERT (nemaže staré) a db je singleton → reset medzi prípadmi
// (ceny-snapshot.md), inak by seednutá cena prežila do honest-null testu.
beforeEach(() => {
	db.exec('DELETE FROM material_prices; DELETE FROM material_prices_meta;');
	fs.rmSync(SNAP, { force: true });
});

function seed(rows: Record<string, unknown>[]) {
	fs.writeFileSync(SNAP, JSON.stringify({ generatedAt: new Date().toISOString(), rows }));
}

// ---- CAD nárez tok (/pergola) ----------------------------------------------
// 1:1 vektor z tests/pergola.test.ts (BARTONICEK) — dáva nenulové PRP profily.
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

function cadEvent(user: User) {
	const fd = new FormData();
	fd.append('zak', 'Z1');
	fd.append('op', 'O1');
	fd.append('zakaznik', 'Test');
	fd.append('cad', BARTONICEK);
	return {
		request: new Request('http://x/pergola', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof cadActions.spocitat>[0];
}

type CadNahlad = {
	step: string;
	v?: { nonzero: { kod: string }[] };
	ceny?: {
		radky: { kod: string; nakupCennik: number | null }[];
		sucty: { nakupCennik: { kompletne: boolean } };
	};
};

describe('CAD nárez /pergola — cenový blok (#232)', () => {
	it('b2b: ceny je undefined (cenový blok sa nikdy nedopočíta)', async () => {
		const r = (await cadActions.spocitat(cadEvent(B2B_USER))) as CadNahlad;
		expect(r.step).toBe('nahlad');
		expect(r.ceny).toBeUndefined();
	});

	it('interný: ceny je definované, riadky = presne zobrazené nenulové Money položky', async () => {
		const r = (await cadActions.spocitat(cadEvent(INTERNAL_USER))) as CadNahlad;
		expect(r.step).toBe('nahlad');
		expect(r.ceny).toBeDefined();
		const nonzero = r.v!.nonzero.map((o) => o.kod).sort();
		const cenyKody = r.ceny!.radky.map((c) => c.kod).sort();
		expect(cenyKody).toEqual(nonzero);
		expect(cenyKody.length).toBeGreaterThan(0);
	});

	it('interný, bez snapshotu: všetky ceny null, súčet neúplný (honest-null)', async () => {
		const r = (await cadActions.spocitat(cadEvent(INTERNAL_USER))) as CadNahlad;
		expect(r.ceny!.radky.every((c) => c.nakupCennik === null)).toBe(true);
		expect(r.ceny!.sucty.nakupCennik.kompletne).toBe(false);
	});

	it('interný, seednutá cena pre PRP kód: ten riadok ukáže reálnu (vymyslenú) cenu', async () => {
		const r0 = (await cadActions.spocitat(cadEvent(INTERNAL_USER))) as CadNahlad;
		const kod = r0.ceny!.radky[0]!.kod;
		seed([
			{ kod, nakupCennik: 4.25, nakupPoslednaFaktura: null, predajVo: null, mena: 'EUR', sklad: 10 }
		]);
		const r = (await cadActions.spocitat(cadEvent(INTERNAL_USER))) as CadNahlad;
		const row = r.ceny!.radky.find((x) => x.kod === kod);
		expect(row!.nakupCennik).toBe(4.25);
	});
});

// ---- Rezervačný odpis tok (/pergola/narez) ----------------------------------
function narezEvent(user: User, rucne?: unknown[]) {
	const fd = new FormData();
	// štandardná pergola z callu (rovnaké rozmery ako e2e/pergola-rezervacia.spec):
	// Robust, na stenu, 4 nohy, výška zadná 2900 → nenulové PRP profily
	fd.append('system', 'Robust');
	fd.append('sirka', '5000');
	fd.append('hlbka', '3500');
	fd.append('pocetPrednychNoh', '4');
	fd.append('vyskaZadna', '2900');
	fd.append('uchytenie', 'stena');
	fd.append('pocetZadnychNoh', '4');
	fd.append('hornyProfilZadnej', '110');
	fd.append('zak', 'Z1');
	fd.append('op', 'O1');
	fd.append('zakaznik', 'Test');
	if (rucne) fd.append('rucnePolozky', JSON.stringify(rucne));
	return {
		request: new Request('http://x/pergola/narez', { method: 'POST', body: fd }),
		locals: { user }
	} as Parameters<typeof narezActions.rezervovat>[0];
}

// ručný riadok #234 (PRP202526 = známy katalógový kód, m) — vymyslená cena nižšie
const RUCNY = [{ kod: 'PRP202526', nazov: 'Kotviaci profil pometraný', mnozstvo: '3,5', mj: 'm' }];

type RezNahlad = {
	step: string;
	rozpis?: { nonzero: { kod: string; rucne?: boolean }[] };
	ceny?: {
		radky: { kod: string; nakupCennik: number | null }[];
		sucty: { nakupCennik: { kompletne: boolean } };
	};
};

describe('Rezervačný odpis /pergola/narez — cenový blok (#232)', () => {
	it('b2b: ceny je undefined', async () => {
		const r = (await narezActions.rezervovat(narezEvent(B2B_USER))) as RezNahlad;
		expect(r.step).toBe('rez-nahlad');
		expect(r.ceny).toBeUndefined();
	});

	it('interný: ceny je definované, riadky pokrývajú zobrazené nenulové položky vrátane ručného', async () => {
		const r = (await narezActions.rezervovat(narezEvent(INTERNAL_USER, RUCNY))) as RezNahlad;
		expect(r.step).toBe('rez-nahlad');
		expect(r.ceny).toBeDefined();
		const nonzero = r.rozpis!.nonzero.map((o) => o.kod).sort();
		const cenyKody = r.ceny!.radky.map((c) => c.kod).sort();
		expect(cenyKody).toEqual(nonzero);
		// ručný kód #234 je medzi cenenými položkami
		expect(cenyKody).toContain('PRP202526');
	});

	it('interný, bez snapshotu: všetky ceny null, súčet neúplný (honest-null)', async () => {
		const r = (await narezActions.rezervovat(narezEvent(INTERNAL_USER, RUCNY))) as RezNahlad;
		expect(r.ceny!.radky.every((c) => c.nakupCennik === null)).toBe(true);
		expect(r.ceny!.sucty.nakupCennik.kompletne).toBe(false);
	});

	it('interný, seednutá cena pre ručný kód: ten riadok ukáže reálnu (vymyslenú) cenu', async () => {
		seed([
			{
				kod: 'PRP202526',
				nakupCennik: 7.9,
				nakupPoslednaFaktura: null,
				predajVo: null,
				mena: 'EUR',
				sklad: null
			}
		]);
		const r = (await narezActions.rezervovat(narezEvent(INTERNAL_USER, RUCNY))) as RezNahlad;
		const row = r.ceny!.radky.find((x) => x.kod === 'PRP202526');
		expect(row!.nakupCennik).toBe(7.9);
	});
});
