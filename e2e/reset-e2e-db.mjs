// #291: E2E stav (zdieľaná SQLite DB + Money odpis-export adresár) sa resetuje TU —
// v playwright.config.ts `webServer.command`, PRED `npm run preview`, aby čistá DB
// existovala skôr, než si ju preview server pri boote otvorí a zmigruje. NESMIE bežať
// v globalSetup: ten Playwright púšťa AŽ PO štarte webServera, takže by mazal DB spod
// už bežiaceho servera (osirotený inode) a seedDopyt (test proces) by potom otvoril
// čerstvý prázdny súbor → „no such table: dopyt". Čistá DB pre každý beh: zlyhaný test
// nesmie otráviť ďalší beh zmenenou konfiguráciou vzorcov (pôvodný nález review). Voči
// NASADENEJ appke (BASE_URL) sa nikdy nespúšťa — jej dáta sa nemažú (webServer je vtedy
// aj tak `undefined`, tento guard je len poistka pre ručné spustenie skriptu).
import fs from 'node:fs';

if (process.env.BASE_URL) process.exit(0);

for (const f of ['./data/e2e.db', './data/e2e.db-wal', './data/e2e.db-shm']) {
	fs.rmSync(f, { force: true });
}
fs.rmSync('./data/e2e-odpis-export', { recursive: true, force: true });
