// Kovanie do Money odpisu (Dominik 2026-07-28) v prehliadači: dielňa musí vidieť
// kusy pred odoslaním a jednostranná FAB musí naozaj zmeniť počty.
//
// Väčšina testov je READ-ONLY („Spočítať" / „Späť"); zápisový test „po odoslaní"
// je za `skipAkLive`, takže proti ostrej appke (MONEY_LIVE=1) sa preskočí.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania, skipAkLive } from './helpers';

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

test('Štandard +: bez kovania kusov (žiadne FAB pole), ale karta má tesnenie (#342)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '04');
	await page.getByLabel('Systém').selectOption('Štandard +');
	// Štandard + nemá kovanie kusy (komponentyPre vráti null pre tento systém) →
	// FAB pole sa vôbec neponúka, presne ako predtým.
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(0);
	await page.getByLabel('Štýl').selectOption('2K');
	// reaktívny sklo-select sa doplní po zmene systému — samostatný krok (race)
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float sklo 6 mm');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// #342 round 2: Štandard + je v TESNENIE_SYSTEMY, takže karta „Kovanie a
	// tesnenia" sa zobrazí s tesnením — nie je prázdna ako pred #342.
	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(riadok(page, 'ZASK00006')).toContainText(' m');
	// profily sa odpisujú ako doteraz
	await expect(page.getByText('Odpis (do Money)')).toBeVisible();

	expect(errs).toEqual([]);
});

test('Štandard + 4 mm: odpis má tesnenie ZASK00005 (dĺžka kladkový-only, #342 kolo 2)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '4a');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float sklo 4 mm');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// 4 mm → ZASK00005 (metrážové; dĺžka = súčet šírok kladkových profilov), NIE 6 mm kód
	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(riadok(page, 'ZASK00005')).toContainText(' m');
	await expect(riadok(page, 'ZASK00006')).toHaveCount(0);
	await expect(page.getByText('Odpis (do Money)')).toBeVisible();

	expect(errs).toEqual([]);
});

test('Štandard + IZO: žiadne zasklievacie tesnenie (bez gumy, #342 kolo 2)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '4b');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	// reaktívny sklo-select sa doplní po zmene systému — samostatný krok (race)
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Izolačné sklo 4/8/4 číre');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// IZO → žiadny tesnenie riadok (Dominik: „pre izolačne … ide bez gumy"). Štandard +
	// nemá ani kovanie kusy, takže karta „Kovanie a tesnenia (do Money)" sa vôbec nezobrazí.
	await expect(page.getByText('Odpis (do Money)')).toBeVisible();
	await expect(page.getByTestId('kovanie-karta')).toHaveCount(0);

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
	await expect(page.getByLabel('Sklo (základ — určuje vzorec)')).toHaveValue('Float kalené 10 mm');

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
