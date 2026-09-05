// #340: interný zoznam materiálu zákazky → interná log-note na sale.order v Odoo.
// VŠETKY qty/kódy/ceny sú VYMYSLENÉ (repo je verejné). Jedna DB pre celý súbor
// (db.ts je modulový singleton — vzor zakazka-ceny.test.ts); každý test vlastná ZAK.
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { OdooTransport } from '../src/lib/server/odoo-rpc';
import type { ZakazkaNote } from '../src/lib/server/odoo-zakazka';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odoo-zakazka-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
// enrichPolozky číta Money snapshot — nasmeruj na neexistujúci súbor (ceny = null → note
// prizná „cena nedostupná"; testujeme push, nie cenový snapshot).
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json');

const { db } = await import('../src/lib/server/db');
const { setOdooTransport } = await import('../src/lib/server/odoo-rpc');
const { buildZakazkaNote, buildZakazkaNoteHtml, pushZakazkaToOdoo, queueZakazkaPush } =
	await import('../src/lib/server/odoo-zakazka');
const { zakazkaPrehlad } = await import('../src/lib/server/zakazka-ceny');
const zakazkaPdf = await import('../src/lib/server/zakazka-pdf');

let nextId = 70001;
function seedOdpis(opts: {
	zak: string;
	op: string;
	polozky?: { kod: string; nazov: string; qty: number; mj?: string }[];
	live?: number;
	caka?: number;
	zakaznik?: string;
}): number {
	const id = nextId++;
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, presunute_at, zak_norm, op_norm)
		 VALUES (?, 'zasklenia', ?, ?, ?, ?, ?, '/t/f.xlsx', 'f.xlsx', ?, '{}', 'test', datetime('now'), NULL, ?, ?)`
	).run(
		id,
		opts.zak,
		opts.op,
		opts.zakaznik ?? 'Test Zákazník',
		opts.caka ?? 0,
		opts.live ?? 1,
		`hash-${id}`,
		opts.zak,
		opts.op
	);
	const ins = db.prepare(
		'INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, ?)'
	);
	for (const p of opts.polozky ?? []) ins.run(id, p.kod, p.nazov, p.qty, p.mj ?? 'm');
	return id;
}

/** Mock Odoo transport: routuje podľa metódy; zaznamenáva message_post a ir.attachment create. */
function mockOdoo(opts: {
	searchIds: number[];
	onPost?: (body: string) => void;
	onAttach?: (body: string) => void;
	attachThrows?: boolean; // ir.attachment create hodí fault (best-effort test)
	attId?: number;
}): OdooTransport {
	return async (_url, body) => {
		if (body.includes('<methodName>authenticate</methodName>'))
			return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
		if (body.includes('<string>search</string>')) {
			const items = opts.searchIds.map((n) => `<value><int>${n}</int></value>`).join('');
			return `<methodResponse><params><param><value><array><data>${items}</data></array></value></param></params></methodResponse>`;
		}
		if (body.includes('<string>ir.attachment</string>')) {
			opts.onAttach?.(body);
			if (opts.attachThrows)
				return '<methodResponse><fault><value><struct><member><name>faultCode</name><value><int>1</int></value></member><member><name>faultString</name><value><string>attach denied</string></value></member></struct></value></fault></methodResponse>';
			return `<methodResponse><params><param><value><int>${opts.attId ?? 8801}</int></value></param></params></methodResponse>`;
		}
		if (body.includes('<string>message_post</string>')) {
			opts.onPost?.(body);
			return '<methodResponse><params><param><value><int>9001</int></value></param></params></methodResponse>';
		}
		throw new Error('unexpected RPC: ' + body.slice(0, 120));
	};
}

const ENV = {
	ODOO_LEAD_URL: 'https://odoo.test',
	ODOO_LEAD_DB: 'odoo',
	ODOO_LEAD_LOGIN: 'web',
	ODOO_LEAD_API_KEY: 'k'
};
function enableOdoo() {
	for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
}

afterEach(() => {
	setOdooTransport(null);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

// ---- payload composition (pure) -----------------------------------------------------

describe('buildZakazkaNote', () => {
	it('mapuje položky, cena = qty × jednotková predajná VO, neznáma cena → null', () => {
		seedOdpis({
			zak: 'ZAKNOTE1',
			op: 'OP111',
			polozky: [{ kod: 'K1', nazov: 'Profil A', qty: 2 }]
		});
		const prehlad = zakazkaPrehlad('ZAKNOTE1')!;
		const ceny = {
			radky: [
				{
					kod: 'K1',
					nazov: 'Profil A',
					qty: 2,
					mj: 'm',
					nakupCennik: 4,
					nakupPoslednaFaktura: null,
					predajVo: 5,
					marza: 1,
					sklad: null,
					mena: 'EUR'
				}
			],
			sucty: {
				nakupCennik: { suma: 8, kompletne: true },
				nakupPoslednaFaktura: { suma: 0, kompletne: false },
				predajVo: { suma: 10, kompletne: true },
				marza: { suma: 2, kompletne: true }
			},
			snapshot: null
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const note = buildZakazkaNote(prehlad, 'OP111', ceny as any);
		expect(note.sekcie[0]!.polozky[0]!.cena).toBe(10); // 2 × 5
		expect(note.cenaSpolu).toBe(10);
		expect(note.cenaKompletna).toBe(true);
		expect(note.cenaNakupSpolu).toBe(8);
	});
	it('bez cien (ceny=null) → cena položky null, cenaSpolu null, kompletne false', () => {
		seedOdpis({ zak: 'ZAKNOTE2', op: 'OP112', polozky: [{ kod: 'K2', nazov: 'B', qty: 1 }] });
		const note = buildZakazkaNote(zakazkaPrehlad('ZAKNOTE2')!, 'OP112', null);
		expect(note.sekcie[0]!.polozky[0]!.cena).toBeNull();
		expect(note.cenaSpolu).toBeNull();
		expect(note.cenaKompletna).toBe(false);
	});
});

// ---- HTML body (escaping + honesty lines) -------------------------------------------

const baseNote: ZakazkaNote = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'Firma s.r.o.',
	scope: 'live',
	parkovanych: 0,
	bezPoloziek: 0,
	odpisovVScope: 1,
	sekcie: [
		{
			nadpis: 'Profily a komponenty',
			polozky: [{ kod: 'K1', nazov: 'Profil', qty: 3, mj: 'm', cena: 12.5 }]
		}
	],
	cenaSpolu: 12.5,
	cenaKompletna: true,
	cenaNakupSpolu: 8,
	nakupKompletna: true,
	odpad: []
};

describe('buildZakazkaNoteHtml', () => {
	const NOW = new Date('2026-08-31T10:00:00Z');
	it('obsahuje hlavičku, položku, celkovú cenu a „nahrádza predchádzajúce"', () => {
		const html = buildZakazkaNoteHtml(baseNote, NOW);
		expect(html).toContain('Interný zoznam materiálu k zákazke');
		expect(html).toContain('nahrádza predchádzajúce');
		expect(html).toContain('zákazník'); // priznanie internej viditeľnosti
		expect(html).toContain('K1');
		expect(html).toContain('Celková cena (predaj VO): 12,50 €');
		expect(html).toContain('<table');
	});
	it('HTML injekcia v názve položky sa vyescapuje (renderuje ako text)', () => {
		const evil: ZakazkaNote = {
			...baseNote,
			sekcie: [
				{
					nadpis: 'Profily a komponenty',
					polozky: [{ kod: 'K1', nazov: '<script>alert(1)</script>', qty: 1, mj: 'm', cena: null }]
				}
			]
		};
		const html = buildZakazkaNoteHtml(evil, NOW);
		expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
		expect(html).not.toContain('<script>alert(1)</script>');
	});
	it('neúplná cena → prizná NEÚPLNÁ; test scope + parkované + bezPoloziek sa priznajú', () => {
		const n: ZakazkaNote = {
			...baseNote,
			scope: 'test',
			parkovanych: 2,
			bezPoloziek: 1,
			cenaKompletna: false
		};
		const html = buildZakazkaNoteHtml(n, NOW);
		expect(html).toContain('NEÚPLNÁ');
		expect(html).toContain('TEST');
		expect(html).toContain('parkovaných');
		expect(html).toContain('CHÝBA');
	});
});

// ---- push do Odoo -------------------------------------------------------------------

describe('pushZakazkaToOdoo', () => {
	it('disabled keď chýba ODOO_LEAD_* env', async () => {
		expect(await pushZakazkaToOdoo('ZAKX', 'OP1')).toBe('disabled');
	});
	it('missing keď zákazka nemá žiadny odpis', async () => {
		enableOdoo();
		expect(await pushZakazkaToOdoo('ZAK-NEEXISTUJE', 'OP1')).toBe('missing');
	});
	it('no-order keď sale.order sa nenašiel (search vráti [])', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKNOORD', op: 'OP900', polozky: [{ kod: 'K1', nazov: 'A', qty: 1 }] });
		setOdooTransport(mockOdoo({ searchIds: [] }));
		expect(await pushZakazkaToOdoo('ZAKNOORD', 'OP900')).toBe('no-order');
	});
	it('posted → note + PDF príloha (ir.attachment) naviazaná na internú mt_note, leak drží', async () => {
		enableOdoo();
		seedOdpis({
			zak: 'ZAKPOST',
			op: '260439', // bare číslo → normOp → OP260439
			zakaznik: 'ACME',
			polozky: [{ kod: 'K1', nazov: 'Profil', qty: 2 }]
		});
		let postedBody = '';
		let searchBody = '';
		let attachBody = '';
		setOdooTransport(async (_u, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
			if (body.includes('<string>search</string>')) {
				searchBody = body;
				return '<methodResponse><params><param><value><array><data><value><int>53051</int></value></data></array></value></param></params></methodResponse>';
			}
			if (body.includes('<string>ir.attachment</string>')) {
				attachBody = body;
				return '<methodResponse><params><param><value><int>8801</int></value></param></params></methodResponse>';
			}
			if (body.includes('<string>message_post</string>')) {
				postedBody = body;
				return '<methodResponse><params><param><value><int>1</int></value></param></params></methodResponse>';
			}
			throw new Error('unexpected');
		});
		expect(await pushZakazkaToOdoo('ZAKPOST', '260439')).toBe('posted');
		// match na sale.order.name = OP260439 (normOp z bare čísla)
		expect(searchBody).toContain('<string>OP260439</string>');
		// ir.attachment create: base64 PDF (datas), naviazané na sale.order 53051, binary/pdf
		expect(attachBody).toContain('<string>ir.attachment</string>');
		expect(attachBody).toContain('<string>create</string>');
		expect(attachBody).toMatch(/<name>datas<\/name><value><string>[A-Za-z0-9+/=]{40,}<\/string>/);
		expect(attachBody).toContain('<name>res_model</name><value><string>sale.order</string>');
		expect(attachBody).toContain('<name>res_id</name><value><int>53051</int>');
		expect(attachBody).toContain('<name>type</name><value><string>binary</string>');
		expect(attachBody).toContain('<name>mimetype</name><value><string>application/pdf</string>');
		// príloha NIE JE public (druhá vrstva k naviazaniu na internú note); <name>public</name> je base64-safe
		expect(attachBody).not.toContain('<name>public</name>');
		// interná log-note kontrakt (zákazník to NIKDY nevidí)
		expect(postedBody).toContain('<string>mail.mt_note</string>');
		expect(postedBody).toContain('<name>message_type</name><value><string>comment</string>');
		expect(postedBody).toContain(
			'<name>partner_ids</name><value><array><data></data></array></value>'
		);
		// PDF príloha je NAVIAZANÁ na TÚTO internú správu → dedí neúnikovú garanciu #340
		expect(postedBody).toContain(
			'<name>attachment_ids</name><value><array><data><value><int>8801</int></value></data></array></value>'
		);
		// postnuté na nájdený sale.order id
		expect(postedBody).toContain('<value><int>53051</int></value>');
		// NEGATÍVNY leak kontrakt: žiadny notifikačný kwarg
		expect(postedBody).not.toContain('email_from');
		expect(postedBody).not.toContain('subtype_id'); // používame subtype_xmlid, nie subtype_id
		expect(postedBody).not.toMatch(/partner_ids<\/name><value><array><data><value>/); // partner_ids je PRÁZDNE
	});
	it('injekcia v názve → na DRÔTE dvojito escapovaná (renderuje ako text, nie tag)', async () => {
		enableOdoo();
		seedOdpis({
			zak: 'ZAKINJ',
			op: 'OP950',
			polozky: [{ kod: 'K1', nazov: '<script>alert(1)</script>', qty: 1 }]
		});
		let postedBody = '';
		setOdooTransport(async (_u, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
			if (body.includes('<string>search</string>'))
				return '<methodResponse><params><param><value><array><data><value><int>7</int></value></data></array></value></param></params></methodResponse>';
			if (body.includes('<string>ir.attachment</string>'))
				return '<methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>';
			postedBody = body;
			return '<methodResponse><params><param><value><int>1</int></value></param></params></methodResponse>';
		});
		expect(await pushZakazkaToOdoo('ZAKINJ', 'OP950')).toBe('posted');
		// hodnota html-escapnutá (&lt;script&gt;) a potom XML-escapnutá encoderom → &amp;lt;script na drôte
		expect(postedBody).toContain('&amp;lt;script&amp;gt;');
		// surový spustiteľný tag sa na drôte NEOBJAVÍ
		expect(postedBody).not.toContain('<script>alert(1)</script>');
	});

	it('>1 zhoda → postne na VŠETKY', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKMULTI', op: 'OP700', polozky: [{ kod: 'K1', nazov: 'A', qty: 1 }] });
		const posts: number[] = [];
		setOdooTransport(async (_u, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
			if (body.includes('<string>search</string>'))
				return '<methodResponse><params><param><value><array><data><value><int>11</int></value><value><int>22</int></value></data></array></value></param></params></methodResponse>';
			if (body.includes('<string>ir.attachment</string>'))
				return '<methodResponse><params><param><value><int>5</int></value></param></params></methodResponse>';
			if (body.includes('<string>message_post</string>')) {
				const m = /message_post<\/string>[\s\S]*?<int>(\d+)<\/int>/.exec(body);
				if (m) posts.push(Number(m[1]));
				return '<methodResponse><params><param><value><int>1</int></value></param></params></methodResponse>';
			}
			throw new Error('unexpected');
		});
		expect(await pushZakazkaToOdoo('ZAKMULTI', 'OP700')).toBe('posted');
		expect(posts).toEqual([11, 22]);
	});
	it('best-effort: keď ir.attachment create zlyhá, note sa AJ TAK postne (bez attachment_ids)', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKATT', op: 'OP940', polozky: [{ kod: 'K1', nazov: 'A', qty: 1 }] });
		let postedBody = '';
		setOdooTransport(
			mockOdoo({ searchIds: [77], attachThrows: true, onPost: (b) => (postedBody = b) })
		);
		expect(await pushZakazkaToOdoo('ZAKATT', 'OP940')).toBe('posted');
		// note ide aj bez prílohy — attachment_ids sa NEUVÁDZA (leak-kontrakt aj tak drží)
		expect(postedBody).toContain('<string>mail.mt_note</string>');
		expect(postedBody).not.toContain('attachment_ids');
		expect(postedBody).toContain('<value><int>77</int></value>');
	});
	it('best-effort: keď PDF-gen zlyhá, note sa AJ TAK postne (posted, žiadna príloha)', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKPDF', op: 'OP930', polozky: [{ kod: 'K1', nazov: 'A', qty: 1 }] });
		vi.spyOn(zakazkaPdf, 'generateZakazkaPdfBase64').mockRejectedValue(new Error('pdf boom'));
		let postedBody = '';
		let sawAttach = false;
		setOdooTransport(async (_u, body) => {
			if (body.includes('<methodName>authenticate</methodName>'))
				return '<methodResponse><params><param><value><int>252</int></value></param></params></methodResponse>';
			if (body.includes('<string>search</string>'))
				return '<methodResponse><params><param><value><array><data><value><int>55</int></value></data></array></value></param></params></methodResponse>';
			if (body.includes('<string>ir.attachment</string>')) {
				sawAttach = true;
				return '<methodResponse><params><param><value><int>1</int></value></param></params></methodResponse>';
			}
			if (body.includes('<string>message_post</string>')) {
				postedBody = body;
				return '<methodResponse><params><param><value><int>1</int></value></param></params></methodResponse>';
			}
			throw new Error('unexpected');
		});
		expect(await pushZakazkaToOdoo('ZAKPDF', 'OP930')).toBe('posted');
		// PDF zlyhal → žiadna príloha sa netvorí, ale note (primárny záznam) ide
		expect(sawAttach).toBe(false);
		expect(postedBody).toContain('<string>mail.mt_note</string>');
		expect(postedBody).not.toContain('attachment_ids');
	});
	it('NIKDY nehádže — transport chyba → failed', async () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKERR', op: 'OP800', polozky: [{ kod: 'K1', nazov: 'A', qty: 1 }] });
		setOdooTransport(async () => {
			throw new Error('siet down');
		});
		expect(await pushZakazkaToOdoo('ZAKERR', 'OP800')).toBe('failed');
	});
});

describe('queueZakazkaPush', () => {
	it('fire-and-forget: nevráti nič a nehádže ani keď je Odoo dole', () => {
		enableOdoo();
		seedOdpis({ zak: 'ZAKQ', op: 'OP1', polozky: [{ kod: 'K1', nazov: 'A', qty: 1 }] });
		setOdooTransport(async () => {
			throw new Error('down');
		});
		expect(() => queueZakazkaPush('ZAKQ', 'OP1')).not.toThrow();
	});
});

// ---- Money-neutralita (odoo-zakazka NEPÍŠE do /data, nemení Money write cestu) -------

describe('Money-neutralita', () => {
	it('zdroj NEZAPISUJE do /data a nevolá writeOdpis', () => {
		const src = fs.readFileSync(
			new URL('../src/lib/server/odoo-zakazka.ts', import.meta.url),
			'utf8'
		);
		expect(src).not.toMatch(/\/data\//);
		expect(src).not.toMatch(/writeOdpis\s*\(/); // žiadne VOLANIE writeOdpis
		expect(src).not.toMatch(/fs\.(write|append|mkdir|rename|open)/);
		expect(src).not.toMatch(/process\.env\.MONEY_LIVE|isLive\s*\(/); // žiadny prístup k MONEY_LIVE
	});
});
