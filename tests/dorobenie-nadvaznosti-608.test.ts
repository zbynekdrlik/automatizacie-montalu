// #608 dorobenie — nadväznosti druhého odpisu tej istej zákazky (poradie 2):
//   - odpad z nárezov (`odpis_odpad`) sa viaže PER ODPIS — dorobenie dostane vlastné riadky, prvý ostane,
//   - cenový zoznam zákazky + Odoo log-note SČÍTAJÚ oba odpisy (materiál sa reálne spotreboval dvakrát)
//     a priznajú počet dorobení,
//   - readback z Money páruje EXKLUZÍVNE — dva doklady = dva odpisy, jeden doklad neoverí oba,
//   - kiosk nárezák: rezať sa má DOROBENIE (najnovší odpis modulu) a doc_id dostane príponu, aby Odoo
//     neprepísalo PDF prvého plánu.
// MONEY_LIVE=1, cieľové adresáre TEMP (do reálneho importu NIKDY nič).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-dorobenie-nadv-608-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import');
process.env.MONEY_NA_ODPIS_DIR = path.join(tmpRoot, 'dlv-import', 'NA ODPIS');
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'test-export');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json');
process.env.DLV_READBACK_PATH = path.join(tmpRoot, 'neexistuje-dlv.json');

const { writeOdpis, normZak } = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
const { saveOdpisOdpad } = await import('../src/lib/server/odpad-store');
const { zakazkaPrehlad } = await import('../src/lib/server/zakazka-ceny');
const { buildZakazkaNote, buildZakazkaNoteHtml } = await import('../src/lib/server/odoo-zakazka');
const { readbackStav } = await import('../src/lib/server/money-readback');
const { listLiveOdpisyForOp } = await import('../src/lib/server/backfill-narezaky-deps');
const { groupOdpisyPerOp, backfillDocId, poradieOp, odoslatNarezakPreOp } =
	await import('../src/lib/server/backfill-narezaky');
import type { OdpisJob, Polozka } from '../src/lib/server/money';

const ZAK = 'ZAK2026950';
const OP = 'OP261390';

function job(polozky: Polozka[]): OdpisJob {
	return {
		modul: 'zasklenia',
		zak: ZAK,
		op: OP,
		zakaznik: 'Javorský',
		caka: false,
		createdBy: 'patrik',
		cakaSubdir: 'Robust',
		popis: `${OP} : Javorský`,
		polozky,
		detail: { system: 'Robust', styl: '2K', s: 2509, v: 1930 }
	};
}
const POL: Polozka[] = [
	{ kod: 'ZASP00014', nazov: 'Koľajnica 2K', qty: 15 },
	{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', qty: 4, mj: 'ks' }
];
const material = (odpadMm: number) => [
	{ kod: 'ZASP00014', nazov: 'Koľajnica 2K', odpadMm, tyce: 2, barLen: 7500 }
];
/** Oba odpisy zákazky (pôvodný, dorobenie) v poradí vzniku — test padne, ak ich nie sú presne 2. */
const ids = (): [{ id: number; poradie: number }, { id: number; poradie: number }] => {
	const r = db.prepare('SELECT id, poradie FROM odpis_log WHERE zak = ? ORDER BY id').all(ZAK) as {
		id: number;
		poradie: number;
	}[];
	expect(r.length).toBe(2);
	return [r[0]!, r[1]!];
};

beforeAll(async () => {
	fs.mkdirSync(process.env.MONEY_LIVE_DIR!, { recursive: true });
	// 1. odpis + jeho odpad
	expect((await writeOdpis(job(POL))).status).toBe('written');
	saveOdpisOdpad(ZAK, OP, material(1204));
	// 2. dorobenie (identický obsah — ten istý posuv sa vyrába znova) + jeho vlastný odpad
	const b = await writeOdpis(job(POL));
	const d = await writeOdpis(job(POL), {
		overrideDorobenie: true,
		potvrdenieToken: b.potvrdenieToken
	});
	expect(d.status).toBe('written');
	saveOdpisOdpad(ZAK, OP, material(900));
});

describe('#608 odpad z nárezov per odpis', () => {
	it('[RED] dorobenie má vlastné odpad riadky, prvý odpis si ponechá svoje', () => {
		const [prvy, druhy] = ids();
		expect(druhy.poradie).toBe(2);
		const odpad = (id: number) =>
			db.prepare('SELECT odpad_mm FROM odpis_odpad WHERE odpis_log_id = ?').all(id);
		expect(odpad(prvy.id)).toEqual([{ odpad_mm: 1204 }]);
		expect(odpad(druhy.id)).toEqual([{ odpad_mm: 900 }]);
	});
});

describe('#608 cenový zoznam zákazky + Odoo log-note', () => {
	it('[RED] zakazkaPrehlad sčíta OBA odpisy (materiál dvakrát) a prizná 1 dorobenie', () => {
		const p = zakazkaPrehlad(ZAK)!;
		expect(p.odpisovVScope).toBe(2);
		expect(p.dorobeni).toBe(1);
		expect(p.odpisy.map((o) => o.poradie).sort()).toEqual([1, 2]);
		const kol = p.polozky.find((x) => x.kod === 'ZASP00014')!;
		expect(kol.qty).toBe(30);
		expect(p.odpad[0]!.odpadMm).toBe(2104);
	});

	it('[RED] Odoo log-note uvedie, že súčet zahŕňa dorobenie', () => {
		const note = buildZakazkaNote(zakazkaPrehlad(ZAK)!, OP, null);
		expect(note.dorobeni).toBe(1);
		const html = buildZakazkaNoteHtml(note, new Date('2026-10-08T08:00:00Z'));
		expect(html).toContain('dorobenie');
	});
});

describe('#608 readback z Money — exkluzívne párovanie dvoch dokladov jednej zákazky', () => {
	const setMeta = () => {
		db.prepare('DELETE FROM money_dlv_meta').run();
		db.prepare(
			"INSERT INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count, window_days) VALUES (1, datetime('now'), datetime('now'), 2, 0)"
		).run();
	};
	const insDlv = (dlv: string) =>
		db
			.prepare(
				'INSERT INTO money_dlv (dlv, zak_norm, op_norm, datum, pocet_polozek) VALUES (?, ?, ?, NULL, 2)'
			)
			.run(dlv, normZak(ZAK), '');

	it('[guard] jeden doklad v Money overí NAJVIAC jeden z dvoch odpisov (dorobenie neprejde „zadarmo")', () => {
		db.prepare('DELETE FROM money_dlv').run();
		setMeta();
		insDlv('DLV20260001');
		const [a, b] = ids();
		const st = readbackStav([a.id, b.id]);
		const ok = [st.get(a.id)!, st.get(b.id)!].filter((r) => r.stav === 'ok');
		expect(ok.length).toBe(1);
		expect(ok[0]!.dlv).toBe('DLV20260001');
	});

	it('[guard] dva doklady → každý odpis (pôvodný aj dorobenie) má vlastný doklad', () => {
		db.prepare('DELETE FROM money_dlv').run();
		setMeta();
		insDlv('DLV20260001');
		insDlv('DLV20260002');
		const [a, b] = ids();
		const st = readbackStav([a.id, b.id]);
		expect(st.get(a.id)!.stav).toBe('ok');
		expect(st.get(b.id)!.stav).toBe('ok');
		expect(st.get(a.id)!.dlv).not.toBe(st.get(b.id)!.dlv);
	});
});

describe('#608 kiosk nárezák (Odoo „Čo rezať") pri dorobení', () => {
	it('[RED] riadky odpisov OP nesú poradie a skupina OP berie DOROBENIE (najnovší odpis modulu)', () => {
		const rows = listLiveOdpisyForOp(OP);
		expect(rows.map((r) => r.poradie).sort()).toEqual([1, 2]);
		const g = groupOdpisyPerOp(rows).get(OP)!;
		expect(g.byModul.get('zasklenia')!.poradie).toBe(2);
		expect(poradieOp(g)).toBe(2);
	});

	it('[RED] doc_id: bez dorobenia nezmenený, pri dorobení prípona -d<N> (PDF prvého plánu ostane)', () => {
		expect(backfillDocId(OP)).toBe('backfill-narezak-op261390');
		expect(backfillDocId(OP, 1)).toBe('backfill-narezak-op261390');
		expect(backfillDocId(OP, 2)).toBe('backfill-narezak-op261390-d2');
		// aj najdlhšie OP ostane v Odoo limite 40 znakov a charsete [a-z0-9-]
		const dlhy = backfillDocId('OPDL2609999999999', 12);
		expect(dlhy.length).toBeLessThanOrEqual(40);
		expect(dlhy).toMatch(/^[a-z0-9-]+-d12$/);
		// riadok bez `poradie` (starší SELECT / fixtúra) sa ráta ako prvý odpis → bez prípony
		const bezPoradia = {
			id: 1,
			modul: 'zasklenia',
			zak: ZAK,
			op: OP,
			zakaznik: 'X',
			live: 1,
			content_hash: '',
			detail: '{}',
			created_at: '2026-10-08 07:00:00'
		};
		expect(
			poradieOp({ zak: ZAK, zakaznik: 'X', byModul: new Map([['zasklenia', bezPoradia]]) })
		).toBe(1);
	});

	it('[RED] upload nárezáku pri dorobení ide pod doc_id s príponou', async () => {
		const g = groupOdpisyPerOp(listLiveOdpisyForOp(OP)).get(OP)!;
		const docIds: string[] = [];
		const out = await odoslatNarezakPreOp(
			OP,
			g,
			[],
			[],
			async (_op, docId) => {
				docIds.push(docId);
			},
			() => {}
		);
		expect(out.akcia).toBe('uploaded');
		expect(docIds).toEqual(['backfill-narezak-op261390-d2']);
	});
});
