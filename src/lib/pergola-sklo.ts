// Strešné sklo pergoly — vzorec šírky tabule + počet tabúľ + honest-null dĺžka (#223).
//
// POTVRDENÁ A1 (Dominik #198, Odoo 1725595, 21.8.2026): šírka strešného skla =
// „svetlosť medzi krovmi" + 30 mm (sklo / STADUR 24 mm), resp. + 34 mm (polykarbonát
// 16 mm). Stredová výstuha 140×140 do šírky skla NEvstupuje (Dominik to explicitne
// potvrdil). Počet tabúľ = počet polí medzi krovmi = počet krovov − 1.
//
// POTVRDENÁ DĹŽKA (Dominik 2.9.2026, discuss.channel_393 msg 1777597): dĺžka strešného
// skla = „dĺžka hornej hrany" krovu + 10 mm (Robust) / + 20 mm (Massiv), meria sa z hornej
// hrany. Verbatim: „4 pri robuste + 10 a massiv +20 dlzka … meria sa to z dlžky hornej
// hrany tieto detaile prosím nerieš nerobíme vyrobný výkres ale navrhový výkres na
// rezervovanie materialu sklo je osadene na ploche ktora nieje nikde kotovana" — teda ~2 mm
// drift voči reálnemu rezu sa NErieši (návrhová presnosť na rezerváciu materiálu).
//
// Base „dĺžka hornej hrany" = appkin NOMINÁL krovu (`krovDlzkaNominalOverena`) — nominál JE
// horná hrana so waivnutým ~1,17 mm seating detailom (presne ten „detail", čo Dominik povedal
// nechať tak). Golden OP260282 (masív): 3239,76 + 20 = 3259,76 → reálny rez skla 3259 mm
// (príloha 10504), Δ 0,76 mm — v pásme „~2 mm NErieši" (a bližšie než skoršie kandidáty
// „HH+20"=3260,93 / „krov+40"=3279,76, ktoré reál vyvracal). Config-gate: nominál sa emituje
// LEN pre overenú konfiguráciu kotvy (samostatne + zadný 110); pri stene/zadnom 140/bez sklonu
// → dĺžka honest-null (nikdy sa nehádže neoverený rozmer, rovnaká disciplína ako rez krovu).
//
// PLOCHA + CELKOVÁ CENA (Palohova požiadavka „aby to tam započítalo aj ceny skiel"): keď je
// dĺžka známa, plocha = šírka × dĺžka a celkové m² = plocha × počet tabúľ. €/m² (server,
// `sklo-strecha-cena`) × celkové m² dáva celkovú cenu skiel v karte. Money ODPIS skla sa
// stále NEROBÍ (ticket #223: až po potvrdení vzorca AJ variácie; karty skiel = #235) — sklo
// ostáva Money-NEUTRÁLNE.
//
// PURE modul — importuje LEN pure moduly (`sklo-strecha`, `pergola-narez`), žiadny
// server/DB. Strešné sklo je Money-NEUTRÁLNE (display-only): NIKDY nevstupuje do
// `vypocitane`/`narezToCadRows`/Money — je to samostatná funkcia mimo `NarezVysledok`
// (vzor `komponentyPergoly`), aby golden `spocitajNarez`/OP260282 ostali bit-identické.
// Money-safety guard (`tests/pergola-narez-money-safety.test.ts`) drží čistotu.
import { SKLO_STRECHA_TYPY, skloStrechaMoneyKod } from './sklo-strecha';
import {
	svetlostMedziKrovmi,
	platnyPocetKrovov,
	krovDlzkaNominalOverena,
	type PergolaNarezVstup
} from './pergola-narez';

/** zaokrúhlenie na 0,01 mm — rovnaká presnosť ako `svetlostMedziKrovmi` (výkres OP260282
 *  udáva 0,01 mm), aby šírka = svetlosť + prídavok neprišla o presnosť. */
const R2 = (x: number) => Math.round(x * 100) / 100;

/** Prídavok k svetlosti pre šírku strešného skla [mm] — sklo aj STADUR 24 mm (A1). */
export const SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO = 30;
/** Prídavok k svetlosti pre šírku strešného skla [mm] — polykarbonát 16 mm (A1, iný vzorec). */
export const SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT = 34;

/** Prídavok k dĺžke hornej hrany krovu pre dĺžku tabule [mm] — ROBUST (Dominik 2.9., msg 1777597). */
export const SKLO_STRECHA_DLZKA_PRIDAVOK_ROBUST = 10;
/** Prídavok k dĺžke hornej hrany krovu pre dĺžku tabule [mm] — MASSIVE (Dominik 2.9., msg 1777597). */
export const SKLO_STRECHA_DLZKA_PRIDAVOK_MASSIVE = 20;

/** Prídavok k dĺžke tabule podľa systému pergoly [mm]: Robust → 10, Massive → 20 (Dominik 2.9.). */
export function strechaSkloDlzkaPridavok(
	system: PergolaNarezVstup['system']
): typeof SKLO_STRECHA_DLZKA_PRIDAVOK_ROBUST | typeof SKLO_STRECHA_DLZKA_PRIDAVOK_MASSIVE {
	return system === 'Robust'
		? SKLO_STRECHA_DLZKA_PRIDAVOK_ROBUST
		: SKLO_STRECHA_DLZKA_PRIDAVOK_MASSIVE;
}

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
	/** dĺžka tabule [mm] = dĺžka hornej hrany krovu + prídavok (Robust 10 / Massiv 20); `null` keď
	 *  krov nominál nie je overený (stena / zadný profil ≠ 110 / bez sklonu / sklon nad 9°) */
	dlzkaMm: number | null;
	/** plocha jednej tabule [m²] = šírka × dĺžka; `null` keď šírka alebo dĺžka chýba */
	plochaTabuleM2: number | null;
	/** celková plocha skiel [m²] = plocha tabule × počet tabúľ; `null` keď plocha/počet chýba */
	plochaCelkomM2: number | null;
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
 *  - bez počtu krovov → `pocetTabul`/`sirkaMm`/`plochaCelkomM2` `null` (výzva zadať počet krovov);
 *  - dĺžka tabule = dĺžka hornej hrany krovu + prídavok LEN pre overenú konfiguráciu kotvy,
 *    inak `null` (stena / zadný profil ≠ 110 / bez sklonu / sklon nad 9°);
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
			plochaTabuleM2: null,
			plochaCelkomM2: null,
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
	// Dĺžka tabule = dĺžka hornej hrany krovu (= overený nominál krovu) + prídavok (Robust 10 /
	// Massiv 20, Dominik 2.9.). `krovDlzkaNominalOverena` je null pri neoverenej kotve / bez
	// sklonu / nad 9° → dĺžka honest-null. Nezávisí od počtu krovov (je to per-poľová dĺžka).
	const krovNom = krovDlzkaNominalOverena(v);
	const dlzkaPridavok = strechaSkloDlzkaPridavok(v.system);
	const dlzkaMm = krovNom != null ? R2(krovNom + dlzkaPridavok) : null;
	// Plocha [m²]: jednej tabule = šírka × dĺžka; celková = plocha tabule × počet tabúľ. null,
	// keď ktorýkoľvek rozmer/počet chýba (honest-null — celková cena skiel sa potom nespočíta).
	const plochaTabuleM2 =
		sirkaMm != null && dlzkaMm != null ? R2((sirkaMm * dlzkaMm) / 1_000_000) : null;
	const plochaCelkomM2 =
		sirkaMm != null && dlzkaMm != null && pocetTabul != null
			? R2((sirkaMm * dlzkaMm * pocetTabul) / 1_000_000)
			: null;

	const poznamky: string[] = [];
	if (n == null) {
		poznamky.push('Zadaj počet krovov, aby sa spočítala šírka tabule a počet tabúľ.');
	}
	if (dlzkaMm != null) {
		poznamky.push(
			`Dĺžka tabule = dĺžka hornej hrany krovu + ${dlzkaPridavok} mm (návrhový rozmer na ` +
				'rezerváciu materiálu; ~2 mm odchýlka oproti výrobnému rezu).'
		);
	} else {
		poznamky.push(
			'Dĺžka tabule sa počíta zo sklonenej dĺžky krovu — zadaj sklon strechy (do 9°) pri ' +
				'samostatne stojacej pergole so zadným profilom 110. Inak sa dĺžka nepočíta.'
		);
	}
	if (moneyKod == null) {
		poznamky.push('Karta v Money zatiaľ pre tento typ skla neexistuje — cena nedostupná.');
	}

	return {
		typ: zvolene,
		jePolykarbonat: jePoly,
		sirkaPridavok,
		pocetTabul,
		sirkaMm,
		dlzkaMm,
		plochaTabuleM2,
		plochaCelkomM2,
		moneyKod,
		poznamky
	};
}
