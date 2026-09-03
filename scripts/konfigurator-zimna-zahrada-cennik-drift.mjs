#!/usr/bin/env node
// #408 + #429 — ONLINE drift-check: porovná uložený seed `src/lib/server/cennik-zimna-zahrada.json`
// so ŽIVÝM montalu.sk konfigurátorom zimných záhrad. Upozorní, keď montalu.sk zmení cenník (seed
// treba regenerovať cez `scripts/konfigurator-zimna-zahrada-cennik-fetch.mjs`). Read-only (číta len
// cenový endpoint, žiadny submit/objednávka). Politický delay medzi volaniami.
//
// NIKDY v CI (externá sieť). Spustenie: `node scripts/konfigurator-zimna-zahrada-cennik-drift.mjs`
// Výstup: nenulový exit kód pri zistenom drifte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-winter-gardens`;
const PAGE = `${BASE}/konfigurator/zimne-zahrady`;
const DELAY_MS = 200;
const TOL = 0.01; // €

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(
	fs.readFileSync(path.join(root, 'src', 'lib', 'server', 'cennik-zimna-zahrada.json'), 'utf8')
);
const BASE_GLASS_ADD = seed.meta.glassAdd ?? 'Bez úpravy';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c2 = (x) => Math.round(x * 100) / 100;
const num = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

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

async function ceny(ctx, hlbkaM, sirkaM, glazing, roofing) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('variants', '');
	fd.append('configurator_id', 'winter-gardens');
	fd.append('length', String(hlbkaM)); // montalu length = HĹBKA
	fd.append('width', String(sirkaM)); // montalu width = ŠÍRKA
	fd.append('glazing', glazing);
	fd.append('roofing', roofing);
	fd.append('color', 'Antracit');
	fd.append('warranty', '');
	fd.append('glass_add', BASE_GLASS_ADD);
	fd.append('model', 'ZZR00000');
	fd.append('calculate[]', JSON.stringify({ model: 'ZZR00000' }));
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		body: fd,
		headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': ctx.token, Cookie: ctx.cookie }
	});
	if (!res.ok)
		throw new Error(`POST ${hlbkaM}x${sirkaM} ${glazing} ${roofing} → HTTP ${res.status}`);
	const j = await res.json();
	const mo = num(j.price);
	const vo = num(j.priceB2B);
	return Number.isFinite(mo) && mo > 0 && Number.isFinite(vo) && vo > 0
		? { mo: c2(mo), vo: c2(vo) }
		: null;
}

// vzorka: rohy + pár vnútorných buniek per roofing
function vzorka(rows) {
	const keys = Object.keys(rows).sort((a, b) => Number(a) - Number(b));
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
		const ws = pick(
			Object.keys(rows[dK]).sort((a, b) => Number(a) - Number(b)),
			3
		);
		for (const wK of ws) bunky.push([dK, wK]);
	}
	return bunky;
}

async function main() {
	const ctx = await ziskajKontext();
	let drift = 0;
	let checked = 0;
	// #429: matica má TERAZ 4 úrovne (glazing × roofing × hĺbka × šírka) — 6× viac roofing blokov než
	// #408, takže vzorka je per (glazing, roofing) blok (rohy + pár vnútorných buniek), rovnako ako
	// predtým per roofing blok — celkový počet volaní ostáva v rozsahu #408 drift-checku.
	for (const [glazing, roofingBlok] of Object.entries(seed.cennik)) {
		for (const [roofing, rows] of Object.entries(roofingBlok)) {
			for (const [dK, wK] of vzorka(rows)) {
				const stored = rows[dK][wK];
				const live = await ceny(ctx, Number(dK), Number(wK), glazing, roofing);
				checked++;
				const bad =
					!live || Math.abs(live.mo - stored[0]) > TOL || Math.abs(live.vo - stored[1]) > TOL;
				if (bad) {
					drift++;
					console.log(
						`DRIFT ${glazing} / ${roofing} ${dK}×${wK}: seed [${stored}] vs live ${live ? `[${live.mo},${live.vo}]` : 'nedostupné'}`
					);
				}
				await sleep(DELAY_MS);
			}
		}
	}
	console.log(`\nSkontrolovaných ${checked} buniek, drift v ${drift}.`);
	if (drift > 0) {
		console.log(
			'→ montalu.sk zmenil cenník. Regeneruj seed: node scripts/konfigurator-zimna-zahrada-cennik-fetch.mjs'
		);
		process.exit(1);
	}
	console.log('OK — seed sedí so živým montalu.sk.');
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
