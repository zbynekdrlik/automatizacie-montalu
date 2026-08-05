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
