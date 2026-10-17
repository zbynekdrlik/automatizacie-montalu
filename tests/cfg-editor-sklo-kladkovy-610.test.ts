// #610 doplnok (ROZHODNUTÉ 17.10., issuecomment-6233481744): pravidlo výroby „sklo = kladkový
// − 10 mm na krídlo" (Štandard + opona IZO 2×2K / 2×3K / 2×4K, Odoo úloha 1416) musí prežiť
// budúce úpravy profilov v editore vzorcov. Výroba ladí kladkový editorom (cfg_audit 14.9.:
// 2×2K IZO −235 → −273, 2×4K IZO −328 → −380 …), ale riadok `Sklo šírka` editor neukazuje ani
// nezrkadlí (rámový→sklo mirror #504 sa nechytí — tieto štýly nemajú rámový S). Bez väzby by
// ďalšia úprava kladkového ticho znova rozbila šírku skla (presne úloha 1416).
//
// Kontrakt (vzor #504 mirroru, `.claude/rules/cfg-editor.md`): keď sa offset kladkového (dim S)
// SKUTOČNE zmení A sklo šírka ho dovtedy sledovala (`sklo == kladkový_starý − 10·N`), zapíše sa
// `sklo = kladkový_nový − 10·N` a do `zmeny` (→ cfg_audit) pribudne záznam. Sklo, ktoré pravidlo
// nesledovalo (ručná výnimka), ostane nedotknuté. Rozširujúci sklo neposúva (+6 je výsledok).
//
// Stav „sklo sleduje" = PROD po v58 (čítanie PROD `cfg_rez` 17.10., telo #610): kladkový
// −273/−320/−380, sklo −313/−380/−460. Seed nesie staršie profily (−235/−285/−335, seed sa s PROD
// zámerne nezosúlaďuje — `testing.md`), takže v ČISTOM seede sklo pravidlo NEsleduje; testy si
// PROD stav nastavia priamo v izolovanej test DB (`testing.md` #261 — DB je per súbor).
import { describe, it, expect } from 'vitest';
import { db, loadCfg } from '../src/lib/server/db';
import { saveCfgChanges, getEditableRows, getAuditLog } from '../src/lib/server/cfg-editor';
import { rozhodniSkloZapisy, skloSledujeStav } from '../src/lib/server/cfg-editor-sklo';
import { computeFlat } from '../src/lib/server/compute';
import { val } from '../src/lib/server/compute-model';
import { load } from '../src/routes/zasklenia/nastavenia/+page.server';

const KLADKOVY = 'ZASP202415';
const ROZSIRUJUCI = 'ZASP202439';
const POLE_SKLO = 'Sklo šírka (S) offset — sleduje kladkový − 10 mm (#610)';

/** PROD `cfg_rez` 17.10.2026 (telo #610) + sklo po v58 = kladkový − 10·N. */
const PROD: Record<string, { n: number; kladkovy: number }> = {
	'Štandard +|2x2K IZO': { n: 4, kladkovy: -273 },
	'Štandard +|2x3K IZO': { n: 6, kladkovy: -320 },
	'Štandard +|2x4K IZO': { n: 8, kladkovy: -380 }
};
const STYLY = Object.keys(PROD);

const skloOffset = (sysStyl: string, dim: 'S' | 'V'): number => {
	const r = db
		.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = ?`)
		.get(sysStyl, dim) as { offset: number } | undefined;
	expect(r, `${sysStyl}: chýba riadok Sklo ${dim}`).toBeTruthy();
	return r!.offset;
};

const profilS = (sysStyl: string, kod: string) => {
	const r = getEditableRows(sysStyl)?.rows.find((x) => x.kod === kod && x.dim === 'S');
	expect(r, `${sysStyl}: chýba profil ${kod} (S) v editore`).toBeTruthy();
	return r!;
};

/** Fixture: nastaví offset kladkového (S) a skla šírky priamo v test DB (bez auditu). */
function nastavStav(sysStyl: string, stav: { kladkovy: number; sklo: number }) {
	const kl = profilS(sysStyl, KLADKOVY);
	db.prepare('UPDATE cfg_rez SET offset = ? WHERE id = ?').run(stav.kladkovy, kl.id);
	const upd = db
		.prepare(`UPDATE cfg_rez SET offset = ? WHERE sys_styl = ? AND typ = 'sklo' AND dim = 'S'`)
		.run(stav.sklo, sysStyl);
	expect(upd.changes, `${sysStyl}: práve jeden riadok Sklo šírka`).toBe(1);
}

/** Formulár editora posiela VŠETKY `offset_<id>` (aj nezmenené) — presne ako `ulozit` akcia. */
function ulozZmenu(sysStyl: string, zmena: Map<number, number>, skloOffsetSys?: number) {
	const cur = getEditableRows(sysStyl)!;
	const offsets = new Map<number, number>(cur.rows.map((r) => [r.id, r.offset]));
	for (const [id, off] of zmena) offsets.set(id, off);
	return saveCfgChanges({
		sysStyl,
		username: 'vyroba',
		offsets,
		skloOffset: skloOffsetSys ?? cur.skloOffset
	});
}

const nastaveniaLoad = async (sysStyl: string) =>
	(await load({
		url: new URL(`http://x/zasklenia/nastavenia?sysStyl=${encodeURIComponent(sysStyl)}`)
	} as Parameters<typeof load>[0])) as Record<string, unknown>;

describe('#610 editor vzorcov: sklo šírka sleduje kladkový − 10 mm (Štandard + opona IZO)', () => {
	for (const ss of STYLY) {
		it(`[RED] ${ss}: výroba doladí kladkový o −6 mm → sklo šírka sa posunie o −6, auditované`, () => {
			const { n, kladkovy } = PROD[ss]!;
			nastavStav(ss, { kladkovy, sklo: kladkovy - 10 * n });
			const kl = profilS(ss, KLADKOVY);
			const skloVpred = skloOffset(ss, 'V');

			const { zmeny, error } = ulozZmenu(ss, new Map([[kl.id, kladkovy - 6]]));
			expect(error).toBeNull();

			// sklo sa posunulo spolu s kladkovým; invariant po uložení: sklo == kladkový − 10·N
			expect(skloOffset(ss, 'S')).toBe(kladkovy - 6 - 10 * n);
			expect(skloOffset(ss, 'S')).toBe(profilS(ss, KLADKOVY).offset - 10 * n);
			// výška skla (V − 135) je samostatný rozmer — nedotknutá
			expect(skloOffset(ss, 'V')).toBe(skloVpred);

			// presne dva záznamy: zmena kladkového + auditované posunutie skla
			expect(zmeny).toEqual([
				{ pole: `${kl.nazov} · šírka`, stara: kladkovy, nova: kladkovy - 6 },
				{ pole: POLE_SKLO, stara: kladkovy - 10 * n, nova: kladkovy - 6 - 10 * n }
			]);
			const audit = getAuditLog(1)[0]!;
			expect(audit.sys_styl).toBe(ss);
			expect(audit.username).toBe('vyroba');
			expect(JSON.parse(audit.zmeny)).toContainEqual({
				pole: POLE_SKLO,
				stara: kladkovy - 10 * n,
				nova: kladkovy - 6 - 10 * n
			});

			// výpočet: na krídlo je kladkový presne o 10 mm dlhší než sklo (pred zaokrúhlením)
			const g = loadCfg()[ss]!;
			const klRow = g.rez.find((r) => r.kod === KLADKOVY && r.dim === 'S')!;
			for (const S of [3000, 5000, 6500, 7400])
				expect(val(klRow, S, 2070, g.N, true) - val(g.sklo.s!, S, 2070, g.N, true)).toBeCloseTo(
					10,
					9
				);
		});
	}

	it('[RED] vektor úlohy 1416 po doladení: 2×3K IZO 6500 × 2070, kladkový −326 → rez 1029, sklo 1019', () => {
		const ss = 'Štandard +|2x3K IZO';
		nastavStav(ss, { kladkovy: -320, sklo: -380 });
		const r0 = computeFlat(loadCfg(), ss, 6500, 2070, false, 0, true)!;
		expect(r0.sklo).toEqual({ sirka: 1020, vyska: 1935, pocet: 6 });

		const { error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -326]]));
		expect(error).toBeNull();
		const r = computeFlat(loadCfg(), ss, 6500, 2070, false, 0, true)!;
		expect(r.material.find((m) => m.kod === KLADKOVY)!.rezy).toEqual([{ rozmer: 1029, ks: 12 }]);
		expect(r.sklo).toEqual({ sirka: 1019, vyska: 1935, pocet: 6 });
	});

	it('[RED] necelé offsety (pole step="any"): sklo sleduje aj −273,5 → −274,25, bez float šumu', () => {
		const ss = 'Štandard +|2x2K IZO';
		nastavStav(ss, { kladkovy: -273.5, sklo: -313.5 });
		const { zmeny, error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -274.25]]));
		expect(error).toBeNull();
		expect(skloOffset(ss, 'S')).toBe(-314.25);
		expect(zmeny.find((z) => z.pole === POLE_SKLO)).toEqual({
			pole: POLE_SKLO,
			stara: -313.5,
			nova: -314.25
		});
	});

	it('float šum v NOVOM offsete: −255,92 − 40 = −295,91999999999996 sa zapíše ako čisté −295,92', () => {
		// review: binárne presné ,5/,25 hodnoty vyššie zaokrúhlenie neoveria. −255,92 − 40 v double
		// = −295,91999999999996 → `skloOffsetZProfilu` musí zapísať (aj do auditu) čisté −295,92.
		// (Uložené sklo −295,96 tu šum nemá — toleranciu stráži test nižšie.)
		expect(-255.92 - 40).not.toBe(-295.92);
		const ss = 'Štandard +|2x2K IZO';
		nastavStav(ss, { kladkovy: -255.96, sklo: -295.96 });
		const { zmeny, error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -255.92]]));
		expect(error).toBeNull();
		expect(skloOffset(ss, 'S')).toBe(-295.92);
		expect(zmeny.find((z) => z.pole === POLE_SKLO)).toEqual({
			pole: POLE_SKLO,
			stara: -295.96,
			nova: -295.92
		});
		expect(JSON.parse(getAuditLog(1)[0]!.zmeny)).toContainEqual({
			pole: POLE_SKLO,
			stara: -295.96,
			nova: -295.92
		});
	});

	it('float šum v ULOŽENOM skle: sklo −295,96000000000004 (= −255,96 − 40 bez zaokrúhlenia) väzbu nestratí', () => {
		// re-review: uložené sklo so šumom (napr. ručný/starý zápis bez zaokrúhlenia) sa voči
		// zaokrúhlenému `kladkový − 10·N` (−295,96) líši o ~4e-14 → tolerancia 1e-6 ho MUSÍ brať ako
		// sledujúce; striktné `===` by väzbu ticho stratilo (sklo by ostalo stáť).
		const sumSklo = -255.96 - 40;
		expect(sumSklo).not.toBe(-295.96);
		const ss = 'Štandard +|2x2K IZO';
		nastavStav(ss, { kladkovy: -255.96, sklo: sumSklo });
		const { zmeny, error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -256]]));
		expect(error).toBeNull();
		expect(skloOffset(ss, 'S')).toBe(-296);
		expect(zmeny.find((z) => z.pole === POLE_SKLO)).toEqual({
			pole: POLE_SKLO,
			stara: sumSklo,
			nova: -296
		});
	});

	it('ručná výnimka: sklo pravidlo NEsledovalo (seed stav) → zmena kladkového sklo NEposunie', () => {
		const ss = 'Štandard +|2x3K IZO';
		// seed: kladkový −285, sklo −380 → −285 − 60 = −345 ≠ −380 (sklo je samostatný rozmer)
		nastavStav(ss, { kladkovy: -285, sklo: -380 });
		const { zmeny, error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -291]]));
		expect(error).toBeNull();
		expect(skloOffset(ss, 'S')).toBe(-380);
		expect(zmeny.map((z) => z.pole)).toEqual([`${profilS(ss, KLADKOVY).nazov} · šírka`]);
	});

	it('rozširujúci profil sklo NEposúva (pravidlo +6 mm je výsledok, nie zdroj)', () => {
		const ss = 'Štandard +|2x3K IZO';
		nastavStav(ss, { kladkovy: -320, sklo: -380 });
		const roz = profilS(ss, ROZSIRUJUCI);
		const { zmeny, error } = ulozZmenu(ss, new Map([[roz.id, roz.offset - 6]]));
		expect(error).toBeNull();
		expect(skloOffset(ss, 'S')).toBe(-380);
		expect(zmeny).toHaveLength(1);
		expect(zmeny.some((z) => z.pole === POLE_SKLO)).toBe(false);
	});

	it('uloženie BEZ zmeny kladkového (iné pole / systémové zmenšenie) sa skla nedotkne', () => {
		const ss = 'Štandard +|2x4K IZO';
		nastavStav(ss, { kladkovy: -380, sklo: -460 });
		const dor = getEditableRows(ss)!.rows.find((r) => r.dim === 'V' && /dorazov/i.test(r.nazov))!;
		const { zmeny, error } = ulozZmenu(ss, new Map([[dor.id, dor.offset - 1]]), 2);
		expect(error).toBeNull();
		expect(skloOffset(ss, 'S')).toBe(-460);
		expect(zmeny.map((z) => z.pole).sort()).toEqual(
			[`${dor.nazov} · výška`, 'Sklo — konečné zmenšenie'].sort()
		);
		// návrat systémového zmenšenia (net-zero pre ďalšie testy v súbore)
		expect(ulozZmenu(ss, new Map([[dor.id, dor.offset]]), 0).error).toBeNull();
	});

	it('štýly MIMO pravidla (starý Štandard 2×3K IZO, Štandard + 3K IZO): sklo sa NEposunie, aj keď náhodou = kladkový − 10·N', () => {
		for (const [ss, n] of [
			['Štandard|2x3K IZO', 6],
			['Štandard +|3K IZO', 3]
		] as const) {
			const kl = profilS(ss, KLADKOVY);
			nastavStav(ss, { kladkovy: kl.offset, sklo: kl.offset - 10 * n });
			const { zmeny, error } = ulozZmenu(ss, new Map([[kl.id, kl.offset - 6]]));
			expect(error).toBeNull();
			expect(skloOffset(ss, 'S'), ss).toBe(kl.offset - 10 * n);
			expect(
				zmeny.some((z) => /sklo/i.test(z.pole)),
				ss
			).toBe(false);
		}
	});

	it('[RED] odvodené sklo mimo ±500 mm → celé uloženie sa odmietne (kladkový aj sklo ostanú)', () => {
		const ss = 'Štandard +|2x4K IZO';
		nastavStav(ss, { kladkovy: -380, sklo: -460 });
		// kladkový −430 → sklo −510 mimo BOUNDS.offset (±500) → poistka inBounds vráti transakciu
		const { zmeny, error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -430]]));
		expect(error).toMatch(/mimo rozsahu/);
		expect(zmeny).toEqual([]);
		expect(profilS(ss, KLADKOVY).offset).toBe(-380);
		expect(skloOffset(ss, 'S')).toBe(-460);
	});

	// (pôvodne [RED] v af2d6a2 s tvarom `{profilId, mmNaKridlo} | null`; review 76fa4d5 zmenil
	// kontrakt na `{…, sleduje}` aj pre ručnú výnimku — preto už nie je označený [RED])
	it('editor: poznámka pri kladkovom podľa stavu väzby (load `skloSleduje`)', async () => {
		const ss = 'Štandard +|2x3K IZO';
		nastavStav(ss, { kladkovy: -320, sklo: -380 });
		// review: tvar rozšírený o `sleduje` — ručná výnimka dostane vlastnú poznámku („sklo sa
		// neposunie"), aby výroba videla, že sa sklo s kladkovým NEpohne (predtým žiadna poznámka)
		expect((await nastaveniaLoad(ss)).skloSleduje).toEqual({
			profilId: profilS(ss, KLADKOVY).id,
			mmNaKridlo: 10,
			sleduje: true
		});
		// ručná výnimka (seed) → poznámka „sklo sa neposunie" (sklo sa pri zmene kladkového NEpohne)
		nastavStav(ss, { kladkovy: -285, sklo: -380 });
		expect((await nastaveniaLoad(ss)).skloSleduje).toEqual({
			profilId: profilS(ss, KLADKOVY).id,
			mmNaKridlo: 10,
			sleduje: false
		});
		// štýl mimo pravidla → žiadna poznámka
		expect((await nastaveniaLoad('Robust|4K')).skloSleduje).toBeNull();
	});

	it('nejednoznačný riadok Sklo šírka (2×) → väzba sa NEuplatní (nikdy nehádame) a poznámka nie je', async () => {
		const ss = 'Štandard +|2x3K IZO';
		nastavStav(ss, { kladkovy: -320, sklo: -380 });
		const sklo = db
			.prepare(`SELECT id FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = 'S'`)
			.get(ss) as { id: number };
		const kopia = db
			.prepare(
				`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf,
				 pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
				 SELECT sys_styl, 92, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks,
				 sklozavisle, dlzka_tyce, sklo_hrubka FROM cfg_rez WHERE id = ?`
			)
			.run(sklo.id).lastInsertRowid;
		try {
			const { zmeny, error } = ulozZmenu(ss, new Map([[profilS(ss, KLADKOVY).id, -326]]));
			expect(error).toBeNull();
			expect(zmeny.some((z) => z.pole === POLE_SKLO)).toBe(false);
			const offsety = (
				db
					.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = 'S'`)
					.all(ss) as { offset: number }[]
			).map((r) => r.offset);
			expect(offsety).toEqual([-380, -380]);
			expect((await nastaveniaLoad(ss)).skloSleduje).toBeNull();
		} finally {
			db.prepare('DELETE FROM cfg_rez WHERE id = ?').run(kopia);
		}
	});
});

// Čisté rozhodnutie skrytých zápisov skla (`cfg-editor-sklo.ts`) — prípady, ktoré dnešné dáta
// nemajú (žiadny štýl z mapy nemá rámový S), ale kontrakt ich musí držať.
describe('#610 rozhodniSkloZapisy: precedencia a nejednoznačnosť (čisté, bez DB)', () => {
	const SS = 'Štandard +|2x3K IZO';
	const kladkovy = {
		id: 1,
		kod: KLADKOVY,
		nazov: 'Kladkový profil',
		dim: 'S' as const,
		poradie: 20
	};
	const ramovyS = {
		id: 2,
		kod: 'ZASP00024',
		nazov: 'Rámový profil S',
		dim: 'S' as const,
		poradie: 35
	};

	it('rámový mirror má prednosť: sklo sleduje rámový AJ kladkový − 60 → vyhrá rámový, JEDEN audit záznam', () => {
		const rows = [
			{ ...kladkovy, offset: -320 },
			{ ...ramovyS, offset: -380 }
		];
		const { skloZapisy, zmeny } = rozhodniSkloZapisy(
			SS,
			rows,
			new Map([
				[1, -326],
				[2, -385]
			]),
			[
				{ dim: 'S', offset: -380 },
				{ dim: 'V', offset: -135 }
			],
			6
		);
		expect([...skloZapisy]).toEqual([['S', -385]]);
		expect(zmeny).toEqual([
			{ pole: 'Sklo šírka (zrkadlené z „Rámový profil S")', stara: -380, nova: -385 }
		]);
	});

	it('bez zmeny rámového rozhodne väzba na kladkový (rámový S, ktorý sklo nesleduje, ju neblokuje)', () => {
		const { skloZapisy, zmeny } = rozhodniSkloZapisy(
			SS,
			[
				{ ...kladkovy, offset: -320 },
				{ ...ramovyS, offset: -33 }
			],
			new Map([[1, -326]]),
			[{ dim: 'S', offset: -380 }],
			6
		);
		expect([...skloZapisy]).toEqual([['S', -386]]);
		expect(zmeny).toEqual([{ pole: POLE_SKLO, stara: -380, nova: -386 }]);
	});

	it('dva riadky kladkového (S) → väzba sa neuplatní, stav pre editor null', () => {
		const rows = [
			{ ...kladkovy, offset: -320 },
			{ ...kladkovy, id: 3, poradie: 21, offset: -320 }
		];
		const sklo = [{ dim: 'S' as const, offset: -380 }];
		const { skloZapisy, zmeny } = rozhodniSkloZapisy(SS, rows, new Map([[1, -326]]), sklo, 6);
		expect(skloZapisy.size).toBe(0);
		expect(zmeny).toEqual([]);
		expect(skloSledujeStav(SS, rows, sklo, 6)).toBeNull();
	});

	it('štýl mimo mapy → žiadna väzba ani stav', () => {
		const rows = [{ ...kladkovy, offset: -280 }];
		const sklo = [{ dim: 'S' as const, offset: -340 }];
		const ine = 'Štandard|2x3K IZO';
		expect(rozhodniSkloZapisy(ine, rows, new Map([[1, -286]]), sklo, 6).zmeny).toEqual([]);
		expect(skloSledujeStav(ine, rows, sklo, 6)).toBeNull();
	});
});
