// #524: backfill nárezákov → Odoo `lines`. Mapper (odpis `detail` → lines) per modul + orchestrácia
// (`runBackfill`). DI transport (fake upload/existencia) = žiadny PROD Odoo; DB je seedovaná per-file
// izolátorom (`tests/setup/db-isolation.ts`), takže `loadCfg()` + sklo katalóg fungujú.
//
// Money-NEUTRÁLNE: mapper číta len `detail`/`odpis_polozky`, orchestrácia volá injektovaný upload —
// žiadny zápis do Money/`odpis_log` (source-guard v `backfill-narezaky-money-safety.test.ts`).
import { describe, it, expect, vi } from 'vitest';
import {
	mapOdpisToLines,
	materialRowsFromRozpis,
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

describe('materialRowsFromRozpis (#529 — FFD tyče pre grafický PDF)', () => {
	it('agregované rezy → MaterialRow[] s tyčami zabalenými cez ffdPack', () => {
		// 5× 2000 mm na 6000 mm tyč (kerf 4) = 2 kusy/tyč (2000+2000+kerf ≤ 6000, 3. sa nezmestí)
		const mat = materialRowsFromRozpis(
			[{ nazov: 'Profil X', rezy: [{ rozmer: 2000, ks: 5 }] }],
			6000,
			4
		);
		expect(mat).toHaveLength(1);
		expect(mat[0]!.nazov).toBe('Profil X');
		expect(mat[0]!.barLen).toBe(6000);
		expect(mat[0]!.sikmyRez).toBe(false);
		// 5 kusov po 2000: 3 tyče (2+2+1), spolu 5 kusov naprieč tyčami
		const kusovSpolu = mat[0]!.bary.reduce((s, b) => s + b.kusy.length, 0);
		expect(kusovSpolu).toBe(5);
		expect(mat[0]!.tyce).toBe(mat[0]!.bary.length);
		expect(mat[0]!.odpadMm).toBeGreaterThan(0);
	});
	it('zachová kod keď je (sietka) → obrázok v PDF; rez dlhší ako tyč vypadne', () => {
		const mat = materialRowsFromRozpis(
			[
				{
					nazov: 'Sietka',
					kod: 'ZASP00002',
					rezy: [
						{ rozmer: 8000, ks: 1 },
						{ rozmer: 2000, ks: 2 }
					]
				}
			],
			7500,
			4
		);
		expect(mat[0]!.kod).toBe('ZASP00002');
		// 8000 > 7500 → nezaradí sa; ostanú 2× 2000
		const kusovSpolu = mat[0]!.bary.reduce((s, b) => s + b.kusy.length, 0);
		expect(kusovSpolu).toBe(2);
	});
});

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
		// #529: vráti aj MaterialRow[] s tyčami (FFD) pre grafický PDF — 2 profily, každý má bary
		expect(res.material).toHaveLength(2);
		expect(res.material[0]!.nazov).toBe('Žlabový profil 110');
		expect(res.material[0]!.bary.length).toBeGreaterThan(0);
		expect(res.material.every((m) => m.tyce === m.bary.length)).toBe(true);
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
		sleep: async () => {},
		...over,
		uploadLines
	} as BackfillDeps & { uploadLines: ReturnType<typeof vi.fn> };
}

/** #532: Robust 2K zasklenie — recompute nesie Money kódy (ZASP…) + per-profil uhly. */
function robustZaskVstup(op: string): Vstup {
	return {
		zak: 'ZAKC',
		op,
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
	} as unknown as Vstup;
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

	it('ostrý beh pripne GRAFICKÝ nárezák PDF (%PDF + Narezak- filename) k lines (#529)', async () => {
		const d = deps();
		await runBackfill(
			[row({ id: 1, op: 'OP2B', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		const [, , , pdfBase64, filename] = d.uploadLines.mock.calls[0]!;
		expect(typeof pdfBase64).toBe('string');
		expect(Buffer.from(String(pdfBase64), 'base64').slice(0, 5).toString('latin1')).toBe('%PDF-');
		expect(String(filename)).toMatch(/^Narezak-.*\.pdf$/);
	});

	it('dry-run NEGENERUJE PDF (upload sa nevolá vôbec)', async () => {
		const d = deps();
		await runBackfill(
			[row({ id: 1, op: 'OP2C', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
	});

	it('#532: pergola CAD (bez Money kódov) → cut_plan VYNECHANÝ (6. arg undefined)', async () => {
		// pergola/fix/clip idú cez `materialRowsFromRozpis` s `kod:''` → žiadna tyč nemá Money kód
		// → `buildCutPlan` vráti undefined → kľúč sa nepošle (kontrakt: profile_kod nikdy prázdny).
		const d = deps();
		await runBackfill(
			[row({ id: 1, op: 'OP2D', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines.mock.calls[0]![5]).toBeUndefined();
	});

	it('#532: zasklenia (Money kódy) → cut_plan PRÍTOMNÝ s tyčami (bars[].profile_kod neprázdny)', async () => {
		// zasklenia recompute nesie Money kódy profilov (ZASP…) + per-profil uhly → bars sa naplnia.
		const d = deps();
		await runBackfill(
			[
				row({
					id: 1,
					op: 'OP2F',
					modul: 'zasklenia',
					detail: JSON.stringify({ vstupRaw: robustZaskVstup('OP2F') })
				})
			],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		const cutPlan = d.uploadLines.mock.calls[0]![5] as {
			version: number;
			bars: { profile_kod: string; pieces: unknown[]; render_svg: string }[];
		};
		expect(cutPlan).toBeDefined();
		expect(cutPlan.version).toBe(1);
		expect(cutPlan.bars.length).toBeGreaterThan(0);
		// každý vydaný bar nesie neprázdny Money kód + aspoň jeden kus + SVG
		for (const b of cutPlan.bars) {
			expect(b.profile_kod).not.toBe('');
			expect(b.pieces.length).toBeGreaterThan(0);
			expect(Buffer.from(b.render_svg, 'base64').toString('utf8').startsWith('<svg')).toBe(true);
		}
	});

	it('#532: mixovaná OP (zasklenia + pergola) → cut_plan má zasklenia tyče A LOG na vynechané pergola tyče', async () => {
		// review nález: v mixovanej OP je `cutPlan` pravdivý (zasklenia s kódmi), ale pergola tyče
		// (bez Money kódu) sa tichým dropom nedostanú do plánu — musí sa to ZALOGOVAŤ (kontrakt).
		const log = vi.fn();
		const d = deps({ log });
		await runBackfill(
			[
				row({
					id: 1,
					op: 'OP2G',
					modul: 'zasklenia',
					detail: JSON.stringify({ vstupRaw: robustZaskVstup('OP2G') })
				}),
				row({ id: 2, op: 'OP2G', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })
			],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		const cutPlan = d.uploadLines.mock.calls[0]![5] as { bars: unknown[] } | undefined;
		expect(cutPlan).toBeDefined();
		expect(cutPlan!.bars.length).toBeGreaterThan(0); // zasklenia tyče (coded)
		// pergola tyče (bez kódu) vynechané → log fire-ol s planSent:true a bezKodu>0
		const bezKoduLog = log.mock.calls.find((c) => String(c[1]).includes('bez Money kódu'));
		expect(bezKoduLog).toBeDefined();
		const ctx = bezKoduLog![2] as { planSent: boolean; bezKodu: number };
		expect(ctx.planSent).toBe(true);
		expect(ctx.bezKodu).toBeGreaterThan(0);
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

	// #524 R2: tolerantná pre-check — Odoo READ (orderExists/orderHasLines) môže byť zamietnutý
	// 403/AccessError (uid 524 nemá read na sale.order). Read zlyhá → existencia NEZNÁMA,
	// NEZAPOČÍTA sa ako chyba; dry-run vypíše „existencia neoverená" a spracuje ako would-send,
	// live nechá rozhodnúť endpoint (unknown order → no-order, nie chyba). Presná cesta ostáva
	// keď read prejde. Nahrádza pôvodné „orderExists/orderHasLines hodí → error" (contract R2).
	it('orderExists 403 (read blokovaný) → dry-run: existencia neoverená, „poslal by", 0 chýb, has-lines sa NEčíta', async () => {
		const orderHasLines = vi.fn(async () => false);
		const d = deps({
			orderExists: async () => {
				throw new Error('Odoo JSON-2 HTTP 403 Forbidden: AccessError sale.order');
			},
			orderHasLines
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP10', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(d.uploadLines).not.toHaveBeenCalled(); // dry-run nič neposiela
		// pri neznámej existencii sa has-lines read NEskúša (opäť by 403-lo)
		expect(orderHasLines).not.toHaveBeenCalled();
		expect(s.chyb).toBe(0); // 403 read NIE je chyba
		expect(s.existenciaNeoverena).toBe(1);
		expect(s.nahranych).toBe(1); // „poslal by"
		expect(s.riadkovSpolu).toBe(1);
		expect(s.ops[0]!.akcia).toBe('dry-run-neoverena');
	});

	it('orderHasLines 403 (existencia OK, has-lines read blokovaný) → dry-run-neoverena, 0 chýb', async () => {
		const d = deps({
			orderHasLines: async () => {
				throw new Error('Odoo JSON-2 HTTP 403 Forbidden: AccessError montalu.rozpis.line');
			}
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP11', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(s.chyb).toBe(0);
		expect(s.existenciaNeoverena).toBe(1);
		expect(s.ops[0]!.akcia).toBe('dry-run-neoverena');
	});

	it('orderExists 403 + --live + upload prejde → uploaded (existenciu potvrdil upload), existenciaNeoverena 1, 0 chýb', async () => {
		const d = deps({
			orderExists: async () => {
				throw new Error('Odoo JSON-2 HTTP 403 Forbidden: AccessError sale.order');
			}
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP16', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).toHaveBeenCalledTimes(1);
		expect(s.nahranych).toBe(1);
		expect(s.existenciaNeoverena).toBe(1);
		expect(s.chyb).toBe(0);
		expect(s.ops[0]!.akcia).toBe('uploaded');
	});

	it('orderExists 403 + --live + upload zamietne neznámu OP → no-order (nie chyba), errMsg surfacovaný (review 🟡)', async () => {
		const log = vi.fn();
		const d = deps({
			orderExists: async () => {
				throw new Error('Odoo JSON-2 HTTP 403 Forbidden: AccessError sale.order');
			},
			uploadLines: vi.fn(async () => {
				throw new Error('Odoo JSON-2 HTTP 404: objednávka neexistuje');
			}),
			log
		});
		const s = await runBackfill(
			[row({ id: 1, op: 'OP17', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).toHaveBeenCalledTimes(1);
		expect(s.chyb).toBe(0); // neznáma OP zamietnutá endpointom → no-order, NIE chyba
		expect(s.skipNoOrder).toBe(1);
		expect(s.existenciaNeoverena).toBe(1);
		expect(s.nahranych).toBe(0);
		expect(s.ops[0]!.akcia).toBe('skip-no-order');
		// review 🟡: masked upload chyba NESMIE ostať skrytá pod „Chýb: 0" — errMsg na opSum (CLI ⚠)
		// + WARN log (nie info), aby genuine transport 5xx na existujúcej OP bola viditeľná.
		expect(s.ops[0]!.error).toContain('404');
		const warnUpload = log.mock.calls.filter(
			(c) => c[0] === 'warn' && /zamietnut.*upload|upload.*→ no-order/i.test(String(c[1]))
		);
		expect(warnUpload).toHaveLength(1);
	});

	it('čítanie prejde (existencia + has-lines OK) → presná cesta ostáva, existenciaNeoverena 0', async () => {
		const d = deps();
		const s = await runBackfill(
			[row({ id: 1, op: 'OP18', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) })],
			d,
			{ dryRun: true }
		);
		expect(s.existenciaNeoverena).toBe(0);
		expect(s.ops[0]!.akcia).toBe('dry-run');
	});

	it('read 403 sa loguje RAZ za beh (nie per OP), obe OP spracované', async () => {
		const log = vi.fn();
		const d = deps({
			orderExists: async () => {
				throw new Error('Odoo JSON-2 HTTP 403 Forbidden: AccessError sale.order');
			},
			log
		});
		const s = await runBackfill(
			[
				row({ id: 1, op: 'OP19', modul: 'pergola', detail: JSON.stringify({ cad: CAD_A }) }),
				row({ id: 2, op: 'OP20', modul: 'pergola', detail: JSON.stringify({ cad: CAD_B }) })
			],
			d,
			{ dryRun: true }
		);
		expect(s.existenciaNeoverena).toBe(2); // obe OP spracované, žiadna nespadla na chybu
		expect(s.chyb).toBe(0);
		const warnReadBlocked = log.mock.calls.filter(
			(c) => c[0] === 'warn' && /neoveren|zamietnut|403/i.test(String(c[1]))
		);
		expect(warnReadBlocked).toHaveLength(1); // raz za beh, nie 2×
	});

	it('modul mimo záberu (bazen) sa odfiltruje — žiadna objednávka', async () => {
		const d = deps();
		const s = await runBackfill([row({ id: 1, op: 'OP12', modul: 'bazen', detail: '{}' })], d, {
			dryRun: true
		});
		expect(s.objednavok).toBe(0);
		expect(d.uploadLines).not.toHaveBeenCalled();
	});

	it('OP len s pergola-rezervacia → skipPergolaRezervacia + skip-no-lines, žiadny upload', async () => {
		const d = deps();
		const s = await runBackfill(
			[row({ id: 1, op: 'OP13', modul: 'pergola', detail: JSON.stringify({ rezervacia: true }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
		expect(s.skipPergolaRezervacia).toBe(1);
		expect(s.skipNoLines).toBe(1);
		expect(s.ops[0]!.akcia).toBe('skip-no-lines');
	});

	it('OP s nerekonštruovateľným modulom → skipUnreconstructable + skip-no-lines', async () => {
		const d = deps();
		const s = await runBackfill([row({ id: 1, op: 'OP14', modul: 'pergola', detail: '{}' })], d, {
			dryRun: false,
			delayMs: 0
		});
		expect(s.skipUnreconstructable).toBe(1);
		expect(s.skipNoLines).toBe(1);
	});

	it('CAD odrezaný na CAD_DETAIL_MAX → skip (neposiela kusý rozpis)', async () => {
		const d = deps();
		const longCad = '18013 Profil A\t3\t3000\n'.repeat(2000); // > 20000 znakov
		const s = await runBackfill(
			[row({ id: 1, op: 'OP15', modul: 'pergola', detail: JSON.stringify({ cad: longCad }) })],
			d,
			{ dryRun: false, delayMs: 0 }
		);
		expect(d.uploadLines).not.toHaveBeenCalled();
		expect(s.skipUnreconstructable).toBe(1);
	});
});
