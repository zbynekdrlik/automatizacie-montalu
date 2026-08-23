// Interné znovu-vygenerovanie PDF ponuky pre uložený dopyt (#282). Personál si vie pre daný
// dopyt znova stiahnuť PDF špecifikáciu — regeneruje sa DETERMINISTICKY z uloženej kanonickej
// konfigurácie (`dopyt.konfiguracia`), nič sa nikde nemení. MONEY-NEUTRÁLNE: znovupoužíva
// `ponuka-pdf` (ŠPECIFIKÁCIA, NULA cien) — súbor matchuje `/dopyt/`, takže je automaticky
// krytý statickým guardom `tests/dopyt-money-safety.test.ts` (žiadny import money/pergola).
import { getDopyt } from './dopyt-store';
import { generatePonukaPdf } from './ponuka-pdf';
import { sanitizePonukaConfig } from '$lib/ponuka';
import { formatDatumIsoSk, formatDatumSk, sqliteUtcToIso } from '$lib/datum';

export interface RegenerovanePdf {
	/** bajty PDF dokumentu */
	bytes: Uint8Array;
	/** názov súboru na stiahnutie (dátum vzniku dopytu + jeho id — interný kontext) */
	filename: string;
}

/**
 * Znovu vygeneruje PDF ponuky pre dopyt `id` z uloženej konfigurácie. `null` = dopyt s tým id
 * neexistuje (volajúci → 404). Pätička PDF nesie PÔVODNÝ dátum vzniku dopytu (nie „dnes"), aby
 * re-download zodpovedal špecifikácii, ktorú zákazník pôvodne dostal. `created_at` je SQLite
 * UTC timestamp → `sqliteUtcToIso` (UTC pasca #114) pred formátovaním do Europe/Bratislava.
 */
export async function regeneratePonukaPdf(id: number): Promise<RegenerovanePdf | null> {
	const row = getDopyt(id);
	if (!row) return null;
	const cfg = sanitizePonukaConfig(row.konfiguracia);
	const iso = sqliteUtcToIso(row.created_at);
	const bytes = await generatePonukaPdf(cfg, { datum: formatDatumSk(iso) });
	// dátum v názve = ROVNAKÝ kalendárny deň ako v pätičke (Europe/Bratislava), nie UTC slice
	return { bytes, filename: `Montalu-ponuka-dopyt-${id}-${formatDatumIsoSk(iso)}.pdf` };
}
