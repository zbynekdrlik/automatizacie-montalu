// #524: backfill nárezákov → Odoo `lines`. Mapper (odpis `detail` → lines) per modul + orchestrácia
// (`runBackfill`). DI transport (fake upload/existencia) = žiadny PROD Odoo; DB je seedovaná per-file
// izolátorom (`tests/setup/db-isolation.ts`), takže `loadCfg()` + sklo katalóg fungujú.
//
// Money-NEUTRÁLNE: mapper číta len `detail`/`odpis_polozky`, orchestrácia volá injektovaný upload —
// žiadny zápis do Money/`odpis_log` (source-guard v `backfill-narezaky-money-safety.test.ts`).
import { describe, it, expect, vi } from 'vitest';
import {
	mapOdpisToLines,
	backfillDocId,
	driftVsStored,
	runBackfill,
	type OdpisBackfillRow,
	type BackfillDeps
} from '../src/lib/server/backfill-narezaky';
import { rozpisLinesFromMaterial, type RozpisLine } from '../src/lib/server/odoo-rozpis-lines';
import { recomputeVstup } from '../src/lib/server/zasklenia-sklo';
import { loadCfg } from '../src/lib/server/db';
import type { Vstup } from '../src/lib/server/vstup';
import type { Polozka } from '../src/lib/server/money';
import { SKLO_INE } from '../src/lib/sklo';

const cfg = loadCfg();

function row(over: Partial<OdpisBackfillRow>): OdpisBackfillRow {
	return {
		id: 1,
		modul: 'pergola',
		zak: 'ZAK1',
		op: 'OP260500',
		zakaznik: 'Test',
		live: 1,
		content_hash: 'abc',
		detail: '{}',
		created_at: '2026-09-10 12:00:00',
		...over
	};
}

describe('backfillDocId', () => {
	it('stabilný per-OP doc_id s vlastným prefixom, matchuje Odoo regex', () => {
		expect(backfillDocId('OP260500')).toBe('backfill-narezak-op260500');
		expect(backfillDocId('260500')).toBe('backfill-narezak-op260500'); // normOp prepend OP
	});
	it('vždy [a-z0-9_-]{1,40} a ≤40 znakov (extrémne dlhé OP)', () => {
		for (const op of ['OP260500', 'X'.repeat(100), 'o p#q', '']) {
			const id = backfillDocId(op);
			expect(id).toMatch(/^[a-z0-9_-]{1,40}$/);
			expect(id.length).toBeLessThanOrEqual(40);
		}
	});
	it('nekoliduje s plán-rezov doc_id (iný prefix)', () => {
		expect(backfillDocId('OP1')).toMatch(/^backfill-narezak-/);
	});
});

describe('driftVsStored', () => {
	const stored: Polozka[] = [
		{ kod: 'ZASP00014', nazov: 'A', qty: 15, mj: 'm' },
		{ kod: 'ZASP00002', nazov: 'B', qty: 22.5, mj: 'm' },
		{ kod: 'KOV1', nazov: 'kovanie', qty: 2, mj: 'ks' } // uložené navyše — ignoruje sa
	];
	it('zhoda profilov → žiadny drift (kovanie navyše ignorované)', () => {
		expect(
			driftVsStored(
				[
					{ kod: 'ZASP00014', qty: 15 },
					{ kod: 'ZASP00002', qty: 22.5 }
				],
				stored
			)
		).toBe(false);
	});
	it('iné množstvo profilu → drift', () => {
		expect(driftVsStored([{ kod: 'ZASP00014', qty: 20 }], stored)).toBe(true);
	});
	it('znovu-dopočítaný kód chýba v uloženom → drift', () => {
		expect(driftVsStored([{ kod: 'NOVY', qty: 5 }], stored)).toBe(true);
	});
	it('presnosť na 3 des. miesta (0.0004 rozdiel = žiadny drift)', () => {
		expect(driftVsStored([{ kod: 'ZASP00002', qty: 22.5004 }], stored)).toBe(false);
	});
});

describe('mapOdpisToLines — pergola/fix CAD (surový rozpis, žiadny drift-tag)', () => {
	const cad = '18013 Žlabový profil 110\t4\t4500\n18020 Kotviaci profil\t2\t2834,5';

	it('pergola CAD → presné lines (mm→m, mj ks, kod prázdny, poznamka prázdna)', () => {
		const res = mapOdpisToLines(
			row({ modul: 'pergola', detail: JSON.stringify({ cad }) }),
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.drift).toBe(false);
		expect(res.lines).toEqual([
			{ kod: '', nazov: 'Žlabový profil 110', mnozstvo: 4, mj: 'ks', dlzka: 4.5, poznamka: '' },
			{ kod: '', nazov: 'Kotviaci profil', mnozstvo: 2, mj: 'ks', dlzka: 2.8345, poznamka: '' }
		]);
	});

	it('fix CAD → rovnaké mapovanie (zdieľaný CAD parser)', () => {
		const res = mapOdpisToLines(row({ modul: 'fix', detail: JSON.stringify({ cad }) }), [], cfg);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.lines).toHaveLength(2);
		expect(res.lines[0]).toMatchObject({ nazov: 'Žlabový profil 110', mnozstvo: 4, dlzka: 4.5 });
	});

	it('pergola rezervačná cesta (lossy detail) → skip pergola-rezervacia', () => {
		const res = mapOdpisToLines(
			row({ modul: 'pergola', detail: JSON.stringify({ rezervacia: true, system: 'LIGHT' }) }),
			[],
			cfg
		);
		expect(res).toEqual({ status: 'skip', reason: 'pergola-rezervacia' });
	});

	it('pergola bez CAD aj bez rezervácie → skip unreconstructable', () => {
		const res = mapOdpisToLines(row({ modul: 'pergola', detail: '{}' }), [], cfg);
		expect(res).toEqual({ status: 'skip', reason: 'unreconstructable' });
	});
});

describe('mapOdpisToLines — clip (počítaný rozpis, drift porovnaním s odpis_polozky)', () => {
	const vstupRaw = { typ: 'klasika', variant: 2, sirka: 2000, vyska: 1000, ral: 'RAL9006' };
	const clipRow = row({ modul: 'clip', detail: JSON.stringify({ vstupRaw }) });

	it('clip single → lines: mj ks, kod prázdny, dlzka=rozmer/1000, mnozstvo=počet kusov', () => {
		const res = mapOdpisToLines(clipRow, [], cfg);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.lines.length).toBeGreaterThan(0);
		for (const l of res.lines) {
			expect(l.kod).toBe('');
			expect(l.mj).toBe('ks');
			expect(Number.isFinite(l.dlzka)).toBe(true);
			expect(l.dlzka).toBeGreaterThan(0);
			expect(Number.isInteger(l.mnozstvo)).toBe(true);
			expect(l.mnozstvo).toBeGreaterThan(0);
		}
	});

	it('multiClip → riadky všetkých kusov (2× kus = 2× toľko riadkov)', () => {
		const single = mapOdpisToLines(clipRow, [], cfg);
		const multi = mapOdpisToLines(
			row({
				modul: 'clip',
				detail: JSON.stringify({ multiClip: true, kusy: [vstupRaw, vstupRaw] })
			}),
			[],
			cfg
		);
		expect(single.status).toBe('lines');
		expect(multi.status).toBe('lines');
		if (single.status !== 'lines' || multi.status !== 'lines') return;
		expect(multi.lines.length).toBe(single.lines.length * 2);
	});
});

describe('mapOdpisToLines — zasklenia (seeded DB, rekomputa z detail.vstupRaw)', () => {
	const zaskVstup: Vstup = {
		zak: 'ZAK9',
		op: 'OP260900',
		zakaznik: 'Test',
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
	};
	const { r } = recomputeVstup(zaskVstup, cfg);
	const storedPolozky: Polozka[] = (r?.odpis ?? []).map((o) => ({
		kod: o.kod,
		nazov: o.nazov,
		qty: o.metre,
		mj: 'm' as const
	}));
	const zaskRow = row({
		modul: 'zasklenia',
		detail: JSON.stringify({ vstupRaw: zaskVstup }),
		created_at: '2026-09-10 12:00:00'
	});

	it('sklo/systém sú platné (predpoklad testu) — rekomputa vráti materiál', () => {
		expect(r).not.toBeNull();
		expect(storedPolozky.length).toBeGreaterThan(0);
	});

	it('zasklenia detail → lines totožné s rozpisLinesFromMaterial(r.material); zhodné polozky = žiadny drift', () => {
		const res = mapOdpisToLines(zaskRow, storedPolozky, cfg);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.drift).toBe(false);
		expect(res.lines).toEqual(rozpisLinesFromMaterial(r!.material));
	});

	it('zmenená uložená metráž profilu → drift → poznamka „spätne dopočítané <dátum>"', () => {
		const drifted = storedPolozky.map((p, i) => (i === 0 ? { ...p, qty: p.qty + 5 } : p));
		const res = mapOdpisToLines(zaskRow, drifted, cfg);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.drift).toBe(true);
		expect(res.lines.every((l) => l.poznamka === 'spätne dopočítané 2026-09-10')).toBe(true);
	});
});

describe('mapOdpisToLines — samostatná sieťka (pod modul=zasklenia, seeded DB)', () => {
	const sietkaDetail = {
		sietkaSamostatna: true,
		system: 'Robust',
		styl: '2K',
		otvorS: 2509,
		otvorV: 1930
	};

	it('sietkaSamostatna → lines z materiálu sieťky (mj ks, kod prázdny)', () => {
		const res = mapOdpisToLines(
			row({ modul: 'zasklenia', detail: JSON.stringify(sietkaDetail) }),
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.lines.length).toBeGreaterThan(0);
		expect(res.lines.every((l) => l.mj === 'ks' && l.kod === '')).toBe(true);
	});

	it('sietkaSamostatnaMulti → riadky všetkých kusov (2× kus = 2× toľko)', () => {
		const single = mapOdpisToLines(
			row({ modul: 'zasklenia', detail: JSON.stringify(sietkaDetail) }),
			[],
			cfg
		);
		const kus = { system: 'Robust', styl: '2K', otvorS: 2509, otvorV: 1930 };
		const multi = mapOdpisToLines(
			row({
				modul: 'zasklenia',
				detail: JSON.stringify({ sietkaSamostatnaMulti: true, kusy: [kus, kus] })
			}),
			[],
			cfg
		);
		expect(single.status).toBe('lines');
		expect(multi.status).toBe('lines');
		if (single.status !== 'lines' || multi.status !== 'lines') return;
		expect(multi.lines.length).toBe(single.lines.length * 2);
	});
});

describe('mapOdpisToLines — zasklenia zimná záhrada (multiZasklenie, seeded DB)', () => {
	const posuv = {
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
		kliny: [],
		kolajnica: null,
		sietka: null
	};
	const multiVstup = {
		zak: 'ZAK9',
		op: 'OP260901',
		zakaznik: 'Test',
		poznamka: '',
		ral: '',
		caka: false,
		pridavnaKolajnica: false,
		jednostrannaFab: false,
		farbaKovania: null,
		posuvy: [posuv]
	};

	it('multiZasklenie → lines zo všetkých posuvov', () => {
		const res = mapOdpisToLines(
			row({
				modul: 'zasklenia',
				detail: JSON.stringify({ multiZasklenie: true, vstupRaw: multiVstup })
			}),
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.lines.length).toBeGreaterThan(0);
		expect(res.lines.every((l) => l.mj === 'ks' && l.kod === '')).toBe(true);
	});

	it('multiZasklenie bez vstupRaw → skip unreconstructable', () => {
		expect(
			mapOdpisToLines(
				row({ modul: 'zasklenia', detail: JSON.stringify({ multiZasklenie: true }) }),
				[],
				cfg
			)
		).toEqual({ status: 'skip', reason: 'unreconstructable' });
	});
});

describe('mapOdpisToLines — okrajové vetvy rekomputy (seeded DB)', () => {
	function robustVstup(over: Partial<Vstup>): Vstup {
		return {
			zak: 'ZAK',
			op: 'OP1',
			zakaznik: 'T',
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
			sietka: null,
			...over
		};
	}

	it('vlastná skladba (sklo=SKLO_INE + trieda) → syntetické sklo, lines vzniknú', () => {
		const vstup = robustVstup({ sklo: SKLO_INE, skloPresne: 'moja skladba 6mm', skloTrieda: 6 });
		const res = mapOdpisToLines(
			row({ modul: 'zasklenia', detail: JSON.stringify({ vstupRaw: vstup }) }),
			[],
			cfg
		);
		expect(res.status).toBe('lines');
		if (res.status !== 'lines') return;
		expect(res.lines.length).toBeGreaterThan(0);
	});

	it('neplatné sklo v jednoposuve → skip recompute-failed', () => {
		const vstup = robustVstup({ sklo: 'NEEXISTUJE-SKLO' });
		expect(
			mapOdpisToLines(
				row({ modul: 'zasklenia', detail: JSON.stringify({ vstupRaw: vstup }) }),
				[],
				cfg
			)
		).toEqual({ status: 'skip', reason: 'recompute-failed' });
	});

	it('multiZasklenie s neplatným sklom v posuve → skip recompute-failed', () => {
		const badMulti = {
			zak: 'ZAK',
			op: 'OP1',
			zakaznik: 'T',
			poznamka: '',
			ral: '',
			caka: false,
			pridavnaKolajnica: false,
			jednostrannaFab: false,
			farbaKovania: null,
			posuvy: [
				{
					system: 'Robust',
					styl: '2K',
					s: 2000,
					v: 1000,
					sklo: 'NEEXISTUJE',
					skloPresne: '',
					skloTrieda: null,
					otvaranie: '',
					kovanieL: '',
					kovanieP: '',
					kovanieStred: '',
					kovanieStredOkno: 'L',
					kliny: [],
					kolajnica: null,
					sietka: null
				}
			]
		};
		expect(
			mapOdpisToLines(
				row({
					modul: 'zasklenia',
					detail: JSON.stringify({ multiZasklenie: true, vstupRaw: badMulti })
				}),
				[],
				cfg
			)
		).toEqual({ status: 'skip', reason: 'recompute-failed' });
	});

	it('CAD bez validných riadkov → skip no-cut-list', () => {
		const res = mapOdpisToLines(
			row({
				modul: 'pergola',
				detail: JSON.stringify({ cad: 'úplne nezmyselný riadok bez formátu' })
			}),
			[],
			cfg
		);
		expect(res).toEqual({ status: 'skip', reason: 'no-cut-list' });
	});
});

describe('mapOdpisToLines — mimo záberu', () => {
	it('bazén → skip out-of-scope (žiadny rozpis rezov)', () => {
		expect(mapOdpisToLines(row({ modul: 'bazen' }), [], cfg)).toEqual({
			status: 'skip',
			reason: 'out-of-scope'
		});
	});
	it('nevalidný JSON detail → skip unreconstructable', () => {
		expect(mapOdpisToLines(row({ modul: 'clip', detail: '{not json' }), [], cfg)).toEqual({
			status: 'skip',
			reason: 'unreconstructable'
		});
	});
});

// ---- orchestrácia ----

const CAD_A = '18013 Profil A\t3\t3000';
const CAD_B = '18020 Profil B\t1\t2000';

function deps(over: Partial<BackfillDeps> = {}): BackfillDeps & {
	uploadLines: ReturnType<typeof vi.fn>;
} {
	const uploadLines =
		(over.uploadLines as ReturnType<typeof vi.fn> | undefined) ??
		vi.fn(async () => ({ lines_created: 1 }));
	return {
		cfg,
		loadPolozky: () => [],
		orderExists: async () => true,
		orderHasLines: async () => false,
		now: new Date('2026-09-16T10:00:00Z'),
		sleep: async () => {},
		...over,
		uploadLines
	} as BackfillDeps & { uploadLines: ReturnType<typeof vi.fn> };
}

describe('runBackfill — orchestrácia', () => {
	it('dry-run NEPOŠLE nič (upload spy 0×), vráti dry-run akcie + počty', async () => {
		const d = deps();
		const s = await runBackfill(
			[row({ id: 1, op: 'OP1', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
		expect(s.objednavok).toBe(1);
		expect(s.nahranych).toBe(1); // dry-run: „poslal by"
		expect(s.riadkovSpolu).toBe(1);
		expect(s.ops[0]!.akcia).toBe('dry-run');
	});

	it('ostrý beh pošle 1 upload per OP s doc_id + skombinovanými lines', async () => {
		const d = deps();
		await runBackfill(
			[row({ id: 1, op: 'OP2', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).toHaveBeenCalledTimes(1);
		const [orderNumber, docId, lines] = d.uploadLines.mock.calls[0]!;
		expect(orderNumber).toBe('OP2');
		expect(docId).toBe('backfill-narezak-op2');
		expect(lines).toHaveLength(1);
	});

	it('per-OP kombinácia: dva moduly tej istej OP → JEDEN upload so spojenými lines', async () => {
		const d = deps();
		await runBackfill(
			[
				row({ id: 1, op: 'OP3', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) }),
				row({ id: 2, op: 'OP3', modul: 'fix', detail: JSON.stringify({ cad: CAD_B }) })
			],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).toHaveBeenCalledTimes(1);
		const lines = d.uploadLines.mock.calls[0]![2] as RozpisLine[];
		expect(lines).toHaveLength(2); // 1 z pergoly + 1 z fixu
		expect(lines.map((l) => l.nazov).sort()).toEqual(['Profil A', 'Profil B']);
	});

	it('OP bez objednávky v Odoo → skip-no-order, žiadny upload', async () => {
		const d = deps({ orderExists: async () => false });
		const s = await runBackfill(
			[row({ id: 1, op: 'OP4', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
		expect(s.skipNoOrder).toBe(1);
		expect(s.ops[0]!.akcia).toBe('skip-no-order');
	});

	it('OP ktorá už má riadky → skip-has-lines (additive, chráni #522 riadky), aj v dry-rune', async () => {
		const d = deps({ orderHasLines: async () => true });
		const s = await runBackfill(
			[row({ id: 1, op: 'OP5', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
		expect(s.skipHasLines).toBe(1);
		expect(s.ops[0]!.akcia).toBe('skip-has-lines');
	});

	it('posledný odpis per (op, modul) vyhráva (novší created_at)', async () => {
		const d = deps();
		await runBackfill(
			[
				row({
					id: 1,
					op: 'OP6',
					modul: 'pergola',
					detail: JSON.stringify({ cad: CAD_A }),
					created_at: '2026-09-01 08:00:00'
				}),
				row({
					id: 2,
					op: 'OP6',
					modul: 'pergola',
					detail: JSON.stringify({ cad: CAD_B }),
					created_at: '2026-09-05 08:00:00'
				})
			],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		const lines = d.uploadLines.mock.calls[0]![2] as RozpisLine[];
		expect(lines).toHaveLength(1);
		expect(lines[0]!.nazov).toBe('Profil B'); // novší (2026-09-05) vyhral
	});

	it('zákazkový filter obmedzí spracovanie', async () => {
		const d = deps();
		const s = await runBackfill(
			[
				row({
					id: 1,
					op: 'OP7',
					zak: 'ZAKX',
					modul: 'pergola',
					detail: JSON.stringify({ cad: CAD_A })
				}),
				row({
					id: 2,
					op: 'OP8',
					zak: 'ZAKY',
					modul: 'pergola',
					detail: JSON.stringify({ cad: CAD_B })
				})
			],
			d,
			{ dryRun: false, delayMs: 0, zakFilter: ['ZAKX'] }
		);
		expect(d.uploadLines).toHaveBeenCalledTimes(1);
		expect(s.objednavok).toBe(1);
	});

	it('upload chyba → započíta sa do chyb, beh pokračuje', async () => {
		const d = deps({
			uploadLines: vi.fn(async () => {
				throw new Error('Odoo 500');
			})
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP9', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(s.chyb).toBe(1);
		expect(s.ops[0]!.akcia).toBe('error');
	});

	it('orderExists hodí → error, žiadny upload', async () => {
		const d = deps({
			orderExists: async () => {
				throw new Error('Odoo read 500');
			}
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP10', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
		expect(s.chyb).toBe(1);
		expect(s.ops[0]!.akcia).toBe('error');
	});

	it('orderHasLines hodí → error', async () => {
		const d = deps({
			orderHasLines: async () => {
				throw new Error('Odoo read 500');
			}
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP11', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(s.chyb).toBe(1);
	});

	it('modul mimo záberu (bazen) sa odfiltruje — žiadna objednávka', async () => {
		const d = deps();
		const s = await runBackfill([row({ id: 1, op: 'OP12', modul: 'bazen', detail: '{}' })], d, {
			dryRun: true
		});
		expect(s.objednavok).toBe(0);
		expect(d.uploadLines).not.toHaveBeenCalled();
	});
});
