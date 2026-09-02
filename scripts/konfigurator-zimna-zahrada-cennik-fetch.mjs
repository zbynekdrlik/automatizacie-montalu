#!/usr/bin/env node
// #408 (Fáza A) — jednorazové vyťaženie interim cenníkovej matice zimných záhrad z verejného
// konfigurátora montalu.sk do verzovaného seedu `src/lib/server/cennik-zimna-zahrada.json`.
//
// Autoritatívny zdroj: `POST montalu.sk/konfigurator/update-winter-gardens`. Read-only — číta len
// cenový endpoint (ten, ktorý wizard volá pri bežnom prezeraní); NIKDY nevolá submit/objednávku.
// Politický delay medzi volaniami.
//
// Overený mechanizmus (Playwright network capture, viď design komentár #408): cenotvorné osi sú
// `length` = HĹBKA (vysunutie, dominantná os) + `width` = ŠÍRKA (pozdĺž steny, pridáva nad 4 m) +
// `glazing` (systém stien) + `roofing` (strešné zasklenie). Bázový (orientačný) config = pevný systém
// stien `slide|izolacne-sklo-16-mm`, `glass_add=Bez úpravy`, neutrálna farba (color cenu nemení).
// Matica sa vyťaží po osiach `roofing × hĺbka × šírka`; top-level `price` = MO net celého configu,
// `priceB2B` = VO net. DPH = 23 % half-up v centoch (`priceWithVat`/`priceB2BWithVat`).
//
// Spustenie (mimo CI, potrebuje sieť): `node scripts/konfigurator-zimna-zahrada-cennik-fetch.mjs`
// Nikdy nebeží v CI (externá sieť) — je to regeneračný nástroj seedu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-winter-gardens`;
const PAGE = `${BASE}/konfigurator/zimne-zahrady`;
const DELAY_MS = 200; // politický odstup medzi volaniami

// Bázový (orientačný) config — pevné neutrálne voľby; cena reaguje LEN na hĺbku × šírku × roofing.
const BASE_GLAZING = 'slide|izolacne-sklo-16-mm'; // montalu bázový systém stien (Slide 16 mm)
const BASE_GLASS_ADD = 'Bez úpravy';
const BASE_COLOR = 'Antracit'; // color cenu nemení (overené), neutrálny
const BASE_MODEL = 'ZZR00000'; // montalu bázový model kód (`calculate[]`)

// Strešné zasklenie (montalu `roofing` slug) — 4 možnosti zodpovedajúce zákazníckym „Zasklenie"
// kategóriám (mapovanie nazov→slug žije v cenovom module).
const ROOFINGS = [
	'dutinkovy-polykarbonat-16-mm',
	'bezpecnostne-sklo-441',
	'izolacne-sklo-24-mm',
	'panel-izo-24mm'
];

// naša mriežka (metre) = presné body na montalu osiach (obe zaokrúhľuje montalu NAHOR na 0,5).
const HLBKY = []; // 2.0 .. 6.0 krok 0.5 (montalu `length` = hĺbka)
for (let d = 20; d <= 60; d += 5) HLBKY.push(d / 10);
const SIRKY = []; // 2.0 .. 7.5 krok 0.5 (montalu `width` = šírka; nad 7.5 mimo katalógu)
for (let w = 20; w <= 75; w += 5) SIRKY.push(w / 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c2 = (x) => Math.round(x * 100) / 100;
const k1 = (m) => m.toFixed(1);
const parseCena = (s) => Number(String(s).replace(/\s/g, '').replace(',', '.'));

async function ziskajKontext() {
	const res = await fetch(PAGE);
	if (!res.ok) throw new Error(`GET ${PAGE} → HTTP ${res.status}`);
	const html = await res.text();
	const token = html.match(/name="_token"\s+value="([^"]+)"/)?.[1];
	const validFrom = html.match(/name="valid_from"[^>]*?value="([^"]+)"/s)?.[1];
	if (!token || !validFrom) throw new Error('nenašiel som _token / valid_from na stránke');
	const setCookies = res.headers.getSetCookie?.() ?? [];
	const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
	if (!cookie.includes('session')) throw new Error('nezískal som session cookie');
	return { token, validFrom: decodeHtml(validFrom), cookie };
}

function decodeHtml(s) {
	return s.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#039;', "'");
}

async function dopyt(ctx, hlbkaM, sirkaM, roofing) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('variants', ''); // server prepočíta z length+width+glazing+roofing
	fd.append('configurator_id', 'winter-gardens');
	fd.append('length', String(hlbkaM)); // montalu length = HĹBKA
	fd.append('width', String(sirkaM)); // montalu width = ŠÍRKA
	fd.append('glazing', BASE_GLAZING);
	fd.append('roofing', roofing);
	fd.append('color', BASE_COLOR);
	fd.append('warranty', '');
	fd.append('glass_add', BASE_GLASS_ADD);
	fd.append('model', BASE_MODEL);
	fd.append('calculate[]', JSON.stringify({ model: BASE_MODEL }));
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		body: fd,
		headers: {
			'X-Requested-With': 'XMLHttpRequest',
			'X-CSRF-TOKEN': ctx.token,
			Cookie: ctx.cookie
		}
	});
	if (!res.ok) throw new Error(`POST ${hlbkaM}x${sirkaM} ${roofing} → HTTP ${res.status}`);
	return res.json();
}

function parCien(json) {
	const mo = parseCena(json.price);
	const vo = parseCena(json.priceB2B);
	return Number.isFinite(mo) && mo > 0 && Number.isFinite(vo) && vo > 0 ? [c2(mo), c2(vo)] : null;
}

async function main() {
	console.error('GET kontext (token / valid_from / cookie) …');
	const ctx = await ziskajKontext();

	// cennik[roofing][hĺbka][šírka] = [MO net, VO net]
	const cennik = {};
	const verifikaciaDph = [];
	let volani = 0;

	for (const roofing of ROOFINGS) {
		cennik[roofing] = {};
		for (const d of HLBKY) {
			for (const w of SIRKY) {
				const j = await dopyt(ctx, d, w, roofing);
				volani++;
				const par = parCien(j);
				if (par) {
					(cennik[roofing][k1(d)] ??= {})[k1(w)] = par;
					// DPH vzorka: montalu vlastné zaokrúhlené reťazce s DPH — vezmi hraničné (.xx5) bunky,
					// aby parity test odlíšil celocentový half-up od naivného FP.
					const moNet = par[0];
					const moCent = Math.round(moNet * 100);
					const jeHranica = (moCent * 23) % 100 === 50; // net*0.23 končí na .xx5 → half-up NAHOR
					if (jeHranica && verifikaciaDph.length < 6) {
						verifikaciaDph.push({
							roofing,
							hlbkaM: d,
							sirkaM: w,
							moNet,
							moDph: j.priceWithVat,
							voNet: par[1],
							voDph: j.priceB2BWithVat
						});
					}
				}
				await sleep(DELAY_MS);
			}
			console.error(`  ${roofing} hĺbka ${k1(d)} m hotová`);
		}
	}

	// Fallback: ak sa nenašla žiadna .xx5 hraničná bunka, ulož aspoň niekoľko bežných kotiev (Izolačné
	// sklo, viac rozmerov) — parity test aj tak overí exaktnú celocentovú aritmetiku.
	if (verifikaciaDph.length === 0) {
		for (const [d, w] of [
			[4, 3],
			[5, 5],
			[2, 2]
		]) {
			const j = await dopyt(ctx, d, w, 'izolacne-sklo-24-mm');
			volani++;
			const par = parCien(j);
			if (par)
				verifikaciaDph.push({
					roofing: 'izolacne-sklo-24-mm',
					hlbkaM: d,
					sirkaM: w,
					moNet: par[0],
					moDph: j.priceWithVat,
					voNet: par[1],
					voDph: j.priceB2BWithVat
				});
			await sleep(DELAY_MS);
		}
	}

	const seed = {
		meta: {
			zdroj: 'montalu.sk/konfigurator/update-winter-gardens',
			vytazene: new Date().toISOString(),
			dph: 0.23,
			rodina: 'winter-gardens',
			bazovyGlazing: BASE_GLAZING,
			glassAdd: BASE_GLASS_ADD,
			poznamka:
				'Interim cenník zimných záhrad (#408 Fáza A) — replikácia matice montalu.sk. Net MO/VO ' +
				'v EUR; DPH = round(net*1.23, 2) half-up v centoch. Cenotvorné osi: roofing × hĺbka × šírka ' +
				'pri bázovom systéme stien slide|izolacne-sklo-16-mm, glass_add=Bez úpravy, neutrálna farba. ' +
				'Model ROBUST/MASSIVE a systém stien NIE sú tu premietnuté (upresnia sa po obhliadke) — nie ' +
				'definitívny cenník, šéfove pravidlá (#279) môžu prísť ako korekcia.',
			mriezka: {
				hlbkaM: { min: 2.0, max: 6.0, krok: 0.5 },
				sirkaM: { min: 2.0, max: 7.5, krok: 0.5 }
			}
		},
		cennik,
		verifikaciaDph
	};

	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const out = path.join(root, 'src', 'lib', 'server', 'cennik-zimna-zahrada.json');
	fs.writeFileSync(out, JSON.stringify(seed, null, '\t') + '\n');
	const buniek = Object.values(cennik).reduce(
		(a, roof) => a + Object.values(roof).reduce((b, row) => b + Object.keys(row).length, 0),
		0
	);
	console.error(
		`\nHotovo: ${volani} volaní, ${buniek} buniek, ${verifikaciaDph.length} DPH kotiev → ${out}`
	);
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
