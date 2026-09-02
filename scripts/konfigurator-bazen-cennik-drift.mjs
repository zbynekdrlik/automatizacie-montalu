#!/usr/bin/env node
// #404 — ONLINE drift-check: porovná uložený seed `src/lib/server/cennik-bazen.json` so ŽIVÝM
// montalu.sk bazénovým konfigurátorom. Upozorní, keď montalu.sk zmení cenník (seed treba
// regenerovať cez `scripts/konfigurator-bazen-cennik-fetch.mjs`). Read-only (číta len cenový
// endpoint, žiadny submit/objednávka). Politický delay medzi volaniami.
//
// NIKDY v CI (externá sieť). Spustenie: `node scripts/konfigurator-bazen-cennik-drift.mjs`
// Výstup: nenulový exit kód pri zistenom drifte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-pools`;
const PAGE = `${BASE}/konfigurator/zastresenia-bazenov`;
const DELAY_MS = 250;
const TOL = 0.01; // €

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(
	fs.readFileSync(path.join(root, 'src', 'lib', 'server', 'cennik-bazen.json'), 'utf8')
);
const SEGMENTS = seed.meta.segmentsLength ?? 'standardna';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c2 = (x) => Math.round(x * 100) / 100;

async function ziskajKontext() {
	const res = await fetch(PAGE);
	if (!res.ok) throw new Error(`GET ${PAGE} → HTTP ${res.status}`);
	const html = await res.text();
	const token = html.match(/name="_token"\s+value="([^"]+)"/)?.[1];
	const validFrom = html
		.match(/name="valid_from"[^>]*?value="([^"]+)"/s)?.[1]
		?.replaceAll('&amp;', '&');
	const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
	if (!token || !validFrom || !cookie.includes('session'))
		throw new Error('nezískal som token / valid_from / session cookie');
	return { token, validFrom, cookie };
}

async function ceny(ctx, dlzkaM, sirkaM, modelKod) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('variants', 'PBSPP00143');
	fd.append('configurator_id', 'pools');
	fd.append('length', String(dlzkaM));
	fd.append('width', String(sirkaM));
	fd.append('segments_length', SEGMENTS);
	fd.append('calculate[]', JSON.stringify({ model: modelKod }));
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		body: fd,
		headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': ctx.token, Cookie: ctx.cookie }
	});
	if (!res.ok) throw new Error(`POST ${dlzkaM}x${sirkaM} → HTTP ${res.status}`);
	const j = await res.json();
	const c = j.calculate?.find((x) => x.value === modelKod);
	return c ? { mo: c2(c.price), vo: c2(c.priceB2B) } : null;
}

// vzorka: rohy + pár vnútorných buniek per model
function vzorka(rows) {
	const keys = Object.keys(rows).sort();
	if (keys.length === 0) return [];
	const pick = (arr, n) => {
		if (arr.length <= n) return arr;
		const out = [arr[0], arr[arr.length - 1]];
		for (let i = 1; i < n - 1; i++) out.push(arr[Math.floor((i * arr.length) / (n - 1))]);
		return [...new Set(out)];
	};
	const ds = pick(keys, 4);
	const bunky = [];
	for (const dK of ds) {
		const ws = pick(Object.keys(rows[dK]).sort(), 3);
		for (const wK of ws) bunky.push([dK, wK]);
	}
	return bunky;
}

async function main() {
	const ctx = await ziskajKontext();
	let drift = 0;
	let checked = 0;
	for (const [modelKluc, modelKod] of Object.entries(seed.modely)) {
		const rows = seed.cennik[modelKluc];
		if (!rows) continue;
		for (const [dK, wK] of vzorka(rows)) {
			const stored = rows[dK][wK];
			const live = await ceny(ctx, Number(dK), Number(wK), modelKod);
			checked++;
			const bad =
				!live || Math.abs(live.mo - stored[0]) > TOL || Math.abs(live.vo - stored[1]) > TOL;
			if (bad) {
				drift++;
				console.log(
					`DRIFT ${modelKluc} ${dK}×${wK}: seed [${stored}] vs live ${live ? `[${live.mo},${live.vo}]` : 'nedostupné'}`
				);
			}
			await sleep(DELAY_MS);
		}
	}
	console.log(`\nSkontrolovaných ${checked} buniek, drift v ${drift}.`);
	if (drift > 0) {
		console.log(
			'→ montalu.sk zmenil cenník. Regeneruj seed: node scripts/konfigurator-bazen-cennik-fetch.mjs'
		);
		process.exit(1);
	}
	console.log('OK — seed sedí so živým montalu.sk.');
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
