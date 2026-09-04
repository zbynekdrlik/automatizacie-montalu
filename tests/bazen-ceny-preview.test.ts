// #454: náhľad ceny materiálu na bazénovej odpisovej Kontrola obrazovke PRED
// odoslaním do Money. Dominik chce „pozrieť koľko bazén stojí a neodpíše to" —
// takže `spocitat` musí vrátiť `ceny` (CenyResult, vzor pergola/zasklenia
// enrichPolozky) A NESMIE nič zapísať (žiadny riadok v odpis_log, žiadny súbor
// v Money exportnom adresári). VŠETKY ceny v tomto súbore sú VYMYSLENÉ (repo je
// verejné).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-bazen-ceny-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'b.db');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'ceny.json');
process.env.MONEY_LIVE = '0'; // TEST režim — nič sa nezapisuje do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { db } = await import('../src/lib/server/db'); // migrate + seed
const bazen = await import('../src/routes/bazen/+page.server');
const { parseBazenVstup } = await import('../src/lib/server/vstup');
const { computeBazenAll } = await import('../src/lib/server/bazen');

const BODY: Record<string, string> = {
	zak: 'ZAK-CENY-1',
	op: '01',
	zakaznik: 'Test',
	model: 'Premier',
	kolaj: 'Jednokolaj',
	pocetSekcii: '3',
	pocetPriecok: '2',
	vs4500: '1',
	ss6000: '1',
	dlzkaKolajnic: '10000',
	prieckovy4300: '1',
	vyklopneCelo: '1'
};

function fd(body: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(body)) f.append(k, v);
	return f;
}

function spocitatEvent(body: Record<string, string>) {
	return {
		request: new Request('http://x/bazen', { method: 'POST', body: fd(body) }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
	} as Parameters<typeof bazen.actions.spocitat>[0];
}

type CenyBlok = {
	step: string;
	out?: { kod: string; qty: number }[];
	ceny?: {
		radky: { kod: string; nakupCennik: number | null }[];
		sucty: { nakupCennik: { suma: number; kompletne: boolean } };
		snapshot: unknown;
	};
};

// jeden nenulový BPP profil z reálneho rozpisu — kľúč, ktorý ocielime v snapshote
const { out } = computeBazenAll(parseBazenVstup(fd(BODY)).vstup);
const BPP = out.find((o) => o.kod.startsWith('BPP') && o.qty > 0)!;

describe('bazén Kontrola — náhľad ceny materiálu (#454), bez naimportovaného snapshotu', () => {
	it('spocitat vráti CenyResult (ceny + súčty + snapshot) s riadkami PRESNE pre nenulové položky', async () => {
		const r = (await bazen.actions.spocitat(spocitatEvent(BODY))) as CenyBlok;
		expect(r.step).toBe('kontrola');
		expect(r.ceny).toBeDefined();
		expect(r.ceny!.sucty).toBeDefined();
		expect(r.ceny!.snapshot).toBeDefined();
		// riadky = presne nenulové kódy z rozpisu (to, čo by inak odišlo do Money)
		const nenulove = r
			.out!.filter((o) => o.qty > 0)
			.map((o) => o.kod)
			.sort();
		const cenyKody = r.ceny!.radky.map((c) => c.kod).sort();
		expect(cenyKody).toEqual(nenulove);
	});

	it('bez snapshotu sú všetky ceny „neznáme" (null) a súčet nákupu je honest-neúplný', async () => {
		const r = (await bazen.actions.spocitat(spocitatEvent(BODY))) as CenyBlok;
		expect(r.ceny!.radky.every((c) => c.nakupCennik === null)).toBe(true);
		expect(r.ceny!.sucty.nakupCennik.kompletne).toBe(false);
	});
});

describe('bazén Kontrola — náhľad ceny materiálu (#454), s naimportovaným snapshotom', () => {
	const CENA = 12.5; // VYMYSLENÁ cena
	beforeAll(() => {
		fs.writeFileSync(
			process.env.CENY_SNAPSHOT_PATH!,
			JSON.stringify({
				generatedAt: '2026-09-04T05:30:00.000Z',
				rows: [{ kod: BPP.kod, nakupCennik: CENA, sklad: 999, mena: 'EUR' }]
			})
		);
	});

	it('ocenený BPP profil dostane cenu zo snapshotu; súčet ho zarátal (qty × cena)', async () => {
		const r = (await bazen.actions.spocitat(spocitatEvent(BODY))) as CenyBlok;
		const riadok = r.ceny!.radky.find((c) => c.kod === BPP.kod)!;
		expect(riadok.nakupCennik).toBe(CENA);
		// súčet nákupu ≥ podiel tohto jedného oceneného profilu (ostatné kódy honest-null)
		expect(r.ceny!.sucty.nakupCennik.suma).toBeCloseTo(Math.round(BPP.qty * CENA * 100) / 100, 2);
		// BPK* kusové komponenty (a ostatné neocenené kódy) ostávajú honest-null → súčet neúplný
		expect(r.ceny!.sucty.nakupCennik.kompletne).toBe(false);
	});
});

describe('bazén náhľad ceny — MONEY-SAFETY: spocitat NIČ nezapíše (#454)', () => {
	it('po opakovaných spocitat volaniach: žiadny riadok v odpis_log, žiadny súbor v Money exporte', async () => {
		await bazen.actions.spocitat(spocitatEvent(BODY));
		await bazen.actions.spocitat(spocitatEvent({ ...BODY, zak: 'ZAK-CENY-2' }));
		const pocet = (db.prepare('SELECT COUNT(*) AS c FROM odpis_log').get() as { c: number }).c;
		expect(pocet).toBe(0);
		expect(fs.readdirSync(process.env.MONEY_TEST_DIR!)).toEqual([]);
	});
});
