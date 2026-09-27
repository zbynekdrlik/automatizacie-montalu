// #571: pridanie do podkladu, ktorý už má riadky od INÉHO používateľa, sa LOGUJE v zápisovej
// vrstve (všetci producenti — zasklenia, FIX, pergola, ručný riadok), raz na (zákazka, autor).
// Load podkladu (každý reload) NEloguje. Spy na process.stdout.write (vzor `login-log.test.ts`).
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';

// import PRV (LOG_LEVEL nie je nastavený ⇒ migrácie pri importe ticho); level až potom
const { pridajSklaHromadne, pridajSklaHromadneIdempotentne, pridajSkloManual, upozornenieCudzie } =
	await import('../src/lib/server/objednavka-skla');
process.env.LOG_LEVEL = 'info';
afterAll(() => delete process.env.LOG_LEVEL);
afterEach(() => vi.restoreAllMocks());

function capture(fn: () => void): Record<string, unknown>[] {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return lines
		.join('')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

const MSG = 'pridane do podkladu s cudzimi riadkami';

function sklo(zak: string, createdBy: string, popis = 'FIX pole 1') {
	return {
		zak,
		modul: 'fix',
		popis,
		sirkaMm: 500,
		vyskaMm: 400,
		pocet: 1,
		typSkla: 'Float 4',
		createdBy
	};
}

describe('#571 log pridania do cudzieho podkladu', () => {
	it('FIX/pergola (pridajSklaHromadne) do podkladu A ako B → JEDEN info riadok pre 2 riadky', () => {
		const zak = 'ZAK-571-LOG-A';
		pridajSklaHromadne([sklo(zak, 'alice')]);
		const recs = capture(() =>
			pridajSklaHromadne([sklo(zak, 'bob', 'FIX pole 1'), sklo(zak, 'bob', 'FIX pole 2')])
		);
		const hit = recs.filter((r) => r.msg === MSG);
		expect(hit).toHaveLength(1);
		expect(hit[0]).toMatchObject({ level: 'info', zak, user: 'bob', pocet: 1, autori: ['alice'] });
	});

	it('ručný riadok (pridajSkloManual) do cudzieho podkladu → log', () => {
		const zak = 'ZAK-571-LOG-B';
		pridajSklaHromadne([sklo(zak, 'alice')]);
		const recs = capture(() =>
			pridajSkloManual({
				zak,
				popis: 'V.O.',
				typSkla: 'Float 4',
				sirkaMm: 300,
				vyskaMm: 300,
				pocet: 1,
				rezim: 'rozmery',
				createdBy: 'bob'
			})
		);
		expect(recs.filter((r) => r.msg === MSG)).toHaveLength(1);
	});

	it('zasklenia (idempotentne) do cudzieho podkladu → log; do vlastného → nič', () => {
		const zak = 'ZAK-571-LOG-C';
		pridajSklaHromadne([sklo(zak, 'alice')]);
		const cudzi = capture(() =>
			pridajSklaHromadneIdempotentne([{ ...sklo(zak, 'bob'), modul: 'zasklenia' }])
		);
		expect(cudzi.filter((r) => r.msg === MSG)).toHaveLength(1);
		const vlastny = capture(() => pridajSklaHromadne([sklo('ZAK-571-LOG-D', 'bob')]));
		expect(vlastny.filter((r) => r.msg === MSG)).toHaveLength(0);
	});

	it('upozornenieCudzie (load podkladu) NEloguje — len vráti hlášku', () => {
		const zak = 'ZAK-571-LOG-E';
		pridajSklaHromadne([sklo(zak, 'alice')]);
		let text: string | null = null;
		const recs = capture(() => {
			text = upozornenieCudzie(zak, 'bob');
		});
		expect(text).toContain('od alice');
		expect(recs.filter((r) => r.msg === MSG)).toHaveLength(0);
	});
});
