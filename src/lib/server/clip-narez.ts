// CLIP „Rozpis rezov na tyče — pre pílu" adaptér (#554). Prevedie CLIP nárezové
// riadky (ClipRiadok z clip.ts) na `MaterialRow[]`, ktoré kreslí existujúci klientský
// komponent `RozpisRezov.svelte` (pásy tyčí s kusmi a odpadom) — rovnaká vizualizácia
// ako pri zaskleniach.
//
// DISPLAY-ONLY — Money-NEUTRÁLNE (kontrakt clip.md / #372):
//   • Odpis do Money ostáva per-riadkový ROUNDUP z `computeClip` (1:1 parita s
//     Patrikovým Excelom). Tento adaptér ho NIKDY nemení a NIKDY nevoláva
//     `writeOdpis` / Money — je čisté grafické rozloženie.
//   • Pílový plán je OPTIMALIZOVANÉ balenie (`ffdPack`, First-Fit-Decreasing) tých
//     istých rezov do 7500 mm tyčí (rovnaká dĺžka `CLIP_DLZKA_TYCE`, akú používa CLIP
//     compute, kotúč `KOTUC`). Počet tyčí v pláne sa preto môže LÍŠIŤ od ROUNDUP
//     počtu v odpise — to je zámer (poznámka pod plánom + otázka pre Patrika „reálny
//     počet" v akceptácii, Excel 37649 má stĺpec prázdny).
//
// Server-only: `ffdPack`/`KOTUC` žijú v `$lib/server/compute-model` (server modul),
// preto tento adaptér patrí do `$lib/server/*`. Volá ho LEN `clip/+page.server.ts`,
// výsledok (MaterialRow[]) sa serializuje na stránku a vykreslí cez RozpisRezov
// (ten importuje z MaterialRow len TYP — klientsky bezpečné).
import { ffdPack, type MaterialRow, type Kus } from '$lib/server/compute';
import { CLIP_DLZKA_TYCE, type ClipVypocet } from '$lib/clip';

/**
 * Zloží pílový plán (MaterialRow[]) z jedného alebo viacerých CLIP kusov. Pri viacerých
 * kusoch sa rezy toho istého profilu (Money kód) ZDIEĽAJÚ na spoločných tyčiach — presne
 * ako zasklenia multi (jedno spoločné balenie, menej tyčí než súčet samostatných).
 * Drobné položky (kod: null — tesnenia, spojovník, kolík) sa do plánu rezov NEDOSTANÚ
 * (nie sú rezané tyče). Poradie profilov = poradie prvého výskytu (rám → priečka →
 * zasklievací), zhodné s odpisovou tabuľkou.
 */
export function clipMaterialRows(kusy: ClipVypocet[]): MaterialRow[] {
	// názov profilu per Money kód (z odpisových položiek — obsahujú kód + katalógový názov)
	const nazovPre = new Map<string, string>();
	for (const k of kusy) {
		for (const p of k.polozky) if (!nazovPre.has(p.kod)) nazovPre.set(p.kod, p.nazov);
	}

	// zoskup kusy (rezy) per Money kód naprieč všetkými zábradliami (poradie prvého výskytu)
	const perKod = new Map<string, Kus[]>();
	const poradie: string[] = [];
	for (const k of kusy) {
		for (const r of k.riadky) {
			if (r.kod === null || r.rozmer === null || r.pocetKs === null || r.pocetKs <= 0) continue;
			let arr = perKod.get(r.kod);
			if (!arr) {
				arr = [];
				perKod.set(r.kod, arr);
				poradie.push(r.kod);
			}
			// rozmer je zobrazená (R1) dĺžka rezu; CLIP nemá prerez v rozmere — kerf (KOTUC)
			// pridá ffdPack. `dlzka` = spotreba na tyči, `rozmer` = zobrazené robotníkovi.
			for (let i = 0; i < r.pocetKs; i++) arr.push({ rozmer: r.rozmer, dlzka: r.rozmer });
		}
	}

	const rows: MaterialRow[] = [];
	for (const kod of poradie) {
		const kusyKod = perKod.get(kod)!;
		// ffdPack s tou istou 7500 mm tyčou + kotúčom KOTUC ako pri zaskleniach (default kerf)
		const bary = ffdPack(kusyKod, CLIP_DLZKA_TYCE);
		const tyce = bary.length;
		const barLen = CLIP_DLZKA_TYCE;
		// rovnaký vzorec odpadu ako compute-odpis.ts: Σ zvyškov, % z použitých tyčí
		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * barLen)) * 1000) / 10 : 0;

		// rezy = počet kusov per dĺžka (poradie prvého výskytu dĺžky)
		const rezy: { rozmer: number; ks: number }[] = [];
		for (const ku of kusyKod) {
			const ex = rezy.find((x) => x.rozmer === ku.rozmer);
			if (ex) ex.ks += 1;
			else rezy.push({ rozmer: ku.rozmer, ks: 1 });
		}

		rows.push({
			kod,
			nazov: nazovPre.get(kod) ?? '',
			rezy,
			tyce,
			bary,
			odpadMm,
			odpadPct,
			barLen,
			// CLIP profily sa režú rovno (90°) — ako obdĺžniková kresba v Exceli (37649/37650);
			// uhol je len na nákrese, Money odpis nemení.
			sikmyRez: false
		});
	}
	return rows;
}
