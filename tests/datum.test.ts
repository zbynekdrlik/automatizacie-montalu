// Dátum vytvorenia nárezáku v tlačenej hlavičke (#114, Patrik — pripomienka z výroby).
// Server nesie hodnotu ako ISO string (Date.now() na serveri, NIE new Date() na klientovi —
// nesmie driftovať, ak stránka ostane otvorená). Táto funkcia len FORMÁTUJE už hotovú ISO
// hodnotu na zobrazenie — nič nepočíta „teraz". Časová zóna je EXPLICITNE Europe/Bratislava
// (Docker image nemá TZ nastavené → server bez explicitnej zóny by počítal v UTC a dielňa by
// videla čas posunutý o 1-2h), takže výsledok je deterministický bez ohľadu na TZ CI runnera.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { formatDatumCasSk } from '../src/lib/datum';

describe('formatDatumCasSk — slovenský tvar D.M.YYYY HH:MM', () => {
	it('bežný dátum — deň/mesiac bez nuly, čas so nulou', () => {
		// 5.8.2026 14:32 miestneho času (CEST, UTC+2) = 12:32 UTC
		expect(formatDatumCasSk('2026-08-05T12:32:00.000Z')).toBe('5.8.2026 14:32');
	});

	it('jednociferný deň AJ mesiac — žiadne nuly vpredu', () => {
		// 5.1.2026 14:32 miestneho času (CET, UTC+1, zima) = 13:32 UTC
		expect(formatDatumCasSk('2026-01-05T13:32:00.000Z')).toBe('5.1.2026 14:32');
	});

	it('polnoc miestneho času sa zobrazí ako 00:00, nie 24:00', () => {
		// 6.7.2026 00:00 CEST (UTC+2) = 5.7.2026 22:00 UTC
		expect(formatDatumCasSk('2026-07-05T22:00:00.000Z')).toBe('6.7.2026 00:00');
	});

	it('minúty pod 10 majú nulu vpredu (14:05, nie 14:5)', () => {
		expect(formatDatumCasSk('2026-08-05T12:05:00.000Z')).toBe('5.8.2026 14:05');
	});

	it('desiatkový dátum a čas — kontrola formátu bez skrátenia', () => {
		expect(formatDatumCasSk('2026-12-25T09:15:00.000Z')).toBe('25.12.2026 10:15');
	});

	it('jednociferná hodina má nulu vpredu (09:05, nie 9:05)', () => {
		// 5.8.2026 09:05 CEST (UTC+2) = 07:05 UTC
		expect(formatDatumCasSk('2026-08-05T07:05:00.000Z')).toBe('5.8.2026 09:05');
	});

	// Docker image (node:24-bookworm-slim) nemá TZ nastavené → proces beží pod UTC. Mutovanie
	// process.env.TZ V BEŽIACOM procese NIE JE spoľahlivý test (Node/ICU si predvolenú zónu
	// môže cachovať pri štarte — overené priamo na tomto stroji: zmena process.env.TZ za behu
	// output NEOVPLYVNILA). Jediný spoľahlivý spôsob overiť „nezávisí od TZ procesu" je spustiť
	// ČERSTVÝ node proces s TZ=UTC nastaveným PRED štartom (presne ako v Dockeri) a porovnať.
	it('výsledok NEZÁVISÍ od TZ procesu — ČERSTVÝ proces s TZ=UTC (ako Docker) dá rovnaký čas', () => {
		const vystup = execFileSync(
			process.execPath,
			[
				'--experimental-strip-types',
				'-e',
				"import('./src/lib/datum.ts').then(m => console.log(m.formatDatumCasSk('2026-08-05T12:32:00.000Z')))"
			],
			{ cwd: import.meta.dirname + '/..', env: { ...process.env, TZ: 'UTC' }, encoding: 'utf8' }
		).trim();
		// pod TZ=UTC bez explicitnej zóny by toto bolo „5.8.2026 12:32" (UTC, nie Bratislava) —
		// dôkaz spustený priamo proti tomuto testu: odstránenie `timeZone` z datum.ts dá 12:32
		expect(vystup).toBe('5.8.2026 14:32');
	});
});
