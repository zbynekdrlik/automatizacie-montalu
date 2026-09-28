// #583: dôkaz, že upratanie throwaway účtu beží AJ keď test po jeho vytvorení spadne. Prvý test
// zámerne padne (test.fail — očakávané zlyhanie) hneď po založení B2B účtu; druhý overí ako admin,
// že účet na cieli neostal. Beží aj post-deploy proti PROD (B2B účet, žiadny Money zápis) — presne
// tam zvyšok predtým ostal (e2e-b2b-mul90ik9, 0.25.50).
import { test, expect, zalozB2bUcet } from './ucty';
import { collectConsole, goto, loginAs } from './helpers';

test.describe.configure({ mode: 'serial' });

let zalozenyUcet: string | undefined;

test('pád testu PO založení účtu — zaručené upratanie ho aj tak zmaže (#583)', async ({
	page,
	e2eUcty
}) => {
	test.fail(true, 'zámerný pád po založení účtu — dokazuje upratanie aj pri zlyhaní');
	const consoleMsgs = collectConsole(page);
	const username = `e2e-upratanie-${Date.now().toString(36)}`;
	await loginAs(page);
	await zalozB2bUcet(page, e2eUcty, username);
	await expect(page.getByRole('cell', { name: username, exact: true })).toHaveCount(1);
	zalozenyUcet = username;
	expect(consoleMsgs).toEqual([]);
	throw new Error('zámerný pád po založení účtu (#583)');
});

test('po páde predošlého testu účet na cieli NEOSTAL (#583)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	expect(zalozenyUcet, 'predošlý test účet vôbec nezaložil').toBeTruthy();
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await expect(page.getByTestId('pouzivatelia-tabulka')).toBeVisible();
	await expect(page.getByRole('cell', { name: zalozenyUcet!, exact: true })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});
