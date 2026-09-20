// #553: formulár „Pridať riadok" prijme výkres priamo (multipart) — atyp riadok + príloha
// jedným odoslaním; validácia súboru zdieľaná s `nahratSubor` (allowlist prípon, 10 MB,
// vynútený `application/octet-stream`). Money-NEUTRÁLNE. DB je zdieľaná → unikátne zákazky.
import { describe, it, expect } from 'vitest';
import { actions } from '../src/routes/objednavka-skla/[zak]/+page.server';
import { listSklaPreZakazku, listSubory } from '../src/lib/server/objednavka-skla';

function mkEvent(
	zak: string,
	fields: Record<string, string>,
	file?: { name: string; bytes: Uint8Array }
) {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	if (file) f.set('subor', new File([file.bytes], file.name, { type: 'application/pdf' }));
	return {
		params: { zak },
		request: { formData: async () => f },
		locals: { user: { username: 'test' } }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

const BASE = {
	popis: 'ATYP podľa výkresu',
	typ_skla: 'Float 4',
	sirka_mm: '1000',
	vyska_mm: '500',
	pocet: '2',
	rezim: 'atyp'
};

describe('#553 pridatRiadok — výkres priamo vo formulári „Pridať riadok"', () => {
	it('multipart s pdf súborom → riadok A príloha uložené jedným odoslaním', async () => {
		const zak = 'ZAK-553-PDF';
		const res = await actions.pridatRiadok(
			mkEvent(zak, BASE, { name: 'vykres.pdf', bytes: new Uint8Array([1, 2, 3, 4]) })
		);
		expect((res as { ok?: boolean }).ok).toBe(true);

		const rows = listSklaPreZakazku(zak);
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezim).toBe('atyp');

		const subory = listSubory(rows[0]!.id);
		expect(subory).toHaveLength(1);
		expect(subory[0]!.nazov).toBe('vykres.pdf');
		expect(subory[0]!.typ).toBe('application/octet-stream'); // vynútený bezpečný MIME
	});

	it('neplatná prípona → fail(400), NIČ sa nevloží (ani riadok, ani príloha)', async () => {
		const zak = 'ZAK-553-BAD';
		const res = await actions.pridatRiadok(
			mkEvent(zak, BASE, { name: 'vykres.exe', bytes: new Uint8Array([1, 2, 3]) })
		);
		expect((res as { status?: number }).status).toBe(400);
		expect((res as { data?: { pridatChyba?: string } }).data?.pridatChyba).toBeTruthy();
		expect(listSklaPreZakazku(zak)).toHaveLength(0); // validácia PRED vložením
	});

	it('atyp bez súboru → riadok vložený + upozornenie „atyp bez výkresu" (nie chyba)', async () => {
		const zak = 'ZAK-553-NOFILE';
		const res = await actions.pridatRiadok(mkEvent(zak, BASE));
		expect((res as { ok?: boolean }).ok).toBe(true);
		expect((res as { pridatUpozornenie?: string }).pridatUpozornenie).toBeTruthy();
		const rows = listSklaPreZakazku(zak);
		expect(rows).toHaveLength(1);
		expect(listSubory(rows[0]!.id)).toHaveLength(0);
	});
});
