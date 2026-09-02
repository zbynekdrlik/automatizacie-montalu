// Interim cenotvorba bazénových zastrešení (#404) — SERVER-ONLY cenový modul. Lookup do vyťaženej
// matice montalu.sk (`cennik-bazen.json`, Fáza A) so zaokrúhlením rozmeru na katalógovú mriežku a
// obálkou dostupnosti. Mimo katalógu / nedostupná kombinácia ⇒ 'individualna-ponuka' (NIKDY
// neextrapoluje — nevymýšľa cenu).
//
// Zrkadlo pergolového `konfigurator-cena.ts`, parametrizované na bazénové osi: cena závisí od
// model × dĺžka × šírka (segments_length=standardna, bázová orientačná cena). NEZÁVISÍ od farby/
// koľaje/výšky/počtu segmentov/výplne (overené reverzným odvodením, viď design komentár #404).
//
// Money-neutrálny a mimo klientskeho bundle ($lib/server/): obsahuje interim PREDAJNÉ ceny prevzaté
// z verejného konfigurátora montalu.sk (montalu CENOVÉ kľúče PBPPP/PBSPP/PBEPP), NIE Money ERP kódy
// (moneyKod / BPK*/BPP* odpisové kódy). #318 hladina-aware (`naCenuBazen`/`cenaPreModelBazen`/
// `cenyModelovBazen`) — MO (default) pre neprihláseného/interného, VO LEN pre prihláseného
// veľkoobchodného; hladinu rozhoduje SERVER, VO sa do MO odpovede NIKDY nedostane. Čistý (bez DB/
// siete), priamo unit-testovateľný (parity: `tests/konfigurator-bazen-cena.test.ts`).
import { createHash } from 'node:crypto';
import cennikJson from './cennik-bazen.json';
import { BAZEN_MODELY, BAZEN_MODEL_DEFAULT } from '$lib/konfigurator-bazen';
import type { BazenModel } from '$lib/konfigurator-bazen';
import type { VerejnaCena, CenaModelu, CenovaHladina } from '$lib/konfigurator';

interface Mriezka {
	min: number;
	max: number;
	krok: number;
}

/** Bunka matice = [MO net, VO net] v EUR (bez DPH). */
type Bunka = [number, number];
/** šírkový kľúč ("4.0") → bunka */
type SirkaMap = Record<string, Bunka>;
/** dĺžkový kľúč ("6.0") → šírkový riadok */
type DlzkaMap = Record<string, SirkaMap>;
/** model → dĺžkový blok (nedostupné modely by chýbali) */
type CennikMap = Partial<Record<BazenModel, DlzkaMap>>;

interface CennikSeed {
	meta: {
		zdroj: string;
		vytazene: string;
		dph: number;
		rodina: string;
		segmentsLength: string;
		poznamka: string;
		mriezka: { dlzkaM: Mriezka; sirkaM: Mriezka };
	};
	modely: Record<BazenModel, string>;
	cennik: CennikMap;
	verifikaciaDph: Array<{
		model: BazenModel;
		dlzkaM: number;
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
const CENNIK_HASH = createHash('sha256')
	.update(
		JSON.stringify({
			cennik: SEED.cennik,
			dph: SEED.meta.dph,
			mriezka: SEED.meta.mriezka
		})
	)
	.digest('hex')
	.slice(0, 12);

/** Verzia bazénového cenníka pri opečiatkovaní ceny (#309) — čas vyťaženia + obsahový hash. */
export const CENNIK_VERZIA_BAZEN = `${SEED.meta.vytazene}#${CENNIK_HASH}`;

/** Sadzba DPH (0,23) prevzatá zo seedu — jeden zdroj pravdy. */
export const DPH_BAZEN = SEED.meta.dph;
/** Katalógová mriežka (metre). */
export const MRIEZKA_BAZEN = SEED.meta.mriezka;

const EPS = 1e-9;
/** DPH ako celé percentá (23) — na EXAKTNÚ celocentovú aritmetiku (bez FP driftu). */
const DPH_PCT = Math.round(DPH_BAZEN * 100);

/** Zaokrúhli EUR sumu na 2 desatiny (celé centy). */
function eur2(net: number): number {
	return Math.round(net * 100) / 100;
}

/** Suma s DPH v EUR = round(net × (1 + DPH), 2), počítané v celých centoch, aby sa presne (bez FP
 *  driftu na .xx5 hraniciach) zhodovalo s PHP `round()` na montalu.sk. Overené proti reálnym montalu
 *  reťazcom (`verifikaciaDph` v seede). */
function sDphEur(net: number): number {
	const centy = Math.round(net * 100);
	return Math.round((centy * (100 + DPH_PCT)) / 100) / 100;
}

export interface CenaBazenVstup {
	/** dĺžka zastrešenia (pozdĺž bazéna) [mm] → montalu `length` */
	dlzkaMm: number;
	/** šírka zastrešenia [mm] → montalu `width` */
	sirkaMm: number;
	/** model bazénového zastrešenia — default Premier */
	model?: BazenModel;
}

interface CenaZlozka {
	bezDph: number;
	sDph: number;
}

export interface CenaBazenOk {
	druh: 'cena';
	model: BazenModel;
	/** dĺžka po zaokrúhlení na mriežku [m] */
	dlzkaGridM: number;
	/** šírka po zaokrúhlení na mriežku [m] */
	sirkaGridM: number;
	/** maloobchod (MO) */
	mo: CenaZlozka;
	/** veľkoobchod (VO/B2B) */
	vo: CenaZlozka;
}

export interface CenaBazenIndividualna {
	druh: 'individualna-ponuka';
	dovod: string;
}

export type CenaBazenVysledok = CenaBazenOk | CenaBazenIndividualna;

/** Zaokrúhli hodnotu [m] na NAJBLIŽŠÍ bod katalógovej mriežky (krok 0,5 m; zhoda so montalu length
 *  round-nearest, a keďže enumerujeme presne v 0,5 m bodoch, je exaktné pre naše mriežkové vstupy).
 *  Pod minimum ⇒ minimum (prilepí sa, montalu tiež klampuje). Nad maximum ⇒ null (mimo katalógu →
 *  individuálna ponuka). */
export function zaokruhliNaMriezku(hodnotaM: number, m: Mriezka): number | null {
	if (!Number.isFinite(hodnotaM)) return null;
	if (hodnotaM <= m.min) return m.min;
	if (hodnotaM > m.max + EPS) return null;
	const g = Math.round(hodnotaM / m.krok) * m.krok;
	const gr = Math.round(g * 100) / 100;
	// zaokrúhlenie nahor cez max (napr. 14,8 → 15,0) je stále v katalógu; nad max → null (vetva vyššie).
	return gr <= m.max + EPS ? gr : m.max;
}

const k1 = (m: number) => m.toFixed(1);

function zlozka(net: number): CenaZlozka {
	return { bezDph: eur2(net), sDph: sDphEur(net) };
}

/**
 * Vypočíta interim predajnú cenu bazénového zastrešenia (MO + VO, net + s DPH) lookupom do matice
 * montalu.sk. Rozmer sa zaokrúhli na mriežku; nedostupná kombinácia model×rozmer alebo mimo katalógu
 * ⇒ 'individualna-ponuka' (NIKDY neextrapoluje).
 */
export function vypocitajCenuBazen(v: CenaBazenVstup): CenaBazenVysledok {
	const model = v.model ?? BAZEN_MODEL_DEFAULT;

	// Nekladný/neplatný rozmer nesmie ticho spadnúť na katalógové minimum — obranná hranica pre
	// budúcich volateľov (verejný vstup je validovaný v `konfigurator-bazen-vstup.ts`).
	if (!(v.dlzkaMm > 0) || !(v.sirkaMm > 0))
		return { druh: 'individualna-ponuka', dovod: 'Neplatný rozmer (musí byť > 0).' };

	const dlzkaGridM = zaokruhliNaMriezku(v.dlzkaMm / 1000, MRIEZKA_BAZEN.dlzkaM);
	if (dlzkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Dĺžka presahuje katalóg (max ${MRIEZKA_BAZEN.dlzkaM.max} m) — individuálna ponuka.`
		};

	const sirkaGridM = zaokruhliNaMriezku(v.sirkaMm / 1000, MRIEZKA_BAZEN.sirkaM);
	if (sirkaGridM === null)
		return {
			druh: 'individualna-ponuka',
			dovod: `Šírka presahuje katalóg (max ${MRIEZKA_BAZEN.sirkaM.max} m) — individuálna ponuka.`
		};

	const bunka = SEED.cennik[model]?.[k1(dlzkaGridM)]?.[k1(sirkaGridM)];
	if (!bunka)
		return {
			druh: 'individualna-ponuka',
			dovod: 'Kombinácia modelu a rozmeru nie je v katalógu — individuálna ponuka.'
		};

	return {
		druh: 'cena',
		model,
		dlzkaGridM,
		sirkaGridM,
		mo: zlozka(bunka[0]),
		vo: zlozka(bunka[1])
	};
}

// --------------------------------------------------------------------------- //
// Cena pre klienta podľa HLADINY (#318). MO = verejná/maloobchod (default); VO = veľkoobchod (LEN    //
// pre prihlásených b2b). VO sa NIKDY nedostane do MO/verejnej odpovede — o hladine rozhoduje server. //
// --------------------------------------------------------------------------- //

/** Server-dodaný VO label — text hladiny sa NEsmie hardkódovať v klientskom komponente. Server ho
 *  pošle LEN pri VO výstupe; klient renderuje `cena.hladinaLabel`. */
const VO_LABEL = 'veľkoobchodná cena';

/**
 * Zmapuje interný výsledok (`CenaBazenVysledok` s MO **aj** VO) na cenu pre klienta v danej HLADINE.
 * MO → maloobchod (verejná plocha bez náznaku VO); VO → veľkoobchod + explicitné `hladina:'VO'`
 * (LEN pre oprávneného b2b). `hlbkaGridM` nesie DĹŽKOVÝ mriežkový rozmer, `sirkaGridM` šírkový —
 * `VerejnaCena` je zdieľaný typ (pôvodne pergolový); pre bazén grid-note nevykreslíme (rozmery sú už
 * na mriežke — cfg.hlbka undefined → guard v renderi ho potlačí).
 */
export function naCenuBazen(
	v: CenaBazenVysledok,
	model: BazenModel,
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
		hlbkaGridM: v.dlzkaGridM,
		sirkaGridM: v.sirkaGridM,
		...vo
	};
}

/** Cena pre JEDEN model bazéna v danej hladine. Default model Premier. */
export function cenaPreModelBazen(v: CenaBazenVstup, hladina: CenovaHladina): VerejnaCena {
	const model = v.model ?? BAZEN_MODEL_DEFAULT;
	return naCenuBazen(vypocitajCenuBazen({ ...v, model }), model, hladina);
}

/** Ceny VŠETKÝCH modelov (Premier/Star/Exclusive) pre daný rozmer v danej hladine — zrkadlo
 *  montalu.sk „ceny modelov vedľa seba". */
export function cenyModelovBazen(
	dlzkaMm: number,
	sirkaMm: number,
	hladina: CenovaHladina
): CenaModelu[] {
	return BAZEN_MODELY.map((m) => ({
		model: m.kod,
		cena: cenaPreModelBazen({ dlzkaMm, sirkaMm, model: m.kod }, hladina)
	}));
}
