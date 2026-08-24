// #298 — DLV readback snapshot READER (`maybeImportDlvReadback`). 1:1 disciplína ako `ceny.ts`:
// LAZY mtime-gated import zo súborového snapshotu (externý producer + rsync), zlý riadok sa
// preskočí (nezhodí import), zak/op sa normalizujú. Externá služba (Money) = mockovaná súborom;
// interná logika beží reálne.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-readback-reader-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapPath = path.join(tmpRoot, 'dlv-readback.json');
process.env.DLV_READBACK_PATH = snapPath;

const { db } = await import('../src/lib/server/db');
const { maybeImportDlvReadback, getDlvReadbackMeta, dlvReadbackPath } =
	await import('../src/lib/server/money-readback');

function writeSnap(obj: unknown): void {
	fs.writeFileSync(snapPath, JSON.stringify(obj));
}

beforeEach(() => {
	db.prepare('DELETE FROM money_dlv').run();
	db.prepare('DELETE FROM money_dlv_meta').run();
	if (fs.existsSync(snapPath)) fs.rmSync(snapPath);
	process.env.DLV_READBACK_PATH = snapPath;
});

describe('#298 DLV readback reader', () => {
	it('dlvReadbackPath vráti nastavenú cestu', () => {
		expect(dlvReadbackPath()).toBe(snapPath);
	});

	it('chýbajúci súbor ⇒ no-file, meta ostáva prázdna', () => {
		const r = maybeImportDlvReadback();
		expect(r).toMatchObject({ imported: false, reason: 'no-file' });
		expect(getDlvReadbackMeta().generatedAt).toBeNull();
	});

	it('platný snapshot sa naimportuje; zlé riadky sa preskočia (nezhodia import)', () => {
		writeSnap({
			generatedAt: '2026-08-24T05:30:00Z',
			rows: [
				{
					dlv: 'DLV20251360',
					zak: 'ZAK2026273',
					op: 'OP260233',
					datum: '2026-07-30T08:59:25',
					pocetPolozek: 8
				},
				{ dlv: 'DLV20251361', zak: 'ZAK2026273', op: '260233', pocetPolozek: 6 }, // op bez prefixu → normOp
				{ dlv: '', zak: 'ZAKX', pocetPolozek: 1 }, // chýba dlv → zamietnutý
				{ dlv: 'DLVBAD', zak: '', pocetPolozek: 1 }, // chýba zak → zamietnutý
				{ dlv: 'DLVNEG', zak: 'ZAKY', pocetPolozek: -3 }, // záporný pocet → zamietnutý
				{ dlv: 'DLVNAN', zak: 'ZAKZ', pocetPolozek: 'x' }, // neplatný pocet → zamietnutý
				'nie objekt' // → zamietnutý
			]
		});
		const r = maybeImportDlvReadback();
		expect(r.imported).toBe(true);
		expect(r.rowCount).toBe(2);
		expect(r.rejectedCount).toBe(5);
		const rows = db
			.prepare('SELECT dlv, zak_norm, op_norm, pocet_polozek FROM money_dlv ORDER BY dlv')
			.all() as { dlv: string; zak_norm: string; op_norm: string; pocet_polozek: number }[];
		expect(rows).toEqual([
			{ dlv: 'DLV20251360', zak_norm: 'ZAK2026273', op_norm: 'OP260233', pocet_polozek: 8 },
			// op '260233' sa normalizuje na 'OP260233' rovnako ako v money.ts
			{ dlv: 'DLV20251361', zak_norm: 'ZAK2026273', op_norm: 'OP260233', pocet_polozek: 6 }
		]);
	});

	it('meta nesie generatedAt + daysOld', () => {
		writeSnap({
			generatedAt: '2026-08-24T05:30:00Z',
			rows: [{ dlv: 'D1', zak: 'Z1', pocetPolozek: 1 }]
		});
		maybeImportDlvReadback();
		const meta = getDlvReadbackMeta();
		expect(meta.generatedAt).toBe('2026-08-24T05:30:00Z');
		expect(meta.rowCount).toBe(1);
		expect(meta.daysOld).not.toBeNull();
		expect(meta.daysOld).toBeGreaterThanOrEqual(0);
	});

	it('rovnaký súbor druhýkrát ⇒ not-newer (mtime gate, žiadny re-import)', () => {
		writeSnap({
			generatedAt: '2026-08-24T05:30:00Z',
			rows: [{ dlv: 'D1', zak: 'Z1', pocetPolozek: 1 }]
		});
		expect(maybeImportDlvReadback().reason).toBe('ok');
		expect(maybeImportDlvReadback().reason).toBe('not-newer');
	});

	it('nový snapshot NAHRADÍ starý (DLV window rotuje, staré doklady zmiznú)', () => {
		writeSnap({
			generatedAt: '2026-08-23T05:30:00Z',
			rows: [{ dlv: 'DOLD', zak: 'Z1', pocetPolozek: 1 }]
		});
		maybeImportDlvReadback();
		// nový súbor (iný mtime) s iným obsahom
		fs.writeFileSync(
			snapPath,
			JSON.stringify({
				generatedAt: '2026-08-24T05:30:00Z',
				rows: [{ dlv: 'DNEW', zak: 'Z2', pocetPolozek: 2 }]
			})
		);
		const now = Date.now() / 1000 + 5;
		fs.utimesSync(snapPath, now, now); // posunúť mtime, nech gate prepustí
		maybeImportDlvReadback();
		const dlvs = (db.prepare('SELECT dlv FROM money_dlv').all() as { dlv: string }[]).map(
			(r) => r.dlv
		);
		expect(dlvs).toEqual(['DNEW']); // DOLD je preč (autoritatívny snapshot)
	});

	it('nevalidný JSON ⇒ parse-error (nezhodí, len sa nenaimportuje)', () => {
		fs.writeFileSync(snapPath, '{toto nie je json');
		expect(maybeImportDlvReadback().reason).toBe('parse-error');
	});

	it('rows nie je pole ⇒ prázdny import (0 riadkov), nezhodí', () => {
		writeSnap({ generatedAt: '2026-08-24T05:30:00Z', rows: 'nie pole' });
		const r = maybeImportDlvReadback();
		expect(r).toMatchObject({ imported: true, rowCount: 0 });
	});
});
