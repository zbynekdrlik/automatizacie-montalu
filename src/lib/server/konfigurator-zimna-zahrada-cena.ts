// Interim cenotvorba zimných záhrad (#408) — SERVER-ONLY cenový modul. Lookup do vyťaženej matice
// montalu.sk (`cennik-zimna-zahrada.json`, Fáza A) so zaokrúhlením rozmeru NAHOR na katalógovú mriežku
// a obálkou dostupnosti. Mimo katalógu / nedostupná kombinácia ⇒ 'individualna-ponuka' (NIKDY
// neextrapoluje — nevymýšľa cenu).
//
// Zrkadlo pergolového/bazénového cenového modulu, parametrizované na osi zimnej záhrady (viď design
// komentár #408). Cenotvorné osi replikované v seede: **hĺbka (montalu `length`) × šírka (montalu
// `width`) × strešné zasklenie (`roofing`)** pri BÁZOVOM systéme stien (`slide|izolacne-sklo-16-mm`),
// bázovom `glass_add`, neutrálnej farbe. Model ROBUST/MASSIVE ani systém stien NIE sú cenotvorné osi
// montalu — sú DISPLAY spec (upresnia sa po obhliadke); interim cena reaguje na rozmery + zasklenie.
//
// Money-neutrálny a mimo klientskeho bundle ($lib/server/): interim PREDAJNÉ ceny prevzaté z verejného
// konfigurátora montalu.sk (montalu cenové kľúče — roofing slugy), NIE Money ERP kódy. #318 hladina-aware
// (MO default pre neprihláseného/interného, VO LEN pre prihláseného veľkoobchodného; hladinu rozhoduje
// SERVER, VO sa do MO odpovede NIKDY nedostane). Čistý (bez DB/siete), priamo unit-testovateľný
// (parita: `tests/konfigurator-zimna-zahrada-cena.test.ts`).
import cennikJson from './cennik-zimna-zahrada.json';
import { EPS, VO_LABEL, cennikHash, dphNaPct, zlozka as zlozkaSpolocna } from './cennik-spolocne';
import type { CenaZlozka, Mriezka } from './cennik-spolocne';
import { ZZ_MODEL_DEFAULT, ZZ_ZASKLENIE_DEFAULT } from '$lib/konfigurator-zimna-zahrada';
import type { ZzModel } from '$lib/konfigurator-zimna-zahrada';
import type { VerejnaCena, CenovaHladina } from '$lib/konfigurator';

/** Bunka matice = [MO net, VO net] v EUR (bez DPH). */
type Bunka = [number, number];
/** šírkový kľúč ("4.0") → bunka */
type SirkaMap = Record<string, Bunka>;
/** hĺbkový kľúč ("4.0") → šírkový riadok */
type HlbkaMap = Record<string, SirkaMap>;
/** roofing slug → hĺbkový blok */
type CennikMap = Record<string, HlbkaMap>;

interface CennikSeed {
	meta: {
		zdroj: string;
		vytazene: string;
		dph: number;
		rodina: string;
		bazovyGlazing: string;
		glassAdd: string;
		poznamka: string;
		mriezka: { hlbkaM: Mriezka; sirkaM: Mriezka };
	};
	cennik: CennikMap;
	verifikaciaDph: Array<{
		roofing: string;
		hlbkaM: number;
		sirkaM: number;
		moNet: number;
		moDph: string;
		voNet: number;
		voDph: string;
	}>;
}

const SEED = cennikJson as unknown as CennikSeed;

/** Obsahový hash CENOTVORNÝCH častí seedu (matica + DPH + mriezka) — zmení sa pri AKOMKOĽVEK cenovom
 *  drifte (aj ručnej úprave bez zmeny `vytazene`). */
const CENNIK_HASH = cennikHash({
	cennik: SEED.cennik,
	dph: SEED.meta.dph,
	mriezka: SEED.meta.mriezka
});

/** Verzia cenníka zimnej záhrady pri opečiatkovaní ceny (#309) — čas vyťaženia + obsahový hash. */
export const CENNIK_VERZIA_ZZ = `${SEED.meta.vytazene}#${CENNIK_HASH}`;

/** Sadzba DPH (0,23) prevzatá zo seedu — jeden zdroj pravdy. */
export const DPH_ZZ = SEED.meta.dph;
/** Katalógová mriežka (metre). */
export const MRIEZKA_ZZ = SEED.meta.mriezka;
/** Bázový systém stien, na ktorom je matica vyťažená (pre honest poznámku). */
export const BAZOVY_GLAZING_ZZ = SEED.meta.bazovyGlazing;

/** DPH zimnej záhrady v celých percentách (23) — pre zdieľanú `sDphEur`/`zlozka` (celocentová
 *  aritmetika, `cennik-spolocne`). */
const DPH_PCT = dphNaPct(DPH_ZZ);

/** Mapovanie zákazníckej kategórie zasklenia (ZZ_ZASKLENIA nazov) → montalu `roofing` slug (kľúč
 *  matice). Test `konfigurator-zimna-zahrada-cena.test.ts` overuje, že KAŽDÝ ZZ_ZASKLENIA nazov tu má
 *  záznam (drift guard). Neznáme zasklenie → bázový roofing (honest-degrade). */
const ZASKLENIE_ROOFING: Record<string, string> = {
	'Izolačné sklo': 'izolacne-sklo-24-mm',
	'Bezpečnostné sklo': 'bezpecnostne-sklo-441',
	Polykarbonát: 'dutinkovy-polykarbonat-16-mm',
	'Panel ISODOMUS': 'panel-izo-24mm'
};
/** Bázový roofing (zodpovedá ZZ_ZASKLENIE_DEFAULT „Izolačné sklo"). */
const ROOFING_DEFAULT = ZASKLENIE_ROOFING[ZZ_ZASKLENIE_DEFAULT] ?? 'izolacne-sklo-24-mm';

/** roofing slug z názvu zasklenia (whitelist; neznámy → bázový). Exportované pre test drift-guardu. */
export function roofingPreZasklenie(zasklenie: string | null | undefined): string {
	return ZASKLENIE_ROOFING[String(zasklenie ?? '').trim()] ?? ROOFING_DEFAULT;
}

export interface CenaZzVstup {
	/** hĺbka (vysunutie od steny) [mm] → montalu `length` (dominantná cenotvorná os) */
	hlbkaMm: number;
	/** šírka (pozdĺž steny) [mm] → montalu `width` (pridáva nad 4 m) */
	sirkaMm: number;
	/** kategória strešného zasklenia (ZZ_ZASKLENIA nazov) → roofing; default „Izolačné sklo" */
	zasklenie?: string;
	/** model konštrukcie (ROBUST/MASSIVE) — LEN DISPLAY label do `VerejnaCena.model` (cenu nemení) */
	model?: ZzModel;
}

export interface CenaZzOk {
	druh: 'cena';
	/** model label (ROBUST/MASSIVE) — display, nie cenotvorný */
	model: ZzModel;
	/** hĺbka po zaokrúhlení NAHOR na mriežku [m] */
	hlbkaGridM: number;
	/** šírka po zaokrúhlení NAHOR na mriežku [m] */
	sirkaGridM: number;
	/** maloobchod (MO) */
	mo: CenaZlozka;
	/** veľkoobchod (VO/B2B) */
	vo: CenaZlozka;
}

export interface CenaZzIndividualna {
	druh: 'individualna-ponuka';
	dovod: string;
}

export type CenaZzVysledok = CenaZzOk | CenaZzIndividualna;

/** Zaokrúhli hodnotu [m] NAHOR na najbližší bod katalógovej mriežky (montalu: „Vyberáme najbližší väčší
 *  rozmer z nášho katalógu"). Seed enumeruje presné 0,5 m body — pre hodnoty NA mriežke (naše steppery
 *  krokujú tlačidlami po 500 mm) je lookup EXAKTNÝ. Pod minimum ⇒ minimum (montalu tiež klampuje).
 *  Nad maximum ⇒ null (mimo katalógu → individuálna ponuka). */
export function zaokruhliNahor(hodnotaM: number, m: Mriezka): number | null {
	if (!Number.isFinite(hodnotaM)) return null;
	if (hodnotaM <= m.min) return m.min;
	if (hodnotaM > m.max + EPS) return null;
	// najbližší bod mriežky ≥ hodnota; keďže hodnota ≤ max a max je na mriežke, neprekročí max.
	const g = Math.ceil((hodnotaM - EPS) / m.krok) * m.krok;
	const r = Math.round(g * 100) / 100;
	return r > m.max ? m.max : r;
}

const k1 = (m: number) => m.toFixed(1);

/** Cenová zložka {bezDph, sDph} zimnej záhrady — tenký obal nad zdieľanou `zlozka` s DPH_PCT ZZ. */
function zlozka(net: number): CenaZlozka {
	return zlozkaSpolocna(net, DPH_PCT);
}

/**
 * Vypočíta interim predajnú cenu zimnej záhrady (MO + VO, net + s DPH) lookupom do matice montalu.sk.
 * Rozmer sa zaokrúhli NAHOR na mriežku; nedostupná kombinácia rozmer×roofing alebo mimo katalógu ⇒
 * 'individualna-ponuka' (NIKDY neextrapoluje).
 */
export function vypocitajCenuZz(v: CenaZzVstup): CenaZzVysledok {
	const model = v.model ?? ZZ_MODEL_DEFAULT;

	// Nekladný/neplatný rozmer nesmie ticho spadnúť na katalógové minimum — obranná hranica pre
	// budúcich volateľov (verejný vstup je validovaný v `konfigurator-zimna-zahrada-vstup.ts`).
	if (!(v.hlbkaMm > 0) || !(v.sirkaMm > 0))
		return { druh: 'individualna-ponuka', dovod: 'Neplatný rozmer (musí byť > 0).' };

	const hlbkaGridM = zaokruhliNahor(v.hlbkaMm / 1000, MRIEZKA_ZZ.hlbkaM);
	if (hlbkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Hĺbka presahuje katalóg (max ${MRIEZKA_ZZ.hlbkaM.max} m) — individuálna ponuka.`
		};

	const sirkaGridM = zaokruhliNahor(v.sirkaMm / 1000, MRIEZKA_ZZ.sirkaM);
	if (sirkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Šírka presahuje katalóg (max ${MRIEZKA_ZZ.sirkaM.max} m) — individuálna ponuka.`
		};

	const roofing = roofingPreZasklenie(v.zasklenie);
	const bunka = SEED.cennik[roofing]?.[k1(hlbkaGridM)]?.[k1(sirkaGridM)];
	if (!bunka)
		return {
			druh: 'individualna-ponuka',
			dovod: 'Kombinácia rozmeru a zasklenia nie je v katalógu — individuálna ponuka.'
		};

	return {
		druh: 'cena',
		model,
		hlbkaGridM,
		sirkaGridM,
		mo: zlozka(bunka[0]),
		vo: zlozka(bunka[1])
	};
}

// --------------------------------------------------------------------------- //
// Cena pre klienta podľa HLADINY (#318). MO = verejná/maloobchod (default); VO = veľkoobchod (LEN    //
// pre prihlásených b2b). VO sa NIKDY nedostane do MO/verejnej odpovede — o hladine rozhoduje server. //
// --------------------------------------------------------------------------- //

/**
 * Zmapuje interný výsledok (`CenaZzVysledok` s MO **aj** VO) na cenu pre klienta v danej HLADINE.
 * MO → maloobchod (verejná plocha bez náznaku VO); VO → veľkoobchod + explicitné `hladina:'VO'`
 * (LEN pre oprávneného b2b). `hlbkaGridM` nesie HĹBKOVÝ mriežkový rozmer, `sirkaGridM` šírkový —
 * grid-note v PDF (`cenaRiadky`) ich vykreslí ako „šírka × hĺbka" (zhodne so stránkou „Rozmery (š × h)").
 */
export function naCenuZz(v: CenaZzVysledok, model: ZzModel, hladina: CenovaHladina): VerejnaCena {
	const vo = hladina === 'VO' ? { hladina, hladinaLabel: VO_LABEL } : {};
	if (v.druh === 'individualna-ponuka')
		return { druh: 'individualna-ponuka', model, dovod: v.dovod, ...vo };
	const zl = hladina === 'VO' ? v.vo : v.mo;
	return {
		druh: 'cena',
		model,
		bezDph: zl.bezDph,
		sDph: zl.sDph,
		hlbkaGridM: v.hlbkaGridM,
		sirkaGridM: v.sirkaGridM,
		...vo
	};
}

/** Orientačná cena zimnej záhrady v danej hladine (jeden config). */
export function cenaPreZz(v: CenaZzVstup, hladina: CenovaHladina): VerejnaCena {
	const model = v.model ?? ZZ_MODEL_DEFAULT;
	return naCenuZz(vypocitajCenuZz({ ...v, model }), model, hladina);
}
