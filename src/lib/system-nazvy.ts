// Zobrazované názvy systémov. **DISPLAY-ONLY — do Money odpisu odtiaľto nejde nič.**
//
// Patrik 2026-07-31: „celkom by sa mi aj páčilo minimálne v hlavičke, že by nebolo
// štandard + ale štandard plus" + „do budúcna budem používať názvy štandard +
// a starý štandard".
//
// Prečo mapa a nie premenovanie: `Štandard +` NIE JE len text, je to KĽÚČ konfigurácie
// (`sysStyl` = `Štandard +|4K IZO`) — žije v `cfg_seed.json`, v DB tabuľkách nárezákov,
// v uložených odpisoch (`odpis_log.detail`) aj v `b2b-limits.ts`. Premenovanie kľúča by
// rozbilo nárezáky aj históriu odpisov, preto sa mení VÝHRADNE to, čo číta človek;
// hodnoty vo `<option value>`, v hidden inputoch a v POSTe ostávajú pôvodné kľúče.
//
// Popis dokladu v Money (`OP : zákazník`) názov systému neobsahuje, takže sa ho toto
// netýka — a nesmie sa tým začať.

/** Kľúč systému (ten, čo je v cfg/DB) → čo z neho vidí obsluha. */
const NAZVY: Record<string, string> = {
	'Štandard +': 'Štandard plus',
	Štandard: 'Starý štandard'
};

/** Názov systému pre človeka. Neznámy systém sa vráti nezmenený. */
export function nazovSystemu(system: string): string {
	return NAZVY[system] ?? system;
}

/**
 * `sysStyl` (`Štandard +|4K IZO`) → „Štandard plus 4K IZO" pre výpis.
 * Reťazec bez `|` sa berie ako samotný systém.
 */
export function nazovSysStyl(sysStyl: string): string {
	const i = sysStyl.indexOf('|');
	if (i < 0) return nazovSystemu(sysStyl);
	return `${nazovSystemu(sysStyl.slice(0, i))} ${sysStyl.slice(i + 1)}`;
}
