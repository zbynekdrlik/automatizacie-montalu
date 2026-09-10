// #496: unit test — objednavka-skla CRUD module
import { describe, it, expect } from 'vitest';

describe('objednavka-skla CRUD', () => {
	it('pridajSklo inserts and listSklaPreZakazku reads back', async () => {
		const { pridajSklo, listSklaPreZakazku, getSkloPolozka, nastavRezim, zmazPolozku } =
			await import('../src/lib/server/objednavka-skla');

		const id = pridajSklo({
			zak: 'ZAK260501',
			op: 'OP260501',
			modul: 'zasklenia',
			popis: 'Posuv 1: Float 4mm',
			sirkaMm: 1200,
			vyskaMm: 800,
			pocet: 2,
			typSkla: 'Float 4mm',
			createdBy: 'test'
		});

		expect(id).toBeGreaterThan(0);

		const list = listSklaPreZakazku('ZAK260501');
		expect(list.length).toBe(1);
		expect(list[0]!.sirkaMm).toBe(1200);
		expect(list[0]!.vyskaMm).toBe(800);
		expect(list[0]!.pocet).toBe(2);
		expect(list[0]!.typSkla).toBe('Float 4mm');
		expect(list[0]!.modul).toBe('zasklenia');
		expect(list[0]!.rezim).toBe('rozmery');
		expect(list[0]!.sikmy).toBe(false);

		// get single
		const single = getSkloPolozka(id);
		expect(single).not.toBeNull();
		expect(single!.zak).toBe('ZAK260501');

		// set atyp
		nastavRezim(id, 'atyp');
		const updated = getSkloPolozka(id);
		expect(updated!.rezim).toBe('atyp');

		// delete
		zmazPolozku(id);
		const afterDel = getSkloPolozka(id);
		expect(afterDel).toBeNull();
	});

	it('pridajSklaHromadne inserts multiple in transaction', async () => {
		const { pridajSklaHromadne, listSklaPreZakazku } =
			await import('../src/lib/server/objednavka-skla');

		const count = pridajSklaHromadne([
			{
				zak: 'ZAK260502',
				modul: 'fix',
				popis: 'Pole 1 (šikmé)',
				sirkaMm: 500,
				vLavoMm: 800,
				vPravoMm: 600,
				pocet: 1,
				typSkla: 'Float 6mm',
				sikmy: true,
				m2: 0.35,
				createdBy: 'test'
			},
			{
				zak: 'ZAK260502',
				modul: 'fix',
				popis: 'Pole 2 (šikmé)',
				sirkaMm: 500,
				vLavoMm: 600,
				vPravoMm: 400,
				pocet: 1,
				typSkla: 'Float 6mm',
				sikmy: true,
				m2: 0.25,
				createdBy: 'test'
			}
		]);

		expect(count).toBe(2);

		const list = listSklaPreZakazku('ZAK260502');
		expect(list.length).toBe(2);
		expect(list[0]!.sikmy).toBe(true);
		expect(list[0]!.vLavoMm).toBe(800);
		expect(list[0]!.vPravoMm).toBe(600);
	});

	it('zak_norm normalization works (case + space)', async () => {
		const { pridajSklo, listSklaPreZakazku } = await import('../src/lib/server/objednavka-skla');

		pridajSklo({
			zak: 'zak 260503',
			modul: 'pergola',
			popis: 'Strešné sklo',
			sirkaMm: 900,
			vyskaMm: 2000,
			pocet: 5,
			typSkla: 'Kalené 8mm',
			createdBy: 'test'
		});

		// Search with different casing/spacing
		const list = listSklaPreZakazku('ZAK260503');
		expect(list.length).toBe(1);
		expect(list[0]!.popis).toBe('Strešné sklo');
	});

	it('subory CRUD works', async () => {
		const { pridajSklo, pridajSubor, listSubory, getSuborData, getSuborMeta, zmazSubor } =
			await import('../src/lib/server/objednavka-skla');

		const polId = pridajSklo({
			zak: 'ZAK260504',
			modul: 'fix',
			popis: 'Atyp pole',
			sirkaMm: 300,
			pocet: 1,
			typSkla: 'Float 4mm',
			createdBy: 'test'
		});

		const buf = Buffer.from('fake-pdf-content', 'utf8');
		const suborId = pridajSubor(polId, 'vykres.pdf', 'application/pdf', buf);
		expect(suborId).toBeGreaterThan(0);

		const subory = listSubory(polId);
		expect(subory.length).toBe(1);
		expect(subory[0]!.nazov).toBe('vykres.pdf');
		expect(subory[0]!.typ).toBe('application/pdf');

		const meta = getSuborMeta(suborId);
		expect(meta).not.toBeNull();
		expect(meta!.nazov).toBe('vykres.pdf');

		const data = getSuborData(suborId);
		expect(data).not.toBeNull();
		expect(data!.toString('utf8')).toBe('fake-pdf-content');

		zmazSubor(suborId);
		const afterDel = listSubory(polId);
		expect(afterDel.length).toBe(0);
	});

	it('rejects files over MAX_SUBOR_VELKOST', async () => {
		const { pridajSklo, pridajSubor, MAX_SUBOR_VELKOST } =
			await import('../src/lib/server/objednavka-skla');

		const polId = pridajSklo({
			zak: 'ZAK260505',
			modul: 'fix',
			popis: 'Oversized',
			sirkaMm: 100,
			pocet: 1,
			typSkla: 'X',
			createdBy: 'test'
		});

		const buf = Buffer.alloc(MAX_SUBOR_VELKOST + 1);
		expect(() => pridajSubor(polId, 'big.pdf', 'application/pdf', buf)).toThrow(/príliš veľký/);
	});

	it('objednavka_skla table exists after migration (file-size cap guard)', async () => {
		const { db } = await import('../src/lib/server/db');
		expect(db.pragma('user_version', { simple: true })).toBe(44);
		const tbl = db
			.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='objednavka_skla'")
			.get();
		expect(tbl).toBeTruthy();
	});
});
