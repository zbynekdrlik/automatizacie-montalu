// Kovanie do Money odpisu (Dominik 2026-07-28) v prehliadači: dielňa musí vidieť
// kusy pred odoslaním a jednostranná FAB musí naozaj zmeniť počty.
//
// Väčšina testov je READ-ONLY („Spočítať" / „Späť"); zápisový test „po odoslaní"
// je za `skipAkLive`, takže proti ostrej appke (MONEY_LIVE=1) sa preskočí.
import { test, expect, type Page } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	waitHydrated,
	vyberFarbuKovania,
	skipAkLive,
	expectSklo,
	vyberSklo
} from './helpers';

const RUN = `E2E-KOV-${Date.now().toString(36).slice(-5)}`;
const FAB = 'Jednostranná FAB (menej kľučiek a krytiek vložky v odpise)';

async function zaklad(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Kovanie');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
}

const riadok = (page: Page, kod: string) =>
	page.getByTestId('kovanie-karta').locator('.row', { hasText: kod });

test('Robust 2K: kovanie je v náhľade s kusmi aj tesneniami', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '01');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	// 2 krídla → 4 kladky; 2 uzávery → 4 kľučky (obojstranná FAB je predvolená)
	await expect(riadok(page, 'ZASK00027')).toContainText('4 ks');
	await expect(riadok(page, 'ZASK00029')).toContainText('2 ks');
	await expect(riadok(page, 'ZASK202533')).toContainText('4 ks');
	// rohovník obvodový podľa 2K koľajnice
	await expect(riadok(page, 'ZASK00037')).toContainText('8 ks');
	// tesnenie je metrážové
	await expect(riadok(page, 'ZASK20242')).toContainText(' m');

	expect(errs).toEqual([]);
});

test('jednostranná FAB zníži kľučky a krytky, ostatné počty nechá', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '02');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('3K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await expect(riadok(page, 'ZASK202533')).toContainText('4 ks');
	const kladky = await riadok(page, 'ZASK00027').textContent();

	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await page.getByLabel(FAB).check();
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(riadok(page, 'ZASK202533')).toContainText('2 ks');
	await expect(riadok(page, 'ZASK202535')).toContainText('2 ks');
	expect(await riadok(page, 'ZASK00027').textContent()).toBe(kladky);

	expect(errs).toEqual([]);
});

test('zaškrtnutá FAB prežije „Späť a upraviť"', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '03');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel(FAB).check();
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);

	await expect(page.getByLabel(FAB)).toBeChecked();
	expect(errs).toEqual([]);
});

// #604 (Odoo úloha 1261, Patrik: „štandard neobsahuje kefy, zamykáč a kladku"): Štandard + je
// ten istý systém RS STANDARD → v náhľade odpisu MUSIA byť kladky, protikus, automatický zámok
// zvolenej RAL farby a kefa. Pred #604 karta niesla len tesnenie (#342).
// Množstvá kusov sú pevné (krídla/zámky = štýl, nie cfg vzorec); kefa v metroch sa
// nepíše natvrdo — post-deploy E2E beží proti PROD cfg (testing.md #555).
const kusy = (page: Page, kod: string) => riadok(page, kod).locator('b');

test('Štandard + 2K: kovanie RS STANDARD v náhľade — kladka, protikus, zámok R9005, kefa (#604)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '04');
	await page.getByLabel('Systém').selectOption('Štandard +');
	// STANDARD nemá kľučku/krytku vložky (`naUzaverPodlaFab`) → FAB pole sa neponúka…
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(0);
	// …ale RAL voľba ÁNO: zámok má farebné Money kódy (config-derived z komponentyPre)
	await expect(page.getByTestId('farba-kovania')).toBeVisible();
	await page.getByLabel('Štýl').selectOption('2K');
	// reaktívny sklo-select sa doplní po zmene systému — samostatný krok (race)
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), 'Float sklo 6 mm');
	await vyberFarbuKovania(page, 'R9005');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	// 2 krídla → 4 kladky dvojité; 2 koncové okná → 2 zámky R9005 + 2 protikusy
	await expect(kusy(page, 'ZASK00002')).toHaveText('4 ks');
	await expect(kusy(page, 'ZASK20252')).toHaveText('2 ks');
	// názov „… R9005" končí číslicou → assert na izolovaný <b> (money-odpis 2o)
	await expect(kusy(page, 'ZASK202531')).toHaveText('2 ks');
	await expect(riadok(page, 'ZASK202532')).toHaveCount(0); // R7016 zámok NEJDE
	// kefa = kladkový profil × 2 — metrážová, nenulová
	await expect(kusy(page, 'ZASK00007')).toHaveText(/^[1-9]\d*(,\d+)? m$/);
	// tesnenie (#342) ostáva
	await expect(riadok(page, 'ZASK00006')).toContainText(' m');
	// ZASK202541 ostáva honest-null ako pri Štandarde → viditeľná hláška
	await expect(page.getByTestId('plan-warn')).toContainText('ZASK202541');
	// profily sa odpisujú ako doteraz
	await expect(page.getByText('Odpis (do Money)')).toBeVisible();

	expect(errs).toEqual([]);
});

test('Štandard + opona 2x3K R7016: 3 zámky R7016, 3 protikusy, 12 kladiek (#604)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '09');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x3K');
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), 'Float sklo 6 mm');
	await vyberFarbuKovania(page, 'R7016');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(kusy(page, 'ZASK00002')).toHaveText('12 ks');
	await expect(kusy(page, 'ZASK202532')).toHaveText('3 ks');
	await expect(riadok(page, 'ZASK202531')).toHaveCount(0); // R9005 zámok NEJDE
	await expect(kusy(page, 'ZASK20252')).toHaveText('3 ks');
	await expect(kusy(page, 'ZASK00007')).toHaveText(/^[1-9]\d*(,\d+)? m$/);

	expect(errs).toEqual([]);
});

test('Štandard + po odoslaní (TEST priečinok): kovanie je aj na potvrdzovacej obrazovke (#604)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page); // zápisový test — NIKDY proti LIVE Money
	await zaklad(page, '10');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('3K');
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), 'Float sklo 6 mm');
	await vyberFarbuKovania(page, 'R9005');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	// TEST režim (MONEY_LIVE nie je 1) — zapisuje sa do testovacieho priečinka, nie do Money
	await page.getByRole('button', { name: /Odoslať odpis/ }).click();
	await waitHydrated(page);

	// to, čo odišlo do súboru, je vidieť aj tu — 3 krídla → 6 kladiek, 2 zámky R9005
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(kusy(page, 'ZASK00002')).toHaveText('6 ks');
	await expect(kusy(page, 'ZASK202531')).toHaveText('2 ks');
	await expect(kusy(page, 'ZASK20252')).toHaveText('2 ks');

	expect(errs).toEqual([]);
});

test('zimná záhrada: kusy sa sčítajú za oba posuvy', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '05');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByRole('button', { name: /Pridať zasklenie/ }).click();
	await page.locator('#ps0-s').fill('3500');
	await page.locator('#ps0-v').fill('2100');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();
	await waitHydrated(page);

	// 2 posuvy × 2 krídla × 2 ks = 8 kladiek, 2 × 8 = 16 rohovníkov obvodových
	await expect(riadok(page, 'ZASK00027')).toContainText('8 ks');
	await expect(riadok(page, 'ZASK00037')).toContainText('16 ks');

	expect(errs).toEqual([]);
});

test('po odoslaní vidno kovanie aj na potvrdzovacej obrazovke', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await zaklad(page, '06');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	// TEST režim (MONEY_LIVE nie je 1) — zapisuje sa do testovacieho priečinka, nie do Money
	await page.getByRole('button', { name: /Odoslať odpis/ }).click();
	await waitHydrated(page);

	// to, čo odišlo do súboru, musí byť vidieť aj tu — inak dielňa nevie, že kusy odišli
	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(riadok(page, 'ZASK00027')).toContainText('4 ks');

	expect(errs).toEqual([]);
});

test('Deluxe: FAB skryté (nemá FAB položky), kovanie ide, predvolené sklo 10 mm (#431)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '07');

	// Robust má FAB položky (kľučka/krytka vložky, `naUzaverPodlaFab`) → checkbox JE —
	// pozitívna kontrola, aby test odlíšil „vždy skryté" od „správne skryté".
	await page.getByLabel('Systém').selectOption('Robust');
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(1);

	// Deluxe kovanie FAB položky NEMÁ (krytky sú naStyk/konst, madlo) → checkbox NIE JE
	// (Patrik #431 „Delux odstrániť ... Jednostranná FAB").
	await page.getByLabel('Systém').selectOption('Deluxe');
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(0);
	// predvolené sklo pre Deluxe = 10 mm (predtým prvé v poradí = 6 mm) — Patrik #431
	await expectSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), 'Float kalené 10 mm');

	// ...ale Deluxe kovanie DO Money IDE — karta kovania sa po výpočte zobrazí (skrytie
	// FAB checkboxu nesmie skryť samotné kovanie, to gate-uje `kovanie?.length`, nie FAB).
	await page.getByLabel('Štýl').selectOption('3K');
	await vyberFarbuKovania(page, 'R9006');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('kovanie-karta')).toBeVisible();

	expect(errs).toEqual([]);
});

test('mixed objednávka Deluxe + Robust posuv: FAB sa vráti (order-level únia), späť skryté (#431)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '08');

	// primárny Deluxe → FAB skryté (Deluxe nemá FAB položky)
	await page.getByLabel('Systém').selectOption('Deluxe');
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(0);

	// pridaj ďalší posuv a nastav ho na Robust → FAB sa MUSÍ zobraziť. `maFab` je únia
	// naprieč posuvmi (ako `maFarbu`): inak by mixed objednávka o FAB pre Robust posuv
	// prišla — presne tá regresia, ktorej sa únia bráni (nie primary-only gate).
	await page.getByRole('button', { name: /Pridať zasklenie/ }).click();
	await page.locator('#ps0-sys').selectOption('Robust');
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(1);

	// extra posuv späť na Deluxe → žiadny posuv v hre nemá FAB položky → skryté
	// (kryje aj reset $effect, ktorý vynuluje prípadnú zaseknutú hodnotu).
	await page.locator('#ps0-sys').selectOption('Deluxe');
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(0);

	expect(errs).toEqual([]);
});
