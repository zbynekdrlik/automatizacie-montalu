// #570 REGRESIA: tablety „Čo rezať" bez riadkov od 20.9. — #511 odstránil automatický nárezák upload
// z odpis hooku a /plan-rezov save (jediný zostávajúci trigger) výroba nepoužíva. Test ide cez
// SKUTOČNÝ composition root (`hooks.server.ts` registruje `setOdpisWrittenHook`) + reálny
// `writeOdpis` nad dočasnou DB; mockuje sa LEN Odoo sieťová hranica (`setJson2Transport`).
//
// Kontrakt: ostrý odpis (live=1) → `montalu_narezak_upload` s `lines.length > 0`, doc_id per OP
// (`backfill-narezak-<op>`, rovnaký ako backfill), riadky VŠETKÝCH modulov OP v jednom uploade
// (lines upload nahrádza všetky riadky objednávky); test odpis (live=0) → žiadny upload; chyba
// uploadu NIKDY nerozbije odpis.
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpis-narezak-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'live');
process.env.MONEY_NA_ODPIS_DIR = path.join(tmpRoot, 'live', 'NA ODPIS');
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'ceny.json');
// interná note (queueZakazkaPush) ostane no-op — bez ODOO_LEAD_* env
delete process.env.ODOO_LEAD_URL;

await import('../src/hooks.server');
const { writeOdpis } = await import('../src/lib/server/money');
const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { loadCfg } = await import('../src/lib/server/db');
const { recomputeVstup } = await import('../src/lib/server/zasklenia-sklo');
const { uploadNarezakZOdpisu } = await import('../src/lib/server/odoo-narezak-odpis');
import type { OdpisJob, Modul } from '../src/lib/server/money';
import type { Vstup } from '../src/lib/server/vstup';

interface Captured {
	url: string;
	body: Record<string, unknown>;
}

function captureTransport(status = 200): Captured[] {
	const calls: Captured[] = [];
	setJson2Transport((async (url: string, init?: RequestInit) => {
		calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
		if (status !== 200) return new Response('boom', { status });
		return new Response(JSON.stringify({ lines_created: 1 }), { status: 200 });
	}) as typeof fetch);
	return calls;
}

const narezakCalls = (calls: Captured[]) =>
	calls.filter((c) => c.url.endsWith('/sale.order/montalu_narezak_upload'));

function enableOdoo(live: '0' | '1') {
	vi.stubEnv('MONEY_LIVE', live);
	vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

function pergolaJob(zak: string, op: string): OdpisJob {
	return {
		modul: 'pergola' as Modul,
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Pergola',
		popis: `${op} : Test Zákazník`,
		polozky: [{ kod: '18013', nazov: 'Profil A', qty: 9 }],
		detail: { cad: '18013 Profil A\t3\t3000\n18020 Profil B\t1\t2000' }
	};
}

function zaskleniaJob(zak: string, op: string): OdpisJob {
	const cfg = loadCfg();
	const vstupRaw = {
		zak,
		op,
		zakaznik: 'Test Zákazník',
		system: 'Robust',
		styl: '2K',
		s: 2000,
		v: 1000,
		sklo: 'Izolačné sklo 4/16/4 číre',
		skloPresne: '',
		skloTrieda: null,
		otvaranie: '',
		kovanieL: '',
		kovanieP: '',
		kovanieStred: '',
		kovanieStredOkno: 'L',
		vrtanieZamku: 1050,
		poznamka: '',
		ral: '',
		caka: false,
		pridavnaKolajnica: false,
		jednostrannaFab: false,
		farbaKovania: null,
		kliny: [],
		kolajnica: null,
		sietka: null
	} as unknown as Vstup;
	const { r } = recomputeVstup(vstupRaw, cfg);
	expect(r).toBeTruthy();
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test Zákazník`,
		polozky: r!.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: { system: 'Robust', styl: '2K', vstupRaw }
	};
}

/** krátko počkaj na odložený (setImmediate) fire-and-forget upload — pre negatívne testy. */
const settle = () => new Promise((r) => setTimeout(r, 300));

afterEach(() => {
	vi.unstubAllEnvs();
	setJson2Transport(null);
});

describe('#570 ostrý odpis → nárezák (lines) na kiosk „Čo rezať"', () => {
	it('live odpis → montalu_narezak_upload s lines.length > 0 a doc_id per OP', async () => {
		enableOdoo('1');
		const calls = captureTransport();
		const out = await writeOdpis(pergolaJob('ZAK570A', 'OP570001'), {});
		expect(out.status).toBe('written');
		expect(out.live).toBe(true);

		await vi.waitFor(() => expect(narezakCalls(calls)).toHaveLength(1), { timeout: 3000 });
		const body = narezakCalls(calls)[0]!.body;
		expect(body.order_number).toBe('OP570001');
		expect(body.doc_id).toBe('backfill-narezak-op570001');
		expect(body.kind).toBe('narezak');
		const lines = body.lines as { nazov: string; mnozstvo: number; dlzka: number }[];
		expect(lines.length).toBeGreaterThan(0);
		expect(lines).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ nazov: 'Profil A', mnozstvo: 3, dlzka: 3 }),
				expect.objectContaining({ nazov: 'Profil B', mnozstvo: 1, dlzka: 2 })
			])
		);
		// grafický nárezák PDF pripnutý (rovnako ako backfill)
		expect(String(body.pdf_base64 ?? '')).not.toBe('');
		expect(String(body.filename)).toMatch(/^Narezak-/);
	});

	it('live zasklenie → lines + cut_plan (Money kódy) s render_html', async () => {
		enableOdoo('1');
		const calls = captureTransport();
		const out = await writeOdpis(zaskleniaJob('ZAK570B', 'OP570002'), {});
		expect(out.status).toBe('written');

		await vi.waitFor(() => expect(narezakCalls(calls)).toHaveLength(1), { timeout: 3000 });
		const body = narezakCalls(calls)[0]!.body;
		expect((body.lines as unknown[]).length).toBeGreaterThan(0);
		const cutPlan = body.cut_plan as { bars: { profile_kod: string }[]; render_html?: string };
		expect(cutPlan.bars.length).toBeGreaterThan(0);
		expect(cutPlan.bars.every((b) => b.profile_kod !== '')).toBe(true);
		expect(cutPlan.render_html).toContain('class="narezak"');
	});

	it('druhý modul tej istej OP → upload nesie riadky OBOCH modulov (lines nahrádzajú všetky)', async () => {
		enableOdoo('1');
		const calls = captureTransport();
		await writeOdpis(pergolaJob('ZAK570C', 'OP570003'), {});
		await vi.waitFor(() => expect(narezakCalls(calls)).toHaveLength(1), { timeout: 3000 });
		const prvy = (narezakCalls(calls)[0]!.body.lines as unknown[]).length;

		await writeOdpis(zaskleniaJob('ZAK570C', 'OP570003'), {});
		await vi.waitFor(() => expect(narezakCalls(calls)).toHaveLength(2), { timeout: 3000 });
		const druhy = narezakCalls(calls)[1]!.body;
		expect(druhy.doc_id).toBe('backfill-narezak-op570003');
		const lines = druhy.lines as { nazov: string }[];
		expect(lines.length).toBeGreaterThan(prvy);
		expect(lines.some((l) => l.nazov === 'Profil A')).toBe(true);
	});

	it('test odpis (live=0) → ŽIADNY nárezák upload', async () => {
		enableOdoo('0');
		const calls = captureTransport();
		const out = await writeOdpis(pergolaJob('ZAK570D', 'OP570004'), {});
		expect(out.status).toBe('written');
		expect(out.live).toBe(false);
		await settle();
		expect(narezakCalls(calls)).toHaveLength(0);
	});

	it('chyba uploadu (HTTP 500) NEROZBIJE odpis — odpis je zapísaný', async () => {
		enableOdoo('1');
		const calls = captureTransport(500);
		const out = await writeOdpis(pergolaJob('ZAK570E', 'OP570005'), {});
		expect(out.status).toBe('written');
		await vi.waitFor(() => expect(narezakCalls(calls)).toHaveLength(1), { timeout: 3000 });
		await settle();
	});

	it('upload vypnutý (ODOO_NAREZ_UPLOAD_ENABLED != 1) → žiadny upload', async () => {
		enableOdoo('1');
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '0');
		const calls = captureTransport();
		const out = await writeOdpis(pergolaJob('ZAK570F', 'OP570006'), {});
		expect(out.status).toBe('written');
		await settle();
		expect(narezakCalls(calls)).toHaveLength(0);
	});
});

// Review 🟡 (#570): dva odpisy tej istej OP rýchlo po sebe → dva súbežné uploady; starší (len modul A)
// mohol doraziť do Odoo PO novšom (A+B) a keďže lines nahrádzajú všetky riadky objednávky, tablet by
// ukázal len A. Uploady jednej OP musia ísť SÉRIOVO a posledný musí niesť aktuálny stav (A+B).
describe('#570 súbeh dvoch odpisov tej istej OP', () => {
	it('uploady jednej OP idú sériovo a posledný nesie riadky OBOCH modulov', async () => {
		enableOdoo('1');
		const bodies: Record<string, unknown>[] = [];
		let naraz = 0;
		let maxNaraz = 0;
		setJson2Transport((async (url: string, init?: RequestInit) => {
			if (String(url).endsWith('/sale.order/montalu_narezak_upload')) {
				naraz++;
				maxNaraz = Math.max(maxNaraz, naraz);
				bodies.push(JSON.parse(String(init?.body ?? '{}')));
				await new Promise((r) => setTimeout(r, 150));
				naraz--;
			}
			return new Response(JSON.stringify({ lines_created: 1 }), { status: 200 });
		}) as typeof fetch);

		await writeOdpis(pergolaJob('ZAK570R', 'OP570020'), {});
		// nech prvý upload reálne beží (je vo „výrobe" v Odoo), kým príde druhý odpis
		await vi.waitFor(() => expect(bodies).toHaveLength(1), { timeout: 3000 });
		await writeOdpis(zaskleniaJob('ZAK570R', 'OP570020'), {});
		await writeOdpis({ ...pergolaJob('ZAK570R', 'OP570020'), modul: 'fix', cakaSubdir: 'Fix' }, {});

		await vi.waitFor(
			() => {
				expect(naraz).toBe(0);
				const posledny = bodies[bodies.length - 1]!;
				const lines = posledny.lines as { nazov: string }[];
				expect(lines.some((l) => l.nazov === 'Profil A')).toBe(true);
				expect(lines.length).toBeGreaterThan((bodies[0]!.lines as unknown[]).length);
			},
			{ timeout: 4000 }
		);
		await settle();
		expect(maxNaraz).toBe(1);
		// koalescencia: 3 odpisy → najviac 2 uploady (bežiaci + jeden zlúčený dobeh), nie 3 paralelné
		expect(bodies.length).toBeLessThanOrEqual(2);
	});

	it('payload na kiosk nenesie ceny — riadky majú len polia RozpisLine, žiadne €', async () => {
		enableOdoo('1');
		const calls = captureTransport();
		await writeOdpis(zaskleniaJob('ZAK570S', 'OP570021'), {});
		await vi.waitFor(() => expect(narezakCalls(calls)).toHaveLength(1), { timeout: 3000 });
		const body = narezakCalls(calls)[0]!.body;
		const povolene = new Set(['kod', 'nazov', 'mnozstvo', 'mj', 'dlzka', 'poznamka']);
		for (const l of body.lines as Record<string, unknown>[]) {
			for (const k of Object.keys(l)) expect(povolene.has(k)).toBe(true);
		}
		const json = JSON.stringify({ ...body, pdf_base64: '' });
		expect(json).not.toMatch(/€|cena|predaj|nakup/i);
	});
});

// Priame výsledky `uploadNarezakZOdpisu` (vetvy skip/no-order/failed). Odpisy sa zapíšu s VYPNUTÝM
// uploadom (hook nič nepošle), potom sa upload zapne a funkcia sa zavolá priamo.
describe('#570 uploadNarezakZOdpisu — výsledky vetiev', () => {
	async function zapisBezUploadu(job: OdpisJob) {
		vi.stubEnv('MONEY_LIVE', '1');
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '0');
		const out = await writeOdpis(job, {});
		expect(out.status).toBe('written');
		await settle();
		enableOdoo('1');
	}

	it('uploaded → vráti počet riadkov a doc_id per OP', async () => {
		await zapisBezUploadu(pergolaJob('ZAK570G', 'OP570007'));
		const calls = captureTransport();
		const r = await uploadNarezakZOdpisu('ZAK570G', '570007');
		expect(r).toMatchObject({ result: 'uploaded', docId: 'backfill-narezak-op570007' });
		expect(r.riadkov).toBeGreaterThan(0);
		expect(narezakCalls(calls)).toHaveLength(1);
	});

	it('chýba JSON-2 konfigurácia → disabled, žiadne volanie', async () => {
		enableOdoo('1');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		const calls = captureTransport();
		expect(await uploadNarezakZOdpisu('ZAK570G', 'OP570007')).toEqual({ result: 'disabled' });
		expect(calls).toHaveLength(0);
	});

	it('OP len s bazénom (mimo záberu rozpisu rezov) → no-odpis', async () => {
		await zapisBezUploadu({
			...pergolaJob('ZAK570H', 'OP570008'),
			modul: 'bazen',
			cakaSubdir: 'Bazen',
			detail: {}
		});
		const calls = captureTransport();
		expect(await uploadNarezakZOdpisu('ZAK570H', 'OP570008')).toEqual({ result: 'no-odpis' });
		expect(calls).toHaveLength(0);
	});

	it('pergola rezervačný odpis (lossy detail) → no-lines, nič sa neposiela', async () => {
		await zapisBezUploadu({
			...pergolaJob('ZAK570I', 'OP570009'),
			detail: { rezervacia: true }
		});
		const calls = captureTransport();
		expect(await uploadNarezakZOdpisu('ZAK570I', 'OP570009')).toEqual({ result: 'no-lines' });
		expect(calls).toHaveLength(0);
	});

	it('Odoo montalu_order_not_found → no-order (nie chyba)', async () => {
		await zapisBezUploadu(pergolaJob('ZAK570J', 'OP570010'));
		setJson2Transport(
			(async () =>
				new Response('UserError: montalu_order_not_found: objednávka nie je v Odoo', {
					status: 422
				})) as typeof fetch
		);
		const r = await uploadNarezakZOdpisu('ZAK570J', 'OP570010');
		expect(r.result).toBe('no-order');
		expect(r.error).toMatch(/montalu_order_not_found/);
	});

	it('Odoo 500 → failed so správou', async () => {
		await zapisBezUploadu(pergolaJob('ZAK570K', 'OP570011'));
		captureTransport(500);
		const r = await uploadNarezakZOdpisu('ZAK570K', 'OP570011');
		expect(r.result).toBe('failed');
		expect(r.error).toMatch(/HTTP 500/);
	});
});
