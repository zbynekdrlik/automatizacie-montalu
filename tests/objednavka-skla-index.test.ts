// #546: index /objednavka-skla — „Nová objednávka len skla" (zákazka + OP). Server validuje
// normZak/normOp (žiadny Odoo lookup), NIČ neukladá, len presmeruje na podklad
// /objednavka-skla/<zak>?op=<OP> (podklad si `?op=` predvyplní do poľa OP). Money-NEUTRÁLNE.
import { describe, it, expect } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { actions } from '../src/routes/objednavka-skla/+page.server';

function mkEvent(pairs: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(pairs)) f.set(k, v);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { request: { formData: async () => f } } as any;
}

type Res = { kind: 'return'; value: { error?: string } } | { kind: 'redirect'; location: string };

async function run(pairs: Record<string, string>): Promise<Res> {
	try {
		const value = await actions.default(mkEvent(pairs));
		return { kind: 'return', value: (value ?? {}) as { error?: string } };
	} catch (e) {
		if (isRedirect(e)) return { kind: 'redirect', location: (e as { location: string }).location };
		throw e;
	}
}

describe('#546 index objednavka-skla — nová objednávka len skla', () => {
	it('platná zákazka + OP → redirect na podklad s ?op=<normOp>', async () => {
		const r = await run({ zak: 'ZAK260546', op: '260546' });
		expect(r.kind).toBe('redirect');
		if (r.kind === 'redirect') {
			expect(r.location).toBe('/objednavka-skla/ZAK260546?op=OP260546');
		}
	});

	it('OP sa normalizuje cez normOp (číslo → OP<num>)', async () => {
		const r = await run({ zak: 'ZAK9', op: 'op 260999' });
		expect(r.kind).toBe('redirect');
		if (r.kind === 'redirect') expect(r.location).toContain('op=OP260999');
	});

	it('zákazka s medzerami sa v URL zachová (encodeURIComponent), lookup normalizuje podklad', async () => {
		const r = await run({ zak: 'ZAK 260546', op: '1' });
		expect(r.kind).toBe('redirect');
		if (r.kind === 'redirect') expect(r.location.startsWith('/objednavka-skla/')).toBe(true);
	});

	it('prázdna zákazka → chyba (žiadny redirect)', async () => {
		const r = await run({ zak: '   ', op: '260546' });
		expect(r.kind).toBe('return');
		if (r.kind === 'return') expect(r.value.error).toBeTruthy();
	});

	it('prázdne / neplatné OP → chyba (žiadny redirect)', async () => {
		const r = await run({ zak: 'ZAK260546', op: '   ' });
		expect(r.kind).toBe('return');
		if (r.kind === 'return') expect(r.value.error).toBeTruthy();
	});
});
