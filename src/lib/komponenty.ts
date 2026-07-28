// Kovanie a tesnenia do Money odpisu (Dominik 2026-07-28, tabuľky KOMPONENTY RS ROBUST /
// RS SLIDE). Doteraz appka odpisovala IBA profily v metroch; kovanie dopisovala dielňa
// ručne. Šéf 2026-07-27 rozhodol, že má ísť do Money — toto je jeho výpočet.
//
// MONEY-KRITICKÉ: každý riadok tu je skutočný výdaj zo skladu „Materiál". Preto:
//   - množstvá sa NEHÁDAJÚ: odvodzujú sa z toho, čo engine už spočítal (počet krídel,
//     počty a dĺžky profilov), alebo sú to konštanty, ktoré dal Dominik per štýl;
//   - štýl bez nakonfigurovaného počtu je CHYBA (fail-loud), nie „0 ks" — tichá nula
//     by znamenala, že sa kovanie nikdy neodpíše a nikto si to nevšimne.
//
// Tento modul je client-safe (žiadny import zo `$lib/server/*`), aby počty mohol
// zobraziť aj náhľad plánu.

/** Jednotka položky v Money. Profily sú metrážové, kovanie kusové. */
export type MJ = 'm' | 'ks';

/**
 * Vstupy, z ktorých sa počítajú množstvá kovania. Všetko sú veci, ktoré appka už
 * počíta pre nárezový plán — nič nové sa od obsluhy nepýta.
 */
export interface ZakladPoctov {
	/** počet krídel = `N` daného štýlu (pri opone je to súčet oboch strán) */
	kridla: number;
	/** počet kusov nosového profilu (z BOM: `pocetKs` nosových riadkov) */
	nosoveProfily: number;
	/** súčet dĺžok rezov rámového profilu (mm) */
	dlzkaRamovehoMm: number;
	/** súčet dĺžok rezov nosového profilu (mm) */
	dlzkaNosovehoMm: number;
	/** súčet dĺžok rezov oponového profilu (mm); 0 keď štýl oponu nemá */
	dlzkaOponovehoMm: number;
}

/**
 * Pravidlo, ktorým sa z {@link ZakladPoctov} spočíta množstvo jednej položky.
 * Tvary sú presne tie, ktoré Dominik v tabuľkách použil — žiadny všeobecný vzorcový
 * jazyk (YAGNI); nové pravidlo sa pridá až keď reálne príde.
 */
export type Pravidlo =
	/** ks = koef × počet krídel (kladka 2 ks/krídlo, rohovník krídla 4 ks/krídlo) */
	| { typ: 'naKridlo'; koef: number }
	/** ks = koef × počet uzáverov (podložka 5 ks, protikus 2 ks, sada 1 ks…) */
	| { typ: 'naUzaver'; koef: number }
	/** ks = koef × počet kusov nosového profilu (krytka krídla 2 ks) */
	| { typ: 'naNosovyProfil'; koef: number }
	/** ks = konštanta podľa štýlu (uzáver/zámok, rohovník obvodový) */
	| { typ: 'konstPreStyl'; ks: Record<string, number> }
	/** m = súčet dĺžok danej role profilu (zasklievacie tesnenie = rámový) */
	| { typ: 'dlzkaProfilu'; role: 'ramovy' | 'nosovy'; koef: number }
	/** m = (nosový + 2 × oponový) — kefové tesnenie 7x3,5 */
	| { typ: 'dlzkaNosovehoSOponou'; koef: number }
	/** m = (rámový − nosový) × koef — kefové tesnenie 7x5 / 5x8 */
	| { typ: 'dlzkaRozdiel'; koef: number };

export interface Komponent {
	kod: string;
	nazov: string;
	mj: MJ;
	pravidlo: Pravidlo;
}

/** Chyba konfigurácie — vracia sa namiesto množstiev, aby odpis nikdy nešiel polovičný. */
export interface ChybaKomponentu {
	kod: string;
	sprava: string;
}

export interface PolozkaKomponentu {
	kod: string;
	nazov: string;
	mj: MJ;
	/** ks (celé) alebo metre (zaokrúhlené na 3 desatinné, ako profily) */
	qty: number;
}

const R3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Počet uzáverov (Robust) / automatických zámkov (Slide) pre daný štýl — kotva, na
 * ktorej visí 5 ďalších položiek (podložka, protikus, protikus podložka, upevňovacia
 * sada, madlo). Preto sa počíta raz a zvlášť.
 */
export function pocetUzaverov(uzaver: Komponent, sysStyl: string): number | null {
	if (uzaver.pravidlo.typ !== 'konstPreStyl') return null;
	const ks = uzaver.pravidlo.ks[sysStyl];
	return Number.isFinite(ks) ? ks : null;
}

/**
 * Spočíta množstvá kovania pre jeden posuv. Vracia `chyby`, keď štýl nemá
 * nakonfigurovanú konštantu — volajúci to MUSÍ premeniť na hlasné zlyhanie
 * (rovnaká disciplína ako `oversizeCut` / `missingHrubkaProfile` v compute.ts).
 */
export function pocitajKomponenty(
	komponenty: Komponent[],
	sysStyl: string,
	zaklad: ZakladPoctov,
	uzavery: number | null
): { polozky: PolozkaKomponentu[]; chyby: ChybaKomponentu[] } {
	const polozky: PolozkaKomponentu[] = [];
	const chyby: ChybaKomponentu[] = [];

	for (const k of komponenty) {
		let qty: number | null = null;
		const p = k.pravidlo;
		switch (p.typ) {
			case 'naKridlo':
				qty = p.koef * zaklad.kridla;
				break;
			case 'naNosovyProfil':
				qty = p.koef * zaklad.nosoveProfily;
				break;
			case 'naUzaver':
				if (uzavery === null) {
					chyby.push({
						kod: k.kod,
						sprava: `${k.nazov} (${k.kod}): počet sa odvodzuje od uzáveru, ale pre štýl ${sysStyl} nie je nakonfigurovaný počet uzáverov`
					});
				} else {
					qty = p.koef * uzavery;
				}
				break;
			case 'konstPreStyl': {
				const ks = p.ks[sysStyl];
				if (!Number.isFinite(ks)) {
					chyby.push({
						kod: k.kod,
						sprava: `${k.nazov} (${k.kod}): pre štýl ${sysStyl} nie je nakonfigurovaný počet kusov`
					});
				} else {
					qty = ks;
				}
				break;
			}
			case 'dlzkaProfilu':
				qty = R3(
					(p.koef * (p.role === 'ramovy' ? zaklad.dlzkaRamovehoMm : zaklad.dlzkaNosovehoMm)) / 1000
				);
				break;
			case 'dlzkaNosovehoSOponou':
				qty = R3((p.koef * (zaklad.dlzkaNosovehoMm + 2 * zaklad.dlzkaOponovehoMm)) / 1000);
				break;
			case 'dlzkaRozdiel':
				qty = R3((p.koef * (zaklad.dlzkaRamovehoMm - zaklad.dlzkaNosovehoMm)) / 1000);
				break;
		}
		if (qty === null) continue;
		if (qty < 0) {
			chyby.push({
				kod: k.kod,
				sprava: `${k.nazov} (${k.kod}): vyšlo záporné množstvo ${qty} — chyba vo vzorci alebo v konfigurácii`
			});
			continue;
		}
		if (qty === 0) continue;
		polozky.push({ kod: k.kod, nazov: k.nazov, mj: k.mj, qty });
	}

	return { polozky, chyby };
}

/** Zlúči kovanie z viacerých posuvov po kóde (rovnako ako sa poolujú profily). */
export function zlucKomponenty(davky: PolozkaKomponentu[][]): PolozkaKomponentu[] {
	const podla = new Map<string, PolozkaKomponentu>();
	for (const davka of davky)
		for (const p of davka) {
			const m = podla.get(p.kod);
			if (m) m.qty = R3(m.qty + p.qty);
			else podla.set(p.kod, { ...p });
		}
	return [...podla.values()];
}
