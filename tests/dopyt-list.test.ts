// #282 — interný zoznam dopytov: paging (`listDopyty`), feature-detect stĺpca odoo_lead_id
// (#278/v26) a `sqliteUtcToIso` (UTC pasca #114). Zdieľaná test DB (v26), per-test čistá (DELETE).
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { insertDopyt, listDopyty, hasOdooLeadColumn } from '../src/lib/server/dopyt-store';
import { formatDatumIsoSk, sqliteUtcToIso } from '../src/lib/datum';

/** Vloží N dopytov s rozlíšiteľným menom „Meno i" (id 1..N v poradí vloženia). */
function seed(n: number): void {
	for (let i = 1; i <= n; i++) {
		insertDopyt({
			konfiguracia: JSON.stringify({ system: `S${i}`, sirka: 1000 + i }),
			meno: `Meno ${i}`,
			email: `m${i}@x.sk`,
			telefon: '',
			miesto: '',
			poznamka: ''
		});
	}
}

describe('listDopyty paging (#282)', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('na v26 DB stĺpec odoo_lead_id EXISTUJE (feature-detect true); hasOdoo=false ho defenzívne vynechá', () => {
		// #278 (v26) stĺpec už pridal → detekcia true; defenzívna vetva listDopyty (hasOdoo=false)
		// SELECT bez odoo stĺpca → kľúč na riadku CHÝBA (nezávislé od toho, či #278 landol).
		expect(hasOdooLeadColumn()).toBe(true);
		seed(1);
		expect('odoo_lead_id' in listDopyty(0, 50, false)[0]!).toBe(false);
	});

	it('vráti dopyty NAJNOVŠIE HORE (id DESC)', () => {
		seed(3);
		const rows = listDopyty(0, 50);
		expect(rows.map((r) => r.meno)).toEqual(['Meno 3', 'Meno 2', 'Meno 1']);
		// na v26 (odoo_lead_id existuje) default SELECT stĺpec zahrnie → kľúč je na riadku (NULL)
		expect('odoo_lead_id' in rows[0]!).toBe(true);
		expect(rows[0]!.odoo_lead_id).toBeNull();
	});

	it('stránkuje cez offset/limit (okná sa neprekrývajú)', () => {
		seed(5);
		expect(listDopyty(0, 2).map((r) => r.meno)).toEqual(['Meno 5', 'Meno 4']);
		expect(listDopyty(2, 2).map((r) => r.meno)).toEqual(['Meno 3', 'Meno 2']);
		expect(listDopyty(4, 2).map((r) => r.meno)).toEqual(['Meno 1']);
	});

	it('clampuje nezmyselný offset/limit (záporný offset → 0, limit < 1 → 1)', () => {
		seed(3);
		const rows = listDopyty(-5, 0);
		expect(rows.map((r) => r.meno)).toEqual(['Meno 3']); // limit clampnutý na 1, najnovší
	});

	it('prázdna DB → prázdny zoznam', () => {
		expect(listDopyty(0, 50)).toEqual([]);
	});
});

describe('listDopyty — odoo_lead_id feature-detect (#282 / #278 v26)', () => {
	// #278 (v26) už stĺpec pridal — listDopyty ho deteguje a nesie hodnotu leadu na riadku.
	it('stĺpec sa deteguje a hodnota odoo_lead_id sa nesie na riadku', () => {
		db.exec('DELETE FROM dopyt');
		expect(hasOdooLeadColumn()).toBe(true);

		const id = insertDopyt({
			konfiguracia: '{}',
			meno: 'Lead',
			email: 'l@x.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		db.prepare('UPDATE dopyt SET odoo_lead_id = ? WHERE id = ?').run(42, id);

		const rows = listDopyty(0, 50);
		expect(rows[0]).toMatchObject({ meno: 'Lead', odoo_lead_id: 42 });
	});
});

describe('sqliteUtcToIso — UTC pasca #114 (#282)', () => {
	it('SQLite „YYYY-MM-DD HH:MM:SS" (UTC, bez zóny) → UTC ISO ...T...Z', () => {
		expect(sqliteUtcToIso('2026-08-23 12:34:56')).toBe('2026-08-23T12:34:56Z');
	});
	it('vstup, ktorý už nie je SQLite tvar, vráti nezmenený (most, nie parser)', () => {
		expect(sqliteUtcToIso('2026-08-23T12:34:56.000Z')).toBe('2026-08-23T12:34:56.000Z');
	});

	it('formatDatumIsoSk dáva YYYY-MM-DD v Europe/Bratislava (kalendárny deň, nie UTC slice)', () => {
		// poludnie UTC → ten istý deň v Bratislave
		expect(formatDatumIsoSk('2026-08-23T12:00:00Z')).toBe('2026-08-23');
		// 23:00 UTC v lete (UTC+2) → už ďalší kalendárny deň v Bratislave (UTC slice by dal 08-23)
		expect(formatDatumIsoSk('2026-08-23T23:00:00Z')).toBe('2026-08-24');
	});
});
