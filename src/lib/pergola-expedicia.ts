// Pergola — EXPEDIČNÝ ZOZNAM (#419, rozšírený scope). Čistý transform UŽ VYPOČÍTANÝCH dát
// nárezu na výdajovo-orientovaný pohľad: „čo a koľko kusov fyzicky odchádza z dielne na
// expedíciu" (na rozdiel od interného výrobného/nárezového zoznamu). Žiaden nový výpočet,
// žiadne nové vstupy — len zloženie hotových profilov, kusových komponentov, strešného skla,
// FIX výplní, tesnení a drobného materiálu do jedného zoznamu.
//
// DISPLAY-ONLY: nič do Money nezapisuje, neimportuje Money zápisovú/odpisovú cestu
// (statický guard: tests/pergola-narez-money-safety.test.ts, zoznam CISTY_ENGINE). Iba
// pure transform — vzor `pozicujDiely` (pergola-vyroba.ts) / `komponentyPergoly`.
//
// HONEST-NULL DISCIPLÍNA (Money-priľahlá, rovnaká ako pre profily/komponenty):
//  • POČET: profily majú reálny `pocetKs` (číslo), komponenty honest-null („—") — NIKDY
//    sa počet komponentu nevymýšľa.
//  • DĹŽKA: informatívna; null keď dĺžka rezu ešte nie je známa (čaká na vzorec) alebo
//    komponent → zobrazí sa „—", nikdy hádané číslo. UI odlíši profil čakajúci na dĺžku
//    („— (čaká na výkres)") od komponentu (bez dĺžky, „—").
//  • KÓD: profil = jeho Money kód; komponent = len informatívny CAD kód (kodCad, môže byť
//    null) — NIE potvrdený Money kód. Do odpisu z tohto modulu nič nejde.
//  • ROZMER: pre skupiny kde dĺžka rezu neplatí (sklo, FIX, drobný materiál).
//
// DISJUNKTNÉ od odpadovej logiky (#417): expedícia = HOTOVÉ kusy VON z dielne, nie
// zvyškový materiál z nárezov.

import type { NarezVysledok, PergolaKomponent } from './pergola-narez';
import { pozicujDiely } from './pergola-vyroba';
import type { TesnenieRozmer } from './pergola-tesnenia';
import type { FixVykres } from '$lib/fix';

/** Zoskupenie expedičnej položky. */
export type ExpedicnaSkupina =
	'profil' | 'komponent' | 'stresne-sklo' | 'fix-vypln' | 'tesnenie' | 'drobny-material';

/** Jedna položka expedičného zoznamu — jeden hotový kus/typ, ktorý ide na výdaj. */
export interface ExpedicnaPolozka {
	/** zoskupenie: profil / komponent / strešné sklo / FIX výplň / tesnenie / drobný mat. */
	skupina: ExpedicnaSkupina;
	/** pozičné číslo dielu (previazané s balónikmi vo výkrese); null pri komponentoch a pod. */
	poz: number | null;
	/** Money kód (profil) alebo informatívny CAD kód (komponent, môže byť null) */
	kod: string | null;
	/** názov dielu (plain slovenčina, prevzatý z nárezu/katalógu) */
	nazov: string;
	/** počet kusov na expedíciu: reálny pri profiloch (Money-overený), honest-null pri
	 *  komponentoch (pravidlo počtu komponentov zatiaľ neexistuje), null pri tesneniach
	 *  (merané dĺžkou, nie kusmi) */
	pocetKs: number | null;
	/** informatívna dĺžka rezu [mm]; null pri komponente alebo keď dĺžka čaká na vzorec */
	dlzkaRezuMm: number | null;
	/** rozmer (napr. šírka × dĺžka skla) pre skupiny kde dĺžka neplatí */
	rozmerInfo: string | null;
}

/** Voliteľné vstupy pre rozšírené skupiny expedičného zoznamu (#419 extended scope). */
export interface ExpediciaOpts {
	strechaSklo?: {
		pocetTabul: number | null;
		sirkaMm: number | null;
		dlzkaMm: number | null;
		typ: string | null;
	} | null;
	fix?: {
		zapnuty: boolean;
		zrkadlo: boolean;
		vykres: FixVykres | null;
	} | null;
	tesnenia?: TesnenieRozmer[];
}

/** Výsledok expedičného zoznamu: položky + počítadlá. `spoluKusov` = súčet ZNÁMYCH počtov
 *  kusov (položky s null počtom sa NErátajú — honest, nikdy sa nedopĺňa). */
export interface ExpedicnyZoznam {
	polozky: ExpedicnaPolozka[];
	pocetProfilov: number;
	pocetKomponentov: number;
	pocetSkiel: number;
	pocetFixov: number;
	pocetTesneni: number;
	spoluKusov: number;
	/** skupiny s honest-null položkami (na upozornenie) */
	honestNullSkupiny: string[];
}

/** Slovenský mm formát: desatinná čiarka, bez koncovky (na zoradenie v rozmerInfo). */
const fmtMm = (n: number): string => String(n).replace('.', ',');

/** Zloží expedičný zoznam z už vypočítaných dát nárezu (`spocitajNarez`) a kusových
 *  komponentov (`komponentyPergoly`), s voliteľnými rozšírenými skupinami (strešné sklo,
 *  FIX, tesnenia, drobný materiál). ČISTÁ funkcia — žiaden vstup/perzistencia, žiaden
 *  Money zápis. Profily idú prvé (hotové kusy s reálnymi počtami + pozičné číslo z
 *  `pozicujDiely`, rovnaké ako v Pláne rezov/výkrese), komponenty za nimi (honest-null),
 *  potom strešné sklo, FIX výplne, tesnenia a drobný materiál. */
export function expedicnyZoznam(
	vysledok: NarezVysledok,
	komponenty: PergolaKomponent[],
	opts?: ExpediciaOpts
): ExpedicnyZoznam {
	const honestNullSkupiny: string[] = [];

	// 1. Profily = pozicujDiely (tie isté pozičné čísla ako v Materiáli/výkrese)
	const profily: ExpedicnaPolozka[] = pozicujDiely(vysledok.vypocitane).map((d) => ({
		skupina: 'profil' as const,
		poz: d.cislo,
		kod: d.kod,
		nazov: d.nazov,
		pocetKs: d.pocetKs,
		dlzkaRezuMm: d.dlzkaRezuMm,
		rozmerInfo: null
	}));

	// 2. Komponenty (honest-null počty)
	const komp: ExpedicnaPolozka[] = komponenty.map((k) => ({
		skupina: 'komponent' as const,
		poz: null,
		kod: k.kodCad,
		nazov: k.typ,
		pocetKs: k.pocetKs,
		dlzkaRezuMm: null,
		rozmerInfo: null
	}));
	if (komponenty.some((k) => k.pocetKs == null)) {
		honestNullSkupiny.push('komponenty');
	}

	// 3. Strešné sklo
	const skla: ExpedicnaPolozka[] = [];
	const sk = opts?.strechaSklo;
	if (sk && sk.pocetTabul != null && sk.pocetTabul > 0) {
		const typSuffix = sk.typ ? ' — ' + sk.typ : '';
		const rozmer =
			sk.sirkaMm != null && sk.dlzkaMm != null
				? `${fmtMm(sk.sirkaMm)} × ${fmtMm(sk.dlzkaMm)} mm`
				: '—';
		skla.push({
			skupina: 'stresne-sklo',
			poz: null,
			kod: null,
			nazov: 'Strešné sklo' + typSuffix,
			pocetKs: sk.pocetTabul,
			dlzkaRezuMm: null,
			rozmerInfo: rozmer
		});
	}

	// 4. FIX výplne
	const fixy: ExpedicnaPolozka[] = [];
	const fx = opts?.fix;
	if (fx && fx.zapnuty && fx.vykres) {
		const polia = fx.vykres.polia;
		for (let i = 0; i < polia.length; i++) {
			const pole = polia[i]!;
			const ks = fx.zrkadlo ? 2 : 1;
			const rozmer = `${fmtMm(pole.sirka)} × ${fmtMm(pole.vLavo)}`;
			fixy.push({
				skupina: 'fix-vypln',
				poz: null,
				kod: null,
				nazov: `FIX výplň pole ${i + 1}`,
				pocetKs: ks,
				dlzkaRezuMm: null,
				rozmerInfo: rozmer + (pole.vLavo !== pole.vPravo ? `/${fmtMm(pole.vPravo)} mm` : ' mm')
			});
		}
	}

	// 5. Tesnenia
	const tesn: ExpedicnaPolozka[] = [];
	if (opts?.tesnenia) {
		for (const t of opts.tesnenia) {
			if (t.stav === 'ok' && t.dlzkaMm != null) {
				tesn.push({
					skupina: 'tesnenie',
					poz: null,
					kod: null,
					nazov: t.nazov,
					pocetKs: null,
					dlzkaRezuMm: t.dlzkaMm,
					rozmerInfo: null
				});
			}
		}
		if (opts.tesnenia.some((t) => t.stav !== 'ok')) {
			honestNullSkupiny.push('tesnenia');
		}
	}

	// 6. Drobny material (catch-all)
	const drobny: ExpedicnaPolozka[] = [
		{
			skupina: 'drobny-material',
			poz: null,
			kod: null,
			nazov: 'Spojovací a drobný materiál',
			pocetKs: null,
			dlzkaRezuMm: null,
			rozmerInfo: null
		}
	];
	honestNullSkupiny.push('drobny material');

	const polozky = [...profily, ...komp, ...skla, ...fixy, ...tesn, ...drobny];

	// Sucet ZNAMYCH pocitadiel (null sa neradi — honest)
	const spoluKusov = polozky.reduce((s, p) => s + (p.pocetKs ?? 0), 0);

	return {
		polozky,
		pocetProfilov: profily.length,
		pocetKomponentov: komp.length,
		pocetSkiel: skla.length,
		pocetFixov: fixy.length,
		pocetTesneni: tesn.length,
		spoluKusov,
		honestNullSkupiny
	};
}
