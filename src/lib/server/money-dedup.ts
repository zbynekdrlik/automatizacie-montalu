// Dedup rozhodnutie zápisu odpisu (#608) — vytiahnuté z `writeOdpis` (money.ts), aby funkcia neprerástla
// a aby celé rozhodnutie „smie sa tento odpis zapísať a s akým poradím" žilo na jednom mieste:
//   - append-only ledger `odpis_imported` (#294): `ledgerCounts` (pure move z money.ts, re-export tam),
//   - token potvrdenia (`potvrdenieTokenPre`) — stav ledgeru, ktorý „Uvoľniť" nikdy nevráti späť,
//   - cross-modul identický obsah (#380), pergola rezervácia (#221), DOROBENIE `uz-odpisane` (#608).
// VŠETKO je SYNCHRÓNNE (better-sqlite3) a `writeOdpis` to volá bez `await` medzi precheckom a INSERT —
// nikdy sem nedávaj async kód (otvoril by súbehové okno dvojitého zápisu).
// Importuje LEN `db` + `log` (+ typy z money.ts — typový import sa pri behu zmaže, žiadny cyklus).
import { db } from './db';
import { logger } from './log';
import type { OdpisJob, OdpisOutcome, OdpisOverride } from './money';

const log = logger('money');

export interface LedgerCounts {
	imports: number;
	overrides: number;
	lastImportedAt: string | undefined;
}

/**
 * Počítadlo APPEND-ONLY ledgeru `odpis_imported` (#294) pre daný per-order tuple + `content_hash`.
 * `writeOdpis` blokuje re-import, keď `imports > overrides` (identický obsah už raz importovaný a
 * nebol RE-autorizovaný). Kľúč NIKDY nie je globálny hash — dve rôzne zákazky smú mať rovnaký obsah.
 * Exportované aj pre `money-presun.ts` (#299 detekcia ručného presunu — idempotentný ledger append).
 */
export function ledgerCounts(
	modul: string,
	zakNorm: string,
	opNorm: string,
	live: number,
	contentHashV: string
): LedgerCounts {
	const row = db
		.prepare(
			`SELECT
				SUM(CASE WHEN kind = 'import' THEN 1 ELSE 0 END) AS imports,
				SUM(CASE WHEN kind = 'override' THEN 1 ELSE 0 END) AS overrides,
				MAX(CASE WHEN kind = 'import' THEN created_at END) AS lastImportedAt
			 FROM odpis_imported
			 WHERE modul = ? AND zak_norm = ? AND op_norm = ? AND live = ? AND content_hash = ?`
		)
		.get(modul, zakNorm, opNorm, live, contentHashV) as {
		imports: number | null;
		overrides: number | null;
		lastImportedAt: string | null;
	};
	return {
		imports: row.imports ?? 0,
		overrides: row.overrides ?? 0,
		lastImportedAt: row.lastImportedAt ?? undefined
	};
}

/**
 * (#608) Token potvrdenia = `MAX(id)` APPEND-ONLY ledgeru `odpis_imported` pre (modul, live, zákazka/OP)
 * — normalizovaný kľúč ∪ legacy RAW (v27 skopíroval do `zak_norm`/`op_norm` RAW hodnoty). Každý reálny
 * zápis odpisu ho posunie (`import` riadok), „Uvoľniť" ho NEvráti (ledger sa nemaže). Potvrdenie
 * („Odoslať ako dorobenie" / #300 „Odoslať aj tak") preto platí LEN pre stav, ktorý operátor videl v
 * bloku: refresh výsledku, dvojklik, súbežné dorobenie ani replay starého formulára po „Uvoľniť" ho
 * nezopakujú. (MAX(poradie) ako token by „Uvoľniť" vrátilo späť — review nález 🔴.) 0 = žiadny riadok.
 */
export function potvrdenieTokenPre(
	modul: string,
	live: number,
	zakNorm: string,
	opNorm: string,
	zakRaw: string,
	opRaw: string
): number {
	const r = db
		.prepare(
			`SELECT MAX(id) AS m FROM odpis_imported
			 WHERE modul = ? AND live = ? AND ((zak_norm = ? AND op_norm = ?) OR (zak_norm = ? AND op_norm = ?))`
		)
		.get(modul, live, zakNorm, opNorm, zakRaw, opRaw) as { m: number | null };
	return r.m ?? 0;
}

export interface DedupKontext {
	live: number;
	zakNorm: string;
	opNorm: string;
	/** content_hash z normalizovaného zak (dedup/ledger kľúč) */
	ledgerHash: string;
	/** aktuálny `potvrdenieTokenPre(...)` — spočítaný v tom istom synchrónnom bloku */
	token: number;
	/** cieľ/názov prvého odpisu (informatívne vo výsledku bloku, nič sa nezapisuje) */
	target: string;
	filename: string;
}

export type DedupRozhodnutie =
	{ koniec: OdpisOutcome } | { poradie: number; overridingDorobenie: boolean };

/**
 * Smie sa odpis zapísať a s akým poradím? `koniec` = tvrdý duplikát alebo blok `uz-odpisane` (PRED
 * akýmkoľvek zápisom); inak poradie (1 = prvý odpis, > 1 = vedomé dorobenie). Ledger (#294) rieši
 * volajúci až po tomto rozhodnutí (dorobenie ho prekoná tým istým potvrdením).
 */
export function rozhodniDedup(
	job: OdpisJob,
	k: DedupKontext,
	opts: OdpisOverride
): DedupRozhodnutie {
	const { live, zakNorm, opNorm, ledgerHash, token, target, filename } = k;
	const jeLive = live === 1;
	// (#380) CROSS-MODUL identický-obsah dedup — FIX z CADu (modul='fix') reusuje presne pergola
	// katalóg, takže identický CAD nárez dá identický content_hash (a názov súboru) pod modul='fix'
	// aj modul='pergola'. Dedup aj ledger sú kľúčované na modul, takže bez tejto poistky by operátor
	// obišiel dedup presunutím identického nárezu z /pergola (Duplikát) do /fix/cad → dvojitý odpis
	// rovnakého materiálu + prepis súboru v import priečinku. RÔZNY obsah (pergola + fix na tej istej
	// ZAK+OP) má RÔZNY hash → NEblokuje sa (legitímna koexistencia). Kľúč = (live,zak,op,hash) bez modulu.
	// (#608) Kontroluje sa PRED blokom `uz-odpisane` a je TVRDÝ aj pri potvrdenom dorobení — dorobenie
	// je per modul, presun toho istého nárezu do iného modulu sa ním „prepašovať" nedá (a operátorovi
	// sa neponúkne dorobenie, ktoré by aj tak skončilo týmto duplikátom).
	const crossDup = db
		.prepare(
			'SELECT modul, created_at FROM odpis_log WHERE live = ? AND zak_norm = ? AND op_norm = ? AND content_hash = ? AND modul != ?'
		)
		.get(live, zakNorm, opNorm, ledgerHash, job.modul) as
		{ modul: string; created_at: string } | undefined;
	if (crossDup) {
		log.warn('odpis duplikát — identický obsah už zapísaný pod iným modulom, nič sa nezapisuje', {
			modul: job.modul,
			existujuciModul: crossDup.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm,
			live: jeLive,
			existingCreatedAt: crossDup.created_at
		});
		return {
			koniec: {
				status: 'duplicate',
				live: jeLive,
				target,
				filename,
				duplicateCreatedAt: crossDup.created_at
			}
		};
	}

	// (#294) normalizovaný dedup precheck — OP260286 ≡ 260286 obíde RAW UNIQUE, tak dedup-ujeme na
	// normalizovaných stĺpcoch. RAW UNIQUE(modul,zak,op,live,poradie) kryje ATOMICKY len race
	// IDENTICKÉHO zápisu (rovnaké raw zak/op). Cross-spelling race (OP260286 vs 260286 súbežne) NEMÁ
	// DB constraint — kryje ho len to, že precheck→claim beží BEZ `await` v jednom synchrónnom bloku.
	// (#608) Množina existujúcich odpisov = normalizovaný kľúč ∪ RAW kľúč (zak, op) — RAW vetva je
	// presne kľúč DB UNIQUE, takže dedup nerozširuje; zachytí legacy riadky spred v27 (`op_norm` je
	// tam RAW kópia, napr. '01' vs normOp 'OP01'), ktoré by inak skončili až na UNIQUE poistke ako
	// dead-end `duplicate` bez ponuky dorobenia. Zápisová sémantika `zak_norm`/`op_norm` sa nemení.
	const kluc =
		'modul = ? AND live = ? AND ((zak_norm = ? AND op_norm = ?) OR (zak = ? AND op = ?))';
	const klucArgs = [job.modul, live, zakNorm, opNorm, job.zak, job.op];
	const existujuce = db
		.prepare(
			`SELECT COUNT(*) AS pocet, MAX(poradie) AS maxPoradie,
			        MAX(CASE WHEN json_valid(detail)
			                 THEN (CASE WHEN json_extract(detail, '$.rezervacia') = 1 THEN 1 ELSE 0 END)
			                 ELSE 0 END) AS rezervacia
			 FROM odpis_log WHERE ${kluc}`
		)
		.get(...klucArgs) as { pocet: number; maxPoradie: number | null; rezervacia: number | null };
	if (existujuce.pocet === 0) return { poradie: 1, overridingDorobenie: false };

	const posledny = db
		.prepare(`SELECT created_at, created_by FROM odpis_log WHERE ${kluc} ORDER BY id DESC LIMIT 1`)
		.get(...klucArgs) as { created_at: string; created_by: string };
	const maxPoradie = existujuce.maxPoradie ?? 1;
	if (job.rezervacia === true || existujuce.rezervacia === 1) {
		// (#221) pergola rezervácia a CAD odpis tej istej ZAK+OP kolidujú ZÁMERNE (rezervácia už
		// materiál odpísala — CAD odpis by ho odpísal druhýkrát). Ostáva TVRDÝ duplikát bez ponuky
		// dorobenia (#608 sa rezervácie netýka; oprava = „Uvoľniť" v histórii).
		log.warn('odpis duplikát — rezervácia ⇄ odpis tej istej zákazky, nič sa nezapisuje', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm,
			live: jeLive,
			novyJeRezervacia: job.rezervacia === true,
			existingCreatedAt: posledny.created_at
		});
		return {
			koniec: {
				status: 'duplicate',
				live: jeLive,
				target,
				filename,
				duplicateCreatedAt: posledny.created_at
			}
		};
	}
	// (#608) DOROBENIE len VEDOME: potvrdenie „Odoslať ako dorobenie" platí LEN s tokenom stavu
	// ledgeru, ktorý operátor videl v bloku. Bez potvrdenia (náhodný dvojklik / refresh) ALEBO so
	// zastaraným tokenom (refresh výsledku dorobenia, dvojklik, súbežné dorobenie, replay po „Uvoľniť")
	// → blok PRED akýmkoľvek DB/file zápisom. Platí pre live AJ test (dedup platil vždy pre oba).
	if (opts.overrideDorobenie !== true || opts.potvrdenieToken !== token) {
		const led = ledgerCounts(job.modul, zakNorm, opNorm, live, ledgerHash);
		log.warn('odpis blokovaný — zákazka/OP už odpísaná, dorobenie len vedome (#608)', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm,
			live: jeLive,
			pocetOdpisov: existujuce.pocet,
			maxPoradie,
			potvrdenie: opts.overrideDorobenie === true,
			potvrdenieToken: opts.potvrdenieToken,
			aktualnyToken: token,
			existingCreatedAt: posledny.created_at
		});
		return {
			koniec: {
				status: 'blocked',
				reason: 'uz-odpisane',
				live: jeLive,
				target,
				filename,
				duplicateCreatedAt: posledny.created_at,
				duplicateCreatedBy: posledny.created_by,
				poradieMax: maxPoradie,
				pocetOdpisov: existujuce.pocet,
				potvrdenieToken: token,
				// identický obsah už raz importovaný → potvrdenie prekoná aj ledger; hláška to prizná
				identickyObsah: led.imports > led.overrides
			}
		};
	}
	return { poradie: maxPoradie + 1, overridingDorobenie: true };
}
