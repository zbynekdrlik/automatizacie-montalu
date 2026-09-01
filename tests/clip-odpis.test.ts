// CLIP zábradlie (#372) — route odpisový tok (spocitat → kontrola → odoslat) v TEST
// režime + Money-bezpečnosť. Nič sa nikdy nedostane do ostrého Money importu
// (MONEY_LIVE=0, MONEY_TEST_DIR). Odpis = počet tyčí per Money kód (mj 'ks');
// 4 drobné položky (kod:null) do odpisu NEVSTUPUJÚ (honest-null).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-clip-odpis-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'clip.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const clip = await import('../src/routes/clip/+page.server');
const { db } = await import('../src/lib/server/db');
const { listOdpisy, listOdpisPolozky } = await import('../src/lib/server/money');

function fd(body: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(body)) f.append(k, v);
	return f;
}
function ev(body: Record<string, string>) {
	return {
		request: new Request('http://x/clip', { method: 'POST', body: fd(body) }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
	} as never;
}

// izo B1 (N=2) 3000×1000 — kontraktný vektor (viď tests/clip.test.ts):
// odpis {ZASP00116:2, ZASP00125:1, ZASP00119:2}
const IZO_B1 = { typ: 'izo', variant: '2', sirka: '3000', vyska: '1000', ral: 'RAL 7016' };

const lastDetail = () =>
	JSON.parse(
		(
			db.prepare('SELECT detail FROM odpis_log ORDER BY id DESC LIMIT 1').get() as {
				detail: string;
			}
		).detail
	);

describe('clip route — spocitat (náhľad, bez zápisu)', () => {
	it('platný vstup → kontrola s výpočtom; odpis = profily (ZASP), drobné NEsú v polozky', async () => {
		const r = (await clip.actions.spocitat(
			ev({ zak: 'Z1', op: 'OP1', zakaznik: 'X', ...IZO_B1 })
		)) as { step: string; vypocet: import('../src/lib/clip').ClipVypocet };
		expect(r.step).toBe('kontrola');
		const g: Record<string, number> = {};
		r.vypocet.polozky.forEach((p) => (g[p.kod] = p.qty));
		expect(g).toEqual({ ZASP00116: 2, ZASP00125: 1, ZASP00119: 2 });
		expect(r.vypocet.polozky.every((p) => p.mj === 'ks')).toBe(true);
		// honest-null: žiadna položka s null kódom v Money odpise
		expect(r.vypocet.polozky.some((p) => (p.kod as unknown) === null)).toBe(false);
		// drobné (kod:null) sú v materiálovej tabuľke, ale nie v odpise
		const drobne = r.vypocet.riadky.filter((x) => x.kod === null);
		expect(drobne.map((x) => x.oznacenie)).toEqual([
			'vnútorné tesnenie',
			'vonkajšie tesnenie',
			'spojovník priečky',
			'kolík 6x12'
		]);
	});

	it('chýbajúce povinné pole → form error, žiadny výpočet', async () => {
		const r = (await clip.actions.spocitat(
			ev({ zak: '', op: 'OP1', zakaznik: 'X', ...IZO_B1 })
		)) as {
			step: string;
			error: string;
		};
		expect(r.step).toBe('form');
		expect(r.error).toMatch(/ZAK/i);
	});

	it('klasika B3 (N=4) je odmietnutá — mimo whitelistu (KM12 kódy v Money nie sú)', async () => {
		const r = (await clip.actions.spocitat(
			ev({
				zak: 'Z1',
				op: 'OP1',
				zakaznik: 'X',
				typ: 'klasika',
				variant: '4',
				sirka: '3000',
				vyska: '1000',
				ral: ''
			})
		)) as { step: string; error: string };
		expect(r.step).toBe('form');
		expect(r.error).toMatch(/B0 a B1/);
	});
});

describe('clip route — odoslat (TEST režim, do ostrého Money NIČ)', () => {
	it('zapíše odpis do TEST priečinka; polozky = profily (mj ks), detail nesie vstupRaw', async () => {
		const r = (await clip.actions.odoslat(
			ev({ zak: 'CLIP-1', op: 'OP1', zakaznik: 'Zákazník A', ...IZO_B1 })
		)) as { step: string; outcome: { live: boolean; filename: string } };
		expect(r.step).toBe('hotovo');
		expect(r.outcome.live).toBe(false);
		// súbor je v TEST priečinku (nikdy /data/dlv-import)
		expect(r.outcome.filename).toMatch(/\.xlsx$/);
		const files = fs.readdirSync(process.env.MONEY_TEST_DIR!);
		expect(files.some((f) => f === r.outcome.filename)).toBe(true);
		// polozky uložené 1:1
		const row = listOdpisy(200).find((o) => o.zak === 'CLIP-1' && o.op === 'OP1')!;
		expect(row.modul).toBe('clip');
		const items = listOdpisPolozky(row.id);
		expect(items).toEqual([
			{ kod: 'ZASP00116', nazov: 'Rámový profil Surový 7500 mm', qty: 2, mj: 'ks' },
			{ kod: 'ZASP00125', nazov: 'Priečkový profil Surový 7500 mm', qty: 1, mj: 'ks' },
			{ kod: 'ZASP00119', nazov: 'Zasklievací profil 28 mm Surový 7500 mm', qty: 2, mj: 'ks' }
		]);
		// detail nesie surový vstup 1:1 + kľúčové polia
		const d = lastDetail();
		expect(d.typ).toBe('izo');
		expect(d.variant).toBe(2);
		expect(d.sirka).toBe(3000);
		expect(d.vyska).toBe(1000);
		expect(d.ral).toBe('RAL 7016');
		expect(d.vstupRaw).toMatchObject({ zak: 'CLIP-1', op: 'OP1', typ: 'izo', variant: 2 });
	});

	it('ručná úprava počtu tyčí sa premietne do odpisu (applyEdits)', async () => {
		const r = (await clip.actions.odoslat(
			ev({ zak: 'CLIP-EDIT', op: 'OP1', zakaznik: 'X', ...IZO_B1, qty_ZASP00116: '7' })
		)) as { step: string; zmenene: string[] };
		expect(r.step).toBe('hotovo');
		expect(r.zmenene).toContain('ZASP00116');
		const row = listOdpisy(200).find((o) => o.zak === 'CLIP-EDIT')!;
		const items = listOdpisPolozky(row.id);
		expect(items.find((i) => i.kod === 'ZASP00116')!.qty).toBe(7);
	});

	it('záporná úprava sa ODMIETNE (do Money nesmie), ostáva v kontrole', async () => {
		const r = (await clip.actions.odoslat(
			ev({ zak: 'CLIP-NEG', op: 'OP1', zakaznik: 'X', ...IZO_B1, qty_ZASP00116: '-3' })
		)) as { step: string; error: string };
		expect(r.step).toBe('kontrola');
		expect(r.error).toMatch(/[Zz]áporné/);
		expect(listOdpisy(200).some((o) => o.zak === 'CLIP-NEG')).toBe(false);
	});

	it('duplikát tej istej ZAK+OP sa neodošle druhýkrát', async () => {
		const first = (await clip.actions.odoslat(
			ev({ zak: 'CLIP-DUP', op: 'OP1', zakaznik: 'X', ...IZO_B1 })
		)) as { step: string };
		expect(first.step).toBe('hotovo');
		const second = (await clip.actions.odoslat(
			ev({ zak: 'CLIP-DUP', op: 'OP1', zakaznik: 'X', ...IZO_B1 })
		)) as { step: string };
		expect(second.step).toBe('duplikat');
		// len JEDEN záznam
		expect(listOdpisy(200).filter((o) => o.zak === 'CLIP-DUP' && o.op === 'OP1').length).toBe(1);
	});
});

describe('clip — Money-bezpečnosť (statické záruky)', () => {
	it('src/lib/clip.ts NEIMPORTUJE nič zo server/* (client-safe, žiadny Money zápis)', () => {
		const src = fs.readFileSync(new URL('../src/lib/clip.ts', import.meta.url), 'utf8');
		expect(src).not.toMatch(/from ['"]\$lib\/server\//);
		expect(src).not.toMatch(/writeOdpis|MONEY_LIVE/);
	});

	it('route má presne akcie spocitat/upravit/odoslat', () => {
		expect(Object.keys(clip.actions).sort()).toEqual(['odoslat', 'spocitat', 'upravit']);
	});
});
