#!/usr/bin/env node
// Fáza A (#279) — jednorazové vyťaženie interim cenníkovej matice pergol z verejného
// konfigurátora montalu.sk do verzovaného seedu `src/lib/server/cennik-pergola.json`.
//
// Autoritatívny zdroj: `POST montalu.sk/konfigurator/update-pergolas`. Read-only —
// číta len cenový endpoint (ten, ktorý wizard volá pri bežnom prezeraní); NIKDY
// nevolá `submit`/`zoznam` (žiadna objednávka / dopyt). Politický delay medzi volaniami.
//
// Overený mechanizmus (pozri design komentár #279): cenotvorný vstup je FORM pole
// `roofing`; `calculate[]` vracia MO (`price`) + VO (`priceB2B`) net per model pre
// zvolený roofing; nedostupná kombinácia model×roofing×rozmer ⇒ `0`. DPH = 23 %.
//
// Spustenie (mimo CI, potrebuje sieť): `node scripts/konfigurator-cennik-fetch.mjs`
// Nikdy nebeží v CI (externá sieť) — je to regeneračný nástroj seedu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-pergolas`;
const PAGE = `${BASE}/konfigurator/pergoly`;
const DELAY_MS = 250; // politický odstup medzi volaniami

const MODELY = { LIGHT: 'PRL00000', ROBUST: 'PRR00000', MASSIVE: 'PRM00000' };
// kľúč modulu → montalu.sk roofing slug
const VYPLNE = {
	'polykarbonat-16': 'dutinkovy-polykarbonat-16-mm',
	'bezpecnostne-sklo-441': 'bezpecnostne-sklo-441',
	'bezpecnostne-sklo-442': 'bezpecnostne-sklo-442',
	'izolacne-sklo-24': 'izolacne-sklo-24-mm-cire',
	'panel-izo-24': 'panel-izo-24mm'
};
const HLBKY = []; // 2.0 .. 6.0 krok 0.5
for (let d = 20; d <= 60; d += 5) HLBKY.push(d / 10);
const SIRKY = []; // 4.0 .. 7.5 krok 0.25
for (let w = 400; w <= 750; w += 25) SIRKY.push(w / 100);
const REFERENCNE = [
	[3, 5],
	[5, 5],
	[4, 6]
]; // sondy na dostupnosť roofingu

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c2 = (x) => Math.round(x * 100) / 100;
const kD = (d) => d.toFixed(1);
const kW = (w) => w.toFixed(2);

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

async function dopyt(ctx, roofingSlug, length, width) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('variants', 'PRLPC00040'); // server prepočíta z length+width+roofing
	fd.append('configurator_id', 'pergolas');
	fd.append('length', String(length));
	fd.append('width', String(width));
	fd.append('roofing', roofingSlug);
	for (const kod of Object.values(MODELY)) fd.append('calculate[]', JSON.stringify({ model: kod }));
	const res = await fetch(ENDPOINT, {
		method: 'POST',
		body: fd,
		headers: {
			'X-Requested-With': 'XMLHttpRequest',
			'X-CSRF-TOKEN': ctx.token,
			Cookie: ctx.cookie
		}
	});
	if (!res.ok) throw new Error(`POST ${roofingSlug} ${length}x${width} → HTTP ${res.status}`);
	return res.json();
}

function cenyPreModel(json, modelKod) {
	const c = json.calculate?.find((x) => x.value === modelKod);
	if (!c) return null;
	const mo = c2(c.price);
	const vo = c2(c.priceB2B);
	return mo > 0 && vo > 0 ? [mo, vo] : null;
}

async function main() {
	console.error('GET kontext (token / valid_from / cookie) …');
	const ctx = await ziskajKontext();

	const cennik = {};
	const verifikaciaDph = [];
	let volani = 0;

	for (const [vyplnKluc, slug] of Object.entries(VYPLNE)) {
		// dostupnosť roofingu — sonda na referenčných bunkách
		let dostupny = false;
		for (const [d, w] of REFERENCNE) {
			const j = await dopyt(ctx, slug, d, w);
			volani++;
			await sleep(DELAY_MS);
			if (Object.values(MODELY).some((kod) => cenyPreModel(j, kod))) {
				dostupny = true;
				break;
			}
		}
		if (!dostupny) {
			console.error(`roofing ${vyplnKluc}: pre pitched neponúkané — vynechávam`);
			continue;
		}

		const perModel = { LIGHT: {}, ROBUST: {}, MASSIVE: {} };
		for (const d of HLBKY) {
			for (const w of SIRKY) {
				const j = await dopyt(ctx, slug, d, w);
				volani++;
				for (const [mKluc, mKod] of Object.entries(MODELY)) {
					const par = cenyPreModel(j, mKod);
					if (!par) continue;
					(perModel[mKluc][kD(d)] ??= {})[kW(w)] = par;
				}
				// VAT verifikačná vzorka: prvá dostupná bunka roofingu (top-level reťazce)
				if (verifikaciaDph.every((v) => v.roofing !== vyplnKluc) && j.variants?.[0]) {
					const topKod = `${j.variants[0].slice(0, 3)}00000`;
					const topKluc = Object.entries(MODELY).find(([, kod]) => kod === topKod)?.[0];
					if (topKluc && cenyPreModel(j, topKod)) {
						verifikaciaDph.push({
							roofing: vyplnKluc,
							model: topKluc,
							hlbkaM: d,
							sirkaM: w,
							moNet: c2(j.calculate.find((x) => x.value === topKod).price),
							moDph: j.priceWithVat,
							voNet: c2(j.calculate.find((x) => x.value === topKod).priceB2B),
							voDph: j.priceB2BWithVat
						});
					}
				}
				await sleep(DELAY_MS);
			}
			console.error(`  ${vyplnKluc} hĺbka ${kD(d)} m hotová`);
		}
		// vynechaj prázdne modely (napr. LIGHT pri izolačnom/panel-izo)
		for (const mKluc of Object.keys(perModel))
			if (Object.keys(perModel[mKluc]).length === 0) delete perModel[mKluc];
		cennik[vyplnKluc] = perModel;
		console.error(`roofing ${vyplnKluc}: ${Object.keys(perModel).join(', ')}`);
	}

	const vyplneVSeede = {};
	for (const k of Object.keys(cennik)) vyplneVSeede[k] = VYPLNE[k];

	const seed = {
		meta: {
			zdroj: 'montalu.sk/konfigurator/update-pergolas',
			vytazene: new Date().toISOString(),
			dph: 0.23,
			rodina: 'pitched',
			poznamka:
				'Interim cenník pergol (#279 Fáza A) — replikácia matice montalu.sk. Net MO/VO v EUR; ' +
				'DPH = round(net*1.23, 2). Nie definitívny cenník — šéfove pravidlá (marže/práca/montáž) ' +
				'môžu prísť ako korekcia.',
			mriezka: {
				hlbkaM: { min: 2.0, max: 6.0, krok: 0.5 },
				sirkaM: { min: 4.0, max: 7.5, krok: 0.25 }
			}
		},
		modely: MODELY,
		vyplne: vyplneVSeede,
		priplatky: { kominEur: 250, zaruka5rEur: 600, customRal: null, ledRgb: null },
		cennik,
		verifikaciaDph
	};

	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const out = path.join(root, 'src', 'lib', 'server', 'cennik-pergola.json');
	fs.writeFileSync(out, JSON.stringify(seed, null, '\t') + '\n');
	const buniek = Object.values(cennik).reduce(
		(a, roof) =>
			a +
			Object.values(roof).reduce(
				(b, mod) => b + Object.values(mod).reduce((c, row) => c + Object.keys(row).length, 0),
				0
			),
		0
	);
	console.error(`\nHotovo: ${volani} volaní, ${buniek} buniek → ${out}`);
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
