// Tesnenie — výpočet celkovej dĺžky zasklievacieho tesnenia pre STANDARD (#342).
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
// ZASK202541 (4,8×5) zostáva otvorený — neznáma rola profilu.

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
 */
export function klasifikujSkloPreTesnenie(skloNazov: string | undefined): SkloKlasifikacia {
	if (!skloNazov) return 'nezname';
	if (jeIzoSklo(skloNazov)) return 'izolacne';
	// Hrúbka z názvu: "… 4 mm" / "… 6 mm" (STANDARD glass nazvy)
	const m = /(\d+)\s*mm/i.exec(skloNazov);
	if (!m) return 'nezname';
	const hrubka = Number(m[1]!); // regex has 1 mandatory capture group
	if (hrubka === 4) return 'tesnenie4';
	if (hrubka === 6) return 'tesnenie6';
	return 'nezname'; // 10 mm a iné — Dominik neurčil
}

// ---- Výsledok výpočtu tesnenia ----

/** Výsledok výpočtu tesnenia pre STANDARD zasklenie. */
export interface TesnenieResult {
	/** Celková dĺžka tesnenia v mm. */
	dlzkaMm: number;
	/** Celková dĺžka tesnenia v metroch (zaokrúhlené na 1 desatinné miesto). */
	dlzkaM: number;
	/** Systém, pre ktorý bola dĺžka spočítaná. */
	system: string;
	/** Klasifikácia skla pre tesnenie. */
	skloKlasifikacia: SkloKlasifikacia;
	/** Honest-null správa alebo null keď je tesnenie plne určené. */
	honestNull: string | null;
}

/** Polozka do Money odpisu. */
export interface TesneniePolozka {
	kod: string;
	nazov: string;
	qty: number;
	mj: 'm';
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const R3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Vypočíta celkovú dĺžku zasklievacieho tesnenia pre STANDARD zasklenie
 * z už spočítaných materiálových riadkov (computeFlat/computeMulti).
 *
 * Vráti `null` pre systémy, ktoré nemajú tesnenie (Robust, Slide, Deluxe).
 */
export function computeTesnenie(
	material: MaterialRow[],
	system: string,
	skloNazov?: string
): TesnenieResult | null {
	if (!TESNENIE_SYSTEMY.includes(system)) return null;

	const kodKrajovej = kodKrajovejPre(system);
	const kladkovaSum = sumaRezovMm(material, KOD_KLADKOVY);
	const nosSum = sumaRezovMm(material, KOD_NOS);
	const krajovaSum = sumaRezovMm(material, kodKrajovej);

	const dlzkaMm = kladkovaSum + nosSum + krajovaSum;
	const klasifikacia = klasifikujSkloPreTesnenie(skloNazov);

	return {
		dlzkaMm,
		dlzkaM: round1(dlzkaMm / 1000),
		system,
		skloKlasifikacia: klasifikacia,
		honestNull: formatHonestNull(dlzkaMm, klasifikacia)
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
		// pooled nemá jednoznačné sklo — každý posuv môže mať iné
		skloKlasifikacia: 'nezname',
		honestNull: formatHonestNull(dlzkaMm, 'nezname')
	};
}

/**
 * Vráti Money položky tesnenia pre jeden posuv (tesnenie 4/6mm + budúce ZASK202541).
 * Volať PER POSUV — každý posuv má vlastné sklo, teda vlastný tesnenie kód.
 *
 * @returns polozky — ZASK00005 alebo ZASK00006 s dĺžkou v metroch; prázdne pre izolačné
 *   alebo neznáme sklo. warn — honest-null správa pre neznáme/ZASK202541.
 */
export function tesneniePolozky(
	material: MaterialRow[],
	system: string,
	skloNazov: string | undefined
): { polozky: TesneniePolozka[]; warn: string | null } {
	if (!TESNENIE_SYSTEMY.includes(system)) return { polozky: [], warn: null };

	const kodKrajovej = kodKrajovejPre(system);
	const kladkovaSum = sumaRezovMm(material, KOD_KLADKOVY);
	const nosSum = sumaRezovMm(material, KOD_NOS);
	const krajovaSum = sumaRezovMm(material, kodKrajovej);
	const dlzkaMm = kladkovaSum + nosSum + krajovaSum;

	const klasifikacia = klasifikujSkloPreTesnenie(skloNazov);
	const polozky: TesneniePolozka[] = [];
	const warny: string[] = [];

	// Tesnenie riadok — len pre 4mm/6mm, izolačné žiadne (Dominik: "bez gumy")
	if (klasifikacia === 'tesnenie4' || klasifikacia === 'tesnenie6') {
		const { kod, nazov } = TESNENIE_KODY[klasifikacia];
		const metrov = R3(dlzkaMm / 1000);
		if (metrov > 0) {
			polozky.push({ kod, nazov, qty: metrov, mj: 'm' });
		}
	} else if (klasifikacia === 'nezname') {
		warny.push(
			`Tesnenie: ${round1(dlzkaMm / 1000)} m — ` +
				`sklo „${skloNazov ?? '?'}" nie je 4 mm ani 6 mm; ` +
				'tesnenie (ZASK00005/ZASK00006) sa nedá zaradiť do odpisu.'
		);
	}
	// izolačné = žiadne tesnenie, žiadny warn (Dominik potvrdil "bez gumy" = OK)

	// ZASK202541 (kefa 4,8×5) — honest-null, neznáma rola profilu (#342)
	warny.push('Tesniaca kefa ZASK202541 (4,8×5 mm) zatiaľ bez vzorca — doplniť ručne.');

	return {
		polozky,
		warn: warny.length ? warny.join(' ') : null
	};
}

function formatHonestNull(dlzkaMm: number, klasifikacia: SkloKlasifikacia): string | null {
	const parts: string[] = [];

	if (klasifikacia === 'izolacne') {
		// Izolačné = bez tesnenia, len info o dĺžke pre budúce rozšírenie
		parts.push(`Tesnenie: izolačné sklo — bez tesnenia (Dominik: „bez gumy").`);
	} else if (klasifikacia === 'nezname') {
		parts.push(
			`Tesnenie: ${round1(dlzkaMm / 1000)} m — ` +
				'výber 4/6 mm kódu sa nedá určiť pre zvolené sklo.'
		);
	}
	// tesnenie4/tesnenie6 = plne určené, žiadny honest-null pre tesnenie samotné

	// ZASK202541 ostáva otvorený vždy
	parts.push('Tesniaca kefa ZASK202541 (4,8×5 mm) zatiaľ bez vzorca.');

	return parts.length ? parts.join(' ') : null;
}
