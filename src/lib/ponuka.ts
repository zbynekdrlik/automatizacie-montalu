// Zdieľané typy + čisté helpery pre verejnú PDF ponuku (#277). ŽIADNY server import
// (žiadny DB/Money/pdf-lib) — použiteľné aj na klientovi (DopytForm náhľad) aj na serveri
// (ponuka-pdf, dopyt-action). Money-neutrálne: iba zákaznícka konfigurácia + orientačná
// PREDAJNÁ cena (#279 Fáza C) — NIKDY Money nákupné kódy, VO cena ani nárez.
import { MODELY, type ModelPergoly, type VerejnaCena } from '$lib/konfigurator';
// #329 časť 4: zákazník NIKDY nevidí hrúbky — v PDF ponuke zobraz zákaznícky label kategórie
// (napr. „Izolačné sklo — mliečne") namiesto interného katalógového názvu s hrúbkou. `cfg.sklo`
// (konkrétny nazov) ostáva NEZMENENÝ v uloženej konfigurácii + Odoo leade (pipeline nezmenená);
// mapuje sa len pri RENDERI riadku. Neznámy (interný/nekategorizovaný) názov → fallback na raw.
import { konfSkloKategoriaPreNazov } from '$lib/konfigurator-sklo';

/** Platné modely (LIGHT/ROBUST/MASSIVE) — na obranné sparsovanie klientom dodaného `model`. */
const PLATNE_MODELY = new Set<string>(MODELY.map((m) => m.kod));

/**
 * Zákaznícka konfigurácia pergoly tak, ako ju odovzdá verejný konfigurátor (#275).
 * Všetky polia sú VOLITEĽNÉ — konfigurátor sa vyvíja a PDF súhrn vykreslí len to,
 * čo je reálne prítomné (honest-degrade). Rozmery sú v mm.
 */
export interface PonukaConfig {
	system?: string;
	typStrechy?: string;
	/** model konštrukcie (LIGHT/ROBUST/MASSIVE) — cenotvorný vstup (#279 Fáza C). Cenu z neho
	 *  počíta SERVER (`ponuka-pdf`), NIE klient (klient posiela len tento string). */
	model?: ModelPergoly;
	sirka?: number;
	hlbka?: number;
	/** #385: DĹŽKA [mm] — neutrálne pole pre produkty, kde je hlavný rozmer dĺžka, nie hĺbka
	 *  (bazénové zastrešenie: „d × š"). Keď je prítomná, `zhrnutieRiadky` vykreslí „Rozmery (d × š)"
	 *  namiesto pergolového „Rozmery (š × h)" (pergola `dlzka` nenastaví → byte-identická). */
	dlzka?: number;
	vyskaVpredu?: number;
	vyskaPriStene?: number;
	farba?: string;
	sklo?: string;
	pocetPoli?: number;
	/** voliteľný voľný technický popis z konfigurátora */
	popis?: string;
}

const STR_MAX = 120;

/** string|number → orezaný string (cap), prázdny/neplatný → undefined. */
function optStr(v: unknown, max = STR_MAX): string | undefined {
	if (typeof v !== 'string' && typeof v !== 'number') return undefined;
	const s = String(v).trim().slice(0, max);
	return s.length ? s : undefined;
}

/** kladné konečné číslo (rozmer v mm / počet), inak undefined. */
function optPosNum(v: unknown): number | undefined {
	const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Obranné parsovanie klientom dodaného JSON konfigurácie na kanonický `PonukaConfig`.
 * Neznáme kľúče sa ignorujú, dĺžky sú capnuté — nikdy nehádže. Toto je verzia, ktorá sa
 * ukladá do `dopyt` (audit) aj kŕmi PDF, takže je jediný zdroj pravdy tvaru.
 */
export function sanitizePonukaConfig(raw: unknown): PonukaConfig {
	let obj: Record<string, unknown> = {};
	if (typeof raw === 'string') {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
		} catch {
			obj = {};
		}
	} else if (raw && typeof raw === 'object') {
		obj = raw as Record<string, unknown>;
	}
	const out: PonukaConfig = {};
	const system = optStr(obj.system);
	if (system) out.system = system;
	const typStrechy = optStr(obj.typStrechy);
	if (typStrechy) out.typStrechy = typStrechy;
	// model (#279 Fáza C): iba platný LIGHT/ROBUST/MASSIVE — neznámy reťazec sa zahodí (žiadna
	// injekcia). Cena sa z neho počíta server-side, klientom dodaná hodnota je len výberom.
	const model = optStr(obj.model);
	if (model && PLATNE_MODELY.has(model)) out.model = model as ModelPergoly;
	const sirka = optPosNum(obj.sirka);
	if (sirka !== undefined) out.sirka = sirka;
	const hlbka = optPosNum(obj.hlbka);
	if (hlbka !== undefined) out.hlbka = hlbka;
	const dlzka = optPosNum(obj.dlzka);
	if (dlzka !== undefined) out.dlzka = dlzka;
	const vyskaVpredu = optPosNum(obj.vyskaVpredu);
	if (vyskaVpredu !== undefined) out.vyskaVpredu = vyskaVpredu;
	const vyskaPriStene = optPosNum(obj.vyskaPriStene);
	if (vyskaPriStene !== undefined) out.vyskaPriStene = vyskaPriStene;
	const farba = optStr(obj.farba);
	if (farba) out.farba = farba;
	const sklo = optStr(obj.sklo);
	if (sklo) out.sklo = sklo;
	const pocetPoli = optPosNum(obj.pocetPoli);
	if (pocetPoli !== undefined) out.pocetPoli = Math.round(pocetPoli);
	const popis = optStr(obj.popis, 400);
	if (popis) out.popis = popis;
	return out;
}

/** EUR suma → "4 452,06 €" (obyčajná medzera pre tisícky — spoľahlivý glyf v subsete DejaVu PDF
 *  fontu; nbsp z `Intl` by v subsete nemusel byť). Zdieľané medzi PDF (`ponuka-pdf`) a admin
 *  zoznamom (#309) — jeden zdroj pravdy formátu ceny. Pure (bez server importu). */
export function formatEur(n: number): string {
	const cents = Math.round(n * 100);
	const cele = Math.floor(cents / 100);
	const dec = String(cents % 100).padStart(2, '0');
	const tis = String(cele).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
	return `${tis},${dec} €`;
}

/** Krátky label opečiatkovanej ceny do INTERNÉHO zoznamu dopytov (#309). `null` (neopečiatkovaný /
 *  starý riadok) → „—"; konkrétna cena → „4 452,06 € s DPH"; mimo katalógu → „Cena na vyžiadanie".
 *  #318: veľkoobchodný (VO) dopyt nesie marker „· VO", nech personál rozozná VO cenu od MO
 *  (zoznam je interný-only — VO label sa na verejnú plochu nikdy nedostane). Pure. */
export function formatCenaKratko(cena: VerejnaCena | null): string {
	if (cena === null) return '—';
	const vo = cena.hladina === 'VO' ? ' · VO' : '';
	if (cena.druh === 'cena') return `${formatEur(cena.sDph)} s DPH${vo}`;
	return `Cena na vyžiadanie${vo}`;
}

/** celé mm bez desatinných (rozmery sú celé čísla). */
const mm = (n: number) => `${Math.round(n)} mm`;

/**
 * Súhrn konfigurácie ako riadky label/value — zdieľaný medzi PDF a prípadným náhľadom.
 * Zahŕňa LEN prítomné polia (honest-degrade). ŽIADNA cena — toto je špecifikácia.
 */
export function zhrnutieRiadky(cfg: PonukaConfig): { label: string; value: string }[] {
	const rows: { label: string; value: string }[] = [];
	if (cfg.system) rows.push({ label: 'Systém', value: cfg.system });
	if (cfg.model) rows.push({ label: 'Model', value: cfg.model });
	if (cfg.typStrechy) rows.push({ label: 'Typ strechy', value: cfg.typStrechy });
	// #385: produkt s hlavným rozmerom DĹŽKA (bazén) → „Rozmery (d × š)" (poradie zhodné so
	// zákazníckou stránkou); pergola (bez `dlzka`) padne na pôvodné „Rozmery (š × h)" nezmenené.
	if (cfg.dlzka !== undefined && cfg.sirka !== undefined)
		rows.push({ label: 'Rozmery (d × š)', value: `${Math.round(cfg.dlzka)} × ${mm(cfg.sirka)}` });
	else if (cfg.sirka !== undefined && cfg.hlbka !== undefined)
		rows.push({ label: 'Rozmery (š × h)', value: `${Math.round(cfg.sirka)} × ${mm(cfg.hlbka)}` });
	else if (cfg.dlzka !== undefined) rows.push({ label: 'Dĺžka', value: mm(cfg.dlzka) });
	else if (cfg.sirka !== undefined) rows.push({ label: 'Šírka', value: mm(cfg.sirka) });
	else if (cfg.hlbka !== undefined) rows.push({ label: 'Hĺbka', value: mm(cfg.hlbka) });
	if (cfg.vyskaVpredu !== undefined && cfg.vyskaPriStene !== undefined)
		rows.push({
			label: 'Výška',
			value: `vpredu ${mm(cfg.vyskaVpredu)} / pri stene ${mm(cfg.vyskaPriStene)}`
		});
	else if (cfg.vyskaVpredu !== undefined)
		rows.push({ label: 'Výška vpredu', value: mm(cfg.vyskaVpredu) });
	else if (cfg.vyskaPriStene !== undefined)
		rows.push({ label: 'Výška pri stene', value: mm(cfg.vyskaPriStene) });
	if (cfg.pocetPoli !== undefined) rows.push({ label: 'Počet polí', value: String(cfg.pocetPoli) });
	if (cfg.farba) rows.push({ label: 'Farba konštrukcie', value: cfg.farba });
	if (cfg.sklo)
		rows.push({
			label: 'Sklo / výplň',
			value: konfSkloKategoriaPreNazov(cfg.sklo)?.label ?? cfg.sklo
		});
	if (cfg.popis) rows.push({ label: 'Popis', value: cfg.popis });
	return rows;
}

/**
 * Kontaktné údaje firmy na PDF. Web je známy; e-mail/telefón/adresu doplní OWNER pri
 * integrácii (#277) — prázdne polia sa na PDF nevykreslia (žiadne vymyslené dáta).
 */
export const FIRMA = {
	nazov: 'Montalu',
	web: 'app.montalu.cloud',
	email: '',
	telefon: '',
	adresa: ''
} as const;

/** Disclaimer — uvedená cena je ORIENTAČNÁ (#279 Fáza C), NIE záväzná cenová ponuka. */
export const DISCLAIMER =
	'Uvedená cena je ORIENTAČNÁ (informatívna), nie záväzná cenová ponuka. Presnú cenu ' +
	'pripravíme po obhliadke miesta stavby. Uvedené rozmery a prvky vychádzajú z vašej ' +
	'konfigurácie a môžu sa po zameraní upresniť.';

/** #385: disclaimer pre špecifikáciu BEZ ceny (produkt bez cenového zdroja — honest-null). NESMIE
 *  tvrdiť, že dokument nesie orientačnú cenu (bazén ju nemá). Presnú cenu pripravíme individuálne. */
export const DISCLAIMER_BEZ_CENY =
	'Táto špecifikácia je nezáväzná. Presnú cenu pripravíme individuálne po obhliadke miesta ' +
	'stavby. Uvedené rozmery a prvky vychádzajú z vašej konfigurácie a môžu sa po zameraní upresniť.';

/** Neprázdne kontaktné riadky firmy (na vykreslenie do PDF). Param kvôli testovateľnosti
 *  (default = `FIRMA`); prázdne polia sa vynechajú, aby PDF neukázalo vymyslené dáta. */
export function firmaRiadky(
	firma: { adresa?: string; telefon?: string; email?: string; web?: string } = FIRMA
): string[] {
	const r: string[] = [];
	if (firma.adresa) r.push(firma.adresa);
	if (firma.telefon) r.push(`Tel.: ${firma.telefon}`);
	if (firma.email) r.push(firma.email);
	if (firma.web) r.push(firma.web);
	return r;
}
