// #282 — load /dopyty-konfigurator: stránkovanie 50/stránku + počet celkom + clamp neplatnej
// `?page=` + tvar riadku (datum, súhrn). Volá `load` priamo s fake eventom (len `url` sa číta).
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { insertDopyt } from '../src/lib/server/dopyt-store';
import { load } from '../src/routes/dopyty-konfigurator/+page.server';

type LoadEvent = Parameters<typeof load>[0];
function ev(query = ''): LoadEvent {
	return { url: new URL(`http://localhost/dopyty-konfigurator${query}`) } as unknown as LoadEvent;
}

function seed(n: number): void {
	for (let i = 1; i <= n; i++) {
		insertDopyt({
			konfiguracia: JSON.stringify({ system: `S${i}`, sirka: 3000, hlbka: 4000 }),
			meno: `Meno ${i}`,
			email: `m${i}@x.sk`,
			telefon: '',
			miesto: 'Trnava',
			poznamka: ''
		});
	}
}

describe('load /dopyty-konfigurator (#282)', () => {
	beforeEach(() => db.exec('DELETE FROM dopyt'));

	it('prázdna DB → total 0, page 1, pageCount 1, žiadne dopyty', async () => {
		const d = await load(ev());
		expect(d).toMatchObject({ total: 0, page: 1, pageCount: 1, perPage: 50, hasOdooLead: false });
		expect(d.dopyty).toEqual([]);
	});

	it('stránkuje po 50 (51 dopytov → 2 stránky)', async () => {
		seed(51);
		const p1 = await load(ev());
		expect(p1).toMatchObject({ total: 51, page: 1, pageCount: 2 });
		expect(p1.dopyty.length).toBe(50);
		// najnovší hore
		expect(p1.dopyty[0]!.meno).toBe('Meno 51');

		const p2 = await load(ev('?page=2'));
		expect(p2.page).toBe(2);
		expect(p2.dopyty.length).toBe(1);
		expect(p2.dopyty[0]!.meno).toBe('Meno 1');
	});

	it('clampuje neplatnú/mimo-rozsah ?page (99, 0, NaN → do [1, pageCount])', async () => {
		seed(3);
		expect((await load(ev('?page=99'))).page).toBe(1); // pageCount je 1
		expect((await load(ev('?page=0'))).page).toBe(1);
		expect((await load(ev('?page=abc'))).page).toBe(1);
	});

	it('riadok nesie datum (naformátovaný), súhrn a kontaktné údaje', async () => {
		seed(1);
		const d = await load(ev());
		const row = d.dopyty[0]!;
		expect(row.meno).toBe('Meno 1');
		expect(row.miesto).toBe('Trnava');
		expect(row.datum).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/);
		// súhrn obsahuje rozmery (znovupoužitý zhrnutieRiadky)
		expect(row.suhrn.some((r) => r.value.includes('3000 × 4000 mm'))).toBe(true);
		expect(row.odooLeadId).toBeNull();
	});
});
