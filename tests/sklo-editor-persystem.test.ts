// #438: prepínač „nuluje Redukciu 6mm" v editore vzorcov musí byť PER SYSTÉM.
// „3.3.1" žije ako samostatný riadok v Slide (v17) aj v Štandard + (v22) —
// `glass_types` je UNIQUE(nazov, system). Pôvodný save čítal `GROUP BY nazov`
// a zapisoval `WHERE nazov=?` (bez systému), takže úprava skla na stránke JEDNÉHO
// systému prehodila rovnako pomenované sklo aj v druhom systéme (prod cfg_audit
// id 16, 27.7. — úprava z Deluxe|2K prehodila sklá 3 iných systémov).
import { describe, it, expect } from 'vitest';
import { glassTypesForSystem, listSysStyly } from '../src/lib/server/db';
import { saveCfgChanges, getEditableRows } from '../src/lib/server/cfg-editor';

const redukcia = (system: string, nazov: string) =>
	glassTypesForSystem(system).find((g) => g.nazov === nazov)?.redukciaZero;

describe('#438 editor vzorcov: prepínač skla je scoped per systém', () => {
	it('úprava „3.3.1" v Štandard + NEZMENÍ „3.3.1" v Slide', () => {
		const styly = listSysStyly();
		const stdSysStyl = styly.find((s) => s.system === 'Štandard +')?.sysStyl;
		const slideSysStyl = styly.find((s) => s.system === 'Slide')?.sysStyl;
		expect(stdSysStyl, 'Štandard + systém musí existovať').toBeTruthy();
		expect(slideSysStyl, 'Slide systém musí existovať').toBeTruthy();

		// „3.3.1" existuje v OBOCH systémoch (predpoklad testu).
		const std331 = glassTypesForSystem('Štandard +').find((g) => g.nazov === '3.3.1');
		const slide331 = glassTypesForSystem('Slide').find((g) => g.nazov === '3.3.1');
		expect(std331, '3.3.1 musí byť v Štandard +').toBeTruthy();
		expect(slide331, '3.3.1 musí byť v Slide').toBeTruthy();
		const stdBefore = std331!.redukciaZero;
		const slideBefore = slide331!.redukciaZero;

		// Prepni redukciu 3.3.1 na stránke Štandard + — mapa je kľúčovaná ROW ID daného skla.
		const skloOffset = getEditableRows(stdSysStyl!)!.skloOffset;
		const { error } = saveCfgChanges({
			sysStyl: stdSysStyl!,
			username: 'tester',
			offsets: new Map(),
			skloOffset,
			glassRedukcia: new Map([[std331!.id, !stdBefore]])
		});
		expect(error).toBeNull();

		// Štandard + „3.3.1" sa prepol...
		expect(redukcia('Štandard +', '3.3.1')).toBe(!stdBefore);
		// ...ale Slide „3.3.1" ostal NEDOTKNUTÝ. Bez opravy (WHERE nazov=?) sa prehodí tiež.
		expect(redukcia('Slide', '3.3.1'), 'Slide „3.3.1" sa nesmie zmeniť úpravou v Štandard +').toBe(
			slideBefore
		);
	});
});
