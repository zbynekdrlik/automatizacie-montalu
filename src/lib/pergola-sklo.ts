// Strešné sklo pergoly — vzorec šírky tabule + počet tabúľ + honest-null dĺžka (#223).
//
// POTVRDENÁ A1 (Dominik #198, Odoo 1725595, 21.8.2026): šírka strešného skla =
// „svetlosť medzi krovmi" + 30 mm (sklo / STADUR 24 mm), resp. + 34 mm (polykarbonát
// 16 mm). Stredová výstuha 140×140 do šírky skla NEvstupuje (Dominik to explicitne
// potvrdil). Počet tabúľ = počet polí medzi krovmi = počet krovov − 1.
//
// DĹŽKA tabule je ZÁMERNE honest-null — a od 25.8. je to podložené REÁLNYM kusom:
// výrobný výkres skla OP260282 (Dominik ho pripol do ch207, msg 1731731, príloha 10504)
// má tabuľu 685 × 3259 mm, 7 ks. Šírku aj počet vzorce reprodukujú (685,43 → rez 685;
// 7 polí ✓), ale dĺžku NEreprodukuje ŽIADNE verbatim pravidlo: chat „dĺžka skla = dĺžka
// krovu + 30/+40" (ch207 1725597–1725599) dáva 3239,76 + 40 = 3279,76 ✗ (Δ +20,76 —
// zhodou okolností presne dĺžka prítlačnej lišty), call 19.8. „dĺžka hornej hrany + 20
// (masív)" dáva 3240,93 + 20 = 3260,93 ✗ (Δ +1,93). Hypotéza „nominál + 20 zaokrúhlené
// nadol" (= 3259) by sedela, ale sú to dve neoverené domnienky naraz → force-fit. Kým
// Dominik rozpor nerozsekne, dĺžka sa NEPOČÍTA — nikdy sa nehádže neoverený rozmer
// (rovnaká disciplína ako celý pergola-narez engine).
//
// PURE modul — importuje LEN pure moduly (`sklo-strecha`, `pergola-narez`), žiadny
// server/DB. Strešné sklo je Money-NEUTRÁLNE (display-only): NIKDY nevstupuje do
// `vypocitane`/`narezToCadRows`/Money — je to samostatná funkcia mimo `NarezVysledok`
// (vzor `komponentyPergoly`), aby golden `spocitajNarez`/OP260282 ostali bit-identické.
// Money-safety guard (`tests/pergola-narez-money-safety.test.ts`) drží čistotu.
import { SKLO_STRECHA_TYPY, skloStrechaMoneyKod } from './sklo-strecha';
import { svetlostMedziKrovmi, platnyPocetKrovov, type PergolaNarezVstup } from './pergola-narez';

/** zaokrúhlenie na 0,01 mm — rovnaká presnosť ako `svetlostMedziKrovmi` (výkres OP260282
 *  udáva 0,01 mm), aby šírka = svetlosť + prídavok neprišla o presnosť. */
const R2 = (x: number) => Math.round(x * 100) / 100;

/** Prídavok k svetlosti pre šírku strešného skla [mm] — sklo aj STADUR 24 mm (A1). */
export const SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO = 30;
/** Prídavok k svetlosti pre šírku strešného skla [mm] — polykarbonát 16 mm (A1, iný vzorec). */
export const SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT = 34;

/** Je daný typ strešného skla polykarbonát (16 mm)? Polykarbonát má INÝ prídavok šírky
 *  (+34 namiesto +30). STADUR 24 mm sa správa ako sklo (+30), nie ako polykarbonát. */
export function jePolykarbonatSklo(nazov: string): boolean {
	return nazov.toLowerCase().includes('polykarbon');
}

/** Prídavok k svetlosti pre šírku tabule podľa typu skla [mm]: polykarbonát → 34, inak
 *  (lepené / izolačné sklo / STADUR) → 30 (A1, Dominik #198). */
export function strechaSkloSirkaPridavok(
	nazov: string
): typeof SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO | typeof SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT {
	return jePolykarbonatSklo(nazov)
		? SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT
		: SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO;
}

export interface StrechaSkloVypocet {
	/** kanonický typ z katalógu `SKLO_STRECHA_TYPY`, alebo `null` keď nevybrané / neznáme */
	typ: string | null;
	/** je zvolený typ polykarbonát (iný prídavok šírky) */
	jePolykarbonat: boolean;
	/** prídavok šírky [mm] (30 sklo/STADUR, 34 polykarbonát); `null` keď typ nevybraný */
	sirkaPridavok:
		| typeof SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO
		| typeof SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT
		| null;
	/** počet tabúľ = počet polí medzi krovmi = (počet krovov − 1); `null` keď počet krovov nezadaný */
	pocetTabul: number | null;
	/** šírka tabule [mm] = svetlosť medzi krovmi + prídavok; `null` keď typ/počet krovov chýba */
	sirkaMm: number | null;
	/** dĺžka tabule [mm] — VŽDY `null` (vzorec dĺžky nepotvrdený, honest-null) */
	dlzkaMm: number | null;
	/** Money TS kód (cenník IZOS) pre cenu, alebo `null` = žiadny potvrdený kód → „cena neznáma" */
	moneyKod: string | null;
	/** krátke plain-slovenské poznámky (bez interných referencií) — honest-null vysvetlenia na obrazovku */
	poznamky: string[];
}

/** Je názov skutočný katalógový typ (`SKLO_STRECHA_TYPY.nazov`)? Prázdny / mimo katalógu → false. */
function jeKatalogovyTyp(nazov: string): boolean {
	return SKLO_STRECHA_TYPY.some((t) => t.nazov === nazov);
}

/** Výpočet strešného skla z rozmerov pergoly + zvoleného typu (#223). Honest-null disciplína:
 *  - bez zvoleného (katalógového) typu → všetko `null` (výzva vybrať typ);
 *  - bez počtu krovov → `pocetTabul`/`sirkaMm` `null` (výzva zadať počet krovov);
 *  - dĺžka tabule VŽDY `null` (vzorec nepotvrdený);
 *  - bez Money kódu → `moneyKod` `null` (cena nedostupná).
 *  Čistá funkcia — bez vedľajších efektov, bez Money zápisu (Money-neutrálne, display-only). */
export function spocitajStrechaSklo(v: PergolaNarezVstup): StrechaSkloVypocet {
	const zvolene = (v.strechaSkloTyp ?? '').trim();
	if (!jeKatalogovyTyp(zvolene)) {
		return {
			typ: null,
			jePolykarbonat: false,
			sirkaPridavok: null,
			pocetTabul: null,
			sirkaMm: null,
			dlzkaMm: null,
			moneyKod: null,
			poznamky: ['Vyber typ strešného skla pre výpočet šírky a ceny.']
		};
	}

	const jePoly = jePolykarbonatSklo(zvolene);
	const sirkaPridavok = strechaSkloSirkaPridavok(zvolene);
	const moneyKod = skloStrechaMoneyKod(zvolene);

	// Počet polí medzi krovmi = počet krovov − 1 (potrebuje platný manuálny počet krovov).
	const n = platnyPocetKrovov(v);
	const pocetTabul = n != null ? n - 1 : null;
	// Šírka tabule = svetlosť medzi krovmi + prídavok. svetlosť je null keď n chýba alebo sa
	// krovy do šírky nezmestia (backstop v `svetlostMedziKrovmi`).
	const svetlost = svetlostMedziKrovmi(v.sirka, n);
	const sirkaMm = svetlost != null ? R2(svetlost + sirkaPridavok) : null;

	const poznamky: string[] = [];
	if (n == null) {
		poznamky.push('Zadaj počet krovov, aby sa spočítala šírka tabule a počet tabúľ.');
	}
	// Dĺžka tabule ostáva honest-null vždy (vzorec dĺžky zatiaľ nepotvrdený).
	poznamky.push('Dĺžka tabule strešného skla zatiaľ čaká na vzorec od Dominika — nepočíta sa.');
	if (moneyKod == null) {
		poznamky.push('Karta v Money zatiaľ pre tento typ skla neexistuje — cena nedostupná.');
	}

	return {
		typ: zvolene,
		jePolykarbonat: jePoly,
		sirkaPridavok,
		pocetTabul,
		sirkaMm,
		dlzkaMm: null,
		moneyKod,
		poznamky
	};
}
