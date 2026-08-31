// #349: DURABLE stav pushu interného zoznamu materiálu zákazky do Odoo (`sale.order` log-note, #340).
// Tabuľka `odoo_zakazka_push` (migrácia v34) sleduje per (zákazka, objednávka), či push čaká na
// (re)post, počet GENUINE zlyhaní a čas posledného úspechu — aby štartový + arrival sweep
// (`odoo-zakazka.ts`) dopostli zaostalé pushe pri dlhšom výpadku Odoo (MVP #340 sa self-healol len
// pri ĎALŠOM odpise tej istej zákazky).
//
// Vzor `dopyt-store.ts` (#278): tenká DB vrstva nad `db.ts` (ten istý SQLite singleton). Kľúč je
// NORMALIZOVANÝ `(normZak(zak), normOp(op))` (idempotentný upsert — `260439` ≡ `OP260439`); raw
// `zak`/`op` sa ukladajú, aby retry mohol re-invokovať `pushZakazkaToOdoo(zak, op)` s pôvodnými
// argumentmi (a re-derivovať ČERSTVÝ snapshot — telo note sa NEUKLADÁ).
//
// MONEY-NEUTRÁLNE: importuje LEN `db` (pripojenie k SQLite, nie odpisová/zápisová cesta) + ČISTÉ
// `normZak`/`normOp` (string normalizácia, žiadny odpis/`/data`/`MONEY_LIVE`). Guard:
// `tests/odoo-zakazka-store-money-safety.test.ts`.
import { db } from './db';
import { normOp, normZak } from './money';

/** Riadok pending pushu pre retry sweep (raw `zak`/`op` na re-invokáciu + `attempts` na diagnostiku). */
export interface ZakazkaPushRow {
	zak: string;
	op: string;
	attempts: number;
}

function keyParams(
	zak: string,
	op: string
): { zak_norm: string; op_norm: string; zak: string; op: string } {
	return { zak_norm: normZak(zak), op_norm: normOp(op), zak, op };
}

// Úspešný push: vyrieš pending (0), vynuluj poison-pill počítadlo (úspech = dôkaz že Odoo je hore),
// zapíš čas posledného úspechu. Raw `zak`/`op` obnov (pre budúci retry po prípadnom neskoršom zlyhaní).
const upsertPosted = db.prepare(`
	INSERT INTO odoo_zakazka_push (zak_norm, op_norm, zak, op, pending, attempts, last_error, posted_at, updated_at)
	VALUES (@zak_norm, @op_norm, @zak, @op, 0, 0, '', datetime('now'), datetime('now'))
	ON CONFLICT(zak_norm, op_norm) DO UPDATE SET
		pending = 0, attempts = 0, last_error = '', posted_at = datetime('now'),
		updated_at = datetime('now'), zak = excluded.zak, op = excluded.op
`);

// GENUINE zlyhanie (Odoo/sieť): pending=1, inkrementuj poison-pill počítadlo, ulož chybu.
// `created_at` = ZAČIATOK aktuálnej pending epizódy (nie prvý-ever insert): resetuj ho pri prechode
// 0→1 (review #349 🟡 — inak by časový strop `expireStaleZakazkaPushes` na starom (>90 dní) riadku
// hneď „expiroval" ČERSTVÉ zlyhanie zákazky bežiacej mesiace). V `DO UPDATE` je nekvalifikované
// `pending` STARÁ hodnota riadku → reset len keď bol predtým vyriešený (0), inak epizódu zachovaj.
const upsertFailed = db.prepare(`
	INSERT INTO odoo_zakazka_push (zak_norm, op_norm, zak, op, pending, attempts, last_error, updated_at)
	VALUES (@zak_norm, @op_norm, @zak, @op, 1, 1, @err, datetime('now'))
	ON CONFLICT(zak_norm, op_norm) DO UPDATE SET
		pending = 1, attempts = attempts + 1, last_error = @err,
		updated_at = datetime('now'), zak = excluded.zak, op = excluded.op,
		created_at = CASE WHEN pending = 0 THEN datetime('now') ELSE created_at END
`);

// `no-order` (Odoo hore, ale `sale.order` ešte neexistuje — objednávka je ešte ponuka / nie je
// v Odoo): pending=1, ale `attempts` sa NEZVYŠUJE — nie je to chyba, len „ešte nie". Poison-pill by
// tu vyhorel za hodiny (arrival sweep beží často), kým objednávka pribudne za dni; zombie
// (nikdy nepotvrdená) ohraničuje ČASOVÝ strop nad `created_at` (viď `expireStaleZakazkaPushes`).
const upsertNoOrder = db.prepare(`
	INSERT INTO odoo_zakazka_push (zak_norm, op_norm, zak, op, pending, attempts, last_error, updated_at)
	VALUES (@zak_norm, @op_norm, @zak, @op, 1, 0, @err, datetime('now'))
	ON CONFLICT(zak_norm, op_norm) DO UPDATE SET
		pending = 1, last_error = @err, updated_at = datetime('now'),
		zak = excluded.zak, op = excluded.op,
		created_at = CASE WHEN pending = 0 THEN datetime('now') ELSE created_at END
`);

// `missing` (odpis medzitým UVOĽNENÝ „Uvoľniť" medzi zlyhaním a retry → zákazka už nemá odpis):
// TERMINÁLNY, netrackuj ako chybu. UPDATE-only — ak riadok neexistuje, niet čo riešiť (na arrival
// ceste sa missing nestane, odpis bol práve zapísaný; relevantné len keď existujúci pending riadok
// pri retry re-derivuje `missing`).
const markMissing = db.prepare(`
	UPDATE odoo_zakazka_push
	SET pending = 0, last_error = 'missing (zákazka nemá odpis — uvoľnené?)', updated_at = datetime('now')
	WHERE zak_norm = @zak_norm AND op_norm = @op_norm
`);

export function recordZakazkaPushPosted(zak: string, op: string): void {
	upsertPosted.run(keyParams(zak, op));
}
export function recordZakazkaPushFailed(zak: string, op: string, err: string): void {
	upsertFailed.run({ ...keyParams(zak, op), err: err.slice(0, 500) });
}
export function recordZakazkaPushNoOrder(zak: string, op: string): void {
	upsertNoOrder.run({
		...keyParams(zak, op),
		err: 'no-order (objednávka nie je v Odoo / je ešte ponuka)'
	});
}
export function recordZakazkaPushMissing(zak: string, op: string): void {
	markMissing.run({ zak_norm: normZak(zak), op_norm: normOp(op) });
}

// Pending riadky pre retry sweep: čakajú na (re)post, nevyčerpali poison-pill počítadlo A nie sú
// staršie než `maxAgeDays` (no-order zombie ochrana). ORDER BY `updated_at` ASC = najdlhšie čakajúci
// prvý; `LIMIT` ohraničuje záťaž na Odoo v jednom sweepe (vzor #278 `RETRY_BATCH`).
const pendingStmt = db.prepare(`
	SELECT zak, op, attempts FROM odoo_zakazka_push
	WHERE pending = 1 AND attempts < ? AND created_at > datetime('now', ?)
	ORDER BY updated_at ASC LIMIT ?
`);
export function getPendingZakazkaPushes(
	maxAttempts: number,
	maxAgeDays: number,
	limit: number
): ZakazkaPushRow[] {
	return pendingStmt.all(maxAttempts, `-${maxAgeDays} days`, limit) as ZakazkaPushRow[];
}

// Exspiruj zaseknuté pending riadky staršie než `maxAgeDays` (epizóda beží už priveľmi dlho —
// typicky no-order objednávka, ktorá sa nikdy neobjavila v Odoo; alebo poison-pilled riadok, ktorý
// tu tiež upraceme). Prestaň skúšať (pending=0), riadok ostáva pre diagnostiku. Čas, nie počet
// pokusov — arrival sweep beží podľa nesúvisiacej aktivity, takže attempts by nemeral čas. NEUTRÁLNY
// label `expired` (review #349 🔵 — netvrď „no-order" o riadku, čo bol genuine failure/poison-pill).
const expireStmt = db.prepare(`
	UPDATE odoo_zakazka_push
	SET pending = 0, last_error = 'expired', updated_at = datetime('now')
	WHERE pending = 1 AND created_at <= datetime('now', ?)
`);
export function expireStaleZakazkaPushes(maxAgeDays: number): void {
	expireStmt.run(`-${maxAgeDays} days`);
}

// Je (zak, op) STÁLE pending? Retry sweep to re-checkne PRED (re)postom vo svojom serializovanom
// tasku — živý arrival push mohol medzitým ten istý kľúč vyriešiť (review #349 🔵 — bez re-checku
// by sweep zbytočne postol druhý (re-derivovaný) snapshot a minul Odoo volanie).
const isPendingStmt = db.prepare(
	'SELECT pending FROM odoo_zakazka_push WHERE zak_norm = ? AND op_norm = ?'
);
export function isPendingZakazkaPush(zak: string, op: string): boolean {
	const r = isPendingStmt.get(normZak(zak), normOp(op)) as { pending: number } | undefined;
	return r?.pending === 1;
}
