// Cena strešného skla pergoly (#223) — DISPLAY-ONLY z Money cenníka IZOS cez denný snapshot
// cien (#154/#235). Money ODPIS skla sa tým NEMENÍ — strešné sklo je v pergole informatívne
// (žiadny Money zápis; guard `tests/pergola-narez-money-safety.test.ts`). Počíta sa jednotková
// €/m² (`eurM2`) A — odkedy je dĺžka tabule potvrdená (Dominik 2.9.) — aj CELKOVÁ cena skiel
// (`cenaSpolu` = celková plocha × €/m²), čo je Palohova pôvodná požiadavka „aby to tam
// započítalo aj ceny skiel v streche".
//
// Honest-null: typ nezvolený → `null`; typ bez potvrdeného TS kódu (8 zo 14 typov, A2/#235)
// alebo kód bez ceny v snapshote → `eurM2 = null` („cena nedostupná"), NIKDY sa nedopočítava
// z odhadu a NIKDY sa nehádže kód; keď chýba €/m² alebo plocha (honest-null dĺžka pri neoverenej
// kotve) → `cenaSpolu = null`. Gate na interných je na úrovni route (rovnako ako `cenyPre`/
// `skloCenaPre`) — tento modul cenu len počíta.
import { skloStrechaMoneyKod } from '$lib/sklo-strecha';
import { cenaZaM2, getSnapshotMeta, type SnapshotMeta } from './ceny';

/** zaokrúhlenie na 2 desatinné (€/m² aj celková cena) */
const R2 = (x: number) => Math.round(x * 100) / 100;

export interface StrechaSkloCena {
	/** zvolený typ strešného skla (kanonický katalógový názov) */
	typ: string;
	/** Money TS kód (cenník IZOS) alebo `null` = žiadny potvrdený kód → „karta v Money neexistuje" */
	moneyKod: string | null;
	/** €/m² zo snapshotu; `null` = nedostupná (typ bez kódu, alebo kód bez ceny v snapshote) */
	eurM2: number | null;
	/** celková cena skiel = celková plocha [m²] × €/m²; `null` keď €/m² alebo plocha chýba */
	cenaSpolu: number | null;
	/** mena (IZOS je EUR-only, ale nesieme ju z ceny pre konzistenciu) */
	mena: string;
	/** vek snapshotu pre UI (rovnako ako `skloCenaPre`) */
	snapshot: SnapshotMeta;
}

/**
 * Cena strešného skla pre zvolený typ. `null` keď typ nie je zvolený. Money kód =
 * `skloStrechaMoneyKod(typ)` (katalóg #274); €/m² = `cenaZaM2(kod)` zo snapshotu. Keď je zadaná
 * `plochaCelkomM2` (celková plocha tabúľ z `spocitajStrechaSklo`) a €/m² existuje, doráta
 * `cenaSpolu = plochaCelkomM2 × €/m²`; keď €/m²/plocha chýba → `cenaSpolu = null` (honest-null).
 * Volá sa LEN pre interných (gate na route). Money ODPIS skla sa NEROBÍ.
 */
export function strechaSkloCenaPre(
	typ: string | null,
	plochaCelkomM2: number | null = null
): StrechaSkloCena | null {
	const t = (typ ?? '').trim();
	if (!t) return null;
	const snapshot = getSnapshotMeta(); // spustí lazy import + vráti vek snapshotu pre UI
	const moneyKod = skloStrechaMoneyKod(t);
	const cena = moneyKod ? cenaZaM2(moneyKod) : null;
	const eurM2 = cena?.eurM2 ?? null;
	const cenaSpolu = eurM2 != null && plochaCelkomM2 != null ? R2(plochaCelkomM2 * eurM2) : null;
	return {
		typ: t,
		moneyKod,
		eurM2,
		cenaSpolu,
		mena: cena?.mena ?? 'EUR',
		snapshot
	};
}
