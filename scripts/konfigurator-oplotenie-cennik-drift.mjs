#!/usr/bin/env node
// #410 — ONLINE drift-check: porovná uložený seed `src/lib/server/cennik-oplotenie.json` so ŽIVÝM
// montalu.sk oplotenie konfigurátorom. Upozorní, keď montalu.sk zmení cenník (seed treba regenerovať
// cez `scripts/konfigurator-oplotenie-cennik-fetch.mjs`). Read-only (číta len cenový endpoint, žiadny
// submit/objednávka). Politický delay medzi volaniami.
//
// NIKDY v CI (externá sieť). Spustenie: `node scripts/konfigurator-oplotenie-cennik-drift.mjs`
// Výstup: nenulový exit kód pri zistenom drifte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-fencings`;
const PAGE = `${BASE}/konfigurator/oplotenia`;
const DELAY_MS = 200;
const TOL = 0.01; // €

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(
	fs.readFileSync(path.join(root, 'src', 'lib', 'server', 'cennik-oplotenie.json'), 'utf8')
);
// seed.typy: nášTypKod → montalu slug; seed.modely: nášModel → montalu calculate kód
const TYPY = seed.typy;
const MODELY = seed.modely;

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

// jeden POST: type + count=1 + height + width + calculate[] pre všetky modely → mapa nášModel → [mo,vo]
async function ceny(ctx, typSlug, vyskaM, sirkaM) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('configurator_id', 'fencings');
	fd.append('type[0]', typSlug);
	fd.append('count[0]', '1');
	fd.append('height[0]', String(vyskaM));
	fd.append('width[0]', String(sirkaM));
	for (const kod of Object.values(MODELY)) fd.append('calculate[]', JSON.stringify({ model: kod }));
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		body: fd,
		headers: { 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': ctx.token, Cookie: ctx.cookie }
	});
	if (!res.ok) throw new Error(`POST ${typSlug} ${vyskaM}x${sirkaM} → HTTP ${res.status}`);
	const j = await res.json();
	const out = {};
	for (const [nasModel, montaluKod] of Object.entries(MODELY)) {
		const c = j.calculate?.[`model_${montaluKod}`];
		if (c && c.price > 0 && c.priceB2B > 0) out[nasModel] = [c2(c.price), c2(c.priceB2B)];
	}
	return out;
}

// vzorka: rohy + pár vnútorných výška/šírka bodov (spoločné naprieč modelmi jedného typu)
function pick(arr, n) {
	if (arr.length <= n) return arr;
	const out = [arr[0], arr[arr.length - 1]];
	for (let i = 1; i < n - 1; i++) out.push(arr[Math.floor((i * arr.length) / (n - 1))]);
	return [...new Set(out)];
}

async function main() {
	const ctx = await ziskajKontext();
	let drift = 0;
	let checked = 0;
	for (const [typKod, typSlug] of Object.entries(TYPY)) {
		const modely = seed.cennik[typKod];
		if (!modely) continue;
		// vzorka výšok/šírok z prvého modelu (obálka je per-typ zhodná naprieč modelmi)
		const prvyModel = Object.keys(modely)[0];
		const vysky = pick(Object.keys(modely[prvyModel]).sort(), 3);
		for (const hK of vysky) {
			const sirky = pick(Object.keys(modely[prvyModel][hK]).sort(), 3);
			for (const wK of sirky) {
				const live = await ceny(ctx, typSlug, Number(hK), Number(wK));
				for (const [model, vysky2] of Object.entries(modely)) {
					const stored = vysky2[hK]?.[wK];
					if (!stored) continue;
					checked++;
					const l = live[model];
					const bad = !l || Math.abs(l[0] - stored[0]) > TOL || Math.abs(l[1] - stored[1]) > TOL;
					if (bad) {
						drift++;
						console.log(
							`DRIFT ${typKod}/${model} ${hK}×${wK}: seed [${stored}] vs live ${l ? `[${l}]` : 'nedostupné'}`
						);
					}
				}
				await sleep(DELAY_MS);
			}
		}
		console.error(`  typ ${typKod} skontrolovaný`);
	}
	console.log(`\nSkontrolovaných ${checked} buniek, drift v ${drift}.`);
	if (drift > 0) {
		console.log(
			'→ montalu.sk zmenil cenník. Regeneruj seed: node scripts/konfigurator-oplotenie-cennik-fetch.mjs'
		);
		process.exit(1);
	}
	console.log('OK — seed sedí so živým montalu.sk.');
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
