// #295 — tichá strata položiek chýbajúcich v Money. PRE-export validácia kódov proti dennému
// Money snapshotu (`material_prices`): pre live=1 neznámy kód / kód bez skladovej karty MUSÍ
// zablokovať zápis (import by ho ticho preskočil — Dominik: „keď chýba profil, neodpíše VÔBEC").
// MONEY_LIVE=1, ale MONEY_LIVE_DIR ide do TEMP priečinka — do reálneho /data/dlv-import NIKDY nič.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-valid-kody-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import'); // TEMP, nikdy reálny import dir
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json'); // no-file → seed z DB ostane

const { writeOdpis } = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob, Polozka } from '../src/lib/server/money';

function job(zak: string, op: string, polozky: Polozka[]): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test`,
		polozky,
		detail: {}
	};
}

beforeAll(() => {
	fs.mkdirSync(process.env.MONEY_LIVE_DIR!, { recursive: true });
	// čerstvý Money snapshot: prefix ZASP je pokrytý; ZASP00014 má kartu, ZASP00099 kartu nemá.
	// Neznámy kód ZASP99999 v snapshote VÔBEC nie je → Money by ho preskočil.
	db.prepare(
		"INSERT INTO material_prices (kod, sklad, mena, updated_at) VALUES ('ZASP00014', 5, 'EUR', datetime('now'))"
	).run();
	db.prepare(
		"INSERT INTO material_prices (kod, sklad, mena, updated_at) VALUES ('ZASP00099', NULL, 'EUR', datetime('now'))"
	).run();
	db.prepare(
		"INSERT INTO material_prices_meta (id, snapshot_generated_at, imported_at, row_count) VALUES (1, datetime('now'), datetime('now'), 2)"
	).run();
});

describe('#295 pre-export validácia kódov (live=1)', () => {
	it('[RED] live job s NEZNÁMYM kódom sa NEzapíše (import by celý doklad preskočil)', async () => {
		const w = await writeOdpis(
			job('ZAK-UNK', '01', [{ kod: 'ZASP99999', nazov: 'Neznámy profil', qty: 3 }])
		);
		expect(fs.existsSync(w.target)).toBe(false); // žiadny súbor do Money
	});

	it('[RED] live job so samými ZNÁMYMI kódmi prejde (zapíše sa)', async () => {
		const w = await writeOdpis(
			job('ZAK-OK', '01', [{ kod: 'ZASP00014', nazov: 'Koľajnica', qty: 15 }])
		);
		expect(w.status).toBe('written');
		expect(fs.existsSync(w.target)).toBe(true);
	});

	it('blocked outcome nesie reason unknown-kod + zoznam chýbajúcich kódov', async () => {
		const w = await writeOdpis(
			job('ZAK-UNK2', '01', [{ kod: 'ZASP99999', nazov: 'Neznámy', qty: 3 }])
		);
		expect(w.status).toBe('blocked');
		expect(w.reason).toBe('unknown-kod');
		expect(w.chybajuceKody?.map((p) => p.kod)).toContain('ZASP99999');
		expect(w.chybajuceKody?.[0].dovod).toBe('neznamy');
	});

	it('kód v snapshote ale BEZ skladovej karty (sklad=null) sa tiež blokuje', async () => {
		const w = await writeOdpis(
			job('ZAK-NOSKLAD', '01', [{ kod: 'ZASP00099', nazov: 'Bez karty', qty: 2 }])
		);
		expect(w.status).toBe('blocked');
		expect(w.reason).toBe('unknown-kod');
		expect(w.chybajuceKody?.[0].dovod).toBe('bez-skladovej-karty');
	});

	it('override (overrideKody) pošle napriek neznámemu kódu + zapíše audit', async () => {
		const before = (
			db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as {
				c: number;
			}
		).c;
		const w = await writeOdpis(
			job('ZAK-OVR-KOD', '01', [{ kod: 'ZASP99999', nazov: 'Neznámy', qty: 3 }]),
			{ overrideKody: true }
		);
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
		expect(audit.zmeny).toContain('Override chýbajúcich Money kódov');
		expect(audit.zmeny).toContain('ZASP99999');
	});

	it('kód mimo scope snapshotu (pergola PRP*, prefix nie je v snapshote) sa NEblokuje', async () => {
		// snapshot má len ZASP* → prefix PRP nie je pokrytý → nevalidujeme (inak by pergola padala)
		const w = await writeOdpis(
			job('ZAK-PRP', '01', [{ kod: 'PRP20258', nazov: 'Kotviaci profil', qty: 7.5 }])
		);
		expect(w.status).toBe('written');
	});

	it('ZASTARANÝ snapshot ⇒ degrade na warning, NEblokuje (validácia nedostupná)', async () => {
		// posuň snapshot > 7 dní do minulosti → snapshotUsable=false → neznámy kód NEblokuje
		db.prepare(
			"UPDATE material_prices_meta SET snapshot_generated_at = datetime('now', '-30 days') WHERE id = 1"
		).run();
		const w = await writeOdpis(
			job('ZAK-STALE', '01', [{ kod: 'ZASP99999', nazov: 'Neznámy', qty: 3 }])
		);
		expect(w.status).toBe('written');
	});
});
