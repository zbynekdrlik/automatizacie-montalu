// Interim cenotvorba pergoly (#279, Fáza B) — SERVER-ONLY cenový modul. Lookup do
// vyťaženej matice montalu.sk (`cennik-pergola.json`, Fáza A) so zaokrúhlením rozmeru
// NAHOR na katalógovú mriežku a obálkou dostupnosti. Mimo katalógu / nedostupná
// kombinácia ⇒ 'individualna-ponuka' (NIKDY neextrapoluje).
//
// Money-neutrálny a mimo klientskeho bundle ($lib/server/): NEIMPORTUJE katalóg skla
// (nesie Money kód), `sklo-cena`, `server/money`, `server/db` — obsahuje interim PREDAJNÉ ceny
// prevzaté z verejného konfigurátora montalu.sk, nie Money nákupné/odpisové kódy.
// #279 Fáza C (owner ROZHODNUTÉ): tento modul sa DO VEREJNEJ ODPOVEDE ZAPÁJA — verejná route
// dostane LEN maloobchod (MO) cez `naVerejnuCenu`/`verejnaCenaPreModel`/`verejneCenyModelov`
// (VO strip). VO cena / Money kód / matica sa do verejnej odpovede NIKDY nedostanú. Modul je
// čistý (bez DB/siete), priamo unit-testovateľný (parity: `tests/konfigurator-cena.test.ts`).
import { createHash } from 'node:crypto';
import cennikJson from './cennik-pergola.json';
// #279 Fáza C: `ModelPergoly` + verejné cenové typy žijú v client-safe `$lib/konfigurator`
// (jeden zdroj pravdy — vidí ich aj wizard). Tu ich importujeme (server-only lookup) a
// `ModelPergoly` RE-EXPORTUJEME, aby existujúce importy z tohto modulu (parity test) fungovali.
import { MODELY, MODEL_DEFAULT } from '$lib/konfigurator';
import type { ModelPergoly, VerejnaCena, CenaModelu } from '$lib/konfigurator';
export type { ModelPergoly };

/** Kľúč strešnej výplne (mapuje na montalu.sk roofing slug v seed `vyplne`). */
export type VyplnKluc =
	| 'polykarbonat-16'
	| 'bezpecnostne-sklo-441'
	| 'bezpecnostne-sklo-442'
	| 'izolacne-sklo-24'
	| 'panel-izo-24';

interface Mriezka {
	min: number;
	max: number;
	krok: number;
}

/** Bunka matice = [MO net, VO net] v EUR (bez DPH). */
type Bunka = [number, number];
/** šírkový kľúč ("4.00") → bunka */
type SirkaMap = Record<string, Bunka>;
/** hĺbkový kľúč ("3.0") → šírkový riadok */
type HlbkaMap = Record<string, SirkaMap>;
/** model → hĺbkový blok (nedostupné modely chýbajú) */
type ModelMap = Partial<Record<ModelPergoly, HlbkaMap>>;
/** výplň → model blok (nedostupné výplne chýbajú) */
type CennikMap = Partial<Record<VyplnKluc, ModelMap>>;

interface CennikSeed {
	meta: {
		zdroj: string;
		vytazene: string;
		dph: number;
		rodina: string;
		poznamka: string;
		mriezka: { hlbkaM: Mriezka; sirkaM: Mriezka };
	};
	modely: Record<ModelPergoly, string>;
	vyplne: Partial<Record<VyplnKluc, string>>;
	priplatky: {
		kominEur: number;
		zaruka5rEur: number;
		customRal: number | null;
		ledRgb: number | null;
	};
	cennik: CennikMap;
	verifikaciaDph: Array<{
		roofing: VyplnKluc;
		model: ModelPergoly;
		hlbkaM: number;
		sirkaM: number;
		moNet: number;
		moDph: string;
		voNet: number;
		voDph: string;
	}>;
}

const SEED = cennikJson as unknown as CennikSeed;

/** Obsahový hash CENOTVORNÝCH častí seedu (matica + príplatky + DPH + mriezka) — zmení sa pri
 *  AKOMKOĽVEK cenovom drifte (aj ručnej úprave bez zmeny `vytazene`). Časová značka `vytazene`
 *  sama nestačí ako verzia (je len metadáta a mení sa aj bez zmeny cien). */
const CENNIK_HASH = createHash('sha256')
	.update(
		JSON.stringify({
			cennik: SEED.cennik,
			priplatky: SEED.priplatky,
			dph: SEED.meta.dph,
			mriezka: SEED.meta.mriezka
		})
	)
	.digest('hex')
	.slice(0, 12);

/** Verzia cenníka pri opečiatkovaní ceny (#309) — čitateľný čas vyťaženia + obsahový hash
 *  cenotvorných častí. Pri PODANÍ dopytu sa uloží (`dopyt.cennik_verzia`), aby sa dalo dohľadať,
 *  z ktorej matice vzišla opečiatkovaná historická cena. */
export const CENNIK_VERZIA = `${SEED.meta.vytazene}#${CENNIK_HASH}`;

/** Sadzba DPH (0,23) prevzatá zo seedu — jeden zdroj pravdy. */
export const DPH = SEED.meta.dph;
/** Fixné príplatky (EUR, net) zo seedu. */
export const PRIPLATKY = {
	kominEur: SEED.priplatky.kominEur,
	zaruka5rEur: SEED.priplatky.zaruka5rEur
} as const;
/** Katalógová mriežka (metre). */
export const MRIEZKA = SEED.meta.mriezka;

const EPS = 1e-9;
/** DPH ako celé percentá (23) — na EXAKTNÚ celocentovú aritmetiku (bez FP driftu). */
const DPH_PCT = Math.round(DPH * 100);

/** Zaokrúhli EUR sumu na 2 desatiny (celé centy). */
function eur2(net: number): number {
	return Math.round(net * 100) / 100;
}

/** Suma s DPH v EUR = round(net × (1 + DPH), 2), počítané v celých centoch, aby sa
 *  presne (bez FP driftu na .xx5 hraniciach) zhodovalo s PHP `round()` na montalu.sk.
 *  net (v centoch) × (100 + DPH_PCT) / 100, zaokrúhlené half-up na celé centy. */
function sDphEur(net: number): number {
	const centy = Math.round(net * 100);
	return Math.round((centy * (100 + DPH_PCT)) / 100) / 100;
}

export interface CenaVstup {
	/** hĺbka (výsuv od domu) [mm] */
	hlbkaMm: number;
	/** šírka (pozdĺž steny) [mm] */
	sirkaMm: number;
	/** model konštrukcie — default LIGHT (pricing potrebuje model server-side; verejné UI
	 *  výberu modelu je Fáza C, #279). */
	model?: ModelPergoly;
	/** kľúč strešnej výplne — default polykarbonát 16 mm */
	vypln?: VyplnKluc;
	/** predpríprava na komín (+250 € net) */
	komin?: boolean;
	/** predĺženie záruky na 5 rokov (+600 € net) */
	zaruka5r?: boolean;
}

export interface CenaZlozka {
	/** cena bez DPH [EUR] */
	bezDph: number;
	/** cena s DPH [EUR] = round(bezDph × (1 + DPH), 2) */
	sDph: number;
}

export interface CenaOk {
	druh: 'cena';
	model: ModelPergoly;
	vypln: VyplnKluc;
	/** hĺbka po zaokrúhlení NAHOR na mriežku [m] */
	hlbkaGridM: number;
	/** šírka po zaokrúhlení NAHOR na mriežku [m] */
	sirkaGridM: number;
	/** maloobchod (MO) */
	mo: CenaZlozka;
	/** veľkoobchod (VO/B2B) */
	vo: CenaZlozka;
	priplatky: { kominEur: number; zaruka5rEur: number; spoluEur: number };
}

export interface CenaIndividualna {
	druh: 'individualna-ponuka';
	dovod: string;
}

export type CenaVysledok = CenaOk | CenaIndividualna;

/** Zaokrúhli hodnotu [m] NAHOR na katalógovú mriežku. Pod minimum ⇒ minimum (prilepí sa).
 *  Nad maximum ⇒ null (mimo katalógu → individuálna ponuka). Vracia hodnotu na mriežke. */
export function zaokruhliNahor(hodnotaM: number, m: Mriezka): number | null {
	if (!Number.isFinite(hodnotaM)) return null;
	if (hodnotaM <= m.min) return m.min;
	const g = Math.round(Math.ceil((hodnotaM - EPS) / m.krok) * m.krok * 100) / 100;
	return g <= m.max + EPS ? g : null;
}

const kD = (d: number) => d.toFixed(1);
const kW = (w: number) => w.toFixed(2);

function zlozka(net: number): CenaZlozka {
	return { bezDph: eur2(net), sDph: sDphEur(net) };
}

/**
 * Vypočíta interim predajnú cenu pergoly (MO + VO, net + s DPH) lookupom do matice
 * montalu.sk. Rozmer sa zaokrúhli NAHOR na mriežku; mimo katalógu (šírka > 7,5 m,
 * hĺbka > 6,0 m) alebo nedostupná kombinácia model×výplň×rozmer ⇒ 'individualna-ponuka'.
 */
export function vypocitajCenu(v: CenaVstup): CenaVysledok {
	const model = v.model ?? 'LIGHT';
	const vypln = v.vypln ?? 'polykarbonat-16';

	// Nekladný/neplatný rozmer nesmie ticho spadnúť na katalógové minimum — inak by
	// `{hlbkaMm:0}` alebo záporný vstup dostal reálnu cenu min. bunky. Verejný vstup je
	// validovaný v `konfigurator-vstup.ts`, toto je obranná hranica pre budúcich volateľov.
	if (!(v.hlbkaMm > 0) || !(v.sirkaMm > 0))
		return { druh: 'individualna-ponuka', dovod: 'Neplatný rozmer (musí byť > 0).' };

	const hlbkaGridM = zaokruhliNahor(v.hlbkaMm / 1000, MRIEZKA.hlbkaM);
	if (hlbkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Hĺbka presahuje katalóg (max ${MRIEZKA.hlbkaM.max} m) — individuálna ponuka.`
		};

	const sirkaGridM = zaokruhliNahor(v.sirkaMm / 1000, MRIEZKA.sirkaM);
	if (sirkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Šírka presahuje katalóg (max ${MRIEZKA.sirkaM.max} m) — individuálna ponuka.`
		};

	const bunka = SEED.cennik[vypln]?.[model]?.[kD(hlbkaGridM)]?.[kW(sirkaGridM)];
	if (!bunka)
		return {
			druh: 'individualna-ponuka',
			dovod: 'Kombinácia modelu, výplne a rozmeru nie je v katalógu — individuálna ponuka.'
		};

	const kominEur = v.komin ? PRIPLATKY.kominEur : 0;
	const zaruka5rEur = v.zaruka5r ? PRIPLATKY.zaruka5rEur : 0;
	const spoluEur = kominEur + zaruka5rEur;

	return {
		druh: 'cena',
		model,
		vypln,
		hlbkaGridM,
		sirkaGridM,
		mo: zlozka(bunka[0] + spoluEur),
		vo: zlozka(bunka[1] + spoluEur),
		priplatky: { kominEur, zaruka5rEur, spoluEur }
	};
}

/** Zoznam výplní dostupných pre daný model (podľa vyťaženej matice) — pre budúce UI/testy. */
export function dostupneVyplne(model: ModelPergoly): VyplnKluc[] {
	return (Object.keys(SEED.cennik) as VyplnKluc[]).filter(
		(vypln) => SEED.cennik[vypln]?.[model] !== undefined
	);
}

// --------------------------------------------------------------------------- //
// #279 Fáza C — VEREJNÁ (public-safe) cena: LEN maloobchod (MO), VO sa ODSTRÁNI. //
// --------------------------------------------------------------------------- //

/**
 * Zmapuje interný výsledok (`CenaVysledok` s MO **aj** VO) na verejnú cenu (LEN MO).
 * VO (`vo`) sa NIKDY nedostane do verejnej odpovede (#279 leak-guard: VO ostáva neverejné).
 *
 * **Invariant (volateľ ho MUSÍ dodržať):** `model` je autoritatívny LEN pre `individualna-ponuka`
 * vetvu (tam ho `CenaVysledok` nenesie); pre `cena` vetvu sa použije `v.model` a `model` MUSÍ
 * byť ten istý, aký dostal `vypocitajCenu`. `verejnaCenaPreModel` to garantuje (posiela ten istý
 * model do oboch). Nevolaj s nekonzistentným párom (v, model).
 */
export function naVerejnuCenu(v: CenaVysledok, model: ModelPergoly): VerejnaCena {
	if (v.druh === 'individualna-ponuka')
		return { druh: 'individualna-ponuka', model, dovod: v.dovod };
	return {
		druh: 'cena',
		model: v.model,
		bezDph: v.mo.bezDph,
		sDph: v.mo.sDph,
		hlbkaGridM: v.hlbkaGridM,
		sirkaGridM: v.sirkaGridM
	};
}

/** Verejná orientačná cena pre JEDEN model (MO-only). Default model LIGHT, výplň polykarbonát-16
 *  (interim BÁZOVÁ cena — dekoračné sklo interim cenu nemení, viď #279 Fáza C design). */
export function verejnaCenaPreModel(v: CenaVstup): VerejnaCena {
	const model = v.model ?? MODEL_DEFAULT;
	return naVerejnuCenu(vypocitajCenu({ ...v, model }), model);
}

/** Orientačné ceny VŠETKÝCH modelov (LIGHT/ROBUST/MASSIVE) pre daný rozmer — zrkadlo montalu.sk
 *  „ceny modelov vedľa seba". MO-only, žiadne VO. Výplň interim = bázová (polykarbonát-16). */
export function verejneCenyModelov(hlbkaMm: number, sirkaMm: number): CenaModelu[] {
	return MODELY.map((m) => ({
		model: m.kod,
		cena: verejnaCenaPreModel({ hlbkaMm, sirkaMm, model: m.kod })
	}));
}
