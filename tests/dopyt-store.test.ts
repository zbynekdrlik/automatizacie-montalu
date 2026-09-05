// #277 — uloženie dopytu na čerstvo migrovanej (izolovanej) test DB. Overuje verziu 25,
// existenciu tabuľky `dopyt`, insert/read roundtrip a Money-neutralitu (odpis_log nedotknutý).
import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { insertDopyt, getDopyt, countDopyty } from '../src/lib/server/dopyt-store';

describe('dopyt store (migrácia v25)', () => {
	it('DB je na verzii 25 a tabuľka dopyt existuje', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(39);
		const t = db
			.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dopyt'")
			.get();
		expect(t).toEqual({ name: 'dopyt' });
	});

	it('insert + get roundtrip zachová všetky polia', () => {
		const id = insertDopyt({
			konfiguracia: JSON.stringify({ system: 'Robust', sirka: 3000 }),
			meno: 'Ján Novák',
			email: 'jan@example.com',
			telefon: '+421 900 111 222',
			miesto: 'Bratislava',
			poznamka: 'ozvite sa poobede'
		});
		expect(id).toBeGreaterThan(0);
		const row = getDopyt(id);
		expect(row).toMatchObject({
			id,
			meno: 'Ján Novák',
			email: 'jan@example.com',
			telefon: '+421 900 111 222',
			miesto: 'Bratislava',
			poznamka: 'ozvite sa poobede'
		});
		expect(JSON.parse(row!.konfiguracia)).toEqual({ system: 'Robust', sirka: 3000 });
		expect(row!.created_at).toMatch(/\d{4}-\d{2}-\d{2}/);
	});

	it('countDopyty rastie s insertmi', () => {
		const before = countDopyty();
		insertDopyt({
			konfiguracia: '{}',
			meno: 'A',
			email: 'a@b.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		expect(countDopyty()).toBe(before + 1);
	});

	it('getDopyt neexistujúceho id → undefined', () => {
		expect(getDopyt(999999)).toBeUndefined();
	});

	it('tabuľka dopyt NEMÁ žiadny vzťah k odpis_log (Money-neutralita)', () => {
		// dopyt insert nesmie zapísať do odpis_log
		const odpisBefore = (db.prepare('SELECT COUNT(*) c FROM odpis_log').get() as { c: number }).c;
		insertDopyt({
			konfiguracia: '{}',
			meno: 'X',
			email: 'x@y.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		const odpisAfter = (db.prepare('SELECT COUNT(*) c FROM odpis_log').get() as { c: number }).c;
		expect(odpisAfter).toBe(odpisBefore);
	});
});
