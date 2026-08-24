// Cena strešného skla pergoly (#223) — DISPLAY-ONLY €/m² z Money cenníka IZOS cez denný
// snapshot cien (#154/#235). Money ODPIS skla sa tým NEMENÍ — strešné sklo je v pergole
// informatívne (žiadny Money zápis; celkový náklad je aj tak honest-null, lebo dĺžka
// tabule nie je potvrdená → plocha sa nedá spočítať). Tu sa počíta LEN jednotková €/m².
//
// Honest-null: typ nezvolený → `null`; typ bez potvrdeného TS kódu (8 zo 14 typov, A2/#235)
// alebo kód bez ceny v snapshote → `eurM2 = null` („cena nedostupná"), NIKDY sa nedopočítava
// z odhadu a NIKDY sa nehádže kód. Gate na interných je na úrovni route (rovnako ako
// `cenyPre`/`skloCenaPre`) — tento modul cenu len počíta.
import { skloStrechaMoneyKod } from '$lib/sklo-strecha';
import { cenaZaM2, getSnapshotMeta, type SnapshotMeta } from './ceny';

export interface StrechaSkloCena {
	/** zvolený typ strešného skla (kanonický katalógový názov) */
	typ: string;
	/** Money TS kód (cenník IZOS) alebo `null` = žiadny potvrdený kód → „karta v Money neexistuje" */
	moneyKod: string | null;
	/** €/m² zo snapshotu; `null` = nedostupná (typ bez kódu, alebo kód bez ceny v snapshote) */
	eurM2: number | null;
	/** mena (IZOS je EUR-only, ale nesieme ju z ceny pre konzistenciu) */
	mena: string;
	/** vek snapshotu pre UI (rovnako ako `skloCenaPre`) */
	snapshot: SnapshotMeta;
}

/**
 * Jednotková cena €/m² strešného skla pre zvolený typ. `null` keď typ nie je zvolený.
 * Money kód = `skloStrechaMoneyKod(typ)` (katalóg #274); €/m² = `cenaZaM2(kod)` zo snapshotu.
 * Keď kód/cena chýba → `moneyKod`/`eurM2 = null` (honest-null). Celkový náklad (plocha ×
 * €/m²) sa ZÁMERNE nepočíta — dĺžka tabule je honest-null (#223), takže plocha je neznáma.
 * Volá sa LEN pre interných (gate na route).
 */
export function strechaSkloCenaPre(typ: string | null): StrechaSkloCena | null {
	const t = (typ ?? '').trim();
	if (!t) return null;
	const snapshot = getSnapshotMeta(); // spustí lazy import + vráti vek snapshotu pre UI
	const moneyKod = skloStrechaMoneyKod(t);
	const cena = moneyKod ? cenaZaM2(moneyKod) : null;
	return {
		typ: t,
		moneyKod,
		eurM2: cena?.eurM2 ?? null,
		mena: cena?.mena ?? 'EUR',
		snapshot
	};
}
