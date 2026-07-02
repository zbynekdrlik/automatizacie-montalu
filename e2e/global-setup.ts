import fs from 'node:fs';

// Lokálny/CI beh: čistá DB pre každý beh — zlyhaný test nesmie otráviť
// nasledujúce behy zmenenou konfiguráciou (nález review).
export default async function globalSetup() {
	if (process.env.BASE_URL) return; // nasadená appka — jej dáta sa nemažú
	for (const f of ['./data/e2e.db', './data/e2e.db-wal', './data/e2e.db-shm']) {
		fs.rmSync(f, { force: true });
	}
	fs.rmSync('./data/e2e-odpis-export', { recursive: true, force: true });
}
