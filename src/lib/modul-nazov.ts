// Client-safe: modul kód → zobrazovaný názov v histórii odpisov (#380). BEZ server importu
// (používa sa v `/odpisy` .svelte pohľadoch). Musí pokrývať KAŽDÝ modul z `Modul` únie
// (`$lib/server/money`) — inak história/detail/zákazka pohľad zobrazí zlý názov: fix aj clip
// predtým padali na fallback „Pergola" (ternár `… : 'Pergola'`), takže FIX doklad sa tváril
// ako pergola. Neznámy modul → surový kód (`?? m`) je čestný fallback, nie zlý názov.
const MODUL_NAZVY: Record<string, string> = {
	zasklenia: 'Zasklenia',
	bazen: 'Bazén',
	pergola: 'Pergola',
	clip: 'Clip',
	fix: 'Fix'
};

export function modulNazov(m: string): string {
	return MODUL_NAZVY[m] ?? m;
}
