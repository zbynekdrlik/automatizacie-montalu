// #440: editor vzorcov ukladá per-sklo korekciu rozmeru skla — kľúčované ROW ID (per systém),
// prázdne pole = NULL (zruší override), 0 je legitímna explicitná hodnota, bounds ako skloOffset,
// a per-id zápis NEZASIAHNE rovnako pomenované sklo v inom systéme (UNIQUE(nazov, system), #438).
import { describe, it, expect } from 'vitest';
import { glassTypesForSystem, listSysStyly, loadCfg } from '../src/lib/server/db';
import { saveCfgChanges, getEditableRows } from '../src/lib/server/cfg-editor';
import { computeFlat } from '../src/lib/server/compute';

const korekcia = (system: string, nazov: string) =>
	glassTypesForSystem(system).find((g) => g.nazov === nazov)?.skloKorekcia;

const slideSysStyl = () => listSysStyly().find((s) => s.system === 'Slide')!.sysStyl;

describe('#440 editor: per-sklo korekcia rozmeru skla', () => {
	it('uloží korekciu na konkrétne sklo a glassTypesForSystem ju vráti', () => {
		const izo = glassTypesForSystem('Slide').find((g) => g.nazov === 'Izolačné sklo 4/8/4 číre')!;
		expect(izo.skloKorekcia).toBeNull(); // predvolene bez override
		const { zmeny, error } = saveCfgChanges({
			sysStyl: slideSysStyl(),
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows(slideSysStyl())!.skloOffset,
			glassKorekcia: new Map([[izo.id, 40]])
		});
		expect(error).toBeNull();
		expect(zmeny.some((z) => z.pole.includes('Izolačné sklo 4/8/4 číre'))).toBe(true);
		expect(korekcia('Slide', 'Izolačné sklo 4/8/4 číre')).toBe(40);
	});

	it('prázdne pole = NULL zruší override (0 je INÁ, legitímna hodnota)', () => {
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm číre')!;
		// nastav 0 (explicitná) → uloží sa 0, NIE null
		saveCfgChanges({
			sysStyl: slideSysStyl(),
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows(slideSysStyl())!.skloOffset,
			glassKorekcia: new Map([[g.id, 0]])
		});
		expect(korekcia('Slide', '6mm číre')).toBe(0);
		// teraz NULL → zruší override
		saveCfgChanges({
			sysStyl: slideSysStyl(),
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows(slideSysStyl())!.skloOffset,
			glassKorekcia: new Map([[g.id, null]])
		});
		expect(korekcia('Slide', '6mm číre')).toBeNull();
	});

	it('korekcia mimo rozsahu 0–500 sa odmietne (nič sa nezmení)', () => {
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm mliečne')!;
		const { error } = saveCfgChanges({
			sysStyl: slideSysStyl(),
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows(slideSysStyl())!.skloOffset,
			glassKorekcia: new Map([[g.id, 501]])
		});
		expect(error).toContain('Korekcia');
		expect(korekcia('Slide', '6mm mliečne')).toBeNull();
	});

	it('per-id zápis „3.3.1" v Slide NEZMENÍ „3.3.1" v Štandard +', () => {
		const slide331 = glassTypesForSystem('Slide').find((g) => g.nazov === '3.3.1')!;
		const std331 = glassTypesForSystem('Štandard +').find((g) => g.nazov === '3.3.1')!;
		const stdBefore = std331.skloKorekcia;
		const { error } = saveCfgChanges({
			sysStyl: slideSysStyl(),
			username: 'tester',
			offsets: new Map(),
			skloOffset: getEditableRows(slideSysStyl())!.skloOffset,
			glassKorekcia: new Map([[slide331.id, 55]])
		});
		expect(error).toBeNull();
		expect(korekcia('Slide', '3.3.1')).toBe(55);
		// Štandard + „3.3.1" ostal nedotknutý (bez opravy WHERE id=? by sa prehodil tiež)
		expect(korekcia('Štandard +', '3.3.1')).toBe(stdBefore);
	});

	it('nastavená korekcia zmení rozmer skla cez kanál routy (glassTypesForSystem → computeFlat)', () => {
		const sys = slideSysStyl();
		const cfg0 = loadCfg();
		const skloOffset = cfg0[sys]!.skloOffset;
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 mliečne')!;
		// pred: bez override
		const bez = computeFlat(
			cfg0,
			sys,
			2551,
			1601,
			g.redukciaZero,
			g.hrubka,
			false,
			undefined,
			null,
			g.skloKorekcia
		)!;
		// nastav korekciu 40 a prepočítaj presne ako routa (číta g.skloKorekcia z DB)
		saveCfgChanges({
			sysStyl: sys,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			glassKorekcia: new Map([[g.id, 40]])
		});
		const cfg1 = loadCfg();
		const g2 = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 mliečne')!;
		const so = computeFlat(
			cfg1,
			sys,
			2551,
			1601,
			g2.redukciaZero,
			g2.hrubka,
			false,
			undefined,
			null,
			g2.skloKorekcia
		)!;
		expect(so.sklo.sirka).toBe(bez.sklo.sirka + (skloOffset - 40));
	});
});
