// #524: admin endpoint pre backfill nárezákov → Odoo `lines` (rozpis rezov). Beží v už-nabootovanom
// serveri (má DB, compute, callJson2), takže CLI wrapper (`scripts/backfill-narezaky-cli.mjs`,
// `npm run backfill:narezaky`) je len tenký fetch klient — kontajner je bundle-only, nedá sa
// spustiť samostatný TS proces. `/admin/backfill-narezaky` je v PUBLIC_PATHS (hooks) len aby ho
// dosiahol CLI wrapper bez session; SAMOTNÝ endpoint gate-uje: interná session ALEBO `BACKFILL_TOKEN`.
//
// BEZPEČNÝ DEFAULT: `dryRun` je default TRUE — ostrý zápis vyžaduje explicitné `dryRun:false`
// (CLI `--live`). Ďalej vyžaduje `ODOO_NAREZ_UPLOAD_ENABLED=1` + JSON-2 creds (rovnaká brána ako
// #522 upload). Money-neutrálne (žiadny Money/`odpis_log` zápis).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadCfg } from '$lib/server/db';
import { odooJson2Config, isNarezUploadEnabled } from '$lib/server/odoo-json2';
import { logger } from '$lib/server/log';
import { runBackfill } from '$lib/server/backfill-narezaky';
import {
	backfillTokenValid,
	listOdpisyForBackfill,
	makeOdooBackfillDeps
} from '$lib/server/backfill-narezaky-deps';

const log = logger('backfill-narezaky');

export const POST: RequestHandler = async ({ request, locals }) => {
	// gate: interná admin session ALEBO platný BACKFILL_TOKEN (CLI wrapper). Bez oboch → 403.
	const isInternal = locals.user?.role === 'internal';
	const tokenOk = backfillTokenValid(request.headers.get('x-backfill-token'));
	if (!isInternal && !tokenOk) error(403, 'Neautorizované.');

	// rovnaká brána ako #522 upload — bez nej by aj ostrý beh nemal kam poslať
	if (!isNarezUploadEnabled())
		error(409, 'Nárezák upload je vypnutý (ODOO_NAREZ_UPLOAD_ENABLED != 1).');
	const odooCfg = odooJson2Config();
	if (!odooCfg) error(409, 'Chýba ODOO_JSON2_URL / ODOO_JSON2_API_KEY.');

	let body: { days?: number; dryRun?: boolean; zak?: unknown } = {};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		// prázdne telo = defaulty
	}
	const days = Number(body.days ?? 30);
	if (!Number.isFinite(days) || days <= 0) error(400, 'Neplatné `days`.');
	// BEZPEČNÝ default: dry-run, pokiaľ sa EXPLICITNE nepošle dryRun:false
	const dryRun = body.dryRun !== false;
	const zak = Array.isArray(body.zak) ? body.zak.map((z) => String(z)) : undefined;

	log.info('backfill spustený', {
		dryRun,
		days,
		zak: zak?.length ?? 0,
		actor: locals.user?.username
	});

	const cfg = loadCfg();
	const rows = listOdpisyForBackfill(days);
	const deps = makeOdooBackfillDeps(cfg, odooCfg, new Date(), (lvl, msg, ctx) =>
		log[lvl](msg, ctx)
	);
	const summary = await runBackfill(rows, deps, { dryRun, zakFilter: zak });

	return json({ dryRun, days, ...summary });
};
