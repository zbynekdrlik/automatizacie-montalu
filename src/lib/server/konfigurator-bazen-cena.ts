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
// (Money kód / kusové-metrážové odpisové kódy). #318 hladina-aware (`naCenuBazen`/`cenaPreModelBazen`/
// `cenyModelovBazen`) — MO (default) pre neprihláseného/interného, VO LEN pre prihláseného
// veľkoobchodného; hladinu rozhoduje SERVER, VO sa do MO odpovede NIKDY nedostane. Čistý (bez DB/
// siete), priamo unit-testovateľný (parity: `tests/konfigurator-bazen-cena.test.ts`).
import cennikJson from './cennik-bazen.json';
import { EPS, VO_LABEL, cennikHash, dphNaPct, zlozka as zlozkaSpolocna } from './cennik-spolocne';
import type { CenaZlozka, Mriezka } from './cennik-spolocne';
import { BAZEN_MODELY, BAZEN_MODEL_DEFAULT } from '$lib/konfigurator-bazen';
import type { BazenModel } from '$lib/konfigurator-bazen';
import type { VerejnaCena, CenaModelu, CenovaHladina } from '$lib/konfigurator';

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
const CENNIK_HASH = cennikHash({
	cennik: SEED.cennik,
	dph: SEED.meta.dph,
	mriezka: SEED.meta.mriezka
});

/** Verzia bazénového cenníka pri opečiatkovaní ceny (#309) — čas vyťaženia + obsahový hash. */
export const CENNIK_VERZIA_BAZEN = `${SEED.meta.vytazene}#${CENNIK_HASH}`;

/** Sadzba DPH (0,23) prevzatá zo seedu — jeden zdroj pravdy. */
export const DPH_BAZEN = SEED.meta.dph;
/** Katalógová mriežka (metre). */
export const MRIEZKA_BAZEN = SEED.meta.mriezka;

/** DPH bazéna v celých percentách (23) — pre zdieľanú `sDphEur`/`zlozka` (celocentová aritmetika,
 *  `cennik-spolocne`). */
const DPH_PCT = dphNaPct(DPH_BAZEN);

export interface CenaBazenVstup {
	/** dĺžka zastrešenia (pozdĺž bazéna) [mm] → montalu `length` */
	dlzkaMm: number;
	/** šírka zastrešenia [mm] → montalu `width` */
	sirkaMm: number;
	/** model bazénového zastrešenia — default Premier */
	model?: BazenModel;
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

/** Zaokrúhli hodnotu [m] na NAJBLIŽŠÍ bod katalógovej mriežky (krok 0,5 m). Seed enumerujeme PRESNE
 *  v 0,5 m bodoch, takže pre hodnoty NA mriežke (naše steppery krokujú tlačidlami po 500 mm) je lookup
 *  EXAKTNÝ. Pre mimo-mriežkové vstupy (metrový textový stepper píše na 100 mm mriežku, `parseMetreNaMm`)
 *  sa hodnota prilepí na najbližší 0,5 m bod — montalu length zaokrúhľuje na najbližší, width floorom na
 *  0,25, takže off-grid hodnota je APROXIMÁCIA (nie doslovné zrkadlo montalu.sk pre daný presný rozmer);
 *  smer je preto skôr NADhodnotenie (bezpečné pre ORIENTAČNÚ cenu — nezaskočí nižšou definitívnou).
 *  Pod minimum ⇒ minimum (prilepí sa, montalu tiež klampuje). Nad maximum ⇒ null (mimo katalógu →
 *  individuálna ponuka). */
export function zaokruhliNaMriezku(hodnotaM: number, m: Mriezka): number | null {
	if (!Number.isFinite(hodnotaM)) return null;
	if (hodnotaM <= m.min) return m.min;
	if (hodnotaM > m.max + EPS) return null;
	// v rozsahu (min, max] → najbližší bod mriežky nikdy neprekročí max (max je sám na mriežke).
	return Math.round(Math.round(hodnotaM / m.krok) * m.krok * 100) / 100;
}

const k1 = (m: number) => m.toFixed(1);

/** Cenová zložka {bezDph, sDph} bazéna — tenký obal nad zdieľanou `zlozka` s DPH_PCT bazéna. */
function zlozka(net: number): CenaZlozka {
	return zlozkaSpolocna(net, DPH_PCT);
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
