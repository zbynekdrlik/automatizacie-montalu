// #573 (meeting výroba 25.9.2026, ROZHODNUTÉ 27.9. na tickete): ktoré sklá smie nárezák
// zasklení per SYSTÉM ponúknuť. JEDINÝ zdroj pravdy — klient ním filtruje ponuku „Sklo
// (základ)" (single aj multi posuv), server (`parseVstup`/`parseMultiVstup`, `znova`) ním
// odmieta nový vstup mimo zoznamu.
//
// ZÁMERNE je to allow-list NAD výpočtovým katalógom `glass_types`, NIE zmena katalógu:
// katalóg ostáva nedotknutý (Money-neutrálne, `money_kod` bez zmeny) a uložené staré odpisy
// so sklom, ktoré už ponuka nemá (napr. Robust 3.3.1), sa dajú ďalej PREPOČÍTAŤ — `skloPre`
// (rekomputa backfill/kiosk) tento zoznam neaplikuje (lekcia #570: zmazané sklo = 0 riadkov
// nárezáku na kiosku).
//
// Systém BEZ záznamu = bez obmedzenia (celý katalóg systému, ako doteraz): starý Štandard
// („bez zmeny" v tabuľke), Drevostavby, Slide. Kľúč = cfg systém (`Štandard +` = Štandard plus).
// Zmena zoznamu (napr. keď Patrik pošle presný zoznam) = úprava LEN tu; názvy musia byť riadky
// katalógu systému (stráži `tests/sklo-povolene.test.ts`).
import { SKLO_INE, SKLO_TRIEDY, defaultSklo, type SkloTrieda } from './sklo';

interface PovoleneSkla {
	/** povolené katalógové sklá (`glass_types.nazov` v katalógu systému) */
	readonly nazvy: readonly string[];
	/** povolené hrúbkové triedy vlastnej skladby („Iné (vlastná skladba)", `SKLO_INE`) —
	 *  inak by „Iné" allow-list obišlo */
	readonly triedyIne: readonly SkloTrieda[];
	/** predvolené sklo ponuky, keď ho všeobecné pravidlo `defaultSklo` (prvé v poradí katalógu)
	 *  nedá — napr. povolená výnimka stojí v katalógu PRED bežným sklom */
	readonly predvolene?: string;
}

export const POVOLENE_SKLA: Readonly<Record<string, PovoleneSkla>> = {
	// 6 mm a 10 mm; predvolené 10 mm rieši `defaultSklo` (#431)
	Deluxe: {
		nazvy: ['Float kalené 6 mm', 'Float kalené 10 mm'],
		triedyIne: [6, 10]
	},
	// LEN skladby 24 mm (4/16/4) číre a mliečne — žiadne 3.3.1/3.3.2/4/6/10 mm ani 4/8/4
	Robust: {
		nazvy: ['Izolačné sklo 4/16/4 číre', 'Izolačné sklo 4/16/4 mliečne'],
		triedyIne: [24]
	},
	// Štandard plus: izolačné (trieda 16 — 4/8/4 aj 4/16/4), 6 mm, 3.3.1 (ako 6 mm, #214) a 4 mm
	// Float aj kalené (#579: Patrik, Odoo úloha 1193, 28.9. „pri štandardoch tam môže byť aj 4mm
	// sklo" — novšie vyjadrenie výroby ruší celé vylúčenie 4 mm scr_017 z meetingu 25.9.; kalené 4 mm
	// aj preto, aby sa Odoo tvrdené 4 mm počítalo ako tvrdené, nie ako Float); NIE 10 mm (#504).
	// 4 mm je VÝNIMKA na výber — predvolené ostáva 6 mm (katalóg má Float 4 mm pred 6).
	'Štandard +': {
		nazvy: [
			'Float sklo 4 mm',
			'ESG kalené 4 mm',
			'Float sklo 6 mm',
			'ESG kalené 6 mm',
			'3.3.1',
			'3.3.1 mliečne',
			'Izolačné sklo 4/8/4 číre',
			'Izolačné sklo 4/8/4 mliečne',
			'Izolačné sklo 4/8/4 stopsol',
			'Izolačné sklo 4/16/4 číre',
			'Izolačné sklo 4/16/4 mliečne',
			'Izolačné sklo 4/16/4 stopsol'
		],
		triedyIne: [4, 6, 16, 24],
		predvolene: 'Float sklo 6 mm'
	}
};

/** Predvolené sklo ponuky systému: explicitná predvoľba z `POVOLENE_SKLA` (keď ju ponuka má),
 *  inak všeobecné `defaultSklo`. Klient ho volá pri každom resete výberu skla. */
export function predvoleneSklo(skla: string[], system: string): string {
	const p = POVOLENE_SKLA[system]?.predvolene;
	return p && skla.includes(p) ? p : defaultSklo(skla, system);
}

// ---- #579: Odoo typy skla (`montalu.glass.type`) v ponuke nárezáku podľa HRÚBKY ----
//
// Owner 28.9.: „ak robust používa 24 mm, má mu ponúknuť všetky sklá s tou hrúbkou". Hrúbka je
// SPOJKA medzi Odoo a výpočtom: Odoo typ s `total_thickness_mm` = `mm` (a druhom `druh`) sa ponúkne
// a počíta sa ako reprezentatívne LOKÁLNE výpočtové sklo (vzorce/profily/Money nezmenené — výpočet
// pozná len triedy 6/16 + Deluxe hrúbku 6/10). Nové sklo pridané v Odoo sa objaví bez releasu.
//
// #579 časť 2 (Odoo úloha 1180 po stretnutí 28.9.: „Povolené hrúbky pri systéme si nastaví
// výroba"): povolené hrúbky ŽIJÚ v SQLite `cfg_sklo_hrubka` (server `sklo-hrubky.ts`, editor
// `/zasklenia/nastavenia` s auditom). `ODOO_HRUBKY_SEED` je LEN seed migrácie v52 (= tabuľka pred
// časťou 2). Výroba zadáva systém × hrúbku × druh; výpočtové sklo sa NIKDY nezadáva — odvodí ho
// `vypocetneSkloPre` z lokálnej ponuky systému (kombinácia bez výpočtového skla = neplatná).

/** Druh Odoo skla v triede: izolačné (Odoo `category=izolacne`), jednoduché (jednosklo — kalené,
 *  lepené aj rezané) alebo LEN kalené (`category=esg`, Deluxe). */
export type OdooDruh = 'izolacne' | 'jednoduche' | 'esg';

/** Všetky druhy v poradí pre editor (CHECK v `cfg_sklo_hrubka` = presne tieto). */
export const ODOO_DRUHY: readonly OdooDruh[] = ['izolacne', 'jednoduche', 'esg'];

/** Popis druhu pre človeka (editor, audit). */
export const ODOO_DRUH_POPIS: Readonly<Record<OdooDruh, string>> = {
	izolacne: 'izolačné',
	jednoduche: 'jednoduché',
	esg: 'len kalené'
};

export function jeOdooDruh(v: string): v is OdooDruh {
	return (ODOO_DRUHY as readonly string[]).includes(v);
}

/** Povolená hrúbka Odoo skla v systéme (riadok `cfg_sklo_hrubka` bez id/systému). */
export interface OdooHrubka {
	/** Odoo `total_thickness_mm` */
	readonly mm: number;
	readonly druh: OdooDruh;
}

// Štandard plus, starý Štandard, Drevostavby: vzorec rovnaký (IZO nárezák podľa triedy 16)
const JEDNODUCHE_6: OdooHrubka = { mm: 6, druh: 'jednoduche' };
const IZOLACNE_16: OdooHrubka = { mm: 16, druh: 'izolacne' };
// Drevostavby bez zmeny: 6 jednoduché, 16 aj 24 izolačné
const DREVOSTAVBY: readonly OdooHrubka[] = [
	JEDNODUCHE_6,
	IZOLACNE_16,
	{ mm: 24, druh: 'izolacne' }
];
// Štandard + a starý Štandard = 4, 6, 16 mm (Patrik, Odoo úloha 1218, msg 1872179, 29.9.:
// „Štandardy — 4, 6, 16 mm"; výroba 24 mm izolačné odobrala v PROD editore — cfg_audit 76/77,
// existujúcej DB ho zmaže v56 `migracie-sklo-hrubky-24mm.ts`). 4 mm jednoduché (#579, 28.9.) na
// KONCI — rovnaké poradie ako na PROD po migrácii v54.
const STANDARDY: readonly OdooHrubka[] = [JEDNODUCHE_6, IZOLACNE_16, { mm: 4, druh: 'jednoduche' }];

/** Seed migrácie v52 (`cfg_sklo_hrubka`) — tabuľka z designu #579 (doplnenie 28.9.) + 4 mm pre
 *  Štandardy (29.9.; existujúcej DB ich doplní v54 `migracie-sklo-hrubky-4mm.ts`) − 24 mm
 *  izolačné pri Štandardoch (úloha 1218, 29.9.; existujúcej DB ho zmaže v56). Živé hodnoty
 *  číta server z DB (`skloHrubkyPre`), NIKDY z tejto konštanty. */
export const ODOO_HRUBKY_SEED: Readonly<Record<string, readonly OdooHrubka[]>> = {
	// izolačné 4/16/4 (24 mm); vzorec od skla nezávisí
	Robust: [{ mm: 24, druh: 'izolacne' }],
	// trieda 16 (izolačné) aj 6 („Redukcia 6mm" pri triede 6)
	Slide: [
		{ mm: 16, druh: 'izolacne' },
		{ mm: 6, druh: 'jednoduche' }
	],
	// len kalené 6 / 10 mm (`skloHrubka` vyberá kladkový/klzný profil)
	Deluxe: [
		{ mm: 6, druh: 'esg' },
		{ mm: 10, druh: 'esg' }
	],
	'Štandard +': STANDARDY,
	Štandard: STANDARDY,
	'Štandard Drevo': DREVOSTAVBY
};

// Izolačné lokálne výpočtové sklo: „Izolačné sklo A/B/C číre" (len ČÍRE — mliečne/stopsol nikdy
// nie je reprezentatívne); fyzická hrúbka = A + B + C.
const IZO_CIRE = /^Izolačné sklo (\d+)\/(\d+)\/(\d+) číre$/;

/**
 * Reprezentatívne LOKÁLNE výpočtové sklo pre Odoo sklo hrúbky `mm` a druhu `druh` v systéme s
 * lokálnou povolenou ponukou `lokalne` (`ponukaSkielSystemu`). Pravidlo = číre sklo rovnakej
 * fyzickej hrúbky, ktoré si obsluha vie zvoliť aj lokálne (výpočet/Money teda identické s lokálnym
 * výberom):
 *   • izolačné → „Izolačné sklo A/B/C číre" s A+B+C = mm (16 → 4/8/4, 24 → 4/16/4);
 *   • jednoduché → „Float sklo N mm", inak „Nmm číre" (Slide);
 *   • len kalené → „Float kalené N mm" (Deluxe), inak „ESG kalené N mm".
 * Žiadny kandidát v ponuke systému → `null` = kombinácia NEPLATÍ (editor ju odmietne, ponuka ju
 * vynechá). ČISTÁ.
 */
export function vypocetneSkloPre(
	mm: number,
	druh: OdooDruh,
	lokalne: readonly string[]
): string | null {
	if (druh === 'izolacne') {
		for (const n of lokalne) {
			const m = IZO_CIRE.exec(n);
			if (m && Number(m[1]) + Number(m[2]) + Number(m[3]) === mm) return n;
		}
		return null;
	}
	const kandidati =
		druh === 'esg'
			? [`Float kalené ${mm} mm`, `ESG kalené ${mm} mm`]
			: [`Float sklo ${mm} mm`, `${mm}mm číre`];
	return kandidati.find((k) => lokalne.includes(k)) ?? null;
}

/** Patrí Odoo typ (`category`) do druhu triedy? */
export function odooDruhSedi(druh: OdooDruh, category: string): boolean {
	const c = category.trim().toLowerCase();
	if (druh === 'izolacne') return c === 'izolacne';
	if (druh === 'esg') return c === 'esg';
	return c !== '' && c !== 'izolacne';
}

/** Povolené hrúbkové triedy vlastnej skladby pre systém (bez záznamu = všetky). */
export function povoleneTriedyIne(system: string): readonly number[] {
	return POVOLENE_SKLA[system]?.triedyIne ?? SKLO_TRIEDY;
}

/** Smie nárezák pre `system` ponúknuť/prijať sklo `sklo`? Pri vlastnej skladbe (`SKLO_INE`)
 *  rozhoduje hrúbková trieda; chýbajúca trieda sa tu NEodmieta (tú hlási vlastná validácia
 *  „vyber hrúbkovú triedu"). */
export function skloPovolene(system: string, sklo: string, skloTrieda?: number | null): boolean {
	const p = POVOLENE_SKLA[system];
	if (!p) return true;
	if (sklo === SKLO_INE)
		return skloTrieda == null || (p.triedyIne as readonly number[]).includes(skloTrieda);
	return p.nazvy.includes(sklo);
}

/** Katalógové sklá systému zúžené na allow-list (poradie katalógu zachované). */
export function filtrujPovoleneSkla(system: string, skla: string[]): string[] {
	return skla.filter((g) => skloPovolene(system, g));
}

/** Ponuka katalógových skiel pre systém z riadkov katalógu (`data.skla` na klientovi) — klientsky
 *  ZRKADLOVÝ výber serverového `glassTypesForSystem` (Deluxe + Štandardy LEN vlastné sklá, starý
 *  Štandard a Drevostavby čítajú riadky `'Štandard +'`; Robust/Slide vlastné + spoločné `'ALL'`)
 *  zúžený allow-listom. Paritu so serverom stráži `tests/sklo-povolene.test.ts`. */
export function ponukaSkielSystemu(
	system: string,
	skla: readonly { nazov: string; system: string }[]
): string[] {
	const zdielany = system === 'Štandard' || system === 'Štandard Drevo';
	const kat = zdielany ? 'Štandard +' : system;
	const lenVlastne = kat === 'Deluxe' || kat === 'Štandard +';
	return filtrujPovoleneSkla(
		system,
		skla.filter((g) => g.system === kat || (!lenVlastne && g.system === 'ALL')).map((g) => g.nazov)
	);
}
