// Jednotný verejný konfigurátor (#384) — client-safe katalóg produktových radov + produkt
// diskriminátor pre dopyt/PDF/Odoo pipeline. PURE modul: ŽIADNY server import (ani `server/db`
// ani Money/cena), takže ho smie importovať klientsky bundle (výberová obrazovka `KonfVyber`
// aj formuláre). Nesie LEN prezentačné texty + fotky z montalu.sk (žiadny Money kód, žiadna
// cena) → leak-guard (A) `konfigurator-money-safety` ho prejde bez porušenia.
//
// Rám (PR 1/7) zavádza JEDINÉ pergolové rameno; produktové PR-y (#385–#390) menia `stav` karty
// na `live` a pridajú svoju podstránku `/konfigurator/<slug>`.

/** Slug produktu = kód v pipeline aj v URL podstránky `/konfigurator/<kod>`. */
export type KonfProduktKod =
	'pergola' | 'bazen' | 'zimna-zahrada' | 'zasklenie' | 'oplotenie' | 'tienenie' | 'pristresok';

/** Karta produktu na výberovej obrazovke. `live` = má vlastný konfigurátor (interná podstránka);
 *  `pripravujeme` = fotka + badge + odkaz na produktovú stránku montalu.sk (žiadny mŕtvy klik). */
export interface KonfProdukt {
	kod: KonfProduktKod;
	/** názov v nominatíve — karta + prefix názvu Odoo leadu („Pergola – dopyt: …") */
	nazov: string;
	/** nadpis PDF špecifikácie („Špecifikácia pergoly") — produkt-aware titul ponuky */
	pdfNadpis: string;
	/** 1 veta pod názvom na karte */
	popis: string;
	/** názov webp súboru v `static/konfigurator/vyber/` (bez cesty; stiahnuté cwebp z montalu.sk) */
	foto: string;
	/** alt text obrázka */
	alt: string;
	stav: 'live' | 'pripravujeme';
	/** kam vedie CTA karty: `live` → interná podstránka; `pripravujeme` → montalu.sk produktová stránka */
	odkaz: string;
	/** `true` keď `odkaz` smeruje na montalu.sk (otvor v novej karte) */
	externy: boolean;
	/** #385: má produkt OVERENÝ interim cenový zdroj (matica montalu.sk)? Iba pergola (#279) — ostatné
	 *  rady zatiaľ NEMAJÚ cenník → honest-null (verejný konfigurátor bez orientačnej ceny, dopyt bez
	 *  ceny). Produkt bez zdroja NESMIE dostať opečiatkovanú/prepočítanú cenu (inak by mu pipeline
	 *  priradila nesprávnu PERGOLOVÚ cenu z rozmerov). Nový produkt to prepne na `true`, keď doňho
	 *  pribudne overený cenník. Server-side gate: `maCenovyZdroj` (nižšie). */
	cenovyZdroj: boolean;
}

/** Katalóg produktových radov (parita so 6 kategóriami web-konfigurátora montalu.sk + prístrešky).
 *  Pergola prvá a `live`; ostatné `pripravujeme` sa prepnú na `live` per produktový PR (#385–#390).
 *  Fotky sú lokálne webp (žiadny hotlink); montalu.sk odkazy sú finálne 200 URL (bez www redirectu). */
export const KONF_PRODUKTY: KonfProdukt[] = [
	{
		kod: 'pergola',
		nazov: 'Pergola',
		pdfNadpis: 'Špecifikácia pergoly',
		popis: 'Hliníkové a bioklimatické pergoly na mieru — na stenu aj samonosné.',
		foto: 'pergola.webp',
		alt: 'Bioklimatická pergola Montalu pri bazéne',
		stav: 'live',
		odkaz: '/konfigurator/pergola',
		externy: false,
		cenovyZdroj: true
	},
	{
		kod: 'bazen',
		nazov: 'Bazénové zastrešenie',
		pdfNadpis: 'Špecifikácia bazénového zastrešenia',
		popis: 'Jedno- a dvojkoľajové zastrešenia bazénov aj vírivky.',
		foto: 'bazen.webp',
		alt: 'Bazénové zastrešenie Montalu Premier',
		stav: 'live',
		odkaz: '/konfigurator/bazen',
		externy: false,
		// #404: bazén MÁ vyťažený interim cenový zdroj (matica montalu.sk `update-pools` v
		// `cennik-bazen.json`, server modul `konfigurator-bazen-cena.ts`) → orientačná cena je
		// odblokovaná (gate `maCenovyZdroj` → dopyt/PDF/`vypocet` akcia dostanú bazénovú cenu).
		cenovyZdroj: true
	},
	{
		kod: 'zimna-zahrada',
		nazov: 'Zimná záhrada',
		pdfNadpis: 'Špecifikácia zimnej záhrady',
		popis: 'Hliníkové zimné záhrady ROBUST a MASSIVE s presklením na mieru.',
		foto: 'zimna-zahrada.webp',
		alt: 'Hliníková zimná záhrada Montalu Robust',
		stav: 'live',
		odkaz: '/konfigurator/zimna-zahrada',
		externy: false,
		// #408: zimná záhrada MÁ vyťažený interim cenový zdroj (matica montalu.sk `update-winter-gardens`
		// v `cennik-zimna-zahrada.json`, server modul `konfigurator-zimna-zahrada-cena.ts`) → orientačná
		// cena je odblokovaná (gate `maCenovyZdroj` → dopyt/PDF/`vypocet` akcia dostanú cenu z matice
		// hĺbka × šírka × strešné zasklenie pri bázovom systéme stien; model ROBUST/MASSIVE = display spec).
		cenovyZdroj: true
	},
	{
		kod: 'zasklenie',
		nazov: 'Zasklenie terasy a balkóna',
		pdfNadpis: 'Špecifikácia zasklenia',
		popis: 'Bezrámové aj rámové posuvné zasklenia terás a balkónov.',
		foto: 'zasklenie.webp',
		alt: 'Moderné zasklenie terasy Montalu Slide',
		stav: 'live',
		odkaz: '/konfigurator/zasklenie',
		externy: false,
		// #387: zasklenie NEMÁ overený interim cenový zdroj (matica montalu.sk pre zasklenie nie je
		// reverzne odvodená — samostatný follow-up v rozsahu #279). Honest-null → bez ceny.
		cenovyZdroj: false
	},
	{
		kod: 'oplotenie',
		nazov: 'Hliníkové oplotenie',
		pdfNadpis: 'Špecifikácia oplotenia',
		popis: 'Dizajnové hliníkové ploty a brány — krídlové, posuvné aj samonosné.',
		foto: 'oplotenie.webp',
		alt: 'Dizajnové hliníkové oplotenie Montalu Narvi',
		stav: 'live',
		odkaz: '/konfigurator/oplotenie',
		externy: false,
		// #410: oplotenie MÁ vyťažený interim cenový zdroj (matica montalu.sk `update-fencings` v
		// `cennik-oplotenie.json`, server modul `konfigurator-oplotenie-cena.ts`) → orientačná cena je
		// odblokovaná (gate `maCenovyZdroj` → dopyt/PDF/`vypocet` akcia dostanú oplotenie cenu).
		cenovyZdroj: true
	},
	{
		kod: 'tienenie',
		nazov: 'Tienenie',
		pdfNadpis: 'Špecifikácia tienenia',
		popis: 'Markízy XLINE a XLIGHT a screenové rolety ZIPLINE.',
		foto: 'tienenie.webp',
		alt: 'Hliníková markíza Montalu XLINE',
		stav: 'live',
		odkaz: '/konfigurator/tienenie',
		externy: false,
		// #389: tienenie NEMÁ overený interim cenový zdroj (montalu.sk cenu markíz nevystavuje ako
		// jednoduchý endpoint pergoly `update-pergolas`; vyťaženie = práca v rozsahu #279). Honest-null → bez ceny.
		cenovyZdroj: false
	},
	{
		kod: 'pristresok',
		nazov: 'Prístrešky a altánky',
		pdfNadpis: 'Špecifikácia prístrešku',
		popis: 'Hliníkové prístrešky na auto, altánky, skleníky aj vonkajšie sauny.',
		foto: 'pristresok.webp',
		alt: 'Hliníkový prístrešok na auto Montalu',
		stav: 'live',
		odkaz: '/konfigurator/pristresok',
		externy: false,
		// #390: prístrešky NEMAJÚ overený interim cenový zdroj (montalu.sk ich vôbec nemá vo svojom
		// cenovom konfigurátore) → honest-null, konfigurátor beží bez ceny (cena na vyžiadanie).
		cenovyZdroj: false
	}
];

const PODLA_KODU = new Map<string, KonfProdukt>(KONF_PRODUKTY.map((p) => [p.kod, p]));

/** Produkt podľa kódu (alebo `undefined` pri neznámom). */
export function produktPodlaKodu(kod: string | null | undefined): KonfProdukt | undefined {
	return PODLA_KODU.get(String(kod ?? ''));
}

/** Názov produktu v nominatíve pre Odoo lead / admin zoznam (fallback 'Pergola' pre NULL/neznámy —
 *  staré dopyty pred migráciou v35 nemajú `produkt` a sú všetky pergolové). */
export function produktNazov(kod: string | null | undefined): string {
	return produktPodlaKodu(kod)?.nazov ?? 'Pergola';
}

/** Nadpis PDF špecifikácie pre produkt (fallback 'Špecifikácia pergoly' — byte-identické so
 *  správaním pred #384 pre pergolu aj staré neopečiatkované riadky). */
export function produktPdfNadpis(kod: string | null | undefined): string {
	return produktPodlaKodu(kod)?.pdfNadpis ?? 'Špecifikácia pergoly';
}

/** #385: má produkt OVERENÝ interim cenový zdroj (a teda smie dostať orientačnú/opečiatkovanú cenu)?
 *  Gate pre dopyt/PDF cenu — produkt bez zdroja (bazén, …) je honest-null (cena sa NEopečiatkuje ani
 *  neprepočíta). Fail-safe smery:
 *  - **`null`/`undefined` → `true` (pergola)**: LEN historický default — dopyty pred migráciou v35
 *    nemajú `produkt` a sú všetky pergolové s cenníkom (#279), takže ich re-download honest-degrade
 *    prepočet zo živej matice ostáva zachovaný.
 *  - **známy produkt → jeho `cenovyZdroj`** (pergola true, bazén/ostatné false).
 *  - **neznámy NEPRÁZDNY kód → `false`** (#385 review 🟡): produkt neskôr odobraný/premenovaný z
 *    `KONF_PRODUKTY` NESMIE ticho znovu získať pergolovú cenu na re-downloade — honest-null je
 *    bezpečný default pre čokoľvek, čo NIE JE explicitne pergola so zdrojom. */
export function maCenovyZdroj(kod: string | null | undefined): boolean {
	if (kod == null) return true;
	return produktPodlaKodu(kod)?.cenovyZdroj ?? false;
}
