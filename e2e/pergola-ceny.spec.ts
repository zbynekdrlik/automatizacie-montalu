// #232: ceny materiálu v pergolovom rozpise (Rezervačný odpis /pergola/narez) cez
// REÁLNY prehliadač — „cena neznáma" bez snapshotu (honest-null), reálna (VYMYSLENÁ)
// cena so seednutým fixture snapshotom vrátane ručného riadku #234, NOPRINT (v tlači
// skrytý — dielňa cenu nevidí) a b2b redirect (b2b sa na /pergola vôbec nedostane).
// VŠETKY ceny TU sú VYMYSLENÉ (repo je verejné — nikdy reálnu Money cenu). PRP20242 =
// „Profil 110x110 V2" (predná noha), PRP202410 = „Profil 110x43" (bočný), PRP202526 =
// „Žlab 110" (známy katalógový kód pre ručný riadok). Nula console errors všade.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { collectConsole, loginAs, goto, waitHydrated, logout } from './helpers';

const RUN = `PC-${Date.now().toString(36).toUpperCase()}`;

// rozmery štandardnej pergoly (rovnaký vektor ako e2e/pergola-rezervacia.spec) →
// nenulové PRP profily vrátane PRP20242 (predná noha) a PRP202410 (bočný)
async function napergolu(page: import('@playwright/test').Page) {
	await goto(page, '/pergola/narez');
	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('5000');
	await page.locator('#hlbka').fill('3500');
	await page.locator('#pocetPrednychNoh').fill('4');
}

// materiál z rozmerov (krok „vysledok") — až tu je viditeľná ručná karta (#234)
async function spocitaj(page: import('@playwright/test').Page) {
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
}

// ZAK/OP/zákazník → Money rozpis (krok „rez-nahlad") — tu žije cenový blok
async function pripravit(page: import('@playwright/test').Page, zak: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('OP260232');
	await page.getByLabel('Zákazník *').fill('E2E Ceny Pergola');
	await page.getByTestId('pripravit-rezervaciu').click();
	await waitHydrated(page);
}

async function doRozpisu(page: import('@playwright/test').Page, zak: string) {
	await spocitaj(page);
	await pripravit(page, zak);
}

test('kód bez ceny v snapshote → „cena neznáma", súčet neúplný (honest-null)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	// lokálny beh: zmaž fixture (post-deploy beh proti BASE_URL naň nemá prístup — no-op).
	// POZN.: E2E DB je ZDIEĽANÁ medzi spec súbormi — zmazanie SÚBORU nevynuluje už
	// naimportovanú snapshot-metu v DB (iný spec mohol seednúť skôr), takže netvrdíme
	// „snapshot nebol naimportovaný" (to platí len na čistej DB). Testujeme honest-null,
	// ktorý platí VŽDY: pergolové PRP kódy NIE SÚ v žiadnom seede → „cena neznáma".
	if (!process.env.BASE_URL) fs.rmSync('./data/e2e-ceny.json', { force: true });
	await loginAs(page);
	await napergolu(page);
	await doRozpisu(page, `${RUN}-BEZ`);

	await expect(page.getByTestId('ceny-tabulka')).toBeVisible();
	await expect(page.getByTestId('ceny-snapshot-vek')).toBeVisible(); // vek snapshotu je vždy
	// PRP kódy nie sú v žiadnom snapshote → čestne „cena neznáma", súčet neúplný
	await expect(page.getByTestId('cena-nakup-cennik-PRP20242')).toHaveText('cena neznáma');
	await expect(page.getByTestId('ceny-sucet-nakup-cennik')).toContainText('neúplné');
	expect(consoleMsgs).toEqual([]);
});

test('so seednutým snapshotom appka ukáže reálnu (vymyslenú) cenu profilu + ručného riadku; chýbajúci kód ostáva „cena neznáma"', async ({
	page
}) => {
	// beh proti nasadenej appke (BASE_URL) nemá prístup k jej kontajnerovému FS —
	// fixture sa dá napísať LEN pri lokálnom preview serveri
	test.skip(
		!!process.env.BASE_URL,
		'post-deploy: nedá sa zapísať fixture do vzdialeného kontajnera'
	);
	const consoleMsgs = collectConsole(page);
	fs.writeFileSync(
		'./data/e2e-ceny.json',
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			rows: [
				// PRP20242 ocenené, PRP202410 zámerne NIE (honest-null); ceny sú VYMYSLENÉ
				{
					kod: 'PRP20242',
					nakupCennik: 12.5,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: 20
				},
				// ručný riadok #234 (PRP202526) tiež ocenený — cena sa napojí aj na ručné položky
				{
					kod: 'PRP202526',
					nakupCennik: 4.8,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: null
				}
			]
		})
	);
	await loginAs(page);
	await napergolu(page);
	await spocitaj(page); // ručná karta (#234) je viditeľná až v kroku „vysledok"
	// pridaj ručný riadok #234 (PRP202526, m) — cena sa naň má napojiť tiež
	await page.getByTestId('rucne-kod').fill('PRP202526');
	await page.getByTestId('rucne-nazov').fill('Kotviaci profil pometraný');
	await page.getByTestId('rucne-mnozstvo').fill('3,5');
	await page.getByTestId('rucne-mj').selectOption('m');
	await page.getByTestId('rucne-pridat').click();
	await pripravit(page, `${RUN}-CENA`);

	await expect(page.getByTestId('ceny-snapshot-vek')).toContainText('Ceny zo snapshotu Money k');
	// spočítaný profil s cenou
	const profil = page.getByTestId('cena-nakup-cennik-PRP20242');
	await expect(profil).toContainText('€');
	await expect(profil).not.toHaveText('cena neznáma');
	// ručný riadok #234 s cenou
	await expect(page.getByTestId('cena-nakup-cennik-PRP202526')).toContainText('€');
	// chýbajúci kód ostáva čestne „cena neznáma"
	await expect(page.getByTestId('cena-nakup-cennik-PRP202410')).toHaveText('cena neznáma');
	// súčet nesie reálnu hodnotu a zároveň sa prizná ako neúplný (chýbajúce ceny)
	const sucet = page.getByTestId('ceny-sucet-nakup-cennik');
	await expect(sucet).toContainText('€');
	await expect(sucet).toContainText('neúplné');
	expect(consoleMsgs).toEqual([]);
});

test('cenový blok je NOPRINT — v tlačovom náhľade skrytý (dielňa cenu nevidí)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	if (!process.env.BASE_URL) fs.rmSync('./data/e2e-ceny.json', { force: true });
	await loginAs(page);
	await napergolu(page);
	await doRozpisu(page, `${RUN}-PRINT`);

	const blok = page.getByTestId('ceny-tabulka');
	await expect(blok).toBeVisible(); // na obrazovke viditeľný
	await page.emulateMedia({ media: 'print' });
	await expect(blok).toBeHidden(); // v tlači skrytý (.noprint)
	await page.emulateMedia({ media: 'screen' });
	expect(consoleMsgs).toEqual([]);
});

test('b2b: /pergola/narez je presmerovaná preč — cenový blok b2b nikdy neuvidí', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	page.on('dialog', (d) => d.accept());
	const b2bUser = `e2e-pergola-ceny-b2b-${Date.now().toString(36)}`;
	const b2bPass = 'e2eheslo1';
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(b2bUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(b2bPass);
	await page.getByRole('button', { name: 'Pridať účet' }).click(); // rola defaultne B2B
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	await logout(page);
	await loginAs(page, b2bUser, b2bPass);

	// priamy prístup na /pergola/narez presmeruje na /zasklenia (celý /pergola prefix
	// je pre b2b zablokovaný) → cenový blok sa b2b nikdy nevykreslí
	await goto(page, '/pergola/narez');
	await expect(page).toHaveURL(/\/zasklenia$/);
	await expect(page.getByTestId('ceny-tabulka')).toHaveCount(0);

	// upratanie
	await logout(page);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.locator('tr', { hasText: b2bUser }).getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');

	expect(consoleMsgs).toEqual([]);
});
