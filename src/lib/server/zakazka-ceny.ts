// Cenový zoznam odpísaného materiálu K ZÁKAZKE (#154, časti 1+2 — rescope 25.8.:
// časť 3 „sledovanie cez pracoviská" dodáva Odoo vetva, appka ju nestavia).
//
// Odvodená (on-the-fly) agregácia uložených odoslaných odpisov jednej zákazky
// (`odpis_log` + `odpis_polozky`, kľúč `zak_norm`) — ŽIADNY materializovaný
// „zákazka" objekt (duplicitný stav = drift risk; zdroj pravdy sa číta vždy
// čerstvý, presne vzor `readbackStav` v money-readback.ts). Ceny na agregát
// napája volajúci cez existujúci `enrichPolozky` (denný Money snapshot,
// honest-null „cena neznáma"). Read-only — do Money sa odtiaľto NIČ nepíše.
import { db } from './db';
import { normZak } from './money';
import { getOdpadForOdpisy, type OdpadRow } from './odpad-store';

export interface ZakazkaOdpisRow {
	id: number;
	modul: string;
	zak: string;
	op: string;
	zakaznik: string;
	caka: number;
	live: number;
	created_by: string;
	created_at: string;
	/** (#299) čas detekcie ručného presunu parkovaného odpisu; NULL = nepresunutý. */
	presunute_at: string | null;
	/** počet ULOŽENÝCH položiek (odpis_polozky) — 0 = odpis spred fázy 1. */
	pocetPoloziek: number;
}

export interface AgregovanaPolozka {
	kod: string;
	nazov: string;
	qty: number;
	mj: string;
}

export interface ZakazkaPrehlad {
	/** reprezentatívny RAW tvar ZAK — z najnovšieho odpisu (na zobrazenie). */
	zak: string;
	zakNorm: string;
	/** zákazník z najnovšieho odpisu (na zobrazenie v hlavičke). */
	zakaznik: string;
	/** VŠETKY odpisy zákazky (LIVE aj TEST), najnovší prvý. */
	odpisy: ZakazkaOdpisRow[];
	/** `live` = súčty z ostrých odpisov; `test` = zákazka nemá žiadny ostrý odpis,
	 *  agregujú sa 🧪 TEST odpisy (explicitne označené v UI). Mix sa NIKDY nesčítava —
	 *  ten istý obsah poslaný test aj live by sa započítal dvakrát. */
	scope: 'live' | 'test';
	/** agregované položky zo scope odpisov: group by kod, SUM(qty), názov/mj z
	 *  najnovšieho výskytu; zoradené po kóde (deterministická tlač). */
	polozky: AgregovanaPolozka[];
	/** koľko odpisov je v scope súčtov. */
	odpisovVScope: number;
	/** scope odpisy stále PARKOVANÉ v „NA ODPIS" (`caka=1`, nepresunuté) — sú v
	 *  súčtoch (reálny materiál čakajúci na ručný presun), ale UI to musí priznať. */
	parkovanych: number;
	/** scope odpisy BEZ uložených položiek (spred fázy 1) — ich materiál v agregáte
	 *  čestne CHÝBA a UI to musí priznať, nikdy sa tváriť, že zoznam je kompletný. */
	bezPoloziek: number;
	/** #417 faza 2: per-profil odpad z narezov agregovany napriec scope odpisy.
	 *  Prazdne pole ak ziadne odpisy nemaju odpadove data (moduly bez ffdPack: pergola, bazen, clip). */
	odpad: OdpadRow[];
}

/** float šum zo sčítania qty (0.1+0.2) — zaokrúhlenie na 3 des. (mm/kusy stačia). */
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Prehľad jednej zákazky: všetky jej odoslané odpisy + agregovaný zoznam
 * materiálu zo scope odpisov. `null`, keď zákazka nemá ŽIADNY odpis (volajúci
 * dá 404 — „zoznam pripnutý k zákazke" existuje len pre odpísané zákazky).
 */
export function zakazkaPrehlad(zakRaw: string): ZakazkaPrehlad | null {
	const zakNorm = normZak(zakRaw);
	if (!zakNorm) return null;
	// Legacy pasca (#154 review 🟡): v27 backfill skopíroval `zak_norm = zak` RAW —
	// len post-v27 `writeOdpis` riadky majú kanonický normZak tvar. Priama rovnosť by
	// legacy riadok (napr. „zak 2026450") TICHO vynechala z agregátu a jeho vlastný
	// ZAK link by dal 404. Preto sa DRUHOU podmienkou normalizuje aj DB strana v SQL
	// (upper+replace ≈ normZak pre ASCII ZAK kódy; SQLite `upper` je ASCII-only, takže
	// priama rovnosť ostáva pre už-kanonické hodnoty vrátane ne-ASCII). Dedup/ledger
	// sémantika `zak_norm` sa NEMENÍ — toto je čisto read-side rozšírenie.
	const odpisy = db
		.prepare(
			`SELECT l.id, l.modul, l.zak, l.op, l.zakaznik, l.caka, l.live, l.created_by, l.created_at,
			        l.presunute_at,
			        (SELECT COUNT(*) FROM odpis_polozky p WHERE p.odpis_log_id = l.id) AS pocetPoloziek
			 FROM odpis_log l
			 WHERE l.zak_norm = ? OR upper(replace(l.zak_norm, ' ', '')) = ?
			 ORDER BY l.id DESC`
		)
		.all(zakNorm, zakNorm) as ZakazkaOdpisRow[];
	const najnovsi = odpisy[0];
	if (!najnovsi) return null;

	const liveOdpisy = odpisy.filter((o) => o.live === 1);
	const scope: 'live' | 'test' = liveOdpisy.length > 0 ? 'live' : 'test';
	const vScope = scope === 'live' ? liveOdpisy : odpisy;

	// group by kod naprieč scope odpismi — iteruje sa od NAJSTARŠIEHO, takže novší
	// výskyt prepíše nazov/mj (katalógový názov kódu sa mohol medzičasom zmeniť)
	const poKode = new Map<string, AgregovanaPolozka>();
	let bezPoloziek = 0;
	const polozkyStmt = db.prepare(
		'SELECT kod, nazov, qty, mj FROM odpis_polozky WHERE odpis_log_id = ? ORDER BY id'
	);
	for (const o of [...vScope].sort((a, b) => a.id - b.id)) {
		const rows = polozkyStmt.all(o.id) as { kod: string; nazov: string; qty: number; mj: string }[];
		if (rows.length === 0) {
			bezPoloziek++;
			continue;
		}
		for (const r of rows) {
			const cur = poKode.get(r.kod);
			if (cur) {
				cur.qty += r.qty;
				cur.nazov = r.nazov;
				cur.mj = r.mj;
			} else {
				poKode.set(r.kod, { ...r });
			}
		}
	}
	const polozky = [...poKode.values()]
		.map((p) => ({ ...p, qty: round3(p.qty) }))
		.sort((a, b) => a.kod.localeCompare(b.kod, 'sk'));

	// #417 faza 2: per-profil odpad z narezov agregovany napriec scope odpisy
	const odpad = getOdpadForOdpisy(vScope.map((o) => o.id));

	return {
		zak: najnovsi.zak,
		zakNorm,
		zakaznik: najnovsi.zakaznik,
		odpisy,
		scope,
		polozky,
		odpisovVScope: vScope.length,
		parkovanych: vScope.filter((o) => o.caka === 1 && o.presunute_at === null).length,
		bezPoloziek,
		odpad
	};
}
