#!/usr/bin/env node
// #410 (Fáza A) — jednorazové vyťaženie interim cenníkovej matice hliníkového oplotenia a brán
// z verejného konfigurátora montalu.sk do verzovaného seedu `src/lib/server/cennik-oplotenie.json`.
//
// Autoritatívny zdroj: `POST montalu.sk/konfigurator/update-fencings`. Read-only — číta len
// cenový endpoint (ten, ktorý wizard volá pri bežnom prezeraní); NIKDY nevolá submit/objednávku.
// Politický delay medzi volaniami.
//
// Overený mechanizmus (Playwright network capture, viď design komentár #410): cenotvorný vstup je
// `type[0]` (typ prvku) + `count[0]` + `height[0]`/`width[0]` (v METROCH) + `calculate[]` =
// `{"model":<kod>}`. Odpoveď `calculate[].price` = MO net, `.priceB2B` = VO net per model; nedostupná
// kombinácia (mimo katalógovej obálky) ⇒ 0. Cena NEZÁVISÍ od farby ani warranty (warranty = plochý
// príplatok len na top-level); počet je LINEÁRNY, takže enumerujeme count=1 (per-unit). DPH = 23 %.
// Model PANDORA má v montalu form kóde `PLBP00001` (ostatné = ich display názov).
//
// Spustenie (mimo CI, potrebuje sieť): `node scripts/konfigurator-oplotenie-cennik-fetch.mjs`
// Nikdy nebeží v CI (externá sieť) — je to regeneračný nástroj seedu.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://montalu.sk';
const ENDPOINT = `${BASE}/konfigurator/update-fencings`;
const PAGE = `${BASE}/konfigurator/oplotenia`;
const DELAY_MS = 150; // politický odstup medzi volaniami

// náš typKod (seed/modul) → montalu `type[0]` slug
const TYPY = {
	diel: 'plotovy-diel',
	kridlova: 'brana|dvojkridlova',
	posuvna: 'brana|posuvna',
	samonosna: 'brana|samonosna',
	branka: 'branka'
};
// náš model kód (seed/modul, = display) → montalu `calculate[]`/`model` kód (PANDORA = PLBP00001)
const MODELY = {
	ARIEL: 'ARIEL',
	BIANCA: 'BIANCA',
	LUNA: 'LUNA',
	NARVI: 'NARVI',
	PANDORA: 'PLBP00001',
	REA: 'REA'
};

// naša mriežka (metre) = presné body zákazníckeho metrového stepera (#333 RozmerStepper):
// výška 0,6..2,2 krok 0,1; šírka 1,0..6,0 krok 0,5. Enumerujeme celú mriežku per typ; montalu vráti
// 0 mimo svojej katalógovej obálky (per-typ) → tú bunku NEUKLADÁME (honest-null = individuálna ponuka).
const VYSKY = [];
for (let h = 6; h <= 22; h += 1) VYSKY.push(h / 10);
const SIRKY = [];
for (let w = 10; w <= 60; w += 5) SIRKY.push(w / 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c2 = (x) => Math.round(x * 100) / 100;
const k1 = (m) => m.toFixed(1);

// DPH half-up presne v centoch (zhoda s montalu PHP round()); naivná FP verzia na detekciu hranice.
const dphExakt = (net) => Math.round((Math.round(net * 100) * 123) / 100) / 100;
const dphNaiv = (net) => Math.round(net * 1.23 * 100) / 100;

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

// jeden POST na cenový endpoint: type + count=1 + height + width (metre) + calculate[] pre všetky
// modely. `model` (voliteľný) nastaví SELECTED model → top-level price/priceWithVat je toho modelu
// (na autoritatívny DPH reťazec). Vráti celý JSON.
async function dopyt(ctx, typSlug, vyskaM, sirkaM, selectedMontaluKod) {
	const fd = new FormData();
	fd.append('_token', ctx.token);
	fd.append('valid_from', ctx.validFrom);
	fd.append('configurator_id', 'fencings');
	fd.append('type[0]', typSlug);
	fd.append('count[0]', '1');
	fd.append('height[0]', String(vyskaM));
	fd.append('width[0]', String(sirkaM));
	if (selectedMontaluKod) fd.append('model', selectedMontaluKod);
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
	if (!res.ok) throw new Error(`POST ${typSlug} ${vyskaM}×${sirkaM} → HTTP ${res.status}`);
	return res.json();
}

function paryPreModel(json, montaluKod) {
	const c = json.calculate?.[`model_${montaluKod}`];
	if (!c) return null;
	const mo = c2(c.price);
	const vo = c2(c.priceB2B);
	return mo > 0 && vo > 0 ? [mo, vo] : null;
}

async function main() {
	console.error('GET kontext (token / valid_from / cookie) …');
	const ctx = await ziskajKontext();

	// cennik[typKod][model][vyskaKluc][sirkaKluc] = [moNet, voNet] (per-unit)
	const cennik = {};
	let volani = 0;
	let buniek = 0;

	for (const [typKod, typSlug] of Object.entries(TYPY)) {
		for (const h of VYSKY) {
			for (const w of SIRKY) {
				const j = await dopyt(ctx, typSlug, h, w);
				volani++;
				for (const [modelKod, montaluKod] of Object.entries(MODELY)) {
					const par = paryPreModel(j, montaluKod);
					if (!par) continue;
					((cennik[typKod] ??= {})[modelKod] ??= {})[k1(h)] ??= {};
					cennik[typKod][modelKod][k1(h)][k1(w)] = par;
					buniek++;
				}
				await sleep(DELAY_MS);
			}
		}
		console.error(`  typ ${typKod} hotový (${volani} volaní)`);
	}

	// DPH parita: autoritatívne montalu reťazce s DPH (top-level price*WithVat pri SELECTED modeli).
	// Vzorky = pár pevných buniek naprieč typmi/modelmi + AUTO-nájdená half-up HRANIČNÁ bunka (kde sa
	// naivné net*1.23 líši od celocentového half-up), aby parity test rozlíšil celocentovú aritmetiku.
	const dphKandidati = [
		['diel', 'REA'],
		['diel', 'NARVI'],
		['posuvna', 'REA'],
		['kridlova', 'ARIEL']
	];
	// hľadaj half-up hranicu naprieč celou maticou (MO alebo VO net)
	let hranica = null;
	for (const [typKod, modely] of Object.entries(cennik)) {
		for (const [modelKod, vysky] of Object.entries(modely)) {
			for (const [hK, riadok] of Object.entries(vysky)) {
				for (const [wK, [mo, vo]] of Object.entries(riadok)) {
					if (dphExakt(mo) !== dphNaiv(mo) || dphExakt(vo) !== dphNaiv(vo)) {
						hranica = { typKod, modelKod, h: Number(hK), w: Number(wK), mo, vo };
						break;
					}
				}
				if (hranica) break;
			}
			if (hranica) break;
		}
		if (hranica) break;
	}
	if (hranica) {
		dphKandidati.unshift([hranica.typKod, hranica.modelKod, hranica.h, hranica.w]);
		console.error(
			`  DPH half-up HRANICA: ${hranica.typKod}/${hranica.modelKod} ${hranica.h}×${hranica.w} ` +
				`MO ${hranica.mo} (exakt ${dphExakt(hranica.mo)} vs naiv ${dphNaiv(hranica.mo)}), ` +
				`VO ${hranica.vo} (exakt ${dphExakt(hranica.vo)} vs naiv ${dphNaiv(hranica.vo)})`
		);
	} else {
		console.error('  DPH half-up hranica sa v matici nenašla (parity test doplní syntetickú).');
	}

	const verifikaciaDph = [];
	const videne = new Set();
	for (const kand of dphKandidati) {
		const [typKod, modelKod] = kand;
		// nájdi platnú bunku pre kandidáta: buď explicitný h×w, alebo prvá dostupná bunka modelu
		let h = kand[2];
		let w = kand[3];
		if (h === undefined || w === undefined) {
			const vysky = cennik[typKod]?.[modelKod];
			if (!vysky) continue;
			const hK = Object.keys(vysky)[0];
			h = Number(hK);
			w = Number(Object.keys(vysky[hK])[0]);
		}
		const kluc = `${typKod}|${modelKod}|${h}|${w}`;
		if (videne.has(kluc)) continue;
		videne.add(kluc);
		const montaluKod = MODELY[modelKod];
		const j = await dopyt(ctx, TYPY[typKod], h, w, montaluKod);
		volani++;
		const par = paryPreModel(j, montaluKod);
		if (!par) continue;
		verifikaciaDph.push({
			typ: typKod,
			model: modelKod,
			vyskaM: h,
			sirkaM: w,
			moNet: par[0],
			moDph: j.priceWithVat,
			voNet: par[1],
			voDph: j.priceB2BWithVat
		});
		await sleep(DELAY_MS);
	}

	const seed = {
		meta: {
			zdroj: 'montalu.sk/konfigurator/update-fencings',
			vytazene: new Date().toISOString(),
			dph: 0.23,
			rodina: 'fencings',
			poznamka:
				'Interim cenník hliníkového oplotenia a brán (#410 Fáza A) — replikácia matice montalu.sk. ' +
				'Net MO/VO v EUR per KUS (count=1); DPH = round(net*1.23, 2) half-up. Cenotvorné osi: ' +
				'typ × model × výška × šírka; počet je lineárny (× v module). Model PANDORA = montalu ' +
				'form kód PLBP00001. Nie definitívny cenník — šéfove pravidlá (#279) môžu prísť ako korekcia.',
			mriezka: {
				vyskaM: { min: 0.6, max: 2.2, krok: 0.1 },
				sirkaM: { min: 1.0, max: 6.0, krok: 0.5 }
			}
		},
		typy: TYPY,
		modely: MODELY,
		cennik,
		verifikaciaDph
	};

	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const out = path.join(root, 'src', 'lib', 'server', 'cennik-oplotenie.json');
	fs.writeFileSync(out, JSON.stringify(seed, null, '\t') + '\n');
	console.error(
		`\nHotovo: ${volani} volaní, ${buniek} buniek, ${verifikaciaDph.length} DPH vzoriek → ${out}`
	);
}

main().catch((e) => {
	console.error('CHYBA:', e.message);
	process.exit(1);
});
