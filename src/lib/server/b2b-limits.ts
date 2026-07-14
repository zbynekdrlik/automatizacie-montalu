// Server adaptér nad klientsky bezpečným $lib/b2b-limits (jediný zdroj pravdy pre
// LOGIKU + hlášky). Server má `cfg` z výpočtu; postaví z neho StyleN[] a zavolá
// čistú funkciu. Klientsky formulár volá $lib/b2b-limits priamo (data.styly).
import type { Cfg } from './compute';
import {
	checkB2BWidth as checkB2BWidthPure,
	checkB2BHeight,
	B2B_LIMITS,
	type StyleN
} from '$lib/b2b-limits';

export { checkB2BHeight, B2B_LIMITS };
export type { StyleN };

/** cfg (Record<sysStyl,{N,…}>) → ľahký StyleN[] pre b2b limity. */
export function stylesFromCfg(cfg: Cfg): StyleN[] {
	return Object.keys(cfg).map((sysStyl) => ({
		sysStyl,
		system: sysStyl.split('|')[0],
		styl: sysStyl.split('|')[1],
		N: cfg[sysStyl].N
	}));
}

// Zachováva pôvodné volanie checkB2BWidth(cfg, sysStyl, S) — server callery ostávajú
// nezmenené, správanie bit-identické (over zasklenia-b2b-preview.test.ts).
export function checkB2BWidth(cfg: Cfg, sysStyl: string, S: number): string | null {
	return checkB2BWidthPure(stylesFromCfg(cfg), sysStyl, S);
}
