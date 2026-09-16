#!/usr/bin/env node
// #524: tenký CLI klient pre backfill nárezákov → Odoo `lines`. POSTne na LOKÁLNY admin endpoint
// bežiaceho servera (`/admin/backfill-narezaky`) — kontajner je bundle-only, samostatný TS proces
// sa nedá spustiť, takže ťažkú prácu robí server (má DB/compute/callJson2), toto je len fetch klient.
//
// Spustenie v kontajneri (supervisor po nasadení):
//   docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30            # DRY-RUN (default)
//   docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30 --dry-run  # DRY-RUN (explicitne)
//   docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30 --live     # OSTRÝ zápis
//   docker exec automatizacie-montalu npm run backfill:narezaky -- --days 30 --zak ZAK1 ZAK2
//
// BEZPEČNÝ default: DRY-RUN. Ostrý zápis IBA s `--live`. Autorizácia cez `BACKFILL_TOKEN`
// (env kontajnera; server ho číta z tej istej env). Nárezák upload musí byť zapnutý
// (`ODOO_NAREZ_UPLOAD_ENABLED=1` + JSON-2 creds), inak endpoint vráti 409.
const args = process.argv.slice(2);

function flagVal(name, dflt) {
	const i = args.indexOf(name);
	return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
}

const days = Number(flagVal('--days', '30'));
const live = args.includes('--live');
const dryRun = !live; // `--dry-run` je no-op (default); ostrý beh len s `--live`
const zakIdx = args.indexOf('--zak');
const zak = zakIdx >= 0 ? args.slice(zakIdx + 1).filter((a) => !a.startsWith('--')) : undefined;

const port = process.env.PORT || '3000';
const url = `http://127.0.0.1:${port}/admin/backfill-narezaky`;
const token = process.env.BACKFILL_TOKEN || '';

if (!Number.isFinite(days) || days <= 0) {
	console.error('Neplatné --days (musí byť kladné číslo).');
	process.exit(2);
}
if (!token) {
	console.error(
		'Chýba BACKFILL_TOKEN v env kontajnera — nastav ho (rovnaká hodnota ako číta server) a spusti znova.'
	);
	process.exit(2);
}

console.log(
	`Backfill nárezákov → Odoo lines: ${dryRun ? 'DRY-RUN' : 'OSTRÝ ZÁPIS'}, posledných ${days} dní${zak?.length ? `, zak=${zak.join(',')}` : ''}`
);

let res;
try {
	res = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-backfill-token': token },
		body: JSON.stringify({ days, dryRun, zak })
	});
} catch (e) {
	console.error(`Nepodarilo sa spojiť s ${url}: ${e?.message ?? e}`);
	process.exit(1);
}

const text = await res.text();
if (!res.ok) {
	console.error(`Backfill zlyhal: HTTP ${res.status}\n${text.slice(0, 2000)}`);
	process.exit(1);
}

let s;
try {
	s = JSON.parse(text);
} catch {
	console.error(`Neočakávaná odpoveď (nie JSON):\n${text.slice(0, 2000)}`);
	process.exit(1);
}

console.log('');
console.log(`Objednávok:            ${s.objednavok}`);
console.log(
	`${dryRun ? 'Poslal by' : 'Nahraných'}:            ${s.nahranych}  (riadkov spolu: ${s.riadkovSpolu})`
);
console.log(`Skip — bez objednávky: ${s.skipNoOrder}`);
console.log(`Skip — už má riadky:   ${s.skipHasLines}`);
console.log(`Skip — bez riadkov:    ${s.skipNoLines}`);
console.log(`Skip — pergola rezerv: ${s.skipPergolaRezervacia}`);
console.log(`Skip — nerekonštr.:    ${s.skipUnreconstructable}`);
console.log(`Spätne dopočítané OP:  ${s.driftOp}`);
console.log(`Chýb:                  ${s.chyb}`);
console.log('');
for (const op of s.ops) {
	const mods = (op.moduly || [])
		.map((m) => `${m.modul}:${m.riadkov}${m.drift ? ' (spätne)' : ''}`)
		.join(', ');
	console.log(
		`  ${op.op} [${op.zak}] — ${op.akcia}${op.riadkovSpolu ? ` (${op.riadkovSpolu} r.: ${mods})` : ''}${op.error ? ` ⚠ ${op.error}` : ''}`
	);
}

process.exit(s.chyb > 0 ? 1 : 0);
