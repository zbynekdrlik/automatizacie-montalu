// #282 — load /dopyty-konfigurator: stránkovanie 50/stránku + počet celkom + clamp neplatnej
// `?page=` + tvar riadku (datum, súhrn) + interný-only guard. Volá `load` priamo s fake eventom.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { insertDopyt } from '../src/lib/server/dopyt-store';
import { load } from '../src/routes/dopyty-konfigurator/+page.server';

type LoadEvent = Parameters<typeof load>[0];
// `error()` guard robí návratový typ `void | PageData`; pri úspešnom (interný) volaní je vždy
// PageData — Exclude<…, void> to zúži, aby test čítal `.dopyty`/`.hasOdooLead` bez void vetvy.
type LoadOk = Exclude<Awaited<ReturnType<typeof load>>, void>;

function ev(query = '', role: 'internal' | 'b2b' | null = 'internal'): LoadEvent {
	const user = role ? { id: 1, username: 'u', role } : null;
	return {
		url: new URL(`http://localhost/dopyty-konfigurator${query}`),
		locals: { user }
	} as unknown as LoadEvent;
}
/** Úspešné (interné) volanie load — návrat zúžený na PageData (bez void). */
async function loadOk(query = ''): Promise<LoadOk> {
	return (await load(ev(query, 'internal'))) as LoadOk;
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
		const d = await loadOk();
		expect(d).toMatchObject({ total: 0, page: 1, pageCount: 1, perPage: 50, hasOdooLead: true });
		expect(d.dopyty).toEqual([]);
	});

	it('stránkuje po 50 (51 dopytov → 2 stránky)', async () => {
		seed(51);
		const p1 = await loadOk();
		expect(p1).toMatchObject({ total: 51, page: 1, pageCount: 2 });
		expect(p1.dopyty.length).toBe(50);
		// najnovší hore
		expect(p1.dopyty[0]!.meno).toBe('Meno 51');

		const p2 = await loadOk('?page=2');
		expect(p2.page).toBe(2);
		expect(p2.dopyty.length).toBe(1);
		expect(p2.dopyty[0]!.meno).toBe('Meno 1');
	});

	it('clampuje neplatnú/mimo-rozsah ?page (99, 0, NaN → do [1, pageCount])', async () => {
		seed(3);
		expect((await loadOk('?page=99')).page).toBe(1); // pageCount je 1
		expect((await loadOk('?page=0')).page).toBe(1);
		expect((await loadOk('?page=abc')).page).toBe(1);
	});

	it('riadok nesie datum (naformátovaný), súhrn a kontaktné údaje', async () => {
		seed(1);
		const d = await loadOk();
		const row = d.dopyty[0]!;
		expect(row.meno).toBe('Meno 1');
		expect(row.miesto).toBe('Trnava');
		expect(row.datum).toMatch(/^\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}$/);
		// súhrn obsahuje rozmery (znovupoužitý zhrnutieRiadky); PageData je voľne typované → anotuj r
		expect(
			row.suhrn.some((r: { label: string; value: string }) => r.value.includes('3000 × 4000 mm'))
		).toBe(true);
		expect(row.odooLeadId).toBeNull();
	});

	it('na v26 (odoo_lead_id existuje) load nesie hasOdooLead=true a hodnotu leadu', async () => {
		const id = insertDopyt({
			konfiguracia: '{}',
			meno: 'Lead',
			email: 'l@x.sk',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		db.prepare('UPDATE dopyt SET odoo_lead_id = ? WHERE id = ?').run(77, id);
		const d = await loadOk();
		expect(d.hasOdooLead).toBe(true);
		expect(d.dopyty[0]!.odooLeadId).toBe(77);
	});

	it('neinterný používateľ (b2b/anon) → 403 (defense-in-depth, symetria s PDF endpointom)', async () => {
		await expect(load(ev('', 'b2b'))).rejects.toMatchObject({ status: 403 });
		await expect(load(ev('', null))).rejects.toMatchObject({ status: 403 });
	});
});
