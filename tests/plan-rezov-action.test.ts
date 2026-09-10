// #505: Action validation tests for plan-rezov save (ulozit) — validates that
// the save path enforces the same input bounds as spocitat (parsePlanRezovFormData).
// Pattern: objednavka-action.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';

// Direct action import — actions are plain async functions
const { actions } = await import('../src/routes/plan-rezov/+page.server');

function makeFormData(fields: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return fd;
}

function makeRequest(fields: Record<string, string>): Request {
	const fd = makeFormData(fields);
	return new Request('http://localhost/plan-rezov?/ulozit', { method: 'POST', body: fd });
}

const locals = { user: { username: 'test' } };

beforeEach(() => {
	db.prepare('DELETE FROM plan_rezov_ulozene').run();
});

describe('plan-rezov ulozit action validation (#505)', () => {
	it('rejects empty nazov', async () => {
		const r = await actions.ulozit({
			request: makeRequest({ nazov: '', cad: 'X\t1\t1000', dlzkaTyce: '6000', reznaMedzera: '4' }),
			locals
		} as never);
		expect(r).toMatchObject({ status: 400 });
		expect((r as { data?: { saveError?: string } }).data?.saveError).toContain('názov');
	});

	it('rejects nazov over 200 chars', async () => {
		const r = await actions.ulozit({
			request: makeRequest({
				nazov: 'A'.repeat(201),
				cad: 'X\t1\t1000',
				dlzkaTyce: '6000',
				reznaMedzera: '4'
			}),
			locals
		} as never);
		expect(r).toMatchObject({ status: 400 });
		expect((r as { data?: { saveError?: string } }).data?.saveError).toContain('dlhý');
	});

	it('rejects empty cad text', async () => {
		const r = await actions.ulozit({
			request: makeRequest({ nazov: 'Test', cad: '', dlzkaTyce: '6000', reznaMedzera: '4' }),
			locals
		} as never);
		expect(r).toMatchObject({ status: 400 });
	});

	it('rejects cad text with no parsable rows', async () => {
		const r = await actions.ulozit({
			request: makeRequest({ nazov: 'Test', cad: 'garbage', dlzkaTyce: '6000', reznaMedzera: '4' }),
			locals
		} as never);
		expect(r).toMatchObject({ status: 400 });
	});

	it('rejects negative dlzkaTyce', async () => {
		const r = await actions.ulozit({
			request: makeRequest({
				nazov: 'Test',
				cad: 'PROFIL\t2\t5330',
				dlzkaTyce: '-100',
				reznaMedzera: '4'
			}),
			locals
		} as never);
		expect(r).toMatchObject({ status: 400 });
	});

	it('rejects negative reznaMedzera', async () => {
		const r = await actions.ulozit({
			request: makeRequest({
				nazov: 'Test',
				cad: 'PROFIL\t2\t5330',
				dlzkaTyce: '6000',
				reznaMedzera: '-5'
			}),
			locals
		} as never);
		expect(r).toMatchObject({ status: 400 });
	});

	it('accepts valid input and saves', async () => {
		const r = await actions.ulozit({
			request: makeRequest({
				nazov: 'Brány',
				zak: 'ZAK-001',
				cad: 'PROFIL\t2\t5330\nPROFIL\t1\t1550',
				dlzkaTyce: '6000',
				reznaMedzera: '4'
			}),
			locals
		} as never);
		expect(r).toMatchObject({ saved: true });
		expect((r as { savedId: number }).savedId).toBeGreaterThan(0);

		// Verify saved data
		const rows = db.prepare('SELECT * FROM plan_rezov_ulozene').all();
		expect(rows.length).toBe(1);
	});

	it('saves validated dlzkaTyce and reznaMedzera (not raw form values)', async () => {
		const r = await actions.ulozit({
			request: makeRequest({
				nazov: 'Test',
				cad: 'PROFIL\t2\t5330',
				dlzkaTyce: '7500',
				reznaMedzera: '3'
			}),
			locals
		} as never);
		expect(r).toMatchObject({ saved: true });

		const row = db.prepare('SELECT dlzka_tyce, rezna_medzera FROM plan_rezov_ulozene').get() as {
			dlzka_tyce: number;
			rezna_medzera: number;
		};
		expect(row.dlzka_tyce).toBe(7500);
		expect(row.rezna_medzera).toBe(3);
	});
});

describe('plan-rezov zmazat action validation (#505)', () => {
	it('rejects non-numeric id', async () => {
		const r = await actions.zmazat({
			request: makeRequest({ id: 'abc' })
		} as never);
		expect(r).toMatchObject({ status: 400 });
	});

	it('rejects id <= 0', async () => {
		const r = await actions.zmazat({
			request: makeRequest({ id: '0' })
		} as never);
		expect(r).toMatchObject({ status: 400 });
	});

	it('succeeds on valid id (even non-existent)', async () => {
		const r = await actions.zmazat({
			request: makeRequest({ id: '99999' })
		} as never);
		expect(r).toMatchObject({ deleted: true });
	});
});
