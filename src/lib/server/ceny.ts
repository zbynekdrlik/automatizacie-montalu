// Cenový zoznam materiálu k zákazke — fáza 1 (#154, ROZHODNUTÉ 2026-08-12: ceny +
// dostupnosť, read-only). Appka NIKDY nepíše do Money — číta LEN denný snapshot
// súbor, ktorý sem doniesol `scripts/ceny-snapshot.py` (beží mimo appky, tam kde
// je Money dosiahnuteľné) + rsync na VPS (viď design komentár na tikete pre celý
// dátový tok). Chýbajúca cena je vždy `null` ("cena neznáma"), nikdy 0 — Money má
// reálne kódy, kde `Cena=0` znamená "nikdy zadané", nie "zadarmo" (overené live).
import fs from 'node:fs';
import { db } from './db';

export interface PriceRow {
	kod: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	mena: string;
	/** `null` = Money pre tento kód vôbec nemá skladovú kartu (neznáme); 0/záporné
	 *  sú REÁLNE hodnoty (vypredané / rezervované nad rámec skladu). */
	sklad: number | null;
}

const snapshotPath = () => process.env.CENY_SNAPSHOT_PATH || '/data/ceny/ceny.json';

interface MetaRow {
	snapshot_generated_at: string | null;
	snapshot_file_mtime_ms: number | null;
	imported_at: string | null;
	row_count: number;
	rejected_count: number;
}

function getMetaRow(): MetaRow | undefined {
	return db.prepare('SELECT * FROM material_prices_meta WHERE id = 1').get() as MetaRow | undefined;
}

/** Cena z Money 0/chýbajúca/neplatná ⇒ `null` ("cena neznáma"). Kladné číslo ⇒ hodnota. */
function priceOrNull(v: unknown, label: string, log: (m: string) => void): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v > 0 ? v : null;
	log(`neplatná cena „${label}" (${JSON.stringify(v)}) — berie sa ako neznáma`);
	return null;
}

/**
 * Validuje jeden riadok snapshotu. Štrukturálny problém (chýba/neplatný `kod`
 * alebo `sklad`) ⇒ CELÝ riadok sa zamietne (vráti `null`, zaloguje sa). Neplatná
 * JEDNOTLIVÁ cena riadok nezhodí — len sa zaloguje a to jedno pole je „neznáma"
 * (skladová dostupnosť aj ostatné ceny toho istého kódu sú stále cenné dáta).
 */
function validateRow(raw: unknown, idx: number, log: (m: string) => void): PriceRow | null {
	if (!raw || typeof raw !== 'object') {
		log(`riadok ${idx}: nie je objekt — zamietnutý`);
		return null;
	}
	const r = raw as Record<string, unknown>;
	const kod = typeof r.kod === 'string' ? r.kod.trim() : '';
	if (!kod) {
		log(`riadok ${idx}: chýba/neplatný „kod" — zamietnutý`);
		return null;
	}
	const rowLog = (m: string) => log(`riadok ${idx} (${kod}): ${m}`);
	// sklad SMIE byť záporný — Money ho vie vrátiť pod nulou (rezervované > fyzicky na
	// sklade), overené live na ostrých kódoch (2026-08-13 smoke query). SMIE byť aj
	// `null`/chýbajúce — Money pre daný kód nemá skladovú kartu vôbec (#154 review
	// nález); to je NEZNÁME, nie 0. Zamietame LEN štrukturálne nezmyselné hodnoty
	// (niečo iné než číslo/null — napr. text).
	const skladRaw = r.sklad;
	let sklad: number | null;
	if (skladRaw === null || skladRaw === undefined) {
		sklad = null;
	} else if (typeof skladRaw === 'number' && Number.isFinite(skladRaw)) {
		sklad = skladRaw;
	} else {
		rowLog(`neplatný „sklad" (${JSON.stringify(skladRaw)}) — celý riadok zamietnutý`);
		return null;
	}
	const mena = typeof r.mena === 'string' && r.mena.trim() ? r.mena.trim() : 'EUR';
	const kod0 = kod;
	let predajVo = priceOrNull(r.predajVo, 'predajVo', rowLog);
	// Kódy komponentov/kovania (ZASK*) — veľkoobchodný cenník sa im NEDÔVERUJE (šéf
	// 2026-08-12: "veľkoobchodným cenníkom si pri ZASK ešte nie istí"). Vynútené TU
	// (nielen v producer skripte) — druhá vrstva obrany, presne ako appka layeruje
	// b2b Money-write hranicu (viď access-control skill).
	if (!kod0.startsWith('ZASP')) predajVo = null;
	return {
		kod,
		nakupCennik: priceOrNull(r.nakupCennik, 'nakupCennik', rowLog),
		nakupPoslednaFaktura: priceOrNull(r.nakupPoslednaFaktura, 'nakupPoslednaFaktura', rowLog),
		predajVo,
		mena,
		sklad
	};
}

export interface ImportResult {
	imported: boolean;
	reason: 'no-file' | 'not-newer' | 'read-error' | 'parse-error' | 'ok';
	rowCount?: number;
	rejectedCount?: number;
	generatedAt?: string | null;
}

/**
 * LAZY import: no-op, keď súbor chýba alebo sa mtime nezmenil od posledného
 * importu (lacná `fs.statSync` kontrola na KAŽDÉ volanie — bezpečné, appka beží
 * ako jeden proces, žiadny paralelný import). Zlý riadok sa preskočí + zaloguje,
 * NIKDY nezhodí celý import (jeden pokazený riadok v Money exporte nesmie
 * zablokovať aktualizáciu cien pre všetky ostatné položky — viď design komentár).
 */
export function maybeImportSnapshot(): ImportResult {
	const p = snapshotPath();
	let stat: fs.Stats;
	try {
		stat = fs.statSync(p);
	} catch {
		return { imported: false, reason: 'no-file' };
	}
	const meta = getMetaRow();
	if (meta?.snapshot_file_mtime_ms === stat.mtimeMs) {
		return { imported: false, reason: 'not-newer' };
	}
	let raw: string;
	try {
		raw = fs.readFileSync(p, 'utf8');
	} catch (e) {
		console.error('ceny: čítanie snapshotu zlyhalo:', e);
		return { imported: false, reason: 'read-error' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		console.error('ceny: JSON parse snapshotu zlyhal:', e);
		return { imported: false, reason: 'parse-error' };
	}
	const file = (parsed ?? {}) as { generatedAt?: unknown; rows?: unknown };
	const generatedAt = typeof file.generatedAt === 'string' ? file.generatedAt : null;
	const rowsRaw = Array.isArray(file.rows) ? file.rows : [];

	let rejected = 0;
	const valid: PriceRow[] = [];
	rowsRaw.forEach((r, i) => {
		const row = validateRow(r, i, (m) => console.error(`ceny snapshot: ${m}`));
		if (!row) {
			rejected++;
			return;
		}
		valid.push(row);
	});

	const upsert = db.prepare(`
		INSERT INTO material_prices (kod, nakup_cennik, nakup_posledna_faktura, predaj_vo, mena, sklad, updated_at)
		VALUES (@kod, @nakupCennik, @nakupPoslednaFaktura, @predajVo, @mena, @sklad, datetime('now'))
		ON CONFLICT(kod) DO UPDATE SET
			nakup_cennik = excluded.nakup_cennik,
			nakup_posledna_faktura = excluded.nakup_posledna_faktura,
			predaj_vo = excluded.predaj_vo,
			mena = excluded.mena,
			sklad = excluded.sklad,
			updated_at = excluded.updated_at
	`);
	const upsertMeta = db.prepare(`
		INSERT INTO material_prices_meta (id, snapshot_generated_at, snapshot_file_mtime_ms, imported_at, row_count, rejected_count)
		VALUES (1, ?, ?, datetime('now'), ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			snapshot_generated_at = excluded.snapshot_generated_at,
			snapshot_file_mtime_ms = excluded.snapshot_file_mtime_ms,
			imported_at = excluded.imported_at,
			row_count = excluded.row_count,
			rejected_count = excluded.rejected_count
	`);
	db.transaction(() => {
		for (const row of valid) upsert.run(row);
		upsertMeta.run(generatedAt, stat.mtimeMs, valid.length, rejected);
	})();

	console.error(`ceny: naimportovaných ${valid.length} riadkov, zamietnutých ${rejected} (${p})`);
	return {
		imported: true,
		reason: 'ok',
		rowCount: valid.length,
		rejectedCount: rejected,
		generatedAt
	};
}

export interface SnapshotMeta {
	generatedAt: string | null;
	importedAt: string | null;
	/** dní od `generatedAt` po TERAZ; `null` keď snapshot ešte nikdy nebol naimportovaný */
	daysOld: number | null;
	rowCount: number;
	rejectedCount: number;
}

function readSnapshotMetaFromDb(): SnapshotMeta {
	const meta = getMetaRow();
	if (!meta || !meta.snapshot_generated_at) {
		return { generatedAt: null, importedAt: null, daysOld: null, rowCount: 0, rejectedCount: 0 };
	}
	const genMs = Date.parse(meta.snapshot_generated_at);
	const daysOld = Number.isFinite(genMs)
		? Math.max(0, Math.floor((Date.now() - genMs) / 86400000))
		: null;
	return {
		generatedAt: meta.snapshot_generated_at,
		importedAt: meta.imported_at,
		daysOld,
		rowCount: meta.row_count,
		rejectedCount: meta.rejected_count
	};
}

/** Vek/stav aktuálne naimportovaného snapshotu — pre UI hlášku „Ceny zo snapshotu
 *  Money k {dátum}, N dní staré". Vždy najprv skúsi lazy import (čerstvejší súbor). */
export function getSnapshotMeta(): SnapshotMeta {
	maybeImportSnapshot();
	return readSnapshotMetaFromDb();
}

function getPriceRow(kod: string): PriceRow | undefined {
	const row = db
		.prepare(
			`SELECT kod, nakup_cennik AS nakupCennik, nakup_posledna_faktura AS nakupPoslednaFaktura,
			        predaj_vo AS predajVo, mena, sklad
			 FROM material_prices WHERE kod = ?`
		)
		.get(kod) as
		| {
				kod: string;
				nakupCennik: number | null;
				nakupPoslednaFaktura: number | null;
				predajVo: number | null;
				mena: string;
				sklad: number | null;
		  }
		| undefined;
	return row;
}

export interface CenaRiadok {
	kod: string;
	nazov: string;
	qty: number;
	mj: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	/** JEDNOTKOVÁ marža (predajVo − nakupCennik, na jednotku) — marža sa počíta
	 *  z CENNÍKOVEJ nákupnej ceny, nie z poslednej faktúry (šéf 2026-08-12). */
	marza: number | null;
	/** dostupné množstvo na sklade. `null` = neznáme (kód nikdy nebol v Money
	 *  snapshote, ALEBO tam bol, ale Money preň nemá skladovú kartu — obe sa
	 *  zobrazujú rovnako); `0`/záporné = reálna hodnota z Money, nikdy "neznáma". */
	sklad: number | null;
	/** mena zdrojovej ceny (z Money price-booku); `EUR`, keď appka o kóde vôbec
	 *  nemá cenové dáta — nemá čo inak zobraziť. */
	mena: string;
}

export interface CenySucet {
	suma: number;
	/** `false`, keď aspoň jedna položka s nenulovým množstvom mala pre tento
	 *  stĺpec neznámu cenu — súčet je TEDA NEÚPLNÝ (appka to musí priznať v UI). */
	kompletne: boolean;
}

export interface CenyResult {
	radky: CenaRiadok[];
	sucty: {
		nakupCennik: CenySucet;
		nakupPoslednaFaktura: CenySucet;
		predajVo: CenySucet;
		marza: CenySucet;
	};
	snapshot: SnapshotMeta;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function novySucet(): CenySucet {
	return { suma: 0, kompletne: true };
}

function pripocitaj(sucet: CenySucet, hodnota: number | null, qty: number) {
	if (hodnota === null) {
		if (qty !== 0) sucet.kompletne = false;
		return;
	}
	sucet.suma += hodnota * qty;
}

/**
 * Napojí cenové dáta na položky odpisu (JOIN podľa kódu) + spočíta súčty za
 * zákazku. Volá sa LEN pre interných (b2b cenový blok nesmie vidieť vôbec —
 * gatuje sa na úrovni route/akcie, nie tu, presne ako Money-write hranica).
 */
export function enrichPolozky(
	polozky: { kod: string; nazov: string; qty: number; mj?: string }[]
): CenyResult {
	maybeImportSnapshot();
	const sucty = {
		nakupCennik: novySucet(),
		nakupPoslednaFaktura: novySucet(),
		predajVo: novySucet(),
		marza: novySucet()
	};
	const radky: CenaRiadok[] = polozky.map((p) => {
		const price = getPriceRow(p.kod);
		const nakupCennik = price?.nakupCennik ?? null;
		const nakupPoslednaFaktura = price?.nakupPoslednaFaktura ?? null;
		const predajVo = price?.predajVo ?? null;
		const marza = nakupCennik !== null && predajVo !== null ? predajVo - nakupCennik : null;
		pripocitaj(sucty.nakupCennik, nakupCennik, p.qty);
		pripocitaj(sucty.nakupPoslednaFaktura, nakupPoslednaFaktura, p.qty);
		pripocitaj(sucty.predajVo, predajVo, p.qty);
		pripocitaj(sucty.marza, marza, p.qty);
		return {
			kod: p.kod,
			nazov: p.nazov,
			qty: p.qty,
			mj: p.mj ?? 'm',
			nakupCennik,
			nakupPoslednaFaktura,
			predajVo,
			marza,
			sklad: price?.sklad ?? null,
			mena: price?.mena ?? 'EUR'
		};
	});
	for (const s of Object.values(sucty)) s.suma = round2(s.suma);
	return { radky, sucty, snapshot: readSnapshotMetaFromDb() };
}
