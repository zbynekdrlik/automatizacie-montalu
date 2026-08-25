// zakazka-ceny.ts — per-zákazka agregácia odpísaného materiálu (#154, časti 1+2).
// VŠETKY qty/kódy sú VYMYSLENÉ (repo je verejné). Jedna DB pre celý súbor
// (db.ts je modulový singleton — vzor ceny.test.ts): testy bežia SEKVENČNE,
// každý používa VLASTNÚ ZAK, aby sa navzájom nekolidovali.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-zakazka-ceny-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
// zakazka-ceny sám snapshot nečíta (ceny napája volajúci cez enrichPolozky) —
// poistka, nech prípadný lazy import v module chain je no-op
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json');

const { zakazkaPrehlad } = await import('../src/lib/server/zakazka-ceny');
const { db } = await import('../src/lib/server/db');

let nextId = 50001;

function seedOdpis(opts: {
	zak: string;
	op: string;
	modul?: string;
	live?: number;
	caka?: number;
	zakaznik?: string;
	polozky?: { kod: string; nazov: string; qty: number; mj?: string }[];
}): number {
	const id = nextId++;
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
		 VALUES (?, ?, ?, ?, ?, ?, ?, '/t/f.xlsx', 'f.xlsx', ?, '{}', 'test', datetime('now'), ?, ?)`
	).run(
		id,
		opts.modul ?? 'zasklenia',
		opts.zak,
		opts.op,
		opts.zakaznik ?? 'Test Zákazník',
		opts.caka ?? 0,
		opts.live ?? 1,
		`hash-${id}`,
		opts.zak,
		opts.op
	);
	const ins = db.prepare(
		'INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, ?)'
	);
	for (const p of opts.polozky ?? []) ins.run(id, p.kod, p.nazov, p.qty, p.mj ?? 'm');
	return id;
}

describe('zakazkaPrehlad', () => {
	it('agreguje qty po kóde naprieč LIVE odpismi a nájde zákazku cez normZak (case/medzery)', () => {
		const idA = seedOdpis({
			zak: 'ZAKUTAGG1',
			op: 'OP1',
			polozky: [
				{ kod: 'UT-K1', nazov: 'Profil A', qty: 3 },
				{ kod: 'UT-K2', nazov: 'Profil B', qty: 1.5 }
			]
		});
		const idB = seedOdpis({
			zak: 'ZAKUTAGG1',
			op: 'OP2',
			modul: 'pergola',
			polozky: [
				{ kod: 'UT-K1', nazov: 'Profil A', qty: 2 },
				{ kod: 'UT-K3', nazov: 'Skrutka', qty: 4, mj: 'ks' }
			]
		});
		// vstup v inom case + s medzerami — normZak ho musí zladiť s uloženým zak_norm
		const p = zakazkaPrehlad('  zakutagg1 ');
		expect(p).not.toBeNull();
		expect(p!.zakNorm).toBe('ZAKUTAGG1');
		expect(p!.scope).toBe('live');
		expect(p!.odpisovVScope).toBe(2);
		expect(p!.bezPoloziek).toBe(0);
		// najnovší odpis prvý
		expect(p!.odpisy.map((o) => o.id)).toEqual([idB, idA]);
		expect(p!.odpisy[0]?.pocetPoloziek).toBe(2);
		// group by kod, zoradené po kóde, qty sčítané
		expect(p!.polozky).toEqual([
			{ kod: 'UT-K1', nazov: 'Profil A', qty: 5, mj: 'm' },
			{ kod: 'UT-K2', nazov: 'Profil B', qty: 1.5, mj: 'm' },
			{ kod: 'UT-K3', nazov: 'Skrutka', qty: 4, mj: 'ks' }
		]);
	});

	it('nazov/mj agregovanej položky sa berie z NAJNOVŠIEHO výskytu kódu', () => {
		seedOdpis({
			zak: 'ZAKUTNAZ',
			op: 'OP1',
			polozky: [{ kod: 'UT-KX', nazov: 'Starý názov', qty: 1 }]
		});
		seedOdpis({
			zak: 'ZAKUTNAZ',
			op: 'OP2',
			polozky: [{ kod: 'UT-KX', nazov: 'Nový názov', qty: 2 }]
		});
		const p = zakazkaPrehlad('ZAKUTNAZ');
		expect(p!.polozky).toEqual([{ kod: 'UT-KX', nazov: 'Nový názov', qty: 3, mj: 'm' }]);
	});

	it('qty súčet je zaokrúhlený — žiadny float šum (0.1 + 0.2 = 0.3)', () => {
		seedOdpis({
			zak: 'ZAKUTFLT',
			op: 'OP1',
			polozky: [{ kod: 'UT-KF', nazov: 'Float', qty: 0.1 }]
		});
		seedOdpis({
			zak: 'ZAKUTFLT',
			op: 'OP2',
			polozky: [{ kod: 'UT-KF', nazov: 'Float', qty: 0.2 }]
		});
		expect(zakazkaPrehlad('ZAKUTFLT')!.polozky[0]?.qty).toBe(0.3);
	});

	it('LIVE scope: 🧪 TEST odpisy sú v zozname, ale do agregátu sa NEpočítajú', () => {
		seedOdpis({
			zak: 'ZAKUTLT',
			op: 'OP1',
			live: 1,
			polozky: [{ kod: 'UT-KA', nazov: 'Ostrý', qty: 2 }]
		});
		seedOdpis({
			zak: 'ZAKUTLT',
			op: 'OP1',
			live: 0,
			polozky: [{ kod: 'UT-KB', nazov: 'Testový', qty: 9 }]
		});
		const p = zakazkaPrehlad('ZAKUTLT');
		expect(p!.scope).toBe('live');
		expect(p!.odpisy).toHaveLength(2);
		expect(p!.odpisovVScope).toBe(1);
		expect(p!.polozky).toEqual([{ kod: 'UT-KA', nazov: 'Ostrý', qty: 2, mj: 'm' }]);
	});

	it('TEST fallback: zákazka bez LIVE odpisu agreguje TEST so scope="test"', () => {
		seedOdpis({
			zak: 'ZAKUTTO',
			op: 'OP1',
			live: 0,
			polozky: [{ kod: 'UT-KC', nazov: 'Len test', qty: 7 }]
		});
		const p = zakazkaPrehlad('ZAKUTTO');
		expect(p!.scope).toBe('test');
		expect(p!.odpisovVScope).toBe(1);
		expect(p!.polozky).toEqual([{ kod: 'UT-KC', nazov: 'Len test', qty: 7, mj: 'm' }]);
	});

	it('odpis bez uložených položiek (spred fázy 1) sa čestne vykáže v bezPoloziek', () => {
		seedOdpis({
			zak: 'ZAKUTBP',
			op: 'OP1',
			polozky: [{ kod: 'UT-KD', nazov: 'S položkami', qty: 1 }]
		});
		seedOdpis({ zak: 'ZAKUTBP', op: 'OP2' }); // žiadne položky
		const p = zakazkaPrehlad('ZAKUTBP');
		expect(p!.bezPoloziek).toBe(1);
		expect(p!.odpisovVScope).toBe(2);
		expect(p!.polozky).toEqual([{ kod: 'UT-KD', nazov: 'S položkami', qty: 1, mj: 'm' }]);
	});

	it('hlavička nesie RAW zak + zákazníka z NAJNOVŠIEHO odpisu', () => {
		seedOdpis({ zak: 'ZAKUTHDR', op: 'OP1', zakaznik: 'Prvý s.r.o.' });
		seedOdpis({ zak: 'ZAKUTHDR', op: 'OP2', zakaznik: 'Druhý s.r.o.' });
		const p = zakazkaPrehlad('ZAKUTHDR');
		expect(p!.zak).toBe('ZAKUTHDR');
		expect(p!.zakaznik).toBe('Druhý s.r.o.');
	});

	it('neexistujúca zákazka a prázdny vstup vracajú null', () => {
		expect(zakazkaPrehlad('ZAKUTNIC')).toBeNull();
		expect(zakazkaPrehlad('   ')).toBeNull();
	});
});
