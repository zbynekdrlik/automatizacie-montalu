// #443: reťaz precedencie korekcie (per-sklo #440 → trieda → systémová), derivácia
// redukcie (Slide+16→true, Slide+6→false, honest-null fallback inak), a parity guardy
// nad REÁLNE migrovanou+seednutou DB (glass-catalog.md: test na migrovanej DB, nie
// hardkód) — plus integračný dôkaz, že nastavenie triedovej korekcie skutočne posunie
// vypočítaný rozmer skla cez ten istý kanál, akým ide route (computeFlat).
import { describe, it, expect } from 'vitest';
import {
	glassTypesForSystem,
	listSysStyly,
	loadCfg,
	efektivnaKorekcia,
	efektivnaRedukciaZero,
	triedaKorekcia,
	resolveGlassSystem,
	type GlassType
} from '../src/lib/server/db';
import { saveCfgChanges, getEditableRows } from '../src/lib/server/cfg-editor';
import { computeFlat } from '../src/lib/server/compute';
import { jeIzoSklo, jeIzoTrieda } from '../src/lib/styl';

describe('#443 efektivnaKorekcia — reťaz precedencie per-sklo > trieda > systémová', () => {
	it('bez akéhokoľvek override vráti null (padne na systémovú vo compute)', () => {
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm mliečne')!;
		expect(efektivnaKorekcia(g, 'Slide')).toBeNull();
	});

	it('trieda korekcia sa použije, keď per-sklo override chýba', () => {
		const sysStyl = listSysStyly().find((s) => s.system === 'Slide')!.sysStyl;
		const skloOffset = getEditableRows(sysStyl)!.skloOffset;
		saveCfgChanges({
			sysStyl,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			triedaKorekcia: new Map([[6, 33]])
		});
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm mliečne')!;
		expect(g.hrubkaTrieda).toBe(6);
		expect(efektivnaKorekcia(g, 'Slide')).toBe(33);
	});

	it('per-sklo override (#440) VYHRÁVA nad triedou', () => {
		const sysStyl = listSysStyly().find((s) => s.system === 'Slide')!.sysStyl;
		const skloOffset = getEditableRows(sysStyl)!.skloOffset;
		const before = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm číre')!;
		saveCfgChanges({
			sysStyl,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			glassKorekcia: new Map([[before.id, 99]])
		});
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm číre')!;
		expect(g.hrubkaTrieda).toBe(6); // rovnaká trieda 6 má korekciu 33 z predošlého testu
		expect(efektivnaKorekcia(g, 'Slide')).toBe(99); // ale per-sklo override vyhráva
	});

	it('resolveGlassSystem: Štandard aj Štandard + čítajú TEN ISTÝ cfg_sklo_trieda riadok', () => {
		const sysStyl = listSysStyly().find((s) => s.system === 'Štandard +')!.sysStyl;
		const skloOffset = getEditableRows(sysStyl)!.skloOffset;
		saveCfgChanges({
			sysStyl,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			triedaKorekcia: new Map([[6, 77]])
		});
		expect(triedaKorekcia('Štandard', 6)).toBe(77);
		expect(triedaKorekcia('Štandard +', 6)).toBe(77);
		expect(resolveGlassSystem('Štandard')).toBe('Štandard +');
	});

	it('NULL zruší triedový override (späť na systémovú)', () => {
		const sysStyl = listSysStyly().find((s) => s.system === 'Štandard +')!.sysStyl;
		const skloOffset = getEditableRows(sysStyl)!.skloOffset;
		saveCfgChanges({
			sysStyl,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			triedaKorekcia: new Map([[6, null]])
		});
		expect(triedaKorekcia('Štandard +', 6)).toBeNull();
	});
});

describe('#443 efektivnaRedukciaZero — derivácia z triedy, Slide-only gate', () => {
	it('Slide + trieda 16 (IZO 4/8/4) → true (derivovaná)', () => {
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 číre')!;
		expect(g.hrubkaTrieda).toBe(16);
		expect(efektivnaRedukciaZero(g)).toBe(true);
	});

	it('Slide + trieda 6 (6mm) → false (derivovaná)', () => {
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === '6mm číre')!;
		expect(g.hrubkaTrieda).toBe(6);
		expect(efektivnaRedukciaZero(g)).toBe(false);
	});

	it('trieda NULL (Robust) → uložený stĺpec (honest-null fallback)', () => {
		const g = glassTypesForSystem('Robust').find((x) => x.nazov.includes('4/16/4'))!;
		expect(g.hrubkaTrieda).toBeNull();
		expect(efektivnaRedukciaZero(g)).toBe(g.redukciaZero);
	});

	it('iný systém než Slide (Štandard +) → uložený stĺpec, aj keď má triedu', () => {
		const g = glassTypesForSystem('Štandard +').find((x) => x.nazov === 'Izolačné sklo 4.8.4')!;
		expect(g.hrubkaTrieda).toBe(16); // klasifikované, ale gate je Slide-only
		expect(efektivnaRedukciaZero(g)).toBe(g.redukciaZero);
	});
});

describe('#443 parity guard — trieda dáva ROVNAKÝ výsledok ako regex pre všetky dnešné sklá', () => {
	it('každé Štandard + sklo: jeIzoTrieda(trieda,nazov) === jeIzoSklo(nazov)', () => {
		for (const g of glassTypesForSystem('Štandard +')) {
			expect(jeIzoTrieda(g.hrubkaTrieda, g.nazov), g.nazov).toBe(jeIzoSklo(g.nazov));
		}
	});

	it('každé Slide sklo: derivovaná redukcia === uložená (bit-parita so seedom)', () => {
		for (const g of glassTypesForSystem('Slide')) {
			expect(efektivnaRedukciaZero(g), g.nazov).toBe(g.redukciaZero);
		}
	});
});

describe('#443 guard — každé Slide/Štandard + VLASTNÉ sklo má non-NULL triedu', () => {
	// chráni budúce seedy: nové sklo pridané bez triedy (Odoo import zabudne parameter) = RED
	const vlastneNeklasifikovane = (system: string): GlassType[] =>
		glassTypesForSystem(system).filter((g) => g.system === system && g.hrubkaTrieda === null);

	it('Slide', () => {
		expect(vlastneNeklasifikovane('Slide').map((g) => g.nazov)).toEqual([]);
	});

	it('Štandard +', () => {
		expect(vlastneNeklasifikovane('Štandard +').map((g) => g.nazov)).toEqual([]);
	});
});

describe('#443 integrácia: triedová korekcia mení skutočný rozmer skla (rovnaký kanál ako route)', () => {
	it('nastavenie triedy 16 korekcie posunie rozmer skla presne o rozdiel oproti systémovej', () => {
		const sys = listSysStyly().find((s) => s.system === 'Slide')!.sysStyl;
		const cfg0 = loadCfg();
		const skloOffset = cfg0[sys]!.skloOffset;
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 mliečne')!;
		const bez = computeFlat(
			cfg0,
			sys,
			2551,
			1601,
			efektivnaRedukciaZero(g),
			g.hrubka,
			false,
			undefined,
			null,
			efektivnaKorekcia(g, 'Slide')
		)!;
		saveCfgChanges({
			sysStyl: sys,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			triedaKorekcia: new Map([[16, 40]])
		});
		const cfg1 = loadCfg();
		const g2 = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 mliečne')!;
		const po = computeFlat(
			cfg1,
			sys,
			2551,
			1601,
			efektivnaRedukciaZero(g2),
			g2.hrubka,
			false,
			undefined,
			null,
			efektivnaKorekcia(g2, 'Slide')
		)!;
		expect(po.sklo.sirka).toBe(bez.sklo.sirka + (skloOffset - 40));
	});

	it('per-sklo override (#440) vyhráva nad novo nastavenou triedou', () => {
		const sys = listSysStyly().find((s) => s.system === 'Slide')!.sysStyl;
		const skloOffset = getEditableRows(sys)!.skloOffset;
		const g = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 mliečne')!;
		// trieda 16 korekcia je z predošlého testu 40; nastav per-sklo override na 12
		saveCfgChanges({
			sysStyl: sys,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			glassKorekcia: new Map([[g.id, 12]])
		});
		const g2 = glassTypesForSystem('Slide').find((x) => x.nazov === 'Izolačné sklo 4/8/4 mliečne')!;
		expect(efektivnaKorekcia(g2, 'Slide')).toBe(12); // nie triedová 40
	});
});
