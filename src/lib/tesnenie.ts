// Tesnenie — výpočet celkovej dĺžky zasklievacieho tesnenia pre STANDARD (#342).
// Display-only, Money-NEUTRÁLNE (žiadny odpis, žiadny zápis do Money).
//
// Vzorec (Dominik, 7.9.2026, úloha 582, msg 1806754):
//   dĺžka tesnenia = Σ(ZASP202415 rezy) + Σ(ZASP00024 rezy) + Σ(ZASP20244 rezy)
//   (pri RS STANDARD PLUS; pri klasickom Štandarde namiesto ZASP20244 → ZASP00018)
//
// Výsledok = celkový počet mm rezov troch profilov: kladkový + nos/stredový + krajová.
// Tieto profily sú UŽ spočítané v compute engine (computeFlat/computeMulti) —
// tesnenie je len SUM ich rezných dĺžok, žiadna nová geometria.
//
// Honest-null: ktoré tesnenie (4mm ZASK00005 vs 6mm ZASK00006) patrí ku ktorému sklu
// ešte Dominik neurčil — preto sa zobrazuje len DĹŽKA, nie Money kód ani odpis.
// Kefy (ZASK00007/ZASK202541) zostávajú úplne otvorené (call pending).

import type { MaterialRow } from '$lib/server/compute';

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

/** Systémy, pre ktoré sa tesnenie počíta. */
export const TESNENIE_SYSTEMY: readonly string[] = ['Štandard', 'Štandard +'];

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

/** Výsledok výpočtu tesnenia pre STANDARD zasklenie. */
export interface TesnenieResult {
	/** Celková dĺžka tesnenia v mm. */
	dlzkaMm: number;
	/** Celková dĺžka tesnenia v metroch (zaokrúhlené na 1 desatinné miesto). */
	dlzkaM: number;
	/** Systém, pre ktorý bola dĺžka spočítaná. */
	system: string;
	/** Honest-null správa o chýbajúcom určení 4/6 mm. */
	honestNull: string;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Vypočíta celkovú dĺžku zasklievacieho tesnenia pre STANDARD zasklenie
 * z už spočítaných materiálových riadkov (computeFlat/computeMulti).
 *
 * Vráti `null` pre systémy, ktoré nemajú tesnenie (Robust, Slide, Deluxe).
 */
export function computeTesnenie(material: MaterialRow[], system: string): TesnenieResult | null {
	if (!TESNENIE_SYSTEMY.includes(system)) return null;

	const kodKrajovej = kodKrajovejPre(system);
	const kladkovaSum = sumaRezovMm(material, KOD_KLADKOVY);
	const nosSum = sumaRezovMm(material, KOD_NOS);
	const krajovaSum = sumaRezovMm(material, kodKrajovej);

	const dlzkaMm = kladkovaSum + nosSum + krajovaSum;

	return {
		dlzkaMm,
		dlzkaM: round1(dlzkaMm / 1000),
		system,
		honestNull: formatHonestNull(dlzkaMm)
	};
}

/**
 * Spočíta tesnenie z POOLOVANÉHO materiálu (computeMulti). Bezpečné aj pre
 * zmiešanú zákazku (Štandard + Štandard +): ZASP202415/ZASP00024 sú zdieľané
 * a len JEDEN z ZASP20244/ZASP00018 existuje per systém, takže súčet oboch
 * krajových kódov dá správny výsledok bez toho, aby sme potrebovali per-posuv
 * material (na rozdiel od kovanie, kde sú per-posuv počty krídel).
 */
export function computeTesneniePooled(
	material: MaterialRow[],
	systems: string[]
): TesnenieResult | null {
	const stdSystem = systems.find((s) => TESNENIE_SYSTEMY.includes(s));
	if (!stdSystem) return null;

	const kladkovaSum = sumaRezovMm(material, KOD_KLADKOVY);
	const nosSum = sumaRezovMm(material, KOD_NOS);
	// Obe krajové kódy — len jeden bude mať nenulový súčet per systém,
	// ale ak zákazka mieša Štandard + Štandard+ (oba STANDARD), sčítame oba.
	const krajovaSum =
		sumaRezovMm(material, KOD_KRAJOVA_PLUS) + sumaRezovMm(material, KOD_KRAJOVA_KLASIK);

	const dlzkaMm = kladkovaSum + nosSum + krajovaSum;

	return {
		dlzkaMm,
		dlzkaM: round1(dlzkaMm / 1000),
		system: stdSystem,
		honestNull: formatHonestNull(dlzkaMm)
	};
}

function formatHonestNull(dlzkaMm: number): string {
	return (
		`Tesnenie: ${round1(dlzkaMm / 1000)} m — ` +
		'čaká na spresnenie (4 mm ZASK00005 alebo 6 mm ZASK00006 podľa skla). ' +
		'Tesniace kefy (ZASK00007/ZASK202541) zatiaľ bez vzorca.'
	);
}
