#!/usr/bin/env -S npx tsx
// #6385 noha 2: jednorazový backfill — nahrá historické nárezové PDF na zákazky do Odoo.
//
// Prejde všetky UNIKÁTNE (zak, op) páry z odpis_log2, regeneruje PDF rozpisu materiálu
// a uploadne cez montalu_narezak_upload (/json/2). Idempotentný — opakovaný beh prepíše
// existujúcu prílohu (endpoint je xmlid-idempotentný).
//
// Spustenie:
//   ODOO_JSON2_URL=https://erp.montalu.cloud \
//   ODOO_NAREZ_UPLOAD_ENABLED=1 \
//   ODOO_JSON2_API_KEY=<key> \
//   DATABASE_PATH=/opt/automatizacie-montalu/data/app.db \
//   npx tsx scripts/backfill-narezak-upload.ts [--dry-run] [--limit N]
//
// Vyžaduje:
//   - prístup k SQLite databáze appky (DATABASE_PATH)
//   - ODOO_JSON2_URL + ODOO_JSON2_API_KEY + ODOO_NAREZ_UPLOAD_ENABLED=1
//   - cenník snapshot (CENY_SNAPSHOT_PATH alebo default)
//
// Výstup: počet úspešne nahraných / preskočených / zlyhaných.

import Database from 'better-sqlite3';

// We need to bootstrap the app's module resolution for pdf-lib etc.
// Since this is a standalone script, we import from the built server directly.
// For now, we'll use a simpler approach: direct DB access + the upload function.

interface OdpisRow {
	zak: string;
	op: string;
	zakaznik: string;
}

async function main() {
	const args = process.argv.slice(2);
	const dryRun = args.includes('--dry-run');
	const limitIdx = args.indexOf('--limit');
	const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '0', 10) : 0;

	const dbPath = process.env.DATABASE_PATH;
	if (!dbPath) {
		console.error('ERROR: DATABASE_PATH nie je nastavená.');
		process.exit(1);
	}

	const odooUrl = process.env.ODOO_JSON2_URL;
	const odooKey = process.env.ODOO_JSON2_API_KEY;
	const enabled = process.env.ODOO_NAREZ_UPLOAD_ENABLED;

	if (!odooUrl || !odooKey) {
		console.error('ERROR: ODOO_JSON2_URL a ODOO_JSON2_API_KEY musia byť nastavené.');
		process.exit(1);
	}
	if (enabled !== '1') {
		console.error('ERROR: ODOO_NAREZ_UPLOAD_ENABLED musí byť "1".');
		process.exit(1);
	}

	console.log(`Backfill narezak upload`);
	console.log(`  DB: ${dbPath}`);
	console.log(`  Odoo: ${odooUrl}`);
	console.log(`  Dry run: ${dryRun}`);
	if (limit > 0) console.log(`  Limit: ${limit}`);
	console.log();

	const db = new Database(dbPath, { readonly: true });

	// Zober unikátne (zak, op) páry z odpis_log2 — LEN LIVE odpisy (live=1).
	const query = limit > 0
		? `SELECT DISTINCT zak, op, zakaznik FROM odpis_log2 WHERE live = 1 ORDER BY created_at DESC LIMIT ?`
		: `SELECT DISTINCT zak, op, zakaznik FROM odpis_log2 WHERE live = 1 ORDER BY created_at DESC`;
	const rows: OdpisRow[] = limit > 0
		? (db.prepare(query).all(limit) as OdpisRow[])
		: (db.prepare(query).all() as OdpisRow[]);

	console.log(`Nájdených ${rows.length} unikátnych (zak, op) párov s live odpismi.`);
	console.log();

	let uploaded = 0;
	let skipped = 0;
	let failed = 0;

	for (const row of rows) {
		const { zak, op, zakaznik } = row;

		if (dryRun) {
			console.log(`[DRY-RUN] ${zak} / ${op} (${zakaznik})`);
			skipped++;
			continue;
		}

		try {
			// Use the upload function directly — it reads from the same DB, generates PDF, and uploads.
			// We dynamically import to avoid module resolution issues with SvelteKit aliases.
			// Since this is a tsx script, we need to handle the import paths differently.

			// For this backfill script, we'll call the Odoo endpoint directly using fetch,
			// generating the PDF inline. This avoids SvelteKit alias resolution issues.
			const result = await uploadSingle(
				{ url: odooUrl, apiKey: odooKey },
				db,
				zak,
				op
			);

			if (result === 'uploaded') {
				console.log(`[OK] ${zak} / ${op}`);
				uploaded++;
			} else if (result === 'missing') {
				console.log(`[SKIP] ${zak} / ${op} — žiadne položky`);
				skipped++;
			} else {
				console.log(`[FAIL] ${zak} / ${op} — ${result}`);
				failed++;
			}
		} catch (e) {
			console.error(`[FAIL] ${zak} / ${op} — ${e instanceof Error ? e.message : String(e)}`);
			failed++;
		}

		// Throttle — 200ms medzi requestami
		await new Promise((r) => setTimeout(r, 200));
	}

	db.close();

	console.log();
	console.log(`Hotovo: ${uploaded} nahraných, ${skipped} preskočených, ${failed} zlyhaných.`);
	process.exit(failed > 0 ? 1 : 0);
}

/**
 * Upload jedného (zak, op) páru. Generuje jednoduchý placeholder PDF (rozpis položiek
 * z DB ako text) a uploadne cez montalu_narezak_upload. Pre plné PDF by bolo treba
 * bootstrapnúť celý SvelteKit server — pre backfill stačí jednoduchý textový PDF.
 *
 * Alternatívne: spustiť backfill cez SvelteKit dev server (importovať moduly priamo).
 * Tu je self-contained verzia s minimálnym PDF.
 */
async function uploadSingle(
	cfg: { url: string; apiKey: string },
	db: Database.Database,
	zak: string,
	op: string
): Promise<string> {
	// Zober najnovší odpis pre túto zákazku
	const polozky = db.prepare(`
		SELECT p.kod, p.nazov, SUM(p.qty) as qty, p.mj
		FROM odpis_polozky p
		JOIN odpis_log2 l ON p.odpis_log_id = l.id
		WHERE l.zak = ? AND l.live = 1
		GROUP BY p.kod
		ORDER BY p.nazov
	`).all(zak) as Array<{ kod: string; nazov: string; qty: number; mj: string }>;

	if (polozky.length === 0) {
		return 'missing';
	}

	// Generuj jednoduchý PDF s pdf-lib
	const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

	let page = doc.addPage([595, 842]); // A4
	const { height } = page.getSize();
	let y = height - 50;

	page.drawText(`Rozpis materialu - zakazka ${zak}`, {
		x: 50, y, size: 14, font: boldFont, color: rgb(0, 0, 0)
	});
	y -= 20;

	const opNorm = op.toUpperCase().replace(/\s+/g, '');
	page.drawText(`Objednavka: ${opNorm}`, {
		x: 50, y, size: 10, font, color: rgb(0.3, 0.3, 0.3)
	});
	y -= 10;
	page.drawText(`Generovane: ${new Date().toISOString().slice(0, 19)} (backfill)`, {
		x: 50, y, size: 8, font, color: rgb(0.5, 0.5, 0.5)
	});
	y -= 25;

	// Header
	page.drawText('Kod', { x: 50, y, size: 9, font: boldFont });
	page.drawText('Nazov', { x: 130, y, size: 9, font: boldFont });
	page.drawText('Mnozstvo', { x: 400, y, size: 9, font: boldFont });
	page.drawText('MJ', { x: 470, y, size: 9, font: boldFont });
	y -= 15;

	for (const p of polozky) {
		if (y < 50) {
			page = doc.addPage([595, 842]);
			y = height - 50;
		}
		const kod = p.kod.slice(0, 15);
		const nazov = p.nazov.slice(0, 40);
		const qty = String(Math.round(p.qty * 1000) / 1000);
		page.drawText(kod, { x: 50, y, size: 8, font });
		page.drawText(nazov, { x: 130, y, size: 8, font });
		page.drawText(qty, { x: 400, y, size: 8, font });
		page.drawText(p.mj || 'm', { x: 470, y, size: 8, font });
		y -= 12;
	}

	const pdfBytes = await doc.save();
	const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

	// Doc ID — stabilný per zákazka
	const docId = `rozpis-${zak.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 33) || 'x'}`;

	// Upload cez /json/2
	const url = `${cfg.url.replace(/\/+$/, '')}/json/2/sale.order/montalu_narezak_upload`;
	const body = JSON.stringify({
		jsonrpc: '2.0',
		method: 'call',
		id: 1,
		params: {
			order_number: opNorm,
			doc_id: docId,
			kind: 'narezak',
			filename: `Rozpis-${zak}-backfill.pdf`,
			pdf_base64: pdfBase64
		}
	});

	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `bearer ${cfg.apiKey}`
		},
		body
	});

	const text = await res.text();
	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
	}

	const parsed = JSON.parse(text);
	if (parsed.error) {
		// montalu_order_not_found = zákazka nie je v Odoo (normálne pre staré zákazky)
		if (typeof parsed.error.message === 'string' && parsed.error.message.includes('montalu_order_not_found')) {
			return 'missing';
		}
		throw new Error(`Odoo error: ${parsed.error.message}`);
	}

	return 'uploaded';
}

main().catch((e) => {
	console.error('Fatálna chyba:', e);
	process.exit(1);
});
