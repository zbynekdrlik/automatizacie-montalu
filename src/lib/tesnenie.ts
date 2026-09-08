// Tesnenie — výpočet a Money odpis zasklievacieho tesnenia pre STANDARD (#342).
//
// Vzorec (Dominik, 7.9.2026, úloha 582, msg 1806754):
//   dĺžka tesnenia = Σ(ZASP202415 rezy) + Σ(ZASP00024 rezy) + Σ(ZASP20244 rezy)
//   (pri RS STANDARD PLUS; pri klasickom Štandarde namiesto ZASP20244 → ZASP00018)
//
// Výsledok = celkový počet mm rezov troch profilov: kladkový + nos/stredový + krajová.
// Tieto profily sú UŽ spočítané v compute engine (computeFlat/computeMulti) —
// tesnenie je len SUM ich rezných dĺžok, žiadna nová geometria.
//
// Mapovanie (Dominik, 8.9.2026, úloha 582, msg 1807247):
//   4 mm sklo → ZASK00005 (Zasklievacie tesnenie 4 mm)
//   6 mm sklo → ZASK00006 (Zasklievacie tesnenie 6 mm)
//   izolačné sklo → ŽIADNE tesnenie („bez gumy")
//   10 mm / iné → honest-null (Dominik neurčil)
//
// Kefy ZASK00007 (4,8×4) sa počítajú cez komponentový systém (komponenty-cfg.ts).
// ZASK202541 (4,8×5) zostáva otvorený — KOVANIE_NEUPLNE ho vlastní (nie tento modul).

import type { MaterialRow } from '$lib/server/compute';
import { jeIzoSklo } from '$lib/styl';

// Profilové kódy, ktorých rezné dĺžky tvoria dĺžku tesnenia.
// Kladkový profil — zdieľaný medzi Štandard a Štandard +.
const KOD_KLADKOVY = 'ZASP202415';
// Nos / rámový stredový — zdieľaný medzi Štandard a Štandard +.
const KOD_NOS = 'ZASP00024';
// Krajová (koncový) — líši sa podľa systému:
//   Štandard + (PLUS): ZASP20244
//   Štandard (klasik): ZASP00018
const KOD_KRAJOVA_PLUS = 'ZASP20244';
const KOD_KRAJOVA_KLASIK = 'ZASP00018';

/** Systémy, pre ktoré sa tesnenie počíta. Štandard Drevo (#445) zdieľa rovnaký
 *  profilový trojuholník (ZASP202415/ZASP00024/ZASP00018) ako klasický Štandard. */
export const TESNENIE_SYSTEMY: readonly string[] = ['Štandard', 'Štandard +', 'Štandard Drevo'];

/** Vráti kód krajovej podľa systému (PLUS vs klasik). */
function kodKrajovejPre(system: string): string {
	return system === 'Štandard +' ? KOD_KRAJOVA_PLUS : KOD_KRAJOVA_KLASIK;
}

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
 * Detekcia: izolačné cez existujúci `jeIzoSklo` (regex), hrúbka z názvu skla
 * (STANDARD_GLASS mená: "Float sklo 4 mm", "Float sklo 6 mm", "Float sklo 10 mm").
 * Lookbehind `(?<![\d.,])` zamedzí falošnému matchu na desatinné názvy ("6,4 mm" → 🟡5).
 * glass_types je admin-editable, takže budúci laminovaný názov nesmie misroutovať.
 */
export function klasifikujSkloPreTesnenie(skloNazov: string | undefined): SkloKlasifikacia {
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
 * Celková dĺžka tesnenia (mm) z materiálu pre JEDEN systém.
 * Sčíta rezy kladkového + nosového + krajovej (podľa systému).
 */
function dlzkaTesneniaMm(material: MaterialRow[], system: string): number {
	const kodKrajovej = kodKrajovejPre(system);
	return (
		sumaRezovMm(material, KOD_KLADKOVY) +
		sumaRezovMm(material, KOD_NOS) +
		sumaRezovMm(material, kodKrajovej)
	);
}

/**
 * Celková dĺžka tesnenia (mm) z POOLOVANÉHO materiálu naprieč VIACERÝMI STANDARD
 * systémami. Bezpečné pre zmiešanú zákazku (Štandard + Štandard +): sčíta OBE
 * krajové kódy, lebo ZASP202415/ZASP00024 sú zdieľané a len JEDEN z ZASP20244/
 * ZASP00018 existuje per systém v materiáli.
 */
function dlzkaTesneniePooledMm(material: MaterialRow[]): number {
	return (
		sumaRezovMm(material, KOD_KLADKOVY) +
		sumaRezovMm(material, KOD_NOS) +
		sumaRezovMm(material, KOD_KRAJOVA_PLUS) +
		sumaRezovMm(material, KOD_KRAJOVA_KLASIK)
	);
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
	skloNazov: string | undefined
): { polozky: TesneniePolozka[]; warn: string | null } {
	if (!TESNENIE_SYSTEMY.includes(system)) return { polozky: [], warn: null };

	const dlzkaMm = dlzkaTesneniaMm(material, system);
	return buildPolozky(dlzkaMm, skloNazov);
}

/**
 * Money položky tesnenia pre POOLOVANÝ materiál naprieč viacerými STANDARD systémami.
 * Bezpečné pre zmiešanú zákazku (Štandard + Štandard +): sčíta OBE krajové kódy.
 */
export function tesneniePolozkyPooled(
	material: MaterialRow[],
	systems: string[],
	skloNazov: string | undefined
): { polozky: TesneniePolozka[]; warn: string | null } {
	const hasStd = systems.some((s) => TESNENIE_SYSTEMY.includes(s));
	if (!hasStd) return { polozky: [], warn: null };

	const dlzkaMm = dlzkaTesneniePooledMm(material);
	return buildPolozky(dlzkaMm, skloNazov);
}

/** Spoločné jadro — z dĺžky + skla vyrobí polozky a warn. */
function buildPolozky(
	dlzkaMm: number,
	skloNazov: string | undefined
): { polozky: TesneniePolozka[]; warn: string | null } {
	const klasifikacia = klasifikujSkloPreTesnenie(skloNazov);
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
				'konfiguračná anomália (profily ZASP202415/ZASP00024/krajová nemajú rezy).';
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
