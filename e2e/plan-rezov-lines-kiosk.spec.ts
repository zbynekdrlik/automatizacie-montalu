// #522: pri uložení plánu rezov appka pošle na kiosk „Čo rezať" aj `lines` (rozpis rezov →
// montalu.rozpis.line) k tomu istému montalu_narezak_upload volaniu, z TOHO ISTÉHO plánu ako PDF.
//
// Server-side fetch sa cez prehliadač Playwrightom NEZACHYTÁVA (rovnako ako #511 kiosk spec), a v
// E2E env je upload VYPNUTÝ (žiadny ODOO_JSON2_URL) — takže transport-kontrakt `lines`
// (kod/nazov/mnozstvo/mj/dlzka/poznamka + idempotentný doc_id) je pokrytý integračne v
// `tests/odoo-rozpis-lines.test.ts` + `tests/odoo-plan-rezov-upload.test.ts` cez `setJson2Transport`.
// Tento E2E overuje USER FLOW cez REÁLNY prehliadač: uloženie plánu (spustí queuePlanRezovUpload s
// lines) NEZHODÍ uloženie, a compute aj detail plánu renderujú TIE ISTÉ riadky rezov (profil ×
// dĺžka × počet kusov), z ktorých `buildRozpisLines` stavia `lines` — čiže zdroj `lines` je viditeľne
// ten istý plán, ktorý vidí rezač na tablete. Plán rezov NIKDY neukazuje ceny (kiosk je bez cenníka).
import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs, skipAkLive } from './helpers';

test('uloženie plánu → lines rozpisu rezov (profil × dĺžka × ks) sú v pláne, ktorý appka posiela na kiosk', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// ZÁPISOVÝ test (uloží plán do DB) — na LIVE prode sa preskočí.
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');

	// CAD s presne známymi rezmi → z nich `buildRozpisLines` odvodí montalu.rozpis.line:
	//   NÁRAZNÍK PROFIL 90x40 → 2× 4500 mm + 3× 2100 mm     (dva riadky lines)
	//   KRYCÍ PROFIL 50x30    → 4× 1865 mm                    (jeden riadok lines)
	const cadText = [
		'NÁRAZNÍK PROFIL 90x40\t2\t4500',
		'NÁRAZNÍK PROFIL 90x40\t3\t2100',
		'KRYCÍ PROFIL 50x30\t4\t1865'
	].join('\n');
	await page.getByTestId('cad-input').fill(cadText);
	await page.getByTestId('spocitaj').click();

	// compute renderuje TIE ISTÉ riadky rezov (Dĺžka mm × Kusov), ktoré sa stanú `lines`
	const vysledok = page.getByTestId('vysledok');
	await expect(vysledok).toBeVisible();
	await expect(vysledok).toContainText('NÁRAZNÍK PROFIL 90x40');
	await expect(vysledok).toContainText('4500');
	await expect(vysledok).toContainText('2100');
	await expect(vysledok).toContainText('KRYCÍ PROFIL 50x30');
	await expect(vysledok).toContainText('1865');
	// plán rezov NIKDY neukazuje ceny (kiosk je bez cenníka) — istota, že do lines nejde cena
	await expect(vysledok).not.toContainText('€');

	// ulož plán so zákazkou → spustí queuePlanRezovUpload({...}) s lines (v E2E vypnutý, nesmie zhodiť)
	await page.getByTestId('save-nazov').fill('E2E lines plán #522');
	await page.getByTestId('save-zak').fill('ZAKE2E522');
	await page.getByTestId('save-btn').click();
	await expect(page.getByTestId('save-msg')).toBeVisible();

	// detail plánu (to, čo nesie kiosk PDF + lines) renderuje TIE ISTÉ riadky rezov
	const detailLink = page
		.getByTestId('plan-link')
		.filter({ hasText: 'E2E lines plán #522' })
		.first();
	await expect(detailLink).toBeVisible();
	await detailLink.click();
	await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E lines plán #522');
	const detail = page.getByTestId('vysledok-detail');
	await expect(detail).toBeVisible();
	await expect(detail).toContainText('NÁRAZNÍK PROFIL 90x40');
	await expect(detail).toContainText('4500');
	await expect(detail).toContainText('2100');
	await expect(detail).toContainText('KRYCÍ PROFIL 50x30');
	await expect(detail).toContainText('1865');
	await expect(detail).not.toContainText('€');

	expect(consoleMsgs).toEqual([]);
});
