// Interim cenotvorba hliníkového oplotenia a brán (#410) — SERVER-ONLY cenový modul. Lookup do
// vyťaženej matice montalu.sk (`cennik-oplotenie.json`, Fáza A) so zaokrúhlením rozmeru na katalógovú
// mriežku a per-typ obálkou dostupnosti. Mimo katalógu / na mieru (ATYP) ⇒ 'individualna-ponuka'
// (NIKDY neextrapoluje — nevymýšľa cenu).
//
// Zrkadlo bazénového `konfigurator-bazen-cena.ts`, parametrizované na oplotenie osi: cena závisí od
// typ prvku × model výplne × výška × šírka, NÁSOBENÁ počtom kusov (lineárne). NEZÁVISÍ od farby ani
// warranty (overené reverzným odvodením, viď design komentár #410). Seed nesie cenu za JEDEN kus
// (count=1); počet násobí tento modul.
//
// Money-neutrálny a mimo klientskeho bundle ($lib/server/): obsahuje interim PREDAJNÉ ceny prevzaté
// z verejného konfigurátora montalu.sk (montalu CENOVÉ kľúče modelov), NIE Money ERP kódy (Money kód /
// kusové-metrážové odpisové kódy). #318 hladina-aware (`naCenuOplotenie`/`cenaPreModelOplotenie`/
// `cenyModelovOplotenie`) — MO (default) pre neprihláseného/interného, VO LEN pre prihláseného
// veľkoobchodného; hladinu rozhoduje SERVER, VO sa do MO odpovede NIKDY nedostane. Čistý (bez DB/
// siete), priamo unit-testovateľný (parity: `tests/konfigurator-oplotenie-cena.test.ts`).
import cennikJson from './cennik-oplotenie.json';
import { EPS, VO_LABEL, cennikHash, dphNaPct, zlozka as zlozkaSpolocna } from './cennik-spolocne';
import type { CenaZlozka, Mriezka } from './cennik-spolocne';
import {
	OPLOTENIE_MODELY,
	OPLOTENIE_MODEL_DEFAULT,
	OPLOTENIE_POCET_MIN,
	OPLOTENIE_POCET_MAX,
	oplotenieTyp,
	oplotenieModel
} from '$lib/konfigurator-oplotenie';
import type { OplotenieTypKod, OplotenieModel } from '$lib/konfigurator-oplotenie';
import type { VerejnaCena, CenaModelu, CenovaHladina } from '$lib/konfigurator';
import type { PonukaConfig } from '$lib/ponuka';

/** Bunka matice = [MO net, VO net] v EUR za JEDEN KUS (bez DPH). */
type Bunka = [number, number];
/** šírkový kľúč ("4.0") → bunka */
type SirkaMap = Record<string, Bunka>;
/** výškový kľúč ("1.8") → šírkový riadok */
type VyskaMap = Record<string, SirkaMap>;
/** model → výškový blok */
type ModelMap = Partial<Record<OplotenieModel, VyskaMap>>;
/** typ prvku → modelový blok */
type CennikMap = Partial<Record<OplotenieTypKod, ModelMap>>;

interface CennikSeed {
	meta: {
		zdroj: string;
		vytazene: string;
		dph: number;
		rodina: string;
		poznamka: string;
		mriezka: { vyskaM: Mriezka; sirkaM: Mriezka };
	};
	typy: Record<string, string>;
	modely: Record<string, string>;
	cennik: CennikMap;
	verifikaciaDph: Array<{
		typ: OplotenieTypKod;
		model: OplotenieModel;
		vyskaM: number;
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

/** Verzia oplotenieho cenníka pri opečiatkovaní ceny (#309) — čas vyťaženia + obsahový hash. */
export const CENNIK_VERZIA_OPLOTENIE = `${SEED.meta.vytazene}#${CENNIK_HASH}`;

/** Sadzba DPH (0,23) prevzatá zo seedu — jeden zdroj pravdy. */
export const DPH_OPLOTENIE = SEED.meta.dph;
/** Katalógová mriežka (metre). */
export const MRIEZKA_OPLOTENIE = SEED.meta.mriezka;

/** Cenové modely (bez ATYP — ten je oplotenie na mieru, žiadna montalu cena). */
export const OPLOTENIE_CENOVE_MODELY: readonly OplotenieModel[] = OPLOTENIE_MODELY.filter(
	(m) => m.kod !== 'ATYP'
).map((m) => m.kod);

/** DPH oplotenia v celých percentách (23) — pre zdieľanú `sDphEur`/`zlozka` (celocentová aritmetika,
 *  `cennik-spolocne`). */
const DPH_PCT = dphNaPct(DPH_OPLOTENIE);

export interface CenaOplotenieVstup {
	/** typ prvku (plotový diel / brána / bránka) */
	typ: OplotenieTypKod;
	/** model výplne — default ARIEL */
	model?: OplotenieModel;
	/** výška prvku [mm] → montalu `height` */
	vyskaMm: number;
	/** šírka prvku [mm] → montalu `width` */
	sirkaMm: number;
	/** počet kusov (celé číslo ≥ 1) — cena je lineárna, seed je za 1 kus */
	pocet: number;
}

export interface CenaOplotenieOk {
	druh: 'cena';
	model: OplotenieModel;
	/** výška po zaokrúhlení na mriežku [m] */
	vyskaGridM: number;
	/** šírka po zaokrúhlení na mriežku [m] */
	sirkaGridM: number;
	/** počet kusov (cena je za všetky) */
	pocet: number;
	/** maloobchod (MO) — CELKOM za `pocet` kusov */
	mo: CenaZlozka;
	/** veľkoobchod (VO/B2B) — CELKOM za `pocet` kusov */
	vo: CenaZlozka;
}

export interface CenaOplotenieIndividualna {
	druh: 'individualna-ponuka';
	dovod: string;
}

export type CenaOplotenieVysledok = CenaOplotenieOk | CenaOplotenieIndividualna;

/** Zaokrúhli hodnotu [m] na NAJBLIŽŠÍ bod katalógovej mriežky. Seed enumerujeme PRESNE v bodoch
 *  mriežky (výška krok 0,1 m, šírka krok 0,5 m). VÝŠKA je vždy na mriežke (stepper krok 100 mm = 0,1 m)
 *  → lookup EXAKTNÝ. ŠÍRKA: metrový stepper píše na 100 mm mriežku (`parseMetreNaMm`), ale naša cenová
 *  mriežka je 0,5 m, takže LEGITÍMNY vstup mimo 0,5 m (napr. 2,3 m) sa prilepí na NAJBLIŽŠÍ bod (2,3 → 2,5;
 *  2,2 → 2,0) — teda APROXIMÁCIA, ktorá môže cenu mierne PODhodnotiť aj NADhodnotiť (nie je to „forged"
 *  ani vždy nadhodnotenie). Preto stránka aj PDF zobrazia „katalógový rozmer …" poznámku, keď sa
 *  zaokrúhlená šírka líši od zadanej (`cenaRiadky` v `ponuka-pdf`, on-page note v `+page.svelte`). Pod
 *  minimum ⇒ minimum; nad maximum ⇒ null (mimo katalógu → individuálna ponuka). Bunky sú v katalógovej
 *  obálke daného typu — mimo obálky bunka v seede CHÝBA (individuálna ponuka), aj keď je rozmer v mriežke. */
export function zaokruhliNaMriezku(hodnotaM: number, m: Mriezka): number | null {
	if (!Number.isFinite(hodnotaM)) return null;
	if (hodnotaM <= m.min) return m.min;
	if (hodnotaM > m.max + EPS) return null;
	// v rozsahu (min, max] → najbližší bod mriežky nikdy neprekročí max (max je sám na mriežke).
	return Math.round(Math.round(hodnotaM / m.krok) * m.krok * 100) / 100;
}

const k1 = (m: number) => m.toFixed(1);

/** Cenová zložka {bezDph, sDph} oplotenia — tenký obal nad zdieľanou `zlozka` s DPH_PCT oplotenia. */
function zlozka(net: number): CenaZlozka {
	return zlozkaSpolocna(net, DPH_PCT);
}

/**
 * Vypočíta interim predajnú cenu oplotenieho prvku (MO + VO, net + s DPH) lookupom do matice
 * montalu.sk. Rozmer sa zaokrúhli na mriežku; cena za 1 kus sa NÁSOBÍ počtom (lineárne). Model ATYP
 * (na mieru), nedostupná kombinácia typ×model×rozmer alebo mimo katalógu ⇒ 'individualna-ponuka'
 * (NIKDY neextrapoluje).
 */
export function vypocitajCenuOplotenie(v: CenaOplotenieVstup): CenaOplotenieVysledok {
	const model = v.model ?? OPLOTENIE_MODEL_DEFAULT;

	// ATYP = oplotenie/výplň na mieru — montalu ho v cenníku nemá; nevymýšľame cenu.
	if (model === 'ATYP')
		return {
			druh: 'individualna-ponuka',
			dovod: 'Oplotenie na mieru (ATYP) — pripravíme individuálnu ponuku.'
		};

	// Počet MUSÍ byť v rozmedzí — NIKDY ho ticho neklampuj na 1 (forged veľký počet by inak
	// opečiatkoval absurdnú cenu do DB/PDF; klientom-forgeovateľná POST `konfiguracia` ho nesie).
	if (!Number.isInteger(v.pocet) || v.pocet < OPLOTENIE_POCET_MIN || v.pocet > OPLOTENIE_POCET_MAX)
		return {
			druh: 'individualna-ponuka',
			dovod: `Počet kusov musí byť ${OPLOTENIE_POCET_MIN}–${OPLOTENIE_POCET_MAX}.`
		};
	const pocet = v.pocet;

	// Nekladný/neplatný rozmer nesmie ticho spadnúť na katalógové minimum — obranná hranica pre
	// budúcich volateľov (verejný vstup je validovaný v `konfigurator-oplotenie-vstup.ts`).
	if (!(v.vyskaMm > 0) || !(v.sirkaMm > 0))
		return { druh: 'individualna-ponuka', dovod: 'Neplatný rozmer (musí byť > 0).' };

	const vyskaGridM = zaokruhliNaMriezku(v.vyskaMm / 1000, MRIEZKA_OPLOTENIE.vyskaM);
	if (vyskaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Výška presahuje katalóg (max ${MRIEZKA_OPLOTENIE.vyskaM.max} m) — individuálna ponuka.`
		};

	const sirkaGridM = zaokruhliNaMriezku(v.sirkaMm / 1000, MRIEZKA_OPLOTENIE.sirkaM);
	if (sirkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Šírka presahuje katalóg (max ${MRIEZKA_OPLOTENIE.sirkaM.max} m) — individuálna ponuka.`
		};

	const bunka = SEED.cennik[v.typ]?.[model]?.[k1(vyskaGridM)]?.[k1(sirkaGridM)];
	if (!bunka)
		return {
			druh: 'individualna-ponuka',
			dovod: 'Kombinácia typu, modelu a rozmeru nie je v katalógu — individuálna ponuka.'
		};

	return {
		druh: 'cena',
		model,
		vyskaGridM,
		sirkaGridM,
		pocet,
		mo: zlozka(bunka[0] * pocet),
		vo: zlozka(bunka[1] * pocet)
	};
}

// --------------------------------------------------------------------------- //
// Cena pre klienta podľa HLADINY (#318). MO = verejná/maloobchod (default); VO = veľkoobchod (LEN    //
// pre prihlásených b2b). VO sa NIKDY nedostane do MO/verejnej odpovede — o hladine rozhoduje server. //
// --------------------------------------------------------------------------- //

/**
 * Zmapuje interný výsledok (`CenaOplotenieVysledok` s MO **aj** VO) na cenu pre klienta v danej HLADINE.
 * MO → maloobchod (verejná plocha bez náznaku VO); VO → veľkoobchod + explicitné `hladina:'VO'`
 * (LEN pre oprávneného b2b). `hlbkaGridM` nesie VÝŠKOVÝ mriežkový rozmer, `sirkaGridM` šírkový —
 * `VerejnaCena` je zdieľaný typ (pôvodne pergolový). POZOR: `cenaRiadky` v `ponuka-pdf` vykreslí
 * „katalógový rozmer š × h" poznámku, KEĎ sa zaokrúhlená ŠÍRKA líši od zadanej (druhý rozmer
 * `cfg.hlbka ?? cfg.dlzka` je pri oplotení undefined, ale mismatch šírky sám poznámku spustí) — čísla
 * sú správne (`sirkaGridM` × `hlbkaGridM` = šírka × výška), label „š × h" je len zdieľaný pergolový text.
 */
export function naCenuOplotenie(
	v: CenaOplotenieVysledok,
	model: OplotenieModel,
	hladina: CenovaHladina
): VerejnaCena {
	const vo = hladina === 'VO' ? { hladina, hladinaLabel: VO_LABEL } : {};
	if (v.druh === 'individualna-ponuka')
		return { druh: 'individualna-ponuka', model, dovod: v.dovod, ...vo };
	const zl = hladina === 'VO' ? v.vo : v.mo;
	return {
		druh: 'cena',
		model,
		bezDph: zl.bezDph,
		sDph: zl.sDph,
		hlbkaGridM: v.vyskaGridM,
		sirkaGridM: v.sirkaGridM,
		...vo
	};
}

/** Cena pre JEDEN model oplotenia v danej hladine. Default model ARIEL. */
export function cenaPreModelOplotenie(v: CenaOplotenieVstup, hladina: CenovaHladina): VerejnaCena {
	const model = v.model ?? OPLOTENIE_MODEL_DEFAULT;
	return naCenuOplotenie(vypocitajCenuOplotenie({ ...v, model }), model, hladina);
}

/** Ceny VŠETKÝCH cenových modelov (ARIEL…REA; ATYP je vždy individuálny, do porovnania nepatrí) pre
 *  daný typ/rozmer/počet v danej hladine — zrkadlo montalu.sk „ceny modelov vedľa seba". */
export function cenyModelovOplotenie(
	typ: OplotenieTypKod,
	vyskaMm: number,
	sirkaMm: number,
	pocet: number,
	hladina: CenovaHladina
): CenaModelu[] {
	return OPLOTENIE_CENOVE_MODELY.map((model) => ({
		model,
		cena: cenaPreModelOplotenie({ typ, model, vyskaMm, sirkaMm, pocet }, hladina)
	}));
}

/** #410: orientačná cena oplotenia z `PonukaConfig` (dispatch z `dopyt-cena-stamp.cenaZCfgProdukt`).
 *  Cenotvorný kľúč je v NEUTRÁLNOM poli `systemKod = "${typKod}|${model}|${vyskaMm}|${pocet}"`
 *  (deterministicky uložený v cfg → reprodukovateľný pri re-downloade; typKod/model neobsahujú `|`),
 *  šírka v `cfg.sirka`. Bez `systemKod` (starý neopečiatkovaný oplotenie riadok) alebo pri chýbajúcej
 *  šírke → `null` (honest-degrade — starému honest-null oplotenie dopytu sa ticho nepriradí cena). */
export function cenaOplotenieZCfg(
	cfg: PonukaConfig,
	hladina: CenovaHladina = 'MO'
): VerejnaCena | null {
	if (!cfg.systemKod || !(cfg.sirka && cfg.sirka > 0)) return null;
	const [typRaw, modelRaw, vyskaRaw, pocetRaw] = cfg.systemKod.split('|');
	if (modelRaw === undefined || vyskaRaw === undefined) return null;
	const vyskaMm = Number(vyskaRaw);
	if (!(vyskaMm > 0)) return null;
	// Počet z (forgeovateľného) systemKod musí byť platné celé číslo v rozmedzí — inak honest-null
	// (NIKDY neklampuj na 1: forged veľký počet by opečiatkoval absurdnú cenu do DB/PDF).
	const pocet = Number(pocetRaw);
	if (!Number.isInteger(pocet) || pocet < OPLOTENIE_POCET_MIN || pocet > OPLOTENIE_POCET_MAX)
		return null;
	return cenaPreModelOplotenie(
		{
			typ: oplotenieTyp(typRaw),
			model: oplotenieModel(modelRaw),
			vyskaMm,
			sirkaMm: cfg.sirka,
			pocet
		},
		hladina
	);
}
