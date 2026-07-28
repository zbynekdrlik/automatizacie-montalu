// E2E cez reálny prehliadač: login, celý zasklenia tok (náhľad → odoslanie →
// duplikát), editor vzorcov (zmena + návrat), verzia v pätičke. Každý test
// vyžaduje NULA console errors/warnings (browser-console-zero-errors).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive } from './helpers';

// unikátna ZAK pre každý beh — dedup je perzistentný
const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

test('login: zlé heslo zobrazí chybu, správne prihlási; verzia v pätičke', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/login');
	await page.getByLabel('Meno').fill('e2e');
	await page.getByLabel('Heslo').fill('zle-heslo');
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	await expect(page.getByTestId('login-error')).toContainText('Nesprávne');

	await loginAs(page);
	await expect(page.getByTestId('version')).toHaveText(/^v.+/);
	await expect(page.getByTestId('mode')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('neprihlásený je presmerovaný na login', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/zasklenia');
	await expect(page).toHaveURL(/\/login/);
	expect(consoleMsgs).toEqual([]);
});

test('zasklenia: náhľad → odoslanie → duplikát', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	// 1. formulár → náhľad (bez zápisu)
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// hlavička ukazuje OP/OPDL · zákazník (Dominik 2026-07-23: bez „Nárezový plán", OP nie ZAK)
	await expect(page.locator('h1')).toContainText('01 · E2E Test');
	await expect(page.locator('h1')).not.toContainText('Nárezový plán');
	// overené hodnoty z 1:1 testov: sklo 1129 × 1725 (zaokrúhlené na celé mm), odpis 15/15/7,5
	await expect(page.getByTestId('sklo-sirka')).toHaveText('1129');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('1725');
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	// profil je na viacerých miestach (materiál, odpis, rozpis rezov) — over odpis riadok
	await expect(page.locator('.row', { hasText: 'ZASP00014' })).toContainText('15 m');

	// 2. odoslanie (TEST režim)
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText(RUN);
	await expect(page.getByTestId('vysledok')).toContainText('OP01');
	await expect(page.getByRole('button', { name: /Tlačiť/ })).toBeVisible();

	// 3. nový plán → rovnaká ZAK+OP → duplikát, nič sa nezapíše
	await page.getByRole('link', { name: /Nový nárezový plán/ }).click();
	await waitHydrated(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	await page.getByLabel('Šírka (mm) *').fill('2000');
	await page.getByLabel('Výška (mm) *').fill('1800');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');
	await page.getByRole('link', { name: /Späť na formulár/ }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue('');

	// 4. iná OP tej istej ZAK prejde
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('02');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('OP02');

	// 5. história odpisov obsahuje oba záznamy
	await page.getByRole('link', { name: 'História', exact: true }).click();
	await expect(page.getByTestId('odpisy-tabulka')).toContainText(RUN);
	expect(consoleMsgs).toEqual([]);
});

// Poznámka (viacriadková, vľavo) + RAL (veľkým, vpravo) na nárezovom pláne aj v tlači;
// Money „Odoslané… .xlsx" riadok sa v TLAČI NEZOBRAZUJE (na obrazovke ostáva). Dominik
// 2026-07-23. Poznámka + RAL sú DISPLAY-only — do Money odpisu nejdú.
test('nárezový plán: poznámka (pod seba) + RAL veľkým; Money box preč z tlače', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PR`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Poznámka');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByLabel(/Poznámka/).fill('Pozor na ľavé krídlo\nDodať do piatku\nMontáž 5.8.');
	await page.getByLabel(/RAL \(farba\)/).fill('7016');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// poznámka + RAL box na pláne
	await expect(page.getByTestId('poznamka-ral')).toBeVisible();
	await expect(page.getByTestId('ral-val')).toHaveText('7016');
	await expect(page.locator('.poznamka-plan')).toContainText('Pozor na ľavé krídlo');
	await expect(page.locator('.poznamka-plan')).toContainText('Montáž 5.8.');

	// v tlači poznámka + RAL ostáva
	await page.emulateMedia({ media: 'print' });
	await expect(page.getByTestId('poznamka-ral')).toBeVisible();
	await expect(page.getByTestId('ral-val')).toBeVisible();
	await page.emulateMedia({ media: 'screen' });

	// odoslanie (TEST) → Money potvrdenie na obrazovke, ale NIE v tlači
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await page.emulateMedia({ media: 'print' });
	await expect(page.getByTestId('vysledok')).toBeHidden(); // Money box preč z tlače
	await expect(page.getByTestId('poznamka-ral')).toBeVisible(); // poznámka+RAL ostáva
	await page.emulateMedia({ media: 'screen' });
	await expect(page.getByTestId('vysledok')).toBeVisible(); // na obrazovke stále je

	expect(consoleMsgs).toEqual([]);
});

// Deluxe (posuvná sklenená stena) — READ-ONLY náhľad (nič sa nezapisuje do Money).
// Kľúč (Dominik 2026-07-10): HRÚBKA SKLA (6/10) vyberá kladka/klzný profil, nie štýl.
// 10mm sklo → kladka ZASP202417; 6mm sklo → ZASP202416; množstvo rovnaké, líši sa LEN
// kód. + per-profil dĺžka tyče: 5K horná koľajnica 6000mm (→ 6 m), kladka 3600mm (→ 7,2 m).
test('Deluxe 5K: hrúbka skla (6/10) vyberá kladka/klzný profil (Dominik) + per-profil tyč', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-DLX`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Deluxe');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('5K');
	await page.getByLabel('Šírka (mm) *').fill('4500');
	await page.getByLabel('Výška (mm) *').fill('2400');

	// --- 10mm sklo → kladka/klzný 10mm (ZASP202417/425) ---
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 10 mm');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	// sklo (len plán, nie Money) — 908 × 2318, rovnaké pre 6 aj 10
	await expect(page.getByTestId('sklo-sirka')).toHaveText('908');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('2318');
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	// 5K horná koľajnica ZASP202434 = 6000mm tyč → 6 m; kladka 10mm ZASP202417 → 7,2 m.
	// (^|\D) hranica — aby "6 m" nechytilo napr. "16 m" v inom stĺpci riadku
	await expect(page.locator('.row', { hasText: 'ZASP202434' })).toContainText(/(^|\D)6 m/);
	await expect(page.locator('.row', { hasText: 'ZASP202417' })).toContainText(/(^|\D)7,2 m/);
	// 10mm sklo NESMIE ponúkať 6mm kladku
	await expect(page.locator('.row', { hasText: 'ZASP202416' })).toHaveCount(0);

	// --- prepni na 6mm sklo → kladka/klzný 6mm (ZASP202416/424), množstvo ROVNAKÉ ---
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 6 mm');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	// teraz 6mm kladka ZASP202416 = 7,2 m (rovnaké množstvo ako 10mm — len iný kód)
	await expect(page.locator('.row', { hasText: 'ZASP202416' })).toContainText(/(^|\D)7,2 m/);
	// a 10mm kladka už NIE je v pláne
	await expect(page.locator('.row', { hasText: 'ZASP202417' })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

// Štandard + (basic/IZO/opona) — READ-ONLY náhľad (nič sa nezapisuje do Money).
// 2K IZO @ S=3000 V=2400 overené 1:1 proti Money odpisu (U profil ZASP202439 21,6 m).
// Dominik 2026-07-15: veľkosť spodnej koľajnice NEurčuje IZO — IZO používa NORMÁLNU
// (2K = ZASP00104); o 1 väčšiu (ZASP00030) dá až checkbox „prídavná koľajnica".
test('Štandard + 2K IZO: normálna koľajnica + „prídavná koľajnica" checkbox → o 1 väčšia', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-SPL`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Standard Plus');
	await page.getByLabel('Systém').selectOption('Štandard +');
	// IZO nárezák vyberá SKLO (Patrik 2026-07-27) — štýl nesie len počet krídel
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Izolačné sklo 4.8.4');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// sklo (len plán, nie Money) — 1417 × 2265 (šírka +2mm oprava)
	await expect(page.getByTestId('sklo-sirka')).toHaveText('1417');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('2265');
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	// IZO používa NORMÁLNU spodnú koľajnicu ZASP00104 (2K), NIE zväčšenú ZASP00030
	await expect(page.locator('.row', { hasText: 'ZASP00107' })).toContainText(/(^|\D)7,5 m/);
	await expect(page.locator('.row', { hasText: 'ZASP00104' })).toContainText(/(^|\D)7,5 m/);
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toHaveCount(0);
	await expect(page.locator('.row', { hasText: 'ZASP202439' })).toContainText(/(^|\D)21,6 m/);

	// zaklikni „prídavná koľajnica" → spodná o 1 väčšia (ZASP00030), metre rovnaké
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.getByLabel(/Prídavná koľajnica/).check();
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toContainText(/(^|\D)7,5 m/);
	await expect(page.locator('.row', { hasText: 'ZASP00104' })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada: viac posuvov → spoločný plán s posuv labelmi (náhľad)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page); // náhľad NEzapisuje → bezpečné aj na LIVE, žiadny skipAkLive
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-ZZ`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Zimná záhrada');
	// primárny posuv (posuv 1)
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	// pridaj druhý posuv a vyplň jeho rozmery (id ps0-*)
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-s').fill('2509');
	await page.locator('#ps0-v').fill('1930');
	await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();

	// badge ťahá NÁZOV SYSTÉMU, nie paušálne „Zimná záhrada" (Patrik 2026-07-28)
	await expect(page.getByTestId('plan-badge')).toHaveText('Robust · 2 posuvy');

	// súhrn posuvov + spoločný odpis + rozpis so značkami P1/P2
	// (Posuv 1/2 je aj v tabuľke aj v náhľade → .first())
	await expect(page.getByText('Posuv 1').first()).toBeVisible();
	await expect(page.getByText('Posuv 2').first()).toBeVisible();
	await expect(page.locator('.row', { hasText: 'ZASP00002' })).toBeVisible();
	await expect(page.locator('.pbadge').first()).toBeVisible();
	// je tam tlačidlo na odoslanie (ale my ho v teste NEklikáme)
	await expect(page.getByTestId('odoslat-multi')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('späť a upraviť: formulár si ZACHOVÁ hodnoty (nevynuluje sa)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page); // náhľad nezapisuje → bezpečné aj na LIVE
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BACK`);
	await page.getByLabel('OP/OPDL číslo *').fill('07');
	await page.getByLabel('Zákazník *').fill('Späť Test');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	// späť a upraviť → formulár musí byť predvyplnený (nie prázdny)
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue(`${RUN}-BACK`);
	await expect(page.getByLabel('OP/OPDL číslo *')).toHaveValue('07');
	await expect(page.getByLabel('Zákazník *')).toHaveValue('Späť Test');
	await expect(page.getByLabel('Šírka (mm) *')).toHaveValue('2509');
	await expect(page.getByLabel('Výška (mm) *')).toHaveValue('1930');
	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada: „Späť a upraviť" zachová primárny aj extra posuv', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page); // upravitMulti nezapisuje → bezpečné aj na LIVE
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-MB`);
	await page.getByLabel('OP/OPDL číslo *').fill('03');
	await page.getByLabel('Zákazník *').fill('E2E Multi Späť');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-s').fill('2509');
	await page.locator('#ps0-v').fill('1930');
	await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();
	await expect(page.getByTestId('odoslat-multi')).toBeVisible();

	// „Späť a upraviť" → primárny sa obnoví z posuvy[0], extra z posuvy[1]
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue(`${RUN}-MB`);
	await expect(page.getByLabel('OP/OPDL číslo *')).toHaveValue('03');
	await expect(page.getByLabel('Zákazník *')).toHaveValue('E2E Multi Späť');
	// primárny = #s/#v (getByLabel je nejednoznačný — extra posuv má rovnaký label)
	await expect(page.locator('#s')).toHaveValue('5000');
	await expect(page.locator('#v')).toHaveValue('2000');
	await expect(page.locator('#ps0-s')).toHaveValue('2509');
	await expect(page.locator('#ps0-v')).toHaveValue('1930');
	expect(consoleMsgs).toEqual([]);
});

test('späť a upraviť: zachová aj NE-defaultné polia (systém/štýl/skloPresne/poznámka/čaká)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page); // náhľad nezapisuje → bezpečné aj na LIVE
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-ND`);
	await page.getByLabel('OP/OPDL číslo *').fill('08');
	await page.getByLabel('Zákazník *').fill('NeDefault');
	await page.getByLabel('Systém').selectOption('Slide');
	await page.getByLabel('Štýl').selectOption('3K');
	await page
		.getByLabel('Presné zloženie skla (nepovinné — nemení vzorec)')
		.fill('Stopsol Grey');
	await page.getByLabel(/Poznámka/).fill('Pozn X');
	await page.getByLabel(/RAL \(farba\)/).fill('7016');
	await page.getByLabel(/Čaká na materiál/).check();
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();

	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Systém')).toHaveValue('Slide');
	await expect(page.getByLabel('Štýl')).toHaveValue('3K');
	await expect(
		page.getByLabel('Presné zloženie skla (nepovinné — nemení vzorec)')
	).toHaveValue('Stopsol Grey');
	await expect(page.getByLabel(/Poznámka/)).toHaveValue('Pozn X');
	await expect(page.getByLabel(/RAL \(farba\)/)).toHaveValue('7016');
	await expect(page.getByLabel(/Čaká na materiál/)).toBeChecked();
	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada: odoslanie viac-posuvového odpisu do Money + duplikát', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	const fillMulti = async () => {
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-MO`);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Multi Odoslať');
		await page.getByLabel('Šírka (mm) *').fill('5000');
		await page.getByLabel('Výška (mm) *').fill('2000');
		await page.getByRole('button', { name: /Pridať posuv/ }).click();
		await page.locator('#ps0-s').fill('2509');
		await page.locator('#ps0-v').fill('1930');
		await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();
	};
	await fillMulti();
	await page.getByTestId('odoslat-multi').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText(`${RUN}-MO`);

	// rovnaká ZAK+OP znova → duplikát, nič sa nezapíše
	await page.getByRole('link', { name: /Nový nárezový plán/ }).click();
	await waitHydrated(page);
	await fillMulti();
	await page.getByTestId('odoslat-multi').click();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');
	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada: odobratie posuvu zachová správne indexy a prepne späť na jednoposuv', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-RM`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Odobrať');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	// dva extra posuvy: ps0 = 2509, ps1 = 3000
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-s').fill('2509');
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps1-s').fill('3000');
	// tlačidlo ukazuje 3 posuvy (primárny + 2)
	await expect(page.getByRole('button', { name: /Spočítať spoločný plán \(3 posuvy\)/ })).toBeVisible();

	// odober PRVÝ extra (2509) → zostane ten s 3000 ako nový ps0 (nie 2509)
	await page.getByRole('button', { name: /odobrať/ }).first().click();
	await expect(page.locator('#ps0-s')).toHaveValue('3000');
	await expect(page.getByRole('button', { name: /Spočítať spoločný plán \(2 posuvy\)/ })).toBeVisible();

	// odober aj druhý → späť na jednoposuvový režim
	await page.getByRole('button', { name: /odobrať/ }).first().click();
	await expect(page.getByRole('button', { name: 'Spočítať nárezový plán' })).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('editor: dropdown „Systém · štýl" naviguje a načíta offsety správneho štýlu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia/nastavenia?sysStyl=Robust%7C2K');
	const sklo = page.getByLabel('Sklo — konečné zmenšenie (mm)');
	const robustOff = await sklo.inputValue();

	// prepnutie cez dropdown naviguje na iný štýl a načíta jeho offsety
	await page.getByLabel('Systém · štýl').selectOption('Slide|2K');
	await page.waitForURL(/sysStyl=Slide/);
	await waitHydrated(page);
	const slideOff = await sklo.inputValue();
	expect(slideOff).not.toBe(robustOff); // Slide|2K má iný skloOffset než Robust|2K
	expect(consoleMsgs).toEqual([]);
});

test('validácia: nezmyselné rozmery sa odmietnu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-VAL`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	const sirka = page.getByLabel('Šírka (mm) *');
	await sirka.fill('50');
	await page.getByLabel('Výška (mm) *').fill('1800');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	// HTML5 min=300 zastaví odoslanie (server má rovnakú kontrolu)
	const invalid = await sirka.evaluate((el) => !(el as HTMLInputElement).checkValidity());
	expect(invalid).toBe(true);
	expect(consoleMsgs).toEqual([]);
});

test('editor vzorcov: uloženie bez zmeny → zmena → overenie vo výpočte → návrat', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/zasklenia/nastavenia?sysStyl=Robust%7C2K');

	const sklo = page.getByLabel('Sklo — konečné zmenšenie (mm)');
	const povodna = await sklo.inputValue();

	// 1. uloženie bez zmeny — nič sa nemení
	await page.getByTestId('ulozit-vzorce').click();
	await expect(page.getByTestId('nastavenia-ulozene')).toContainText('Žiadna hodnota sa nezmenila');

	try {
		// 2. zmena skloOffset o +5 → uloží sa, preview ukáže starú → novú
		await page.getByRole('link', { name: /Upraviť ďalší štýl/ }).click();
		await sklo.fill(String(Number(povodna) + 5));
		await page.getByTestId('ulozit-vzorce').click();
		await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();
		await expect(page.getByText(`${povodna} → ${Number(povodna) + 5}`)).toBeVisible();

		// 3. hlavný formulár počíta s novou hodnotou (sklo užšie o 5)
		await goto(page, '/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-CFG`);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Test');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await expect(page.getByTestId('sklo-sirka')).toHaveText('1124');
	} finally {
		// návrat na pôvodnú hodnotu VŽDY — aj po páde testu nesmie ostať
		// zmenená konfigurácia (best effort, bez assertov)
		await goto(page, '/zasklenia/nastavenia?sysStyl=Robust%7C2K');
		await sklo.fill(povodna);
		await page.getByTestId('ulozit-vzorce').click();
		await page.getByTestId('nastavenia-ulozene').waitFor();
	}

	// 4. história zmien obsahuje návrat
	await goto(page, '/zasklenia/nastavenia?sysStyl=Robust%7C2K');
	await expect(page.getByText('História zmien')).toBeVisible();
	await expect(
		page.getByText(`Sklo — konečné zmenšenie: ${Number(povodna) + 5} → ${povodna}`).first()
	).toBeVisible();

	// 5. preklep mimo rozsahu sa odmietne (HTML5 max=500)
	const invalid = await sklo.evaluate((el) => {
		(el as HTMLInputElement).value = '5000';
		return !(el as HTMLInputElement).checkValidity();
	});
	expect(invalid).toBe(true);
	expect(consoleMsgs).toEqual([]);
});

test('B2B: admin vytvorí účet, ten je obmedzený (nav/redirect/šírkový blok/výškový warning), admin ho zmaže', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri Zmazať

	const b2bUser = `e2e-b2b-${Date.now().toString(36)}`;
	const b2bPass = 'e2eheslo1';

	// 1. interný vidí nav odkaz Používatelia a vytvorí B2B účet cez /pouzivatelia
	await loginAs(page);
	await expect(page.getByRole('link', { name: 'Používatelia' })).toBeVisible();
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(b2bUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(b2bPass);
	await page.getByRole('button', { name: 'Pridať B2B účet' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');
	await expect(page.locator('tr', { hasText: b2bUser })).toContainText('B2B');

	// 2. odhlásenie + prihlásenie ako čerstvo vytvorený B2B účet
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page, b2bUser, b2bPass);

	// 3. B2B: nav ukazuje len Zasklenia; /pergola aj /pouzivatelia presmerujú na /zasklenia
	await expect(page.getByRole('link', { name: 'Zasklenia' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Pergola' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Používatelia' })).toHaveCount(0);
	await goto(page, '/pergola');
	await expect(page).toHaveURL(/\/zasklenia/);
	await goto(page, '/pouzivatelia');
	await expect(page).toHaveURL(/\/zasklenia/);

	// 4. Deluxe 2K @ 3000×2000 → šírka na sklo = 1500 mm (nad limit 1000) →
	// šírkový blok, poradí 3K (Dominik: „2K 3000 → sklo 1500, treba 3K po 1000"),
	// tlačidlo Spočítať sa HNEĎ zablokuje → žiadny náhľad, žiadne Odoslať
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-B2B`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E B2B');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	// NOVÉ: šírkový blok je OKAMŽITÝ (client-side, pred „Spočítať") — hlásenie pod
	// poľom + zablokované tlačidlo; žiadny náhľad, žiadne Odoslať.
	await expect(page.getByTestId('b2b-sirka-err')).toContainText('Zvoľ 3K');
	await expect(page.getByTestId('spocitat')).toBeDisabled();
	await expect(page.getByTestId('sklo-sirka')).toHaveCount(0); // žiadny náhľad
	await expect(page.getByTestId('odoslat')).toHaveCount(0);

	// 4b. sub-min šírka (pod min poľa 300 mm) → dimOrNull ju nevyhodnotí, takže
	// počas dopisovania (3 → 30 → 300 → 3000) neblikne falošný ⛔; potom späť na
	// 3000 a blok sa opäť ukáže (stav pre krok 5).
	await page.getByLabel('Šírka (mm) *').fill('200');
	await expect(page.getByTestId('b2b-sirka-err')).toHaveCount(0);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await expect(page.getByTestId('b2b-sirka-err')).toContainText('Zvoľ 3K');

	// 5. prepni na 3K (šírka na sklo = 1000 mm, v limite) → náhľad OK, tlačidlo
	// Tlačiť je prítomné, Odoslať NIE (B2B nesmie zapisovať do Money)
	await page.getByLabel('Štýl').selectOption('3K');
	// oprava (3K, sklo 1000 mm v limite) → blok zmizne, tlačidlo sa odblokuje
	await expect(page.getByTestId('b2b-sirka-err')).toHaveCount(0);
	await expect(page.getByTestId('spocitat')).toBeEnabled();
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	await expect(page.getByRole('button', { name: /Tlačiť/ })).toBeVisible();
	await expect(page.getByTestId('odoslat')).toHaveCount(0);
	await expect(page.getByTestId('height-warn')).toHaveCount(0);

	// 6. rovnaký 3K, výška 2700 mm (nad Deluxe maxHeight 2500) → NEblokuje,
	// len upozorní „BEZ ZÁRUKY" na náhľade
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await page.getByLabel('Výška (mm) *').fill('2700');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('height-warn')).toContainText('BEZ ZÁRUKY');
	await expect(page.getByTestId('odoslat')).toHaveCount(0);

	// 7. upratanie: odhlásenie B2B, prihlásenie interný, zmazanie throwaway účtu
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	const row = page.locator('tr', { hasText: b2bUser });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');
	await expect(page.locator('tr', { hasText: b2bUser })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

// „iba b2b" — interný účet NEVIDÍ okamžitý šírkový limit a môže spočítať čokoľvek
// (regresný strážca požiadavky: limity platia LEN pre b2b).
test('interný účet: nadrozmerná šírka NEVIDÍ okamžitý b2b limit, Spočítať povolené', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page); // interný e2e
	await goto(page, '/zasklenia');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000'); // sklo 1500 mm > b2b limit 1000
	await expect(page.getByTestId('b2b-sirka-err')).toHaveCount(0);
	await expect(page.getByTestId('spocitat')).toBeEnabled();
	expect(consoleMsgs).toEqual([]);
});

// Kaskáda krídel v reze (Dominik 2026-07-14) — nahradila šípku+opona v náhľade.
// P-L = N stupňov; opona (2x) = dve strany × N/2 do stredu. READ-ONLY náhľad.
test('kaskáda v reze: P-L kreslí N čiar (stupne), opona 2x kreslí 2×N/2 do stredu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	// Robust 3K P-L → kaskáda = 3 čiary
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-CASPL`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('Kaskada PL');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Otváranie').selectOption('P - L');
	await page.getByLabel('Šírka (mm) *').fill('4500');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('kaskada')).toBeVisible();
	await expect(page.getByTestId('kaskada').locator('rect')).toHaveCount(3);

	// Robust 2x2K (opona, otváranie auto) → kaskáda = 4 čiary (2 strany × 2)
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-CASOP`);
	await page.getByLabel('OP/OPDL číslo *').fill('02');
	await page.getByLabel('Zákazník *').fill('Kaskada opona');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2x2K');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('kaskada')).toBeVisible();
	await expect(page.getByTestId('kaskada').locator('rect')).toHaveCount(4);

	expect(consoleMsgs).toEqual([]);
});

// Deluxe zámkové otvory D46 v náhľade (Dominik 2026-07-14) — READ-ONLY náhľad,
// bezpečné aj na LIVE. ⌀46 na krajných sklách + KONFIGUROVATEĽNÁ výška vŕtania.
test('Deluxe D46 zámok: náhľad kreslí otvory ⌀46 + zvolenú výšku vŕtania', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-D46`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E D46');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('5K');
	await page.getByLabel('Šírka (mm) *').fill('4500');
	await page.getByLabel('Výška (mm) *').fill('2400');
	// pole je LEN pri Deluxe — nastav vlastnú výšku vŕtania (nie default 1050)
	await page.getByLabel(/Výška vŕtania zámku/).fill('1100');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	const svg = page.getByTestId('nahlad-2d');
	await expect(svg).toBeVisible();
	// 5K → dve krajné sklá → dva prerušované kruhy (vŕtané otvory)
	await expect(svg.locator('circle[stroke-dasharray]')).toHaveCount(2);
	// ⌀46 + zvolená výška vŕtania sú NAPÍSANÉ v náhľade
	await expect(svg.getByText('⌀46').first()).toBeVisible();
	await expect(svg.getByText('v 1100').first()).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

// Aditívnosť: iné systémy (Robust) nemajú pole výšky ani otvory — interný flow nezmenený.
test('Robust: žiadne pole výšky vŕtania ani otvory D46 (D46 je len Deluxe)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Robust');
	// pole „Výška vŕtania zámku" sa pri Robuste NEzobrazuje
	await expect(page.getByLabel(/Výška vŕtania zámku/)).toHaveCount(0);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-NODLX`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	const svg = page.getByTestId('nahlad-2d');
	await expect(svg).toBeVisible();
	// žiadne prerušované kruhy (D46 otvory) pri Robuste
	await expect(svg.locator('circle[stroke-dasharray]')).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});
