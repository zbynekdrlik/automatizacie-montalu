// Zdieľaný cenový LEAF interim cenových modulov (#426/#428) — Money-kritická DPH/mriežková
// aritmetika na JEDNOM mieste. Pergola (`konfigurator-cena.ts`, #279), bazén
// (`konfigurator-bazen-cena.ts`, #404), zimná záhrada (`konfigurator-zimna-zahrada-cena.ts`, #408) a
// oplotenie (`konfigurator-oplotenie-cena.ts`, #410) doteraz nesli VLASTNÚ (byte-identickú) kópiu —
// triplikácia (dnes kvadruplikácia) pozývala tichý drift (oprava/regenerácia v jednom module,
// zabudnutá v druhom). Extrakcia je ČISTO ŠTRUKTURÁLNA: parity kotvy všetkých 4 modulov (vrátane
// .xx5 DPH hraníc) ostávajú zelené a byte-identické — žiadna zmena jedinej ceny.
//
// LEAF s NULOVÝMI internými importmi (iba `node:crypto`) — cenové moduly ho importujú jednosmerne
// (acyklický graf, vzor `large-file-split.md` „Pure functions: a layered façade split", #249).
// Zaokrúhlenie NA mriežku (`zaokruhliNahor`/`zaokruhliNaMriezku`) je per-produkt RÔZNE (pergola/zimná
// záhrada NAHOR vs bazén/oplotenie najbližší bod) — ostáva PER-MODUL, zdieľa sa LEN DPH/EUR aritmetika
// + hash + label. Money-neutrálny (čistá aritmetika, žiadny Money kód) a mimo klientskeho bundle
// (`$lib/server/`).
import { createHash } from 'node:crypto';

/** Katalógová mriežka rozmeru [m]: hranice min/max + krok. Zdieľaná naprieč všetkými interim
 *  cenovými modulmi. */
export interface Mriezka {
	min: number;
	max: number;
	krok: number;
}

/** Cenová zložka pre klienta: cena bez DPH [EUR] + cena s DPH [EUR], obe na 2 desatiny (celé centy). */
export interface CenaZlozka {
	/** cena bez DPH [EUR] */
	bezDph: number;
	/** cena s DPH [EUR] = round(bezDph × (1 + DPH), 2) */
	sDph: number;
}

/** Malá tolerancia pre porovnania rozmerov na mriežke (FP). */
export const EPS = 1e-9;

/** Server-dodaný VO label (#318): text hladiny sa NEsmie hardkódovať v klientskom komponente (inak by
 *  verejný bundle niesol VO literál = náznak VO hladiny). Server ho pošle LEN pri VO výstupe; klient
 *  renderuje `cena.hladinaLabel` bez vlastného VO reťazca. */
export const VO_LABEL = 'veľkoobchodná cena';

/** Zaokrúhli EUR sumu na 2 desatiny (celé centy). */
export function eur2(net: number): number {
	return Math.round(net * 100) / 100;
}

/** DPH ako celé percentá z desatinnej sadzby (0,23 → 23) — na EXAKTNÚ celocentovú aritmetiku (bez FP
 *  driftu). */
export function dphNaPct(dph: number): number {
	return Math.round(dph * 100);
}

/** Suma s DPH v EUR = round(net × (1 + DPH), 2), počítané v celých centoch, aby sa presne (bez FP
 *  driftu na .xx5 hraniciach) zhodovalo s PHP `round()` na montalu.sk. `dphPct` = DPH v celých
 *  percentách (23). Money-kritická — zrkadlí PHP `round()` vrátane .xx5 hraníc. */
export function sDphEur(net: number, dphPct: number): number {
	const centy = Math.round(net * 100);
	return Math.round((centy * (100 + dphPct)) / 100) / 100;
}

/** Cenová zložka {bezDph, sDph} pri danej DPH sadzbe (`dphPct` = celé percentá). */
export function zlozka(net: number, dphPct: number): CenaZlozka {
	return { bezDph: eur2(net), sDph: sDphEur(net, dphPct) };
}

/** Obsahový hash CENOTVORNÝCH častí seedu (12 hex znakov zo sha256) — zmení sa pri AKOMKOĽVEK cenovom
 *  drifte (aj ručnej úprave bez zmeny `vytazene`). Volateľ vloží presne tie časti seedu, ktoré tvoria
 *  cenu (matica + [príplatky] + dph + mriezka). Časová značka `vytazene` sama nestačí ako verzia (je len
 *  metadáta a mení sa aj bez zmeny cien). */
export function cennikHash(cenotvorne: unknown): string {
	return createHash('sha256').update(JSON.stringify(cenotvorne)).digest('hex').slice(0, 12);
}
