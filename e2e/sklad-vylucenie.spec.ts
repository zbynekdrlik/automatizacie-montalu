// #461 — RED regression test: „Odobrať z odpisu" na /zasklenia MUSÍ naozaj vylúčiť
// položku z Money odpisu. Na súčasnom kóde (bez fixu) tlačidlo odobrat len vizuálne
// označí položku, ale v odpise ostáva → Money celý doklad ticho zahodí.
//
// Fixture: ZASP00002 (rámový profil Robust) so sklad=0 → SkladVarovania varovanie.
// Zápisové kroky za skipAkLive, do Money nikdy nič nejde.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { collectConsole, loginAs, skipAkLive, vyberFarbuKovania } from './helpers';

const RUN = `VYLUC-${Date.now().toString(36).toUpperCase()}`;

// ZASP00002 = rámový profil Robust (vždy prítomný v Robust 2K zasklenia compute)
const KOD_SKLAD_0 = 'ZASP00002';

test('zasklenia: odobrať z odpisu NAOZAJ vylúči položku z Money xlsx (nie len vizuálne)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);

	// seed snapshot s ZASP00018 sklad=0 (compute vytvori odpis s ním → varovanie)
	fs.writeFileSync(
		'./data/e2e-ceny.json',
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			rows: [
				{
					kod: KOD_SKLAD_0,
					nakupCennik: 10,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: 0
				}
			]
		})
	);

	await loginAs(page);

	// vyplň minimálny Robust zasklenia formulár
	const zak = `${RUN}-Z`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Vylúčenie');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// náhľad sa zobrazil — SkladVarovania varovanie musí byť viditeľné
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	const blok = page.getByTestId('sklad-varovania');
	await expect(blok).toBeVisible();

	// konkrétna položka ZASP00018 sa zobrazuje s varovaním
	const polozka = page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}`);
	await expect(polozka).toBeVisible();

	// klik „Odobrať z odpisu"
	await page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}-odobrat`).click();

	// vizuálne označenie „Odobraná" sa zobrazí
	await expect(page.getByTestId(`sklad-varovania-${KOD_SKLAD_0}-odobrata`)).toBeVisible();

	// odošli odpis (TEST mód — skipAkLive zaistil MONEY_LIVE=0)
	await page.getByTestId('odoslat').click();

	// hotovo krok sa zobrazí
	const vysledok = page.getByTestId('vysledok');
	await expect(vysledok).toContainText('TEST');

	// KĽÚČOVÝ ASSERT: v odpis_polozky tabuľke pre TENTO odpis NESMIE byť ZASP00018
	// Na súčasnom kóde (RED): ZASP00018 tam JE → assert padne.
	// Po fixe (GREEN): ZASP00018 tam NIE JE → assert prejde.
	const db = new Database('./data/e2e.db');
	try {
		const row = db
			.prepare(
				`SELECT COUNT(*) as cnt FROM odpis_polozky
			 WHERE odpis_log_id = (
				 SELECT id FROM odpis_log WHERE zak = ? ORDER BY id DESC LIMIT 1
			 ) AND kod = ?`
			)
			.get(zak, KOD_SKLAD_0) as { cnt: number } | undefined;
		// ak je cnt > 0, položka ostala v odpise aj po odobratí = BUG
		expect(row?.cnt ?? 0).toBe(0);
	} finally {
		db.close();
	}

	expect(consoleMsgs).toEqual([]);
});
