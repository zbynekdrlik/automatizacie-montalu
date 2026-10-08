// #608 review 🔴 — REPLAY potvrdenia po „Uvoľniť". Token potvrdenia nesmie byť stavová hodnota, ktorú
// „Uvoľniť" vráti späť (MAX(poradie) sa po uvoľnení dorobenia vráti na 1 → starý formulár „Odoslať ako
// dorobenie" — refresh/späť na výsledku — by znova prešiel a Money by dostal identický doklad ešte raz).
// Rovnaká trieda chyby platí pre #300 „Odoslať aj tak" (ledger override). Token = stav APPEND-ONLY
// ledgeru `odpis_imported` (každý reálny zápis ho posunie, „Uvoľniť" ho nevráti).
// Testy idú cestou FORMULÁRA (rawFormEntries → overrideOpts), presne ako tlačidlo v OdpisBlok — nezávisle
// od názvu poľa tokenu. MONEY_LIVE=1, všetky adresáre TEMP.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-replay-608-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import');
process.env.MONEY_NA_ODPIS_DIR = path.join(tmpRoot, 'dlv-import', 'NA ODPIS');
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'test-export');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json');

const { writeOdpis, overrideOpts, rawFormEntries, releaseOdpis, blokHlaska } =
	await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob, OdpisOutcome } from '../src/lib/server/money';

const LIVE_DIR = process.env.MONEY_LIVE_DIR!;

function job(zak: string): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op: 'OP261399',
		zakaznik: 'Javorský',
		caka: false,
		createdBy: 'patrik',
		cakaSubdir: 'Robust',
		popis: 'OP261399 : Javorský',
		polozky: [{ kod: 'ZASP00014', nazov: 'Koľajnica 2K', qty: 15 }],
		detail: {}
	};
}
/** Re-submit formulár presne ako OdpisBlok: polia bloku + skryté `override=<reason>`. */
function potvrdenie(b: OdpisOutcome): FormData {
	const base = new FormData();
	base.append('zak', 'x');
	const fd = new FormData();
	for (const [k, v] of rawFormEntries(base, b)) fd.append(k, v);
	fd.append('override', b.reason!);
	return fd;
}
const riadky = (zak: string) =>
	db.prepare('SELECT id, poradie FROM odpis_log WHERE zak = ? ORDER BY id').all(zak) as {
		id: number;
		poradie: number;
	}[];
const ledger = (zak: string) =>
	(
		db.prepare('SELECT kind FROM odpis_imported WHERE zak_norm = ? ORDER BY id').all(zak) as {
			kind: string;
		}[]
	).map((r) => r.kind);
const subory = () => fs.readdirSync(LIVE_DIR).filter((f) => f.endsWith('.xlsx')).length;
const auditCount = () =>
	(db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as { c: number })
		.c;

beforeAll(() => {
	fs.mkdirSync(LIVE_DIR, { recursive: true });
});

describe('#608 replay potvrdenia po „Uvoľniť" je zablokovaný', () => {
	it('[RED] „Odoslať ako dorobenie" → Uvoľniť dorobenie → replay toho istého formulára = znova blok', async () => {
		const zak = 'ZAK2026960';
		expect((await writeOdpis(job(zak))).status).toBe('written');
		const b = await writeOdpis(job(zak));
		expect(b.reason).toBe('uz-odpisane');
		const fd = potvrdenie(b);
		const d = await writeOdpis(job(zak), overrideOpts(fd));
		expect(d.status).toBe('written');
		expect(d.poradie).toBe(2);
		// operátor dorobenie vymaže v Money a uvoľní ho v histórii …
		expect(releaseOdpis(riadky(zak)[1]!.id, 'patrik')).toBe(true);
		const pred = subory();
		// … a potom obnoví starý výsledok (prehliadač znova pošle ten istý POST s potvrdením)
		const replay = await writeOdpis(job(zak), overrideOpts(fd));
		expect(replay.status).toBe('blocked');
		expect(replay.reason).toBe('uz-odpisane');
		expect(riadky(zak).map((r) => r.poradie)).toEqual([1]);
		expect(subory()).toBe(pred);
	});

	it('[RED] #300 „Odoslať aj tak" → Uvoľniť → replay toho istého formulára = znova ledger blok', async () => {
		const zak = 'ZAK2026961';
		const w1 = await writeOdpis(job(zak));
		expect(w1.status).toBe('written');
		fs.rmSync(w1.target); // Money spracoval
		expect(releaseOdpis(riadky(zak)[0]!.id, 'patrik')).toBe(true);
		const b = await writeOdpis(job(zak));
		expect(b.reason).toBe('ledger-duplicate');
		const fd = potvrdenie(b);
		const ok = await writeOdpis(job(zak), overrideOpts(fd));
		expect(ok.status).toBe('written');
		fs.rmSync(ok.target);
		expect(releaseOdpis(riadky(zak)[0]!.id, 'patrik')).toBe(true);
		const pred = subory();
		const replay = await writeOdpis(job(zak), overrideOpts(fd));
		expect(replay.status).toBe('blocked');
		expect(replay.reason).toBe('ledger-duplicate');
		expect(riadky(zak)).toEqual([]);
		expect(subory()).toBe(pred);
		// one-shot ostáva: 2 importy, 1 override
		expect(ledger(zak)).toEqual(['import', 'override', 'import']);
	});

	it('[RED] zlyhaný zápis dorobenia nenechá v ledgeri override; retry s tým istým potvrdením prejde', async () => {
		const zak = 'ZAK2026962';
		expect((await writeOdpis(job(zak))).status).toBe('written');
		const b = await writeOdpis(job(zak));
		const fd = potvrdenie(b);
		const auditPred = auditCount();
		const blockFile = path.join(tmpRoot, 'blockfile');
		fs.writeFileSync(blockFile, 'x');
		process.env.MONEY_LIVE_DIR = path.join(blockFile, 'sub');
		try {
			await expect(writeOdpis(job(zak), overrideOpts(fd))).rejects.toThrow();
		} finally {
			process.env.MONEY_LIVE_DIR = LIVE_DIR;
		}
		// kompenzácia: žiadny riadok dorobenia, žiadny osirelý override (inak by neskôr po „Uvoľniť"
		// pustil identický obsah BEZ potvrdenia)
		expect(riadky(zak).map((r) => r.poradie)).toEqual([1]);
		expect(ledger(zak)).toEqual(['import']);
		// ani audit netvrdí odoslanie dorobenia, ktoré sa nevykonalo
		expect(auditCount()).toBe(auditPred);
		// zápis sa nikdy nevykonal → to isté potvrdenie stále platí
		const retry = await writeOdpis(job(zak), overrideOpts(fd));
		expect(retry.status).toBe('written');
		expect(retry.poradie).toBe(2);
		expect(auditCount()).toBe(auditPred + 1);
	});

	it('[RED] ledger blok nesie token a re-submit ho prevlečie (Odoslať aj tak cez formulár)', async () => {
		const zak = 'ZAK2026963';
		const w1 = await writeOdpis(job(zak));
		fs.rmSync(w1.target);
		expect(releaseOdpis(riadky(zak)[0]!.id, 'patrik')).toBe(true);
		const b = await writeOdpis(job(zak));
		expect(b.reason).toBe('ledger-duplicate');
		expect(b.potvrdenieToken).toBeGreaterThan(0);
		// bez tokenu (len override pole) sa ledger neprekoná
		const holy = new FormData();
		holy.append('override', 'ledger-duplicate');
		expect((await writeOdpis(job(zak), overrideOpts(holy))).reason).toBe('ledger-duplicate');
	});

	it('legacy riadok spred v27 (RAW op_norm): blok ho nájde a token nesie JEHO ledger stav', async () => {
		// v27 skopíroval do zak_norm/op_norm RAW hodnoty — '01' namiesto normOp 'OP01'
		const odpis = db
			.prepare(
				`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm, poradie)
				 VALUES ('zasklenia', 'ZAK-LEG608', '01', 'Starý', 0, 1, '/t/f.xlsx', 'f.xlsx', 'abc', '{}', 'patrik', 'ZAK-LEG608', '01', 1)`
			)
			.run().lastInsertRowid;
		const led = db
			.prepare(
				`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor)
				 VALUES ('zasklenia', 'ZAK-LEG608', '01', 1, 'abc', 'import', 'f.xlsx', 'patrik')`
			)
			.run().lastInsertRowid;
		expect(odpis).toBeGreaterThan(0);
		const legJob = { ...job('ZAK-LEG608'), op: '01' };
		const b = await writeOdpis(legJob);
		expect(b.reason).toBe('uz-odpisane');
		// token = stav ledgeru legacy riadku (RAW kľúč), nie 0 → potvrdenie platí len pre tento stav
		expect(b.potvrdenieToken).toBe(Number(led));
		const d = await writeOdpis(legJob, {
			overrideDorobenie: true,
			potvrdenieToken: b.potvrdenieToken
		});
		expect(d.status).toBe('written');
		expect(d.poradie).toBe(2);
	});

	it('[RED] hláška dorobenia pri identickom obsahu prizná, že pôjde aj rovnaký doklad ešte raz', async () => {
		const zak = 'ZAK2026964';
		expect((await writeOdpis(job(zak))).status).toBe('written');
		const b = await writeOdpis(job(zak));
		expect(b.identickyObsah).toBe(true);
		expect(blokHlaska(b, zak, 'OP261399')).toContain('ROVNAKÝ obsah');
		// iný obsah → bez tej vety
		const iny = job(zak);
		iny.polozky = [{ kod: 'ZASP00014', nazov: 'Koľajnica 2K', qty: 3 }];
		const b2 = await writeOdpis(iny);
		expect(b2.reason).toBe('uz-odpisane');
		expect(b2.identickyObsah).toBe(false);
		expect(blokHlaska(b2, zak, 'OP261399')).not.toContain('ROVNAKÝ obsah');
	});
});
