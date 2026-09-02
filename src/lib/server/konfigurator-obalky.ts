// Per-typ (oplotenie) / per-model (bazén) cenníkové ROZMEROVÉ OBÁLKY pre verejný konfigurátor (#427).
// SERVER-ONLY modul: odvodí obálku dostupnosti PRIAMO z cenníkových seedov (`cennik-oplotenie.json`,
// `cennik-bazen.json`) — bunka v seede je/nie je → hranice rozmerov, ktoré MAJÚ v katalógu orientačnú
// cenu. Seed je jediný zdroj pravdy, takže obálka nikdy nedriftne od reálnej cenotvorby (anti-drift
// sondu overuje `tests/konfigurator-obalky.test.ts` proti `vypocitajCenu*`).
//
// Money-neutrálny VÝSTUP: exportuje LEN rozmerové hranice v mm (žiadna cena, žiadny VO/MO údaj, žiadny
// Money kód, žiadna matica) — číta sa do `data.obalky` a klient z nej zobrazí „cenníkový rozsah". Modul
// je server-only ($lib/server/) — SvelteKit blokne jeho klientsky import a money-safety leak-guard (A)
// `KLIENT_ZAKAZANE_SPEC` (`/\/server\//`) ho stráži; do klientskeho bundle sa dostane iba odvodený
// číselný výstup cez `load`. NEIMPORTUJE ani nemení cenové moduly (`konfigurator-*-cena.ts`) — odvodenie
// je čisto nad dátovým seedom, takže NEKOLIDUJE s prípadným refaktorom vnútra cenových modulov.
import cennikOplotenieJson from './cennik-oplotenie.json';
import cennikBazenJson from './cennik-bazen.json';
import type { OplotenieTypKod } from '$lib/konfigurator-oplotenie';
import type { BazenModel } from '$lib/konfigurator-bazen';

/** Rozmerová hranica jednej osi (min/max rozmer S cenníkovou cenou), v mm. */
export interface RozmerHranica {
	/** najmenší rozmer s cenníkovou cenou [mm] */
	minMm: number;
	/** najväčší rozmer s cenníkovou cenou [mm] */
	maxMm: number;
}

/** Cenníková obálka oplotenieho typu (výška × šírka). */
export interface OplotenieObalka {
	vyska: RozmerHranica;
	sirka: RozmerHranica;
}

/** Cenníková obálka bazénového modelu (dĺžka × šírka; VÝŠKA nie je cenotvorná os, preto nie v obálke). */
export interface BazenObalka {
	dlzka: RozmerHranica;
	sirka: RozmerHranica;
}

// Seedy sú vnorené mapy s metrovými string kľúčmi; tu ich čítame len na odvodenie min/max PRÍTOMNÝCH
// rozmerových kľúčov (hodnoty buniek = ceny sa NEČÍTAJÚ). Presné vrstvenie kľúčov → žiadne `as` cast-y.
type SirkaMap = Record<string, unknown>; // šírkový kľúč → bunka (cena — nečítame ju)
type OplCennik = Record<string, Record<string, Record<string, SirkaMap>>>; // typ → model → výška → šírka
type BazenCennik = Record<string, Record<string, SirkaMap>>; // model → dĺžka → šírka

const OPL_SEED = (cennikOplotenieJson as { cennik: OplCennik }).cennik;
const BAZ_SEED = (cennikBazenJson as { cennik: BazenCennik }).cennik;

/** Prevedie metrový string kľúč seedu („2.0") na mm (2000). */
function mKlucNaMm(kluc: string): number {
	return Math.round(parseFloat(kluc) * 1000);
}

/** min/max z množiny hodnôt (prázdna → null). */
function hranica(hodnoty: number[]): RozmerHranica | null {
	if (hodnoty.length === 0) return null;
	return { minMm: Math.min(...hodnoty), maxMm: Math.max(...hodnoty) };
}

/** Odvodí obálku oplotenieho TYPU (únia rozmerov naprieč cenovými modelmi typu — obálka je per-typ
 *  model-nezávislá; ATYP nemá v seede bunky, preto medzi typmi nie je). Vráti null pri neznámom type. */
function odvodOplotenieObalku(typ: string): OplotenieObalka | null {
	const modelBloky = OPL_SEED[typ];
	if (!modelBloky) return null;
	const vysky = new Set<number>();
	const sirky = new Set<number>();
	for (const vyskaMap of Object.values(modelBloky)) {
		for (const [vKluc, sirkaMap] of Object.entries(vyskaMap)) {
			vysky.add(mKlucNaMm(vKluc));
			for (const sKluc of Object.keys(sirkaMap)) sirky.add(mKlucNaMm(sKluc));
		}
	}
	const v = hranica([...vysky]);
	const s = hranica([...sirky]);
	if (!v || !s) return null;
	return { vyska: v, sirka: s };
}

/** Odvodí obálku bazénového MODELU (dĺžka × šírka). Vráti null pri neznámom modeli. */
function odvodBazenObalku(model: string): BazenObalka | null {
	const dlzkaBloky = BAZ_SEED[model];
	if (!dlzkaBloky) return null;
	const dlzky = new Set<number>();
	const sirky = new Set<number>();
	for (const [dKluc, sirkaMap] of Object.entries(dlzkaBloky)) {
		dlzky.add(mKlucNaMm(dKluc));
		for (const sKluc of Object.keys(sirkaMap)) sirky.add(mKlucNaMm(sKluc));
	}
	const d = hranica([...dlzky]);
	const s = hranica([...sirky]);
	if (!d || !s) return null;
	return { dlzka: d, sirka: s };
}

function buildOplotenieObalky(): Record<OplotenieTypKod, OplotenieObalka> {
	const out = {} as Record<OplotenieTypKod, OplotenieObalka>;
	for (const typ of Object.keys(OPL_SEED)) {
		const o = odvodOplotenieObalku(typ);
		if (o) out[typ as OplotenieTypKod] = o;
	}
	return out;
}

function buildBazenObalky(): Record<BazenModel, BazenObalka> {
	const out = {} as Record<BazenModel, BazenObalka>;
	for (const model of Object.keys(BAZ_SEED)) {
		const o = odvodBazenObalku(model);
		if (o) out[model as BazenModel] = o;
	}
	return out;
}

/** Cenníkové obálky VŠETKÝCH oplotenieho typov (per-typ; ATYP nie je — je vždy individuálna ponuka). */
export const OPLOTENIE_OBALKY: Readonly<Record<OplotenieTypKod, OplotenieObalka>> =
	buildOplotenieObalky();

/** Cenníkové obálky VŠETKÝCH bazénových modelov (per-model — Premier/Star/Exclusive sa líšia šírkou). */
export const BAZEN_OBALKY: Readonly<Record<BazenModel, BazenObalka>> = buildBazenObalky();

/** Obálka pre daný oplotenie typ (undefined pri neznámom/ATYP-only). */
export function oplotenieObalka(typ: OplotenieTypKod): OplotenieObalka | undefined {
	return OPLOTENIE_OBALKY[typ];
}

/** Obálka pre daný bazénový model (undefined pri neznámom). */
export function bazenObalka(model: BazenModel): BazenObalka | undefined {
	return BAZEN_OBALKY[model];
}
