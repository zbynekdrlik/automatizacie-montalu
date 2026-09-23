// #565: atyp s priloženým výkresom BEZ povinnej šírky/výšky (Patrik, Odoo úloha 1051 — výkres FIX
// Květoň, 9 lichobežníkových tabúľ; jeden rozmer neexistuje). Rozmery sú voliteľné LEN keď režim=atyp
// A výkres je priložený v tom istom odoslaní; inak ostávajú povinné. Riadok bez rozmerov: sirka_mm=0
// (stĺpec NOT NULL — bez migrácie), vyska_mm=NULL, m2=NULL → podklad „podľa výkresu", m² prázdne.
// Odoo v2 príjem (odoo-erp `sale_order_narezak_glass.py`): atyp = rozmery voliteľné, povinná príloha.
// Money-NEUTRÁLNE. DB je zdieľaná → unikátne zákazky.
import { describe, it, expect } from 'vitest';
import { actions } from '../src/routes/objednavka-skla/[zak]/+page.server';
import {
	listSklaPreZakazku,
	listSubory,
	pridajSkloManual,
	MAX_SUBOR_VELKOST
} from '../src/lib/server/objednavka-skla';
import { buildGlassOrderItem } from '../src/lib/server/odoo-rozpis-lines';
import { buildGlassOrderForZak } from '../src/lib/server/odoo-glass-order-upload';
import { bezRozmerov, fmtRozmerTabule } from '../src/lib/objednavka-skla-pozicia';

function mkEvent(
	zak: string,
	fields: Record<string, string>,
	file?: { name: string; content: string }
) {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	if (file) f.set('subor', new File([file.content], file.name, { type: 'application/pdf' }));
	return {
		params: { zak },
		request: { formData: async () => f },
		locals: { user: { username: 'test' } }
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

// Presne Patrikov stav formulára: šírka/výška prázdne (prehliadač ich pošle ako '').
const ATYP_BEZ = {
	popis: '',
	typ_skla: 'Float 4',
	sirka_mm: '',
	vyska_mm: '',
	pocet: '1',
	rezim: 'atyp'
};
const VYKRES = { name: 'OP260320 FIX Kveton SKLO.pdf', content: '%PDF-1.4 vykres' };

type Res = { ok?: boolean; status?: number; data?: { pridatChyba?: string; error?: string } };

describe('#565 pridatRiadok — atyp s výkresom bez šírky/výšky', () => {
	it('atyp + výkres + bez rozmerov → riadok (0 / NULL, m² prázdne) + príloha', async () => {
		const zak = 'ZAK-565-OK';
		const res = (await actions.pridatRiadok(mkEvent(zak, ATYP_BEZ, VYKRES))) as Res;
		expect(res.ok).toBe(true);
		const rows = listSklaPreZakazku(zak);
		expect(rows).toHaveLength(1);
		const r = rows[0]!;
		expect(r.rezim).toBe('atyp');
		expect(r.sirkaMm).toBe(0);
		expect(r.vyskaMm).toBeNull();
		expect(r.m2).toBeNull(); // nikdy 0 m² do súčtov
		expect(listSubory(r.id)).toHaveLength(1);
		expect(listSubory(r.id)[0]!.nazov).toBe(VYKRES.name);
	});

	it('atyp BEZ výkresu a bez rozmerov → 400 so slovenskou hláškou, NIČ sa nevloží', async () => {
		const zak = 'ZAK-565-NOFILE';
		const res = (await actions.pridatRiadok(mkEvent(zak, ATYP_BEZ))) as Res;
		expect(res.status).toBe(400);
		expect(res.data?.pridatChyba).toMatch(/výkres/i);
		expect(listSklaPreZakazku(zak)).toHaveLength(0);
	});

	it('režim rozmery bez rozmerov → 400 aj s priloženým súborom (rozmery povinné)', async () => {
		const zak = 'ZAK-565-ROZMERY';
		const res = (await actions.pridatRiadok(
			mkEvent(zak, { ...ATYP_BEZ, rezim: 'rozmery' }, VYKRES)
		)) as Res;
		expect(res.status).toBe(400);
		expect(res.data?.pridatChyba).toMatch(/Šírka/);
		expect(listSklaPreZakazku(zak)).toHaveLength(0);
	});

	it('atyp + výkres + LEN šírka (polovičné rozmery) → 400 (buď oboje, alebo nič)', async () => {
		const zak = 'ZAK-565-HALF';
		const res = (await actions.pridatRiadok(
			mkEvent(zak, { ...ATYP_BEZ, sirka_mm: '1210' }, VYKRES)
		)) as Res;
		expect(res.status).toBe(400);
		expect(res.data?.pridatChyba).toMatch(/Výška/);
		expect(listSklaPreZakazku(zak)).toHaveLength(0);
	});

	it('atyp + výkres + s rozmermi → správanie ako doteraz (rozmery + m² uložené)', async () => {
		const zak = 'ZAK-565-SROZMERMI';
		const res = (await actions.pridatRiadok(
			mkEvent(zak, { ...ATYP_BEZ, sirka_mm: '1000', vyska_mm: '500', pocet: '2' }, VYKRES)
		)) as Res;
		expect(res.ok).toBe(true);
		const r = listSklaPreZakazku(zak)[0]!;
		expect(r.sirkaMm).toBe(1000);
		expect(r.vyskaMm).toBe(500);
		expect(r.m2).toBeCloseTo(1.0, 6);
	});

	it('riadok bez rozmerov sa nedá prepnúť na režim rozmery (Odoo by odmietol celú objednávku)', async () => {
		const zak = 'ZAK-565-PREPNUT';
		await actions.pridatRiadok(mkEvent(zak, ATYP_BEZ, VYKRES));
		const id = listSklaPreZakazku(zak)[0]!.id;
		const f = new FormData();
		f.set('id', String(id));
		f.set('rezim', 'rozmery');
		const res = (await actions.nastavRezim({
			request: { formData: async () => f }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any)) as Res;
		expect(res.status).toBe(400);
		expect(res.data?.error).toMatch(/rozmery|výkres/i);
		expect(listSklaPreZakazku(zak)[0]!.rezim).toBe('atyp');
	});

	it('Odoo payload zákazky: atyp bez rozmerov → width/height 0, mode atyp, príloha, popis', async () => {
		const zak = 'ZAK-565-ODOO';
		await actions.pridatRiadok(mkEvent(zak, ATYP_BEZ, VYKRES));
		const built = buildGlassOrderForZak(zak)!;
		const item = built.order.items[0]!;
		expect(item.mode).toBe('atyp');
		expect(item.width_mm).toBe(0);
		expect(item.height_mm).toBe(0);
		expect(item.attachments).toHaveLength(1);
		expect(item.attachments![0]!.name).toBe(VYKRES.name);
		expect(item.description).toBe('ATYP podľa výkresu');
	});
});

describe('#565 buildGlassOrderItem — atyp bez rozmerov (kontrakt v2 príjmu)', () => {
	const base = {
		sirkaMm: 0,
		vyskaMm: null,
		vLavoMm: null,
		vPravoMm: null,
		sikmy: false,
		pocet: 1,
		typSkla: 'Float 4',
		popis: '',
		mode: 'atyp' as const,
		attachments: [{ name: 'v.pdf', mimetype: 'application/pdf', data_base64: 'JVBERg==' }]
	};

	it('bez popisu → description „ATYP podľa výkresu", 0 × 0, bez area_m2', () => {
		const it0 = buildGlassOrderItem(base);
		expect(it0.width_mm).toBe(0);
		expect(it0.height_mm).toBe(0);
		expect(it0.mode).toBe('atyp');
		expect(it0.description).toBe('ATYP podľa výkresu');
		expect(it0.attachments).toHaveLength(1);
		expect(Object.keys(it0)).not.toContain('area_m2');
	});

	it('s popisom operátora → popis ostáva (žiadne prepísanie)', () => {
		expect(buildGlassOrderItem({ ...base, popis: 'FIX Květoň' }).description).toBe('FIX Květoň');
	});

	it('režim rozmery s rozmermi → bez fallback popisu (byte-identické s doterajškom)', () => {
		const it0 = buildGlassOrderItem({ ...base, sirkaMm: 1000, vyskaMm: 500, mode: 'rozmery' });
		expect(it0.description).toBeUndefined();
	});

	it('atyp S rozmermi a bez popisu → bez fallback popisu (existujúce atyp riadky nezmenené)', () => {
		const it0 = buildGlassOrderItem({ ...base, sirkaMm: 1000, vyskaMm: 500, mode: 'atyp' });
		expect(it0.description).toBeUndefined();
		expect(it0.width_mm).toBe(1000);
		expect(it0.height_mm).toBe(500);
	});
});

describe('#565 review — výkres riadka bez rozmerov sa nestratí', () => {
	it('riadok + výkres ATOMICKY: zlyhanie uloženia výkresu nevloží ani riadok', () => {
		const zak = 'ZAK-565-ATOM';
		const priVelky = Buffer.alloc(MAX_SUBOR_VELKOST + 1); // pridajSubor hodí (strop veľkosti)
		expect(() =>
			pridajSkloManual({
				zak,
				popis: '',
				typSkla: 'Float 4',
				sirkaMm: null,
				vyskaMm: null,
				pocet: 1,
				rezim: 'atyp',
				vykres: { nazov: 'velky.pdf', data: priVelky },
				createdBy: 'test'
			})
		).toThrow(/veľký/);
		expect(listSklaPreZakazku(zak)).toHaveLength(0); // žiadny riadok 0 × 0 bez výkresu
	});

	it('posledný výkres riadka bez rozmerov sa nedá zmazať (Odoo by atyp bez prílohy odmietol)', async () => {
		const zak = 'ZAK-565-ZMAZ';
		await actions.pridatRiadok(mkEvent(zak, ATYP_BEZ, VYKRES));
		const id = listSklaPreZakazku(zak)[0]!.id;
		const suborId = listSubory(id)[0]!.id;
		const f = new FormData();
		f.set('id', String(suborId));
		const res = (await actions.zmazatSubor({
			request: { formData: async () => f }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any)) as Res;
		expect(res.status).toBe(400);
		expect(res.data?.error).toMatch(/výkres/i);
		expect(listSubory(id)).toHaveLength(1);
	});

	it('riadok S rozmermi — výkres sa dá zmazať ako doteraz', async () => {
		const zak = 'ZAK-565-ZMAZ-OK';
		await actions.pridatRiadok(
			mkEvent(zak, { ...ATYP_BEZ, sirka_mm: '1000', vyska_mm: '500' }, VYKRES)
		);
		const id = listSklaPreZakazku(zak)[0]!.id;
		const f = new FormData();
		f.set('id', String(listSubory(id)[0]!.id));
		const res = (await actions.zmazatSubor({
			request: { formData: async () => f }
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any)) as Res;
		expect(res.ok).toBe(true);
		expect(listSubory(id)).toHaveLength(0);
	});
});

describe('#565 zobrazenie rozmeru riadka', () => {
	const p = { sirkaMm: 0, vyskaMm: null, vLavoMm: null, vPravoMm: null, sikmy: false };
	it('bez rozmerov → „podľa výkresu"', () => {
		expect(bezRozmerov(p)).toBe(true);
		expect(fmtRozmerTabule(p)).toBe('podľa výkresu');
	});
	it('pravouhlé a šikmé → nezmenený formát', () => {
		expect(bezRozmerov({ ...p, sirkaMm: 1000, vyskaMm: 500 })).toBe(false);
		expect(fmtRozmerTabule({ ...p, sirkaMm: 1000, vyskaMm: 500 })).toBe('1000 × 500 mm');
		const sikmy = { ...p, sirkaMm: 1210, vLavoMm: 1002, vPravoMm: 1028, sikmy: true };
		expect(bezRozmerov(sikmy)).toBe(false);
		expect(fmtRozmerTabule(sikmy)).toBe('1210 × 1002/1028 mm (šikmé)');
	});
});
