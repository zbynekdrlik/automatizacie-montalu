// #307 — app-side hardening: prehodené polia zak/op (zak obsahuje OP…, op obsahuje ZAK… — živý tvar
// ZAK2026499, odpis_log id 38/78). `detekujPrehodenePolia` doteraz iba `log.warn`-lo a odpis odišiel
// do Money. Pre live=1 to MUSÍ tvrdo BLOKOVAŤ (rovnaká audited-override sémantika ako #295), test/
// live=0 ostáva WARN-only. MONEY_LIVE=1, ale MONEY_LIVE_DIR + MONEY_TEST_DIR idú do TEMP — do
// reálneho /data/dlv-import NIKDY nič. Snapshot je NEDOSTUPNÝ (CENY_SNAPSHOT_PATH neexistuje, žiadny
// meta riadok) → #295 sa nespustí, takže testuje ČISTO prehodene-polia blok.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-prehodene-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import'); // TEMP, nikdy reálny import dir
process.env.MONEY_NA_ODPIS_DIR = path.join(tmpRoot, 'dlv-import', 'NA ODPIS'); // TEMP — nikdy reálny staging
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'test-export'); // TEMP — live=0 vetva
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json'); // no snapshot → #295 sa nespustí

const { writeOdpis } = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob, Polozka } from '../src/lib/server/money';

function job(zak: string, op: string, polozky?: Polozka[]): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test`,
		polozky: polozky ?? [{ kod: 'ZASP00014', nazov: 'Koľajnica', qty: 15 }],
		detail: {}
	};
}

beforeAll(() => {
	fs.mkdirSync(process.env.MONEY_LIVE_DIR!, { recursive: true });
	fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
});

describe('#307 prehodené polia zak/op — live blokuje, test warn-only', () => {
	it('[RED] live=1 s ZAK číslom v poli op-slot (op="ZAK…") sa NEzapíše (blok)', async () => {
		const w = await writeOdpis(job('ZAK2026500', 'ZAK2026499'));
		expect(w.status).toBe('blocked');
		expect(fs.existsSync(w.target)).toBe(false); // žiadny súbor do Money
	});

	it('[RED] live=1 s OP číslom v poli zak-slot (zak="OP…") sa NEzapíše (blok)', async () => {
		const w = await writeOdpis(job('OP260286', '01'));
		expect(w.status).toBe('blocked');
		expect(fs.existsSync(w.target)).toBe(false);
	});

	it('[RED] blocked outcome nesie reason prehodene-polia', async () => {
		const w = await writeOdpis(job('ZAK2026600', 'ZAK2026601'));
		expect(w.status).toBe('blocked');
		expect(w.reason).toBe('prehodene-polia');
	});

	it('[RED] override (overridePrehodene) pošle napriek prehodeným poliam + zapíše audit', async () => {
		const before = (
			db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as {
				c: number;
			}
		).c;
		const w = await writeOdpis(job('ZAK2026700', 'ZAK2026701'), { overridePrehodene: true });
		expect(w.status).toBe('written');
		expect(fs.existsSync(w.target)).toBe(true);
		const after = (
			db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as {
				c: number;
			}
		).c;
		expect(after).toBe(before + 1); // override je auditovaný, nie tichý
		const audit = db
			.prepare("SELECT zmeny FROM cfg_audit WHERE sys_styl = 'odpis' ORDER BY id DESC LIMIT 1")
			.get() as { zmeny: string };
		expect(audit.zmeny).toContain('Override prehodených polí');
	});

	it('normálne polia (zak="ZAK…", op="OP…") sa NEblokujú (žiadny falošný poplach)', async () => {
		const w = await writeOdpis(job('ZAK2026800', 'OP260900'));
		expect(w.status).toBe('written');
		expect(fs.existsSync(w.target)).toBe(true);
	});

	it('test/live=0 s prehodenými poliami ostáva WARN-only (zapíše sa do test exportu)', async () => {
		process.env.MONEY_LIVE = '0';
		try {
			const w = await writeOdpis(job('ZAK2026900', 'ZAK2026901'));
			expect(w.status).toBe('written'); // do Money nič testovacie nejde, ale súbor do test exportu vznikne
			expect(fs.existsSync(w.target)).toBe(true);
			expect(w.target.startsWith(process.env.MONEY_TEST_DIR!)).toBe(true);
		} finally {
			process.env.MONEY_LIVE = '1';
		}
	});
});

afterAll(() => {
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});
