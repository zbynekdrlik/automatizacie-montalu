#!/usr/bin/env node
// #404 (Fáza A) — jednorazové vyťaženie interim cenníkovej matice bazénových zastrešení
// z verejného konfigurátora montalu.sk do verzovaného seedu `src/lib/server/cennik-bazen.json`.
//
// Autoritatívny zdroj: `POST montalu.sk/konfigurator/update-pools`. Read-only — číta len
// cenový endpoint (ten, ktorý wizard volá pri bežnom prezeraní); NIKDY nevolá submit/objednávku.
// Politický delay medzi volaniami.
//
// Overený mechanizmus (Playwright network capture, viď design komentár #404): cenotvorný vstup je
// `length`/`width` (m) + `segments_length` (standardna|skratena); `calculate[]` vracia MO (`price`)
// + VO (`priceB2B`) net per model pre zvolený segments_length; nedostupná kombinácia ⇒ `0`. Orientačná
// cena = `segments_length=standardna` (bázová, default). DPH = 23 %. Bazénová cena NEZÁVISÍ od farby/
// warranty/parts[]/výšky/počtu segmentov/koľaje — len model × length × width × segments_length.
//
// Spustenie (mimo CI, potrebuje sieť): `node scripts/konfigurator-bazen-cennik-fetch.mjs`
// Nikdy nebeží v CI (externá sieť) — je to regeneračný nástroj seedu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-pools`;
const PAGE = `${BASE}/konfigurator/zastresenia-bazenov`;
const DELAY_MS = 250; // politický odstup medzi volaniami
const SEGMENTS = 'standardna'; // bázový (default) segment — orientačná cena

// montalu.sk model kódy (kľúč modulu → cenotvorný `calculate[]` model kód)
const MODELY = { Premier: 'PBPPP00001', Star: 'PBSPP00001', Exclusive: 'PBEPP00001' };
// naša mriežka (metre) = presné body na montalu osiach (length round-nearest 0,5; width floor 0,25)
const DLZKY = []; // 3.0 .. 15.0 krok 0.5 (montalu `length`)
for (let d = 30; d <= 150; d += 5) DLZKY.push(d / 10);
const SIRKY = []; // 2.0 .. 7.0 krok 0.5 (montalu `width`)
for (let w = 20; w <= 70; w += 5) SIRKY.push(w / 10);
// referenčné bunky na vzorku DPH (montalu vlastný zaokrúhlený reťazec s DPH). Premier 8,5×6,0 je
// zámerne HRANIČNÁ bunka half-up: VO net 13732,5 → s DPH 16 890,98 (naivné FP `net*1.23` dá 16 890,97),
// takže parity test na nej odlíši celocentový half-up od naivného zaokrúhlenia.
const DPH_VZORKY = [
	[4, 3],
	[6, 4],
	[8, 5],
	[8.5, 6]
];

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

async function dopyt(ctx, dlzkaM, sirkaM) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('variants', 'PBSPP00143'); // server prepočíta z length+width+model; ľubovoľný validný
	fd.append('configurator_id', 'pools');
	fd.append('length', String(dlzkaM));
	fd.append('width', String(sirkaM));
	fd.append('segments_length', SEGMENTS);
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
	if (!res.ok) throw new Error(`POST ${dlzkaM}x${sirkaM} → HTTP ${res.status}`);
	return res.json();
}

function paryPreModel(json, modelKod) {
	const c = json.calculate?.find((x) => x.value === modelKod);
	if (!c) return null;
	const mo = c2(c.price);
	const vo = c2(c.priceB2B);
	return mo > 0 && vo > 0 ? [mo, vo] : null;
}

async function main() {
	console.error('GET kontext (token / valid_from / cookie) …');
	const ctx = await ziskajKontext();

	const cennik = { Premier: {}, Star: {}, Exclusive: {} };
	const verifikaciaDph = [];
	let volani = 0;

	// vzorka DPH — montalu vlastné zaokrúhlené reťazce s DPH (top-level = zvolený model, spárujeme net)
	for (const [d, w] of DPH_VZORKY) {
		const j = await dopyt(ctx, d, w);
		volani++;
		const topMo = parseCena(j.price);
		const topModel = Object.entries(MODELY).find(([, kod]) => {
			const c = j.calculate?.find((x) => x.value === kod);
			return c && c2(c.price) === topMo;
		})?.[0];
		if (topModel) {
			verifikaciaDph.push({
				model: topModel,
				dlzkaM: d,
				sirkaM: w,
				moNet: topMo,
				moDph: j.priceWithVat,
				voNet: parseCena(j.priceB2B),
				voDph: j.priceB2BWithVat
			});
		}
		await sleep(DELAY_MS);
	}

	for (const d of DLZKY) {
		for (const w of SIRKY) {
			const j = await dopyt(ctx, d, w);
			volani++;
			for (const [mKluc, mKod] of Object.entries(MODELY)) {
				const par = paryPreModel(j, mKod);
				if (!par) continue;
				(cennik[mKluc][k1(d)] ??= {})[k1(w)] = par;
			}
			await sleep(DELAY_MS);
		}
		console.error(`  dĺžka ${k1(d)} m hotová`);
	}

	// vynechaj prázdne modely (obranné — všetky 3 by mali mať dáta)
	for (const mKluc of Object.keys(cennik))
		if (Object.keys(cennik[mKluc]).length === 0) delete cennik[mKluc];

	const seed = {
		meta: {
			zdroj: 'montalu.sk/konfigurator/update-pools',
			vytazene: new Date().toISOString(),
			dph: 0.23,
			rodina: 'pools',
			segmentsLength: SEGMENTS,
			poznamka:
				'Interim cenník bazénových zastrešení (#404 Fáza A) — replikácia matice montalu.sk. ' +
				'Net MO/VO v EUR; DPH = round(net*1.23, 2) half-up. Cenotvorné osi: model × dĺžka × šírka ' +
				'(segments_length=standardna). Nie definitívny cenník — šéfove pravidlá (#279) môžu prísť ' +
				'ako korekcia.',
			mriezka: {
				dlzkaM: { min: 3.0, max: 15.0, krok: 0.5 },
				sirkaM: { min: 2.0, max: 7.0, krok: 0.5 }
			}
		},
		modely: MODELY,
		cennik,
		verifikaciaDph
	};

	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const out = path.join(root, 'src', 'lib', 'server', 'cennik-bazen.json');
	fs.writeFileSync(out, JSON.stringify(seed, null, '\t') + '\n');
	const buniek = Object.values(cennik).reduce(
		(a, mod) => a + Object.values(mod).reduce((b, row) => b + Object.keys(row).length, 0),
		0
	);
	console.error(`\nHotovo: ${volani} volaní, ${buniek} buniek → ${out}`);
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
