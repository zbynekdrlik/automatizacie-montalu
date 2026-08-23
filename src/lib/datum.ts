// Zobrazenie dátumu vzniku nárezáku v tlačenej hlavičke (#114, Patrik — pripomienka z výroby:
// dielňa chce vedieť, kedy plán vznikol, aby vedela dávať priority podľa dátumu).
//
// DÔLEŽITÉ: táto funkcia len FORMÁTUJE už hotovú ISO časovú značku zo servera — nikdy nepočíta
// „teraz". Server (`+page.server.ts`) vytvorí `vytvorene = new Date().toISOString()` PRI
// SPRACOVANÍ akcie (nahlad/odoslat/nahladMulti/odoslatMulti); táto hodnota sa už nemení, aj keď
// stránka ostane otvorená cez polnoc.
//
// Časová zóna je EXPLICITNE 'Europe/Bratislava': Docker image (node:24-bookworm-slim) nemá
// nastavené TZ, takže bez explicitnej zóny by `Date` metódy počítali v UTC a dielňa by videla
// čas posunutý o 1-2h (podľa letného/zimného času) od skutočnosti. Intl s IANA zónou riadi DST
// automaticky a je deterministický bez ohľadu na to, v akej TZ beží proces (lokálne, CI, VPS).
const FORMAT = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Bratislava',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

/** Slovenský tvar „5.8.2026 14:32" — deň/mesiac bez nuly vpredu, hodiny/minúty 24h so nulou. */
export function formatDatumCasSk(iso: string): string {
	const parts = FORMAT.formatToParts(new Date(iso));
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

// Rovnaká TZ disciplína ako FORMAT vyššie, len bez času — pre miesta, ktoré chcú iba dátum
// (napr. pätička PDF ponuky #277). Bez explicitnej zóny by prod kontajner (UTC) blízko polnoci
// ukázal nesprávny kalendárny deň (viď timestamps.md / #114).
const FORMAT_DATUM = new Intl.DateTimeFormat('en-US', {
	timeZone: 'Europe/Bratislava',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric'
});

/** Slovenský dátum „5.8.2026" (deň/mesiac bez nuly), Europe/Bratislava, bez času. */
export function formatDatumSk(iso: string): string {
	const parts = FORMAT_DATUM.formatToParts(new Date(iso));
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('day')}.${get('month')}.${get('year')}`;
}

// SQLite `datetime('now')` vracia UTC v tvare „YYYY-MM-DD HH:MM:SS" (medzera, BEZ zóny).
// `new Date('YYYY-MM-DD HH:MM:SS')` by ho JS parsol ako LOKÁLNY čas (medzera = nie ISO 8601)
// → na prod kontajneri (UTC) blízko polnoci alebo pri zobrazení času posun o 1-2h (UTC pasca
// #114 / timestamps.md). Normalizácia na UTC ISO (`...T...Z`) je jediný správny most medzi
// SQLite timestampom a `formatDatumCasSk`/`formatDatumSk` (ktoré potom aplikujú Europe/Bratislava).
/** SQLite `datetime('now')` UTC timestamp → korektný UTC ISO reťazec (`...T...Z`). Vstup, ktorý
 *  už ISO je (alebo iný tvar), vráti nezmenený — most, nie parser. */
export function sqliteUtcToIso(sqliteUtc: string): string {
	return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sqliteUtc)
		? sqliteUtc.replace(' ', 'T') + 'Z'
		: sqliteUtc;
}
