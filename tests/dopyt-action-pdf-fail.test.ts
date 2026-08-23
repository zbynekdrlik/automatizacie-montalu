// #277 — keď PDF generovanie zlyhá, dopyt je UŽ uložený (nestratíme lead) a akcia vráti
// fail(500) s `ulozene: true`. Mockujeme generatePonukaPdf, aby hodil.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/server/ponuka-pdf', () => ({
	generatePonukaPdf: vi.fn(() => Promise.reject(new Error('boom')))
}));

import type { RequestEvent } from '@sveltejs/kit';
import { dopytAction } from '../src/lib/server/dopyt-action';
import { countDopyty } from '../src/lib/server/dopyt-store';

function makeEvent(fields: Record<string, string>): RequestEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: () => Promise.resolve(fd), headers: new Headers() },
		getClientAddress: () => '203.0.113.99'
	} as unknown as RequestEvent;
}

describe('dopytAction — PDF pád', () => {
	it('uloží dopyt, ale vráti fail(500) s ulozene=true', async () => {
		const before = countDopyty();
		const res = (await dopytAction(
			makeEvent({
				konfiguracia: '{}',
				meno: 'Ján',
				email: 'jan@example.com',
				telefon: '',
				miesto: '',
				poznamka: ''
			})
		)) as { status: number; data: { ulozene: boolean } };
		expect(res.status).toBe(500);
		expect(res.data.ulozene).toBe(true);
		// lead sa NEstratil
		expect(countDopyty()).toBe(before + 1);
	});
});
