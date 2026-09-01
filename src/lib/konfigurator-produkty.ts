// Jednotný verejný konfigurátor (#384) — client-safe katalóg produktových radov + produkt
// diskriminátor pre dopyt/PDF/Odoo pipeline. PURE modul: ŽIADNY server import (ani `server/db`
// ani Money/cena), takže ho smie importovať klientsky bundle (výberová obrazovka `KonfVyber`
// aj formuláre). Nesie LEN prezentačné texty + fotky z montalu.sk (žiadny Money kód, žiadna
// cena) → leak-guard (A) `konfigurator-money-safety` ho prejde bez porušenia.
//
// Rám (PR 1/7) zavádza JEDINÉ pergolové rameno; produktové PR-y (#385–#390) menia `stav` karty
// na `live`, pridajú svoju podstránku `/konfigurator/<slug>` a rameno do únie `DopytKonfiguracia`.
import type { PonukaConfig } from './ponuka';

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
		externy: false
	},
	{
		kod: 'bazen',
		nazov: 'Bazénové zastrešenie',
		pdfNadpis: 'Špecifikácia bazénového zastrešenia',
		popis: 'Jedno- a dvojkoľajové zastrešenia bazénov aj vírivky.',
		foto: 'bazen.webp',
		alt: 'Bazénové zastrešenie Montalu Premier',
		stav: 'pripravujeme',
		odkaz: 'https://montalu.sk/produkty/zastresenie-bazenov',
		externy: true
	},
	{
		kod: 'zimna-zahrada',
		nazov: 'Zimná záhrada',
		pdfNadpis: 'Špecifikácia zimnej záhrady',
		popis: 'Hliníkové zimné záhrady ROBUST a MASSIVE s presklením na mieru.',
		foto: 'zimna-zahrada.webp',
		alt: 'Hliníková zimná záhrada Montalu Robust',
		stav: 'pripravujeme',
		odkaz: 'https://montalu.sk/produkty/zimne-zahrady',
		externy: true
	},
	{
		kod: 'zasklenie',
		nazov: 'Zasklenie terasy a balkóna',
		pdfNadpis: 'Špecifikácia zasklenia',
		popis: 'Bezrámové aj rámové posuvné zasklenia terás a balkónov.',
		foto: 'zasklenie.webp',
		alt: 'Moderné zasklenie terasy Montalu Slide',
		stav: 'pripravujeme',
		odkaz: 'https://montalu.sk/produkty/zasklenia',
		externy: true
	},
	{
		kod: 'oplotenie',
		nazov: 'Hliníkové oplotenie',
		pdfNadpis: 'Špecifikácia oplotenia',
		popis: 'Dizajnové hliníkové ploty a brány — krídlové, posuvné aj samonosné.',
		foto: 'oplotenie.webp',
		alt: 'Dizajnové hliníkové oplotenie Montalu Narvi',
		stav: 'pripravujeme',
		odkaz: 'https://montalu.sk/produkty/oplotenie',
		externy: true
	},
	{
		kod: 'tienenie',
		nazov: 'Tienenie',
		pdfNadpis: 'Špecifikácia tienenia',
		popis: 'Markízy XLINE a XLIGHT a screenové rolety ZIPLINE.',
		foto: 'tienenie.webp',
		alt: 'Hliníková markíza Montalu XLINE',
		stav: 'pripravujeme',
		odkaz: 'https://montalu.sk/produkty/tienenie',
		externy: true
	},
	{
		kod: 'pristresok',
		nazov: 'Prístrešky a altánky',
		pdfNadpis: 'Špecifikácia prístrešku',
		popis: 'Hliníkové prístrešky na auto, altánky, skleníky aj vonkajšie sauny.',
		foto: 'pristresok.webp',
		alt: 'Hliníkový prístrešok na auto Montalu',
		stav: 'pripravujeme',
		odkaz: 'https://montalu.sk/produkty/hlinikove-pristresky-a-altanky',
		externy: true
	}
];

const PODLA_KODU = new Map<string, KonfProdukt>(KONF_PRODUKTY.map((p) => [p.kod, p]));

/** Produkt podľa kódu (alebo `undefined` pri neznámom). */
export function produktPodlaKodu(kod: string | null | undefined): KonfProdukt | undefined {
	return PODLA_KODU.get(String(kod ?? ''));
}

/** Obranné parsovanie klientom dodaného `produkt` poľa → známy kód. Neznámy/chýbajúci → 'pergola'
 *  (rám má jediné live rameno; zákaznícky POST nesmie zapísať nezmyselný produkt). */
export function parseProdukt(raw: unknown): KonfProduktKod {
	const s = String(raw ?? '').trim();
	return PODLA_KODU.has(s) ? (s as KonfProduktKod) : 'pergola';
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

/**
 * Diskriminovaná únia konfigurácií podľa produktu (#384). Rám zavádza JEDINÉ pergolové rameno;
 * každý produktový PR (#385–#390) pridá svoje rameno (`| BazenKonfiguracia | …`) s vlastným
 * tvarom `konfiguracia` payloadu. `produkt` diskriminátor je voliteľný pre spätnú kompatibilitu
 * so staršími pergolovými dopytmi (bez poľa = pergola).
 */
export interface PergolaKonfiguracia extends PonukaConfig {
	produkt?: 'pergola';
}

export type DopytKonfiguracia = PergolaKonfiguracia;
