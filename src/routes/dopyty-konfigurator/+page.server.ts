// Interný AUTH-gated prehľad zákazníckych dopytov z konfigurátora (#282). Read-only zoznam,
// najnovšie hore, so stránkovaním. AUTH je zabezpečená GLOBÁLNE v `hooks.server.ts` (route nie
// je v PUBLIC_PATHS → neprihlásený je presmerovaný na /login) a b2b je odrezaný denylistom
// (`/dopyty-konfigurator` v B2B_FORBIDDEN_PREFIXES) — táto route je čisto interná.
//
// MONEY-NEUTRÁLNE: žiadny import money/pergola, žiadny zápis. `load` len číta `dopyt` tabuľku
// (audit trail z #277) a zostaví súhrn cez znovupoužité pure helpery z `$lib/ponuka`.
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { isInternal } from '$lib/server/auth';
import {
	countDopyty,
	hasObjednavkaColumn,
	hasOdooLeadColumn,
	listDopyty
} from '$lib/server/dopyt-store';
import { cenaZoStampu } from '$lib/server/dopyt-cena-stamp';
import { formatCenaKratko, sanitizePonukaConfig, zhrnutieRiadky } from '$lib/ponuka';
import { formatDatumCasSk, sqliteUtcToIso } from '$lib/datum';

/** Počet dopytov na stránku. */
const PER_PAGE = 50;

export const load: PageServerLoad = async ({ url, locals }) => {
	// defense-in-depth (brána hooks.server.ts už redirectuje anon/b2b skôr) — symetria s
	// PDF endpointom; interné-only zoznam.
	if (!isInternal(locals.user)) error(403, 'Prístup len pre interných používateľov.');

	const total = countDopyty();
	const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
	// query `?page=N` (1-based); nezmyselný/mimo rozsah vstup sa clampuje do [1, pageCount]
	const raw = Number.parseInt(url.searchParams.get('page') ?? '1', 10);
	const page = Math.min(pageCount, Math.max(1, Number.isFinite(raw) ? raw : 1));
	const offset = (page - 1) * PER_PAGE;

	const hasOdooLead = hasOdooLeadColumn();
	// #319: feature-detect objednávkového stĺpca → interný zoznam odlíši objednávku od dopytu
	const hasObjednavka = hasObjednavkaColumn();
	// flagy podané do listDopyty → `PRAGMA table_info` sa spraví raz za request, nie viackrát
	const dopyty = listDopyty(offset, PER_PAGE, hasOdooLead, hasObjednavka).map((r) => ({
		id: r.id,
		// #319: 1 = záväzná objednávka, inak nezáväzný dopyt (kľúč prítomný len keď schéma stĺpec má)
		jeObjednavka: hasObjednavka && r.je_objednavka === 1,
		// created_at je SQLite UTC timestamp → sqliteUtcToIso (UTC pasca #114) pred formátom
		datum: formatDatumCasSk(sqliteUtcToIso(r.created_at)),
		meno: r.meno,
		email: r.email,
		telefon: r.telefon,
		miesto: r.miesto,
		poznamka: r.poznamka,
		// súhrn konfigurácie (rozmery/typ strechy/sklo/farba…) — znovupoužitý pure helper
		suhrn: zhrnutieRiadky(sanitizePonukaConfig(r.konfiguracia)),
		// #309: opečiatkovaná orientačná cena (z podania) — `null` pri starých/neopečiatkovaných
		// riadkoch (driver-side signál, nie sentinel reťazec), inak naformátovaný label;
		// `cenaVerzia` = verzia cenníka (audit, z ktorej matice cena vzišla)
		cena: (() => {
			const c = cenaZoStampu(r);
			return c ? formatCenaKratko(c) : null;
		})(),
		cenaVerzia: r.cennik_verzia ?? null,
		// Odoo lead (#278/v26) — kľúč prítomný len keď schéma stĺpec má (defenzívne)
		odooLeadId: hasOdooLead ? (r.odoo_lead_id ?? null) : null
	}));

	return { dopyty, total, page, pageCount, perPage: PER_PAGE, hasOdooLead, hasObjednavka };
};
