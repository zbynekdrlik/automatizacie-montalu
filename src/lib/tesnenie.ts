// Tesnenie — výpočet a Money odpis zasklievacieho tesnenia pre STANDARD (#342).
//
// Vzorec (Dominik, úloha 582, 8.9.2026 05:36, verbatim v UNPARK komentári #342):
//   dĺžka tesnenia = „súčet šírok kladkových profilov" = Σ(ZASP202415 rezy).
//   Kladkový rez JE šírka prírezu krídla (compute-sietka.ts: „Šírka prírezov sa číta
//   z POSUVU, kód ZASP202415"), takže Σ jeho rezov = súčet šírok kladkových profilov.
//   NIE obvod skla, NIE nos/krajová.
//
// §1c KONFLIKT (money-odpis skill), zaznamenaný explicitne: kód kola 1 citoval STARŠIU
// Dominikovu odpoveď (7.9., msg 1806754) ako 3-profilový súčet kladkový+nos+krajová a
// tak to aj VYDAL (0.25.1) — dĺžka bola NADHODNOTENÁ (Money-kritické). Novšia PRIAMA
// odpoveď (8.9. „je to súčet sírok (kladkových profilov)") + owner UNPARK rozsúdenie
// vyhrávajú → kolo 2 opravuje dĺžku na kladkový-only. Kladkový je zdieľaný všetkými
// STANDARD systémami, takže single aj pooled (multi-posuv) vetva sú identické.
//
// Mapovanie (Dominik, 8.9.2026, úloha 582, msg 1807247):
//   4 mm sklo → ZASK00005 (Zasklievacie tesnenie 4 mm)
//   6 mm sklo → ZASK00006 (Zasklievacie tesnenie 6 mm)
//   izolačné sklo → ŽIADNE tesnenie („bez gumy")
//   10 mm / iné → honest-null (Dominik neurčil)
//
// Kefy ZASK00007 (4,8×4) sa počítajú cez komponentový systém (komponenty-cfg.ts) ako
// kladkový × 2 — NEZMENENÉ (Dominik: „kefy ostávajú všade rovnako podľa výpočtu").
// ZASK202541 (4,8×5) zostáva otvorený — KOVANIE_NEUPLNE ho vlastní (nie tento modul).

import type { MaterialRow } from '$lib/server/compute';
import { jeIzoSklo } from '$lib/styl';

// Kladkový profil — dĺžka jeho rezov = „súčet šírok kladkových profilov" (Dominik verbatim).
// Zdieľaný VŠETKÝMI STANDARD systémami (Štandard / Štandard + / Štandard Drevo), takže
// dĺžka tesnenia je systémovo-agnostická. (Nos ZASP00024 a krajová ZASP20244/ZASP00018 sa
// do dĺžky tesnenia UŽ nerátajú — kolo 2 korekcia; kladkový je jediný vstup.)
const KOD_KLADKOVY = 'ZASP202415';

/** Systémy, pre ktoré sa tesnenie počíta. Kladkový profil ZASP202415 je zdieľaný
 *  všetkými troma (Štandard Drevo #445 tiež). */
export const TESNENIE_SYSTEMY: readonly string[] = ['Štandard', 'Štandard +', 'Štandard Drevo'];

/**
 * Suma rezných dĺžok (mm) pre daný kód z material výstupu.
 * Pre každý MaterialRow s daným kódom sčíta `rozmer × ks` zo všetkých rezov.
 */
function sumaRezovMm(material: MaterialRow[], kod: string): number {
	return material
		.filter((m) => m.kod === kod)
		.reduce((sum, m) => sum + m.rezy.reduce((s, r) => s + r.rozmer * r.ks, 0), 0);
}

// ---- Klasifikácia skla pre tesnenie (#342, msg 1807247) ----

/** Klasifikácia skla pre tesnenie.
 *  `tesnenie4` / `tesnenie6` → konkrétny Money kód.
 *  `izolacne` → bez tesnenia (Dominik: „bez gumy").
 *  `nezname` → honest-null (napr. 10 mm — Dominik neurčil). */
export type SkloKlasifikacia = 'tesnenie4' | 'tesnenie6' | 'izolacne' | 'nezname';

/** Tesnenie Money kód + názov pre danú klasifikáciu. */
export const TESNENIE_KODY: Record<'tesnenie4' | 'tesnenie6', { kod: string; nazov: string }> = {
	tesnenie4: { kod: 'ZASK00005', nazov: 'Zasklievacie tesnenie 4 mm' },
	tesnenie6: { kod: 'ZASK00006', nazov: 'Zasklievacie tesnenie 6 mm' }
};

/**
 * Klasifikuj sklo pre výber tesnenia.
 * Dominik (8.9., msg 1807247): 4 mm → ZASK00005, 6 mm → ZASK00006, izolačné → žiadne.
 *
 * `skloTrieda` (#235 slice 2) — pri VLASTNEJ skladbe (`sklo===SKLO_INE`) je katalógový
 * názov len sentinel bez hrúbky, takže klasifikácia sa robí z Patrikovej triedy skladby
 * (AUTORITATÍVNA): 4→ZASK00005, 6→ZASK00006, 10→nezname (Dominik neurčil), 16/24→izolačné
 * (bez gumy). Presne to isté mapovanie ako z názvu katalógového skla, len explicitne.
 * Pre KATALÓGOVÉ sklo (`skloTrieda == null`) ostáva pôvodná name-based detekcia — testy
 * a Money vektory bit-identické.
 *
 * Detekcia (katalóg): izolačné cez existujúci `jeIzoSklo` (regex), hrúbka z názvu skla
 * (STANDARD_GLASS mená: "Float sklo 4 mm", "Float sklo 6 mm", "Float sklo 10 mm").
 * Lookbehind `(?<![\d.,])` zamedzí falošnému matchu na desatinné názvy ("6,4 mm" → 🟡5).
 * glass_types je admin-editable, takže budúci laminovaný názov nesmie misroutovať.
 */
export function klasifikujSkloPreTesnenie(
	skloNazov: string | undefined,
	skloTrieda?: number | null
): SkloKlasifikacia {
	// Vlastná skladba: trieda je autoritatívna (názov je len sentinel bez hrúbky)
	if (skloTrieda != null) {
		if (skloTrieda === 4) return 'tesnenie4';
		if (skloTrieda === 6) return 'tesnenie6';
		if (skloTrieda >= 16) return 'izolacne'; // izolačné dvojsklo → bez gumy
		return 'nezname'; // 10 mm — Dominik neurčil
	}
	if (!skloNazov) return 'nezname';
	if (jeIzoSklo(skloNazov)) return 'izolacne';
	// Hrúbka z názvu: "… 4 mm" / "… 6 mm" (STANDARD glass nazvy)
	// Lookbehind: "6,4 mm" nesmie matchnúť ako 4 mm (desatinné číslo)
	const m = /(?<![\d.,])(\d+)\s*mm\b/i.exec(skloNazov);
	if (!m) return 'nezname';
	const hrubka = Number(m[1]!); // regex has 1 mandatory capture group
	if (hrubka === 4) return 'tesnenie4';
	if (hrubka === 6) return 'tesnenie6';
	return 'nezname'; // 10 mm a iné — Dominik neurčil
}

// ---- Polozky do Money odpisu ----

/** Polozka do Money odpisu. */
export interface TesneniePolozka {
	kod: string;
	nazov: string;
	qty: number;
	mj: 'm';
}

const R3 = (x: number) => Math.round(x * 1000) / 1000;
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Dĺžka tesnenia (mm) = „súčet šírok kladkových profilov" (Dominik verbatim, úloha 582,
 * 8.9.2026) = Σ rezných dĺžok kladkového profilu ZASP202415. NIE obvod skla, NIE nos/
 * krajová. Kladkový je zdieľaný všetkými STANDARD systémami, takže single aj pooled
 * (multi-posuv) vetva používajú TEN ISTÝ výpočet — nič systémovo-špecifické.
 */
function dlzkaTesneniaMm(material: MaterialRow[]): number {
	return sumaRezovMm(material, KOD_KLADKOVY);
}

/**
 * Money položky tesnenia pre JEDEN posuv.
 *
 * @returns polozky — ZASK00005 alebo ZASK00006 s dĺžkou v metroch; prázdne pre
 *   izolačné alebo neznáme sklo. warn — honest-null správa pre neznáme sklo.
 *   Kefa ZASK202541 sa tu NEHLÁSI — vlastní ho `KOVANIE_NEUPLNE` (jedno miesto).
 */
export function tesneniePolozky(
	material: MaterialRow[],
	system: string,
	skloNazov: string | undefined,
	skloTrieda?: number | null
): { polozky: TesneniePolozka[]; warn: string | null } {
	if (!TESNENIE_SYSTEMY.includes(system)) return { polozky: [], warn: null };

	const dlzkaMm = dlzkaTesneniaMm(material);
	return buildPolozky(dlzkaMm, skloNazov, skloTrieda);
}

/**
 * Money položky tesnenia pre POOLOVANÝ materiál naprieč viacerými STANDARD systémami.
 * Dĺžka = Σ kladkového (ZASP202415), ktorý je zdieľaný naprieč posuvmi — pooluje sa
 * prirodzene, žiadny systémovo-špecifický kód netreba (zmiešaná Štandard + Štandard +
 * zákazka je bezpečná: kladkový je v materiáli spoločný).
 */
export function tesneniePolozkyPooled(
	material: MaterialRow[],
	systems: string[],
	skloNazov: string | undefined,
	skloTrieda?: number | null
): { polozky: TesneniePolozka[]; warn: string | null } {
	const hasStd = systems.some((s) => TESNENIE_SYSTEMY.includes(s));
	if (!hasStd) return { polozky: [], warn: null };

	const dlzkaMm = dlzkaTesneniaMm(material);
	return buildPolozky(dlzkaMm, skloNazov, skloTrieda);
}

/** Spoločné jadro — z dĺžky + skla (alebo vlastnej triedy) vyrobí polozky a warn. */
function buildPolozky(
	dlzkaMm: number,
	skloNazov: string | undefined,
	skloTrieda?: number | null
): { polozky: TesneniePolozka[]; warn: string | null } {
	const klasifikacia = klasifikujSkloPreTesnenie(skloNazov, skloTrieda);
	const polozky: TesneniePolozka[] = [];
	let warn: string | null = null;

	if (klasifikacia === 'tesnenie4' || klasifikacia === 'tesnenie6') {
		const { kod, nazov } = TESNENIE_KODY[klasifikacia];
		const metrov = R3(dlzkaMm / 1000);
		if (metrov > 0) {
			polozky.push({ kod, nazov, qty: metrov, mj: 'm' });
		} else {
			// Nulová dĺžka pri STANDARD posuve = konfiguračná anomália
			warn =
				`Tesnenie: dĺžka je 0 m pri ${klasifikacia === 'tesnenie4' ? '4' : '6'} mm skle — ` +
				'konfiguračná anomália (kladkový profil ZASP202415 nemá rezy).';
		}
	} else if (klasifikacia === 'nezname') {
		warn =
			`Tesnenie: ${round1(dlzkaMm / 1000)} m — ` +
			`sklo „${skloNazov ?? '?'}“ nie je 4 mm ani 6 mm; ` +
			'tesnenie (ZASK00005/ZASK00006) sa nedá zaradiť do odpisu.';
	}
	// izolačné = žiadne tesnenie, žiadny warn (Dominik potvrdil "bez gumy" = OK)

	return { polozky, warn };
}
