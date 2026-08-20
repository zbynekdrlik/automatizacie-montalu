// #261: izolácia test DB. `db.ts` je modulový singleton — pri importe otvorí + migruje
// DB na `process.env.DATABASE_PATH || './data/app.db'`. 79 test súborov `DATABASE_PATH`
// nenastavuje → zdieľajú default a paralelný vitest preteká workerov na PRVOTNEJ migrácii
// (`SqliteError: table ... already exists`).
//
// `setupFiles` bežia PRED (hoisted) importmi test súboru, takže tu nastavená cesta
// účinkuje pri prvom importe `db.ts`. Prepis je BEZPODMIENEČNÝ — nový unikátny cieľ pre
// KAŽDÝ súbor (aj keď fork proces recykluje `process.env` z predošlého súboru, čím by
// inak dva súbory znova skončili na tej istej DB). 50 súborov, ktoré si `DATABASE_PATH`
// nastavujú samy (cez top-level `await import` po nastavení env), túto hodnotu len prepíšu
// vlastnou cestou — žiaden konflikt, a ich `afterAll` nižšie zmaže (nevyužitý) scratch dir.
import { afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Spolieha sa na default vitest `isolate: true` — `db.ts` sa re-evaluuje per súbor, takže
// per-file env účinkuje. Keby niekto nastavil `isolate: false`, súbory v jednom workeri by
// zdieľali prvú DB (nie však pôvodný migračný race — súbory v jednom workeri bežia sériovo).
// scratch žije pod os.tmpdir() (nikdy v repo; `.gitignore` navyše kryje *.db/data/).
// `am-vitest-db` marker + pid + UUID = bezkolízne naprieč súbormi aj paralelnými workermi.
const scratchDir = path.join(os.tmpdir(), 'am-vitest-db', `${process.pid}-${randomUUID()}`);
process.env.DATABASE_PATH = path.join(scratchDir, 'app.db');

afterAll(() => {
	// scratch DB (+ WAL/SHM súbory) sa po behu tohto test súboru zmažú. Súbor, ktorý si
	// cestu prepísal vlastnou, nechá tento (nevytvorený) dir — `force: true` ho ticho preskočí.
	fs.rmSync(scratchDir, { recursive: true, force: true });
});
