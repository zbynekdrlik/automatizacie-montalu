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
 * Farba kovania (prášková RAL varianta). Niektoré položky existujú v Money ako
 * dva/tri farebné varianty (napr. kľučka R9005 vs R7016) — do odpisu ide LEN variant
 * zvolenej farby, ostatné sa vôbec neobjavia (nie „0 ks", ale absent).
 * `R9006` pridané #354 (Deluxe krytky — 6mm ponúka R9005/R9006, 10mm R9006/R7016).
 */
export type Farba = 'R9005' | 'R9006' | 'R7016';

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
	/**
	 * súčet dĺžok rezov profilu s „kladkový" v názve (mm), #354. POZOR: NIE je
	 * exkluzívne Deluxe — Štandard má VLASTNÝ „Kladkový profil" (ZASP202415), takže
	 * toto pole je nenulové aj pri Štandard posuve; dnes ho žiadny Štandard
	 * komponent nepoužíva (KOVANIE_NEUPLNE.Štandard čaká na vzorec kefy/tesnenia),
	 * ale budúci Štandard-kefy vzorec s touto rolou musí počítať.
	 */
	dlzkaKladkovehoMm: number;
	/** súčet dĺžok rezov profilu s „klzný" v názve (mm), #354; 0 mimo Deluxe — žiadny
	 *  iný systém dnes profil s týmto názvom nemá (over pri pridaní nového systému). */
	dlzkaKlznehoMm: number;
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
	/**
	 * ks = počet uzáverov × (obojstranná FAB ? 2 : 1) — kľučka a krytka vložky.
	 * Dominik 2026-07-28: jednostranná FAB „chodí jeden zo 100", takže obojstranná
	 * je predvolená a jednostranná je zaškrtávacia výnimka vo formulári.
	 */
	| { typ: 'naUzaverPodlaFab' }
	/** ks = koef × počet kusov nosového profilu (krytka krídla 2 ks) */
	| { typ: 'naNosovyProfil'; koef: number }
	/** ks = konštanta podľa štýlu (uzáver / automatický zámok) */
	| { typ: 'konstPreStyl'; ks: Record<string, number> }
	/**
	 * ks = konštanta podľa KOĽAJNICE, nie podľa štýlu (rohovník obvodový).
	 * Dominik 2026-07-28: „je jedno koľko okien na tom je, stále je to tá istá koľajnica" —
	 * takže opona 2x3K berie počet 3K koľajnice, nie dvojnásobok.
	 */
	| { typ: 'konstPreKolajnicu'; ks: Record<string, number> }
	/**
	 * m = súčet dĺžok danej role profilu (zasklievacie tesnenie = rámový; Deluxe
	 * tesniace kefy = kladkový/klzný, #354 — pridané role bez zmeny existujúcich).
	 */
	| { typ: 'dlzkaProfilu'; role: 'ramovy' | 'nosovy' | 'kladkovy' | 'klzny'; koef: number }
	/** m = (nosový + 2 × oponový) — kefové tesnenie 7x3,5 */
	| { typ: 'dlzkaNosovehoSOponou'; koef: number }
	/** m = (rámový − nosový) × koef — kefové tesnenie 7x5 / 5x8 */
	| { typ: 'dlzkaRozdiel'; koef: number }
	/**
	 * ks = konštanta, NEZÁVISLE od štýlu (na rozdiel od `konstPreStyl`) — Deluxe
	 * krytka krajná aj madlo D56, oba „N ks na posuv" bez ohľadu na počet krídel
	 * (#354; overené z `cfg_seed` — Dorazový profil má `pocetKs=2` na KAŽDOM
	 * Deluxe štýle vrátane opony).
	 */
	| { typ: 'konst'; ks: number }
	/**
	 * ks = koef × (počet krídel − 1) — počet stykov medzi susednými krídlami
	 * (Deluxe krytka stredová L/P, #354). Pri N krídlach je stykov N-1; vid
	 * design komentár na #354 pre odvodenie z `cfg_seed` geometrie (kladkový +
	 * klzný profil majú spolu 2N hrán, 2 z nich krajné, zvyšok tvorí N-1 párov).
	 */
	| { typ: 'naStyk'; koef: number };

export interface Komponent {
	kod: string;
	nazov: string;
	mj: MJ;
	pravidlo: Pravidlo;
	/**
	 * RAL farebný variant. Keď je zadaná, položka ide do odpisu LEN keď sa
	 * zhoduje so zvolenou `farbaKovania` (viď {@link pocitajKomponenty}).
	 * Nezadaná = položka je farbo-neutrálna (väčšina) a počíta sa vždy.
	 */
	farba?: Farba;
	/**
	 * Hrúbka skla, pre ktorú tento variant platí (Deluxe krytky majú samostatný
	 * Money kód per hrúbka×farba, #354). Rovnaká „absent, nie 0" disciplína ako
	 * `farba` (viď {@link pocitajKomponenty}) — nezadaná = položka je hrúbko-
	 * neutrálna (madlo, kefy) a počíta sa vždy.
	 */
	hrubkaSkla?: 6 | 10;
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
 * Koľajnica, na ktorej štýl beží — `2x3K` aj `3K` jazdia po TEJ ISTEJ 3K koľajnici.
 * Používa sa len pre {@link Pravidlo} `konstPreKolajnicu` (rohovník obvodový).
 */
export function kolajnicaStylu(sysStyl: string): string {
	// keď sysStyl obsahuje '|', split má vždy prvok [1] (aj prázdny)
	const styl = sysStyl.includes('|') ? sysStyl.split('|')[1]! : sysStyl;
	// štýl môže niesť aj nárezák („4K IZO") — koľajnicu určuje len počet krídel
	const m = /(\d+K)/.exec(styl.replace(/^\d+x/, ''));
	return m ? m[1]! : styl; // regex má 1 povinnú capture skupinu
}

/**
 * Počet uzáverov (Robust) / automatických zámkov (Slide) pre daný štýl — kotva, na
 * ktorej visí 5 ďalších položiek (podložka, protikus, protikus podložka, upevňovacia
 * sada, madlo). Preto sa počíta raz a zvlášť.
 */
export function pocetUzaverov(uzaver: Komponent, sysStyl: string): number | null {
	if (uzaver.pravidlo.typ !== 'konstPreStyl') return null;
	const ks = uzaver.pravidlo.ks[sysStyl];
	return Number.isFinite(ks) ? ks! : null; // isFinite(undefined) === false
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
	uzavery: number | null,
	obojstrannaFab = true,
	farbaKovania?: Farba,
	skloHrubka?: number
): { polozky: PolozkaKomponentu[]; chyby: ChybaKomponentu[] } {
	const polozky: PolozkaKomponentu[] = [];
	const chyby: ChybaKomponentu[] = [];
	// #354 review nález (🔴): kým mali VŠETKY farebné systémy tú istú dvojicu
	// R9005/R7016, „farba sa nezhoduje → absent" bolo vždy neškodné (zvolená
	// farba VŽDY sedela na NEJAKÝ variant danej položky — dostal sa len ten
	// druhý). Odkedy má Deluxe VLASTNÚ dvojicu (R9006/R7016), zdieľaná
	// objednávková `farbaKovania` môže sedieť na Robust/Štandard, ale NA ŽIADEN
	// Deluxe variant (napr. zmiešaná zimná záhrada, alebo len zlá voľba) —
	// vtedy by sa VŠETKY krytky tíško preskočili (0 riadkov, žiadna chyba) =
	// nedopísaný Money odpis, ktorý nikto nevidí. Preto: keď mal tento posuv
	// ASPOŇ JEDEN farebný kandidát (po hrúbkovom filtri) a zvolená farba
	// NESEDÍ na ŽIADEN z nich, je to HLASNÁ chyba, nie tichý nulový riadok.
	let farebnyKandidatVideny = false;
	let farebnaZhodaNajdena = false;
	const dostupneFarby = new Set<Farba>();

	for (const k of komponenty) {
		// Hrúbka skla (Deluxe krytky, #354): rovnaká „absent, nie 0" disciplína
		// ako farba nižšie — beží PRED farbou, takže položka pre inú hrúbku sa
		// preskočí skôr, než sa vôbec pýta na RAL (6mm objednávka si nevynúti
		// voľbu farby kvôli 10mm-only krytke).
		if (k.hrubkaSkla !== undefined) {
			// `!skloHrubka` (nie `=== undefined`, ako pri farbe nižšie) je ZÁMER: Deluxe
			// hrúbka je vždy 6 alebo 10, nikdy legitímne 0 — `0` je ten istý sentinel
			// „nezadané", aký `skloHrubka ?? 0`/`Number(skloHrubka) || 0` už používa v
			// celom `compute-profily.ts`. `!skloHrubka` teda chytí AJ `undefined` AJ `0`
			// ako „chýba", bezpečný smer (nikdy tichý default na jednu hrúbku).
			if (!skloHrubka) {
				chyby.push({
					kod: k.kod,
					sprava: `${k.nazov} (${k.kod}): má variant pre hrúbku skla (${k.hrubkaSkla} mm), ale hrúbka skla nie je zadaná`
				});
				continue;
			}
			if (k.hrubkaSkla !== skloHrubka) continue;
		}
		// RAL farebný variant: keď má položka `farba`, ale zvolená `farbaKovania`
		// chýba, je to HLASNÁ chyba (nikdy tichý default na jednu z farieb —
		// zle zafarbené kovanie do Money). Keď sa farba nezhoduje, položka sa
		// úplne preskočí (žiadny riadok = „absent", nie „0 ks"). Farbo-neutrálna
		// položka (bez `farba`) prejde nedotknutá.
		if (k.farba !== undefined) {
			farebnyKandidatVideny = true;
			dostupneFarby.add(k.farba);
			if (farbaKovania === undefined) {
				chyby.push({
					kod: k.kod,
					sprava: `${k.nazov} (${k.kod}): má RAL variant (${k.farba}), ale nie je zvolená farba kovania`
				});
				continue;
			}
			if (k.farba !== farbaKovania) continue;
			farebnaZhodaNajdena = true;
		}

		let qty: number | null = null;
		const p = k.pravidlo;
		switch (p.typ) {
			case 'naKridlo':
				qty = p.koef * zaklad.kridla;
				break;
			case 'naNosovyProfil':
				qty = p.koef * zaklad.nosoveProfily;
				break;
			case 'naUzaverPodlaFab':
			case 'naUzaver':
				if (uzavery === null) {
					chyby.push({
						kod: k.kod,
						sprava: `${k.nazov} (${k.kod}): počet sa odvodzuje od uzáveru, ale pre štýl ${sysStyl} nie je nakonfigurovaný počet uzáverov`
					});
				} else {
					qty = (p.typ === 'naUzaver' ? p.koef : obojstrannaFab ? 2 : 1) * uzavery;
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
					qty = ks!; // isFinite(undefined) === false → tu je ks konečné číslo
				}
				break;
			}
			case 'konstPreKolajnicu': {
				const kol = kolajnicaStylu(sysStyl);
				const ks = p.ks[kol];
				if (!Number.isFinite(ks)) {
					chyby.push({
						kod: k.kod,
						sprava: `${k.nazov} (${k.kod}): pre koľajnicu ${kol} (štýl ${sysStyl}) nie je nakonfigurovaný počet kusov`
					});
				} else {
					qty = ks!; // isFinite(undefined) === false → tu je ks konečné číslo
				}
				break;
			}
			case 'dlzkaProfilu': {
				const dlzkaMm =
					p.role === 'ramovy'
						? zaklad.dlzkaRamovehoMm
						: p.role === 'nosovy'
							? zaklad.dlzkaNosovehoMm
							: p.role === 'kladkovy'
								? zaklad.dlzkaKladkovehoMm
								: zaklad.dlzkaKlznehoMm;
				qty = R3((p.koef * dlzkaMm) / 1000);
				break;
			}
			case 'dlzkaNosovehoSOponou':
				qty = R3((p.koef * (zaklad.dlzkaNosovehoMm + 2 * zaklad.dlzkaOponovehoMm)) / 1000);
				break;
			case 'dlzkaRozdiel':
				qty = R3((p.koef * (zaklad.dlzkaRamovehoMm - zaklad.dlzkaNosovehoMm)) / 1000);
				break;
			case 'konst':
				qty = p.ks;
				break;
			case 'naStyk':
				qty = p.koef * (zaklad.kridla - 1);
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

	// #354 review nález (🔴): zvolená farba SEDÍ na farebný systém (Robust R9005 aj
	// Deluxe R9006 sú OBE „zadané"), ale na TENTO posuv SEDÍ na ŽIADNU jeho farebnú
	// položku → bez tejto vetvy by celá farebná rodina (napr. všetkých 6 Deluxe
	// krytiek) ticho zmizla z odpisu s `err: null`. Musí ostať POSLEDNÉ — existujúce
	// per-položkové chyby (chýbajúca hrúbka/farba/konfigurácia) majú prednosť.
	if (farebnyKandidatVideny && farbaKovania !== undefined && !farebnaZhodaNajdena) {
		chyby.push({
			kod: '',
			sprava: `Zvolená farba kovania (${farbaKovania}) nesedí na ŽIADNU farebnú položku tohto posuvu (dostupné: ${[...dostupneFarby].join(', ')}) — skontroluj RAL voľbu, inak by odpis nedostal žiadnu z týchto položiek.`
		});
	}

	// Ten istý kód môže byť v tabuľke viackrát s rôznym pravidlom — Slide používa
	// `ZASK00037` naraz ako obvodový rohovník (podľa koľajnice) AJ ako rohovník krídla
	// (4 ks/krídlo). Do Money musí ísť JEDEN riadok so súčtom.
	return { polozky: zlucKomponenty([polozky]), chyby };
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
