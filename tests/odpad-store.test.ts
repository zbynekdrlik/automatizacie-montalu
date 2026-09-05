// #417 fáza 2: unit testy pre odpad-store (saveOdpisOdpad, getOdpadForOdpisy).
// DB izolácia automatická (setup/db-isolation.ts).
import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { saveOdpisOdpad, getOdpadForOdpisy } from '../src/lib/server/odpad-store';
import { normZak, normOp } from '../src/lib/server/money';

// Helper: vlož odpis_log riadok a vráť jeho id
function insertOdpisLog(zak: string, op: string): number {
	const r = db
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, zak_norm, op_norm, live, target, filename, content_hash, detail, created_by)
			 VALUES ('zasklenia', ?, ?, 'Test', ?, ?, 1, '', '', '', '{}', 'test')`
		)
		.run(zak, op, normZak(zak), normOp(op));
	return Number(r.lastInsertRowid);
}

describe('saveOdpisOdpad', () => {
	it('uloží per-profil odpad pre existujúci odpis_log', () => {
		const logId = insertOdpisLog('ZAK2026999', 'OP260999');
		const material = [
			{ kod: 'ZASP001', nazov: 'Rámový profil', odpadMm: 500, tyce: 2, barLen: 7500 },
			{ kod: 'ZASP002', nazov: 'Nosový profil', odpadMm: 200, tyce: 1, barLen: 7500 }
		];
		saveOdpisOdpad('ZAK2026999', 'OP260999', material);
		const rows = db
			.prepare(
				'SELECT profil_kod, odpad_mm, material_mm, tyce FROM odpis_odpad WHERE odpis_log_id = ?'
			)
			.all(logId) as { profil_kod: string; odpad_mm: number; material_mm: number; tyce: number }[];
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ profil_kod: 'ZASP001', odpad_mm: 500, material_mm: 15000, tyce: 2 });
		expect(rows[1]).toEqual({ profil_kod: 'ZASP002', odpad_mm: 200, material_mm: 7500, tyce: 1 });
	});

	it('vynechá profily s tyce=0 (nepoužité)', () => {
		insertOdpisLog('ZAK2026998', 'OP260998');
		const material = [
			{ kod: 'ZASP001', nazov: 'Rámový', odpadMm: 500, tyce: 2, barLen: 7500 },
			{ kod: 'ZASP003', nazov: 'Nepoužitý', odpadMm: 0, tyce: 0, barLen: 7500 }
		];
		saveOdpisOdpad('ZAK2026998', 'OP260998', material);
		const rows = db
			.prepare(
				"SELECT profil_kod FROM odpis_odpad WHERE odpis_log_id = (SELECT id FROM odpis_log WHERE zak_norm = 'ZAK2026998' ORDER BY id DESC LIMIT 1)"
			)
			.all() as { profil_kod: string }[];
		expect(rows).toHaveLength(1);
		expect(rows[0]!.profil_kod).toBe('ZASP001');
	});

	it('vynechá NaN/nekonečný barLen (obrana)', () => {
		insertOdpisLog('ZAK2026997', 'OP260997');
		const material = [
			{ kod: 'ZASP001', nazov: 'OK', odpadMm: 500, tyce: 2, barLen: 7500 },
			{ kod: 'ZASP002', nazov: 'NaN', odpadMm: NaN, tyce: 1, barLen: 7500 },
			{ kod: 'ZASP003', nazov: 'Inf', odpadMm: 100, tyce: 1, barLen: Infinity }
		];
		saveOdpisOdpad('ZAK2026997', 'OP260997', material);
		const rows = db
			.prepare(
				"SELECT profil_kod FROM odpis_odpad WHERE odpis_log_id = (SELECT id FROM odpis_log WHERE zak_norm = 'ZAK2026997' ORDER BY id DESC LIMIT 1)"
			)
			.all() as { profil_kod: string }[];
		expect(rows).toHaveLength(1);
		expect(rows[0]!.profil_kod).toBe('ZASP001');
	});

	it('replace semantika — druhý zápis nahradí predchádzajúci', () => {
		insertOdpisLog('ZAK2026996', 'OP260996');
		saveOdpisOdpad('ZAK2026996', 'OP260996', [
			{ kod: 'ZASP001', nazov: 'Starý', odpadMm: 100, tyce: 1, barLen: 7500 }
		]);
		saveOdpisOdpad('ZAK2026996', 'OP260996', [
			{ kod: 'ZASP002', nazov: 'Nový', odpadMm: 200, tyce: 2, barLen: 7500 }
		]);
		const rows = db
			.prepare(
				"SELECT profil_kod FROM odpis_odpad WHERE odpis_log_id = (SELECT id FROM odpis_log WHERE zak_norm = 'ZAK2026996' ORDER BY id DESC LIMIT 1)"
			)
			.all() as { profil_kod: string }[];
		expect(rows).toHaveLength(1);
		expect(rows[0]!.profil_kod).toBe('ZASP002');
	});
});

describe('getOdpadForOdpisy', () => {
	it('agreguje per-profil odpad naprieč viacerými odpisy (GROUP BY profil_kod)', () => {
		const id1 = insertOdpisLog('ZAK2026990', 'OP260990');
		const id2 = insertOdpisLog('ZAK2026990', 'OP260991');
		db.prepare(
			'INSERT INTO odpis_odpad (odpis_log_id, profil_kod, profil_nazov, odpad_mm, material_mm, tyce) VALUES (?, ?, ?, ?, ?, ?)'
		).run(id1, 'ZASP001', 'Rámový', 500, 15000, 2);
		db.prepare(
			'INSERT INTO odpis_odpad (odpis_log_id, profil_kod, profil_nazov, odpad_mm, material_mm, tyce) VALUES (?, ?, ?, ?, ?, ?)'
		).run(id2, 'ZASP001', 'Rámový profil', 300, 7500, 1);
		db.prepare(
			'INSERT INTO odpis_odpad (odpis_log_id, profil_kod, profil_nazov, odpad_mm, material_mm, tyce) VALUES (?, ?, ?, ?, ?, ?)'
		).run(id2, 'ZASP002', 'Nosový', 200, 7500, 1);

		const result = getOdpadForOdpisy([id1, id2]);
		expect(result).toHaveLength(2);
		// ZASP001: 500+300=800mm waste, 15000+7500=22500mm material, 2+1=3 bars
		expect(result[0]).toEqual({
			profilKod: 'ZASP001',
			profilNazov: 'Rámový profil', // latest name
			odpadMm: 800,
			materialMm: 22500,
			tyce: 3
		});
		// ZASP002: 200mm waste, 7500mm material
		expect(result[1]).toEqual({
			profilKod: 'ZASP002',
			profilNazov: 'Nosový',
			odpadMm: 200,
			materialMm: 7500,
			tyce: 1
		});
	});

	it('prázdny vstup vráti prázdne pole', () => {
		expect(getOdpadForOdpisy([])).toEqual([]);
	});

	it('odpisy bez odpadových dát vrátia prázdne pole', () => {
		const id = insertOdpisLog('ZAK2026985', 'OP260985');
		expect(getOdpadForOdpisy([id])).toEqual([]);
	});
});
