// #448 — súhrnný readback ALARM banner na /odpisy. `agregujReadbackAlarmy` je ČISTÁ funkcia nad UŽ
// vypočítanými `readbackStav()` výsledkami (žiadna DB): počíta LIVE odpisy s alarmom
// (`stav==='nesulad'`, t.j. chyba-doklad ALEBO pocet), vylučuje `ok`/`caka` (parkované caka aj mimo
// okna sú `caka`) aj non-live (do Money nešli). Toto zviditeľní tichý Money drop na vrchu stránky,
// nie až po scrollnutí na konkrétny riadok (Patrik: „hodilo normálne do dopisu … nie je v Money").
import { describe, it, expect } from 'vitest';
import { agregujReadbackAlarmy } from '../src/lib/server/money-readback';
import type { ReadbackVysledok, ReadbackDovod } from '../src/lib/server/money-readback';

function rb(stav: ReadbackVysledok['stav'], dovod: ReadbackDovod = ''): ReadbackVysledok {
	return { stav, dovod, dlv: null, moneyPocet: null, riadkov: 2 };
}
function odpis(
	id: number,
	zak: string,
	op: string,
	live: boolean,
	readback: ReadbackVysledok | null
) {
	return { id, zak, op, live, readback };
}

describe('#448 agregujReadbackAlarmy — súhrn readback alarmov pre /odpisy banner', () => {
	it('alarm riadky (nesulad: chyba-doklad AJ pocet) sa počítajú, ok/caka nie', () => {
		const r = agregujReadbackAlarmy([
			odpis(1, 'ZAK1', 'OP1', true, rb('nesulad', 'chyba-doklad')),
			odpis(2, 'ZAK2', 'OP2', true, rb('ok')),
			odpis(3, 'ZAK3', 'OP3', true, rb('caka')),
			odpis(4, 'ZAK4', 'OP4', true, rb('nesulad', 'pocet'))
		]);
		expect(r.pocet).toBe(2);
		expect(r.polozky.map((p) => p.zak)).toEqual(['ZAK1', 'ZAK4']);
		expect(r.polozky.map((p) => p.dovod)).toEqual(['chyba-doklad', 'pocet']);
		expect(r.polozky[0]).toMatchObject({ id: 1, zak: 'ZAK1', op: 'OP1', dovod: 'chyba-doklad' });
	});

	it('parkovaný (caka) aj overený (ok) odpis sú vylúčené', () => {
		const r = agregujReadbackAlarmy([
			odpis(1, 'Z', 'O', true, rb('caka')),
			odpis(2, 'Z', 'O', true, rb('ok'))
		]);
		expect(r.pocet).toBe(0);
		expect(r.polozky).toEqual([]);
	});

	it('non-live odpis s alarmom sa NEpočíta (do Money nešiel)', () => {
		const r = agregujReadbackAlarmy([odpis(1, 'Z', 'O', false, rb('nesulad', 'chyba-doklad'))]);
		expect(r.pocet).toBe(0);
	});

	it('odpis bez readbacku (null) sa NEpočíta', () => {
		const r = agregujReadbackAlarmy([odpis(1, 'Z', 'O', true, null)]);
		expect(r.pocet).toBe(0);
	});

	it('prázdny zoznam → pocet 0, žiadne položky', () => {
		expect(agregujReadbackAlarmy([])).toEqual({ pocet: 0, polozky: [] });
	});
});
