// B2B rozmerové limity (len pre veľkoobchodných používateľov). Šírka na pole = S/N
// (Dominik: „2K 3000 → sklo 1500, treba 3K po 1000") — počet polí (N) je na sys riadku.
// Interní users tieto kontroly OBCHÁDZAJÚ (volá sa len keď isB2B). Výška NEblokuje,
// len upozorní „bez záruky". Konštanta sa dá neskôr presunúť do editora Vzorce.
import type { Cfg } from './compute';

export const B2B_LIMITS: Record<string, { minPanel: number; maxPanel: number; maxHeight: number }> = {
	Deluxe: { minPanel: 800, maxPanel: 1000, maxHeight: 2500 },
	Slide: { minPanel: 800, maxPanel: 1300, maxHeight: 2500 },
	Robust: { minPanel: 800, maxPanel: 1500, maxHeight: 2600 },
	// Štandard +: PLACEHOLDER — spec neurčuje b2b výrobné limity (mimo zadania tejto
	// úlohy), hodnoty len kopírujú Robust (najbližšia konštrukcia — rámovaný
	// posuv, štýly 2K…6K). Bez tohto riadku by b2b dostal NEOBMEDZENÉ rozmery na
	// novom systéme (drift guard v b2b-limits.test.ts to odchytáva). Dominik/Zbynek
	// by mali potvrdiť/upraviť skutočné výrobné limity.
	'Štandard +': { minPanel: 800, maxPanel: 1500, maxHeight: 2600 }
};

// Rodina štýlu: dvojité (opona) začínajú „2x", ostatné sú jednoduché. Návrh štýlu
// ostáva v tej istej rodine (jednoduché ↔ jednoduché, 2x ↔ 2x) — inak by sa zmenil
// typ výrobku.
function family(styl: string): '2x' | 'single' {
	return styl.startsWith('2x') ? '2x' : 'single';
}

/** Štýly daného systému + rodiny, s N, zoradené vzostupne podľa N. */
function familyStyles(cfg: Cfg, system: string, fam: '2x' | 'single'): { styl: string; N: number }[] {
	return Object.keys(cfg)
		.filter((k) => k.startsWith(system + '|'))
		.map((k) => ({ styl: k.split('|')[1], N: cfg[k].N }))
		.filter((s) => family(s.styl) === fam)
		.sort((a, b) => a.N - b.N);
}

/**
 * Blok + poradí štýl. Vráti slovenskú chybu (nespočíta sa), alebo null keď S/N sedí
 * do [minPanel, maxPanel] pre zvolený systém.
 */
export function checkB2BWidth(cfg: Cfg, sysStyl: string, S: number): string | null {
	const [system, styl] = sysStyl.split('|');
	const lim = B2B_LIMITS[system];
	if (!lim) return null; // neznámy systém → nelimituj (fail-open na neznáme, biznis limity sú len pre 3 systémy)
	const g = cfg[sysStyl];
	if (!g) return null;
	const panel = S / g.N;
	if (panel >= lim.minPanel && panel <= lim.maxPanel) return null;

	// nájdi štýl v rovnakej rodine, kde S/N ∈ [min,max]; preferuj najmenšie N
	const fam = family(styl);
	const options = familyStyles(cfg, system, fam);
	const fit = options.find((o) => S / o.N >= lim.minPanel && S / o.N <= lim.maxPanel);
	const per = Math.round(panel);
	if (fit && fit.styl !== styl) {
		const smer = panel > lim.maxPanel ? `nad ${lim.maxPanel}` : `pod ${lim.minPanel}`;
		return `Pri šírke ${S} mm a štýle ${styl} by malo jedno sklo ${per} mm (${smer}). Zvoľ ${fit.styl}.`;
	}
	// žiadny štýl v rodine nesedí → mŕtva zóna medzi počtami polí
	const ranges = options
		.map((o) => `${o.styl} = ${Math.round(lim.minPanel * o.N)}–${Math.round(lim.maxPanel * o.N)} mm`)
		.join(', ');
	return `Šírka ${S} mm sa pri ${system} nedá rozdeliť na sklá v rozsahu ${lim.minPanel}–${lim.maxPanel} mm. Platné šírky: ${ranges}. Uprav šírku.`;
}

/** Výška NEblokuje — len warning „bez záruky" nad maxHeight. Vráti text alebo null. */
export function checkB2BHeight(sysStyl: string, V: number): string | null {
	const system = sysStyl.split('|')[0];
	const lim = B2B_LIMITS[system];
	if (!lim) return null;
	if (V > lim.maxHeight)
		return `⚠ Výška ${V} mm presahuje ${lim.maxHeight} mm — zasklenie BEZ ZÁRUKY.`;
	return null;
}
