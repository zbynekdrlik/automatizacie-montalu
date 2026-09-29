// #587 (Odoo úloha 1185): „Výkres alebo DXF k sklu pôjde s objednávkou z appky." Riadok objednávky
// skla „— s otvorom ⌀46" (#578) nesie POLOHU otvoru (50 mm od zvislej hrany, výška vŕtania od spodku
// skla, ⌀46) a pri odoslaní do Odoo appka k nemu VYGENERUJE PDF výkres tabule (príloha riadku popri
// ručných prílohách) — IZOS tak vie, KDE vŕtať. Riadok bez uloženej polohy (spred zmeny) → žiadny
// výkres (honest-null, podklad upozorní). Money-NEUTRÁLNE (objednávka u dodávateľa skla).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PDFDocument } from 'pdf-lib';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-vykres-otvoru-587-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { actions } = await import('../src/routes/zasklenia/+page.server');
const {
	listSklaPreZakazku,
	pridajSklo,
	pridajSubor,
	pridajSklaHromadneIdempotentne,
	nastavSpec,
	nastavRezim
} = await import('../src/lib/server/objednavka-skla');
const { buildGlassOrderForZak } = await import('../src/lib/server/odoo-glass-order-upload');
const { generateVykresOtvoruPdf, vykresOtvoruZPolozky, vykresOtvoruFilename } =
	await import('../src/lib/server/sklo-otvor-pdf');
const { GET } = await import('../src/routes/objednavka-skla/vykres-otvoru/[id]/+server');
const { OKRAJ_ZAMOK_MM, D_ZAMOK_MM, VRTANIE_ZAMKU_DEFAULT_MM } =
	await import('../src/lib/sklo-otvory');

const USER = { id: 1, username: 'tester', role: 'internal' as const };

function callAction(name: 'pridatSkla' | 'pridatSklaMulti', o: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	const event = {
		request: new Request('http://x/zasklenia', { method: 'POST', body: f }),
		locals: { user: USER }
	};
	const fn = actions[name] as unknown as (e: typeof event) => Promise<Record<string, unknown>>;
	return fn(event);
}

// Deluxe 4K s 10 mm kaleným sklom (att 39228) — výška vŕtania zámku zadaná 1100 mm.
const DELUXE_4K = {
	op: '01',
	zakaznik: 'X',
	system: 'Deluxe',
	styl: '4K',
	s: '4000',
	v: '2000',
	sklo: 'Float kalené 10 mm',
	otvaranie: 'P - L',
	farbaKovania: 'R7016',
	vrtanieZamku: '1100'
};

const S_OTVOROM = 'Zasklenie 1 — s otvorom ⌀46';
/** `created_at` riadku (SQLite UTC tvar) — jediný dátum, z ktorého výkres smie vychádzať. */
const VYTVORENE = '2026-09-28 10:00:00';

async function metadata(b64: string) {
	const doc = await PDFDocument.load(Buffer.from(b64, 'base64'));
	return {
		pages: doc.getPageCount(),
		title: doc.getTitle() ?? '',
		subject: doc.getSubject() ?? '',
		keywords: doc.getKeywords() ?? ''
	};
}

describe('#587 riadok s otvorom z Deluxe posuvu nesie polohu otvoru', () => {
	it('single: poloha = 50 mm od hrany, výška vŕtania z formulára, ⌀46; riadok bez → null', async () => {
		const r = await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-POL' });
		expect(r.step).toBe('nahlad');
		const rows = listSklaPreZakazku('ZAK-587-POL');
		const s = rows.find((p) => p.popis === S_OTVOROM)!;
		const bez = rows.find((p) => p.popis === 'Zasklenie 1')!;
		expect(s.otvor).toEqual({ odHranyMm: OKRAJ_ZAMOK_MM, odSpodkuMm: 1100, priemerMm: D_ZAMOK_MM });
		expect(bez.otvor).toBeNull();
	});

	it('multi posuv (výška vŕtania sa nezadáva) → default výška ako náhľad', async () => {
		const posuvy = JSON.stringify([
			{
				system: 'Deluxe',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: 'Float kalené 10 mm',
				otvaranie: 'P - L'
			}
		]);
		await callAction('pridatSklaMulti', {
			zak: 'ZAK-587-M',
			op: '01',
			zakaznik: 'X',
			farbaKovania: 'R7016',
			posuvy
		});
		const s = listSklaPreZakazku('ZAK-587-M').find((p) => p.popis === S_OTVOROM)!;
		expect(s.otvor?.odSpodkuMm).toBe(VRTANIE_ZAMKU_DEFAULT_MM);
	});

	it('riadok spred #587 (otvor bez polohy) — opakované „Pridať sklá" polohu doplní', async () => {
		// stav po #578 (0.25.48–0.25.51): riadok s otvorom BEZ polohy
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-DOPLN' });
		const pred = listSklaPreZakazku('ZAK-587-DOPLN');
		const legacy = pred.map((p) => ({
			zak: 'ZAK-587-LEGACY',
			op: p.op,
			modul: p.modul,
			popis: p.popis,
			sirkaMm: p.sirkaMm,
			vyskaMm: p.vyskaMm,
			pocet: p.pocet,
			m2: p.m2,
			typSkla: p.typSkla,
			holesQty: p.spec.holesQty,
			holeSize: p.spec.holeSize || undefined,
			createdBy: 'tester'
		}));
		pridajSklaHromadneIdempotentne(legacy);
		expect(
			listSklaPreZakazku('ZAK-587-LEGACY').find((p) => p.popis === S_OTVOROM)!.otvor
		).toBeNull();
		const r = await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-LEGACY' });
		// nič nové sa nevložilo; riadok s otvorom dostal polohu → banner „odošli znova do Odoo"
		expect(r.sklaPridane).toMatchObject({ pridane: 0, polohaZmenena: 1 });
		const po = listSklaPreZakazku('ZAK-587-LEGACY');
		expect(po).toHaveLength(2);
		expect(po.find((p) => p.popis === S_OTVOROM)!.otvor?.odSpodkuMm).toBe(1100);
	});
});

describe('#587 Odoo glass_order — PDF výkres k riadku s otvorom', () => {
	it('riadok s otvorom má PDF prílohu (popri ručnej), riadok bez otvoru žiadnu', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-ODOO' });
		const rows = listSklaPreZakazku('ZAK-587-ODOO');
		const s = rows.find((p) => p.popis === S_OTVOROM)!;
		pridajSubor(s.id, 'rucny.dxf', 'application/octet-stream', Buffer.from('DXF'));

		const items = (await buildGlassOrderForZak('ZAK-587-ODOO'))!.order.items;
		const itemS = items.find((i) => i.description === S_OTVOROM)!;
		const itemBez = items.find((i) => i.description === 'Zasklenie 1')!;
		expect(itemBez).not.toHaveProperty('attachments');
		const att = itemS.attachments!;
		expect(att.map((a) => a.name)).toContain('rucny.dxf');
		const pdf = att.find((a) => a.mimetype === 'application/pdf')!;
		expect(pdf).toBeDefined();
		expect(pdf.name).toMatch(/^Vykres-otvoru-.*\.pdf$/);
		expect(Buffer.from(pdf.data_base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');

		const m = await metadata(pdf.data_base64);
		expect(m.pages).toBe(1);
		expect(m.title).toContain('ZAK-587-ODOO');
		expect(m.subject).toContain(`${s.sirkaMm} × ${s.vyskaMm} mm`);
		expect(m.subject).toContain('⌀46');
		expect(m.subject).toContain('50 mm od zvislej hrany');
		expect(m.subject).toContain('1100 mm od spodku');
		expect(m.subject).toContain(`${s.pocet} ks`);
	});

	it('riadok s otvorom BEZ uloženej polohy → žiadny generovaný výkres (honest-null)', async () => {
		pridajSklo({
			zak: 'ZAK-587-NULL',
			op: '01',
			modul: 'zasklenia',
			popis: S_OTVOROM,
			sirkaMm: 1004,
			vyskaMm: 1914,
			pocet: 2,
			typSkla: 'Float kalené 10 mm',
			holesQty: 1,
			holeSize: 'd50',
			createdBy: 'tester'
		});
		const [p] = listSklaPreZakazku('ZAK-587-NULL');
		expect(p!.otvor).toBeNull();
		expect(vykresOtvoruZPolozky(p!)).toBeNull();
		const item = (await buildGlassOrderForZak('ZAK-587-NULL'))!.order.items[0]!;
		expect(item).not.toHaveProperty('attachments');
		expect(item.holes_qty).toBe(1); // cena IZOS (otvor) ostáva
	});
});

describe('#587 generateVykresOtvoruPdf', () => {
	const V = {
		zak: 'ZAK1',
		op: 'OP260001',
		popis: S_OTVOROM,
		typSkla: 'Float kalené 10 mm',
		sirkaMm: 1004,
		vyskaMm: 1914,
		pocet: 2,
		otvor: { odHranyMm: 50, odSpodkuMm: 1050, priemerMm: 46 },
		vytvoreneAt: VYTVORENE
	};

	it('platné 1-stranové PDF s rozmermi, ⌀46, 50 mm a výškou v metadátach', async () => {
		const bytes = await generateVykresOtvoruPdf(V);
		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(1);
		const subject = doc.getSubject() ?? '';
		expect(subject).toContain('1004 × 1914 mm');
		expect(subject).toContain('otvor ⌀46');
		expect(subject).toContain('50 mm od zvislej hrany');
		expect(subject).toContain('1050 mm od spodku');
		expect(doc.getKeywords() ?? '').toContain('od_hrany_mm=50');
		expect(doc.getTitle() ?? '').toContain('Zasklenie 1');
	});

	it('PDF nenesie žiadne ceny (objednávka ide dodávateľovi)', async () => {
		const doc = await PDFDocument.load(await generateVykresOtvoruPdf(V));
		const meta = `${doc.getTitle()} ${doc.getSubject()} ${doc.getKeywords()}`;
		expect(meta).not.toMatch(/€|EUR|cena/i);
	});
});

describe('#587 podklad: stiahnutie výkresu otvoru', () => {
	const get = (id: number | string) =>
		GET({ params: { id: String(id) } } as unknown as Parameters<typeof GET>[0]);

	it('riadok s otvorom → application/pdf; riadok bez otvoru/neplatné id → 404', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-GET' });
		const rows = listSklaPreZakazku('ZAK-587-GET');
		const s = rows.find((p) => p.popis === S_OTVOROM)!;
		const bez = rows.find((p) => p.popis === 'Zasklenie 1')!;
		const res = await get(s.id);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		expect(res.headers.get('content-disposition')).toContain('Vykres-otvoru-');
		const body = Buffer.from(await res.arrayBuffer());
		expect(body.subarray(0, 5).toString()).toBe('%PDF-');
		await expect(get(bez.id)).rejects.toMatchObject({ status: 404 });
		await expect(get('abc')).rejects.toMatchObject({ status: 404 });
	});
});

describe('#587 review — poloha platí len k zadaniu, ktoré objednávka nesie', () => {
	const sOtvorom = (zak: string) => listSklaPreZakazku(zak).find((p) => p.popis === S_OTVOROM)!;
	const noteS = async (zak: string) =>
		(await buildGlassOrderForZak(zak))!.order.items.find((i) => i.description === S_OTVOROM)!
			.note ?? '';

	it('poloha ide aj do poznámky riadku (Odoo porovnáva pri re-odoslaní polia, nie prílohy)', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-NOTE' });
		const pred = await noteS('ZAK-587-NOTE');
		expect(pred).toBe(
			`${S_OTVOROM} — otvor ⌀46: stred 50 mm od zvislej hrany, 1100 mm od spodku skla`
		);
		// zmena výšky vŕtania → iná poznámka → Odoo založí novú verziu (nový výkres dorazí)
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-NOTE', vrtanieZamku: '1200' });
		const po = await noteS('ZAK-587-NOTE');
		expect(po).toContain('1200 mm od spodku');
		expect(po).not.toBe(pred);
		// riadok bez otvoru poznámku nemení
		const bez = (await buildGlassOrderForZak('ZAK-587-NOTE'))!.order.items.find(
			(i) => i.description === 'Zasklenie 1'
		)!;
		expect(bez.note).toBe('Zasklenie 1');
	});

	it('nová výška mimo skla ZMAŽE starú polohu (žiadny starý výkres)', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-MIMO' });
		expect(sOtvorom('ZAK-587-MIMO').otvor?.odSpodkuMm).toBe(1100);
		const r = await callAction('pridatSkla', {
			...DELUXE_4K,
			zak: 'ZAK-587-MIMO',
			vrtanieZamku: '19000'
		});
		expect(r.sklaPridane).toMatchObject({ pridane: 0, polohaZmenena: 1 });
		const s = sOtvorom('ZAK-587-MIMO');
		expect(s.otvor).toBeNull();
		expect(s.spec.holesQty).toBe(1); // cena IZOS (otvor) ostáva
		const item = (await buildGlassOrderForZak('ZAK-587-MIMO'))!.order.items.find(
			(i) => i.description === S_OTVOROM
		)!;
		expect(item).not.toHaveProperty('attachments');
	});

	it('obsluha zmení spec otvorov (2 otvory / iný priemer) → výkres sa negeneruje', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-SPEC' });
		const s = sOtvorom('ZAK-587-SPEC');
		nastavSpec(s.id, { ...s.spec, holesQty: 2 });
		expect(sOtvorom('ZAK-587-SPEC').otvor).toBeNull();
		nastavSpec(s.id, { ...s.spec, holesQty: 1, holeSize: 'd30' });
		expect(sOtvorom('ZAK-587-SPEC').otvor).toBeNull();
		nastavSpec(s.id, { ...s.spec, holesQty: 1, holeSize: 'd50' });
		expect(sOtvorom('ZAK-587-SPEC').otvor?.odSpodkuMm).toBe(1100);
	});

	it('atyp riadok (vlastný výkres obsluhy) → generovaný výkres sa nepridá', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-ATYP' });
		const s = sOtvorom('ZAK-587-ATYP');
		pridajSubor(s.id, 'vlastny.pdf', 'application/octet-stream', Buffer.from('PDF'));
		nastavRezim(s.id, 'atyp');
		const p = sOtvorom('ZAK-587-ATYP');
		expect(vykresOtvoruZPolozky(p)).toBeNull();
		const item = (await buildGlassOrderForZak('ZAK-587-ATYP'))!.order.items.find(
			(i) => i.description === S_OTVOROM
		)!;
		expect(item.attachments!.map((a) => a.name)).toEqual(['vlastny.pdf']);
	});

	it('PDF kreslí ľavé aj pravé krídlo a polohu berie zo vstupu (nie z konštánt)', async () => {
		const doc = await PDFDocument.load(
			await generateVykresOtvoruPdf({
				zak: 'Z',
				op: 'O',
				popis: S_OTVOROM,
				typSkla: 'T',
				sirkaMm: 900,
				vyskaMm: 1800,
				pocet: 2,
				otvor: { odHranyMm: 73, odSpodkuMm: 987, priemerMm: 28 },
				vytvoreneAt: VYTVORENE
			})
		);
		expect(doc.getSubject() ?? '').toContain('2 ks (ľavé 1, pravé 1)');
		const kw = doc.getKeywords() ?? '';
		for (const k of ['od_hrany_mm=73', 'od_spodku_mm=987', 'priemer_mm=28', 'ks_prave=1'])
			expect(kw).toContain(k);
	});
});

describe('#587 výkres — okrajové vstupy', () => {
	const V = {
		zak: 'ZAK2',
		op: '',
		popis: S_OTVOROM,
		typSkla: '',
		sirkaMm: 1004.5,
		vyskaMm: 1914.25,
		pocet: 1,
		otvor: { odHranyMm: 50, odSpodkuMm: 1050.5, priemerMm: 46 },
		vytvoreneAt: VYTVORENE
	};

	it('desatinné mm s čiarkou, prázdne OP aj typ skla nezhodia PDF', async () => {
		const doc = await PDFDocument.load(await generateVykresOtvoruPdf(V));
		const subject = doc.getSubject() ?? '';
		expect(subject).toContain('1004,5 × 1914,3 mm');
		expect(subject).toContain('1050,5 mm od spodku');
		expect(doc.getKeywords() ?? '').toContain('op=');
	});

	it('názov prílohy je ASCII slug (diakritika preč, prázdna časť → x)', () => {
		expect(vykresOtvoruFilename({ zak: 'Žák 1/2', popis: S_OTVOROM })).toBe(
			'Vykres-otvoru-Zak-1-2-Zasklenie-1-s-otvorom-46.pdf'
		);
		expect(vykresOtvoruFilename({ zak: '—', popis: '' })).toBe('Vykres-otvoru-x-x.pdf');
	});

	it('riadok bez otvoru / šikmý / bez výšky / bez šírky → žiadny výkres', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-EDGE' });
		const s = listSklaPreZakazku('ZAK-587-EDGE').find((p) => p.popis === S_OTVOROM)!;
		expect(vykresOtvoruZPolozky(s)).not.toBeNull();
		expect(vykresOtvoruZPolozky({ ...s, spec: { ...s.spec, holesQty: 0 } })).toBeNull();
		expect(vykresOtvoruZPolozky({ ...s, sikmy: true })).toBeNull();
		expect(vykresOtvoruZPolozky({ ...s, vyskaMm: null })).toBeNull();
		expect(vykresOtvoruZPolozky({ ...s, sirkaMm: 0 })).toBeNull();
		// „iné sklo" (vlastný typ) ide do výkresu namiesto katalógového typu
		expect(vykresOtvoruZPolozky({ ...s, typSklaManual: 'Vlastné 8 mm' })!.typSkla).toBe(
			'Vlastné 8 mm'
		);
	});
});

// Odoo 2.370.0 (odoo-erp 8536, `_montalu_glass_line_atts_changed`) porovnáva pri re-odoslaní prílohy
// riadku podľa názvu + SHA-1; pri zmene zmaže riadky a vráti objednávku do Konceptu. Objednávka sa
// znova posiela pri KAŽDOM uložení plánu rezov → výkres toho istého riadku MUSÍ byť bajtovo rovnaký
// (žiadny wall-clock v tele ani metadátach), inak by každá odoslaná objednávka skočila do Konceptu.
describe('#587 výkres je deterministický (Odoo re-send porovnáva SHA-1 príloh)', () => {
	afterEach(() => vi.useRealTimers());

	const V = {
		zak: 'ZAK-DET',
		op: 'OP260002',
		popis: S_OTVOROM,
		typSkla: 'Float kalené 10 mm',
		sirkaMm: 1004,
		vyskaMm: 1914,
		pocet: 2,
		otvor: { odHranyMm: 50, odSpodkuMm: 1050, priemerMm: 46 },
		vytvoreneAt: VYTVORENE
	};
	const sha1 = (b: Uint8Array | string) => createHash('sha1').update(b).digest('hex');

	/** Len `Date` — pdf-lib `save()` čaká cez setTimeout, ten musí ostať reálny. */
	const hodinyNa = (iso: string) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(iso));
	};

	it('rovnaký riadok v inom čase → identické bajty (rovnaký SHA-1)', async () => {
		hodinyNa('2026-09-29T08:00:00Z');
		const a = await generateVykresOtvoruPdf(V);
		hodinyNa('2027-03-15T21:37:00Z');
		const b = await generateVykresOtvoruPdf(V);
		expect(sha1(b)).toBe(sha1(a));
	});

	it('dátum v metadátach = vytvorenie riadku, nie aktuálny čas', async () => {
		hodinyNa('2027-01-01T00:00:00Z');
		// `updateMetadata: false` — inak by sám `load()` prepísal ModDate/Producer na „teraz"
		const doc = await PDFDocument.load(await generateVykresOtvoruPdf(V), {
			updateMetadata: false
		});
		const riadok = new Date('2026-09-28T10:00:00Z').getTime();
		expect(doc.getCreationDate()?.getTime()).toBe(riadok);
		expect(doc.getModificationDate()?.getTime()).toBe(riadok);
	});

	it('ZMENENÁ poloha otvoru → iné bajty (skutočná zmena sa znova odošle)', async () => {
		const a = await generateVykresOtvoruPdf(V);
		const b = await generateVykresOtvoruPdf({ ...V, otvor: { ...V.otvor, odSpodkuMm: 1100 } });
		expect(sha1(b)).not.toBe(sha1(a));
	});

	it('Odoo príloha riadku je pri dvoch odoslaniach v inom čase bajtovo rovnaká', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-587-DET' });
		const vykres = async () =>
			(await buildGlassOrderForZak('ZAK-587-DET'))!.order.items
				.find((i) => i.description === S_OTVOROM)!
				.attachments!.find((x) => x.mimetype === 'application/pdf')!;
		hodinyNa('2026-09-29T08:00:00Z');
		const prve = await vykres();
		hodinyNa('2026-12-24T18:00:00Z');
		const druhe = await vykres();
		expect(druhe.name).toBe(prve.name);
		expect(sha1(druhe.data_base64)).toBe(sha1(prve.data_base64));
	});
});
