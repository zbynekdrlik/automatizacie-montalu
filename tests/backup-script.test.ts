// Guard test pre deploy/backup.sh (#253 — záloha SQLite dedup ledgeru na VPS).
//
// Repo NEMÁ shell/bats test harness (len vitest .ts), tak overujeme bezpečnostné
// invarianty zálohovacieho skriptu staticky (grep). Skript beží bez dozoru ako
// root cron na LIVE prod boxe, takže regresia v ktoromkoľvek z týchto bodov je
// nebezpečná: strata fail-loud → tichá nefunkčná záloha; strata online backup →
// nekonzistentná záloha pod WAL; strata rotácie → zaplnený disk; strata gzip →
// zbytočne veľké zálohy. Tento test tie kroky pripne, aby ich úprava skriptu
// nemohla nechtiac odstrániť.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_PATH = path.resolve(process.cwd(), 'deploy/backup.sh');
const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

describe('deploy/backup.sh — bezpečnostné invarianty', () => {
	it('má bash shebang', () => {
		expect(src.startsWith('#!/usr/bin/env bash')).toBe(true);
	});

	it('fail loudly: set -euo pipefail v prvých riadkoch', () => {
		const head = src.split('\n').slice(0, 5).join('\n');
		expect(head).toMatch(/^set -euo pipefail$/m);
	});

	it('fail loudly: ERR aj EXIT trap', () => {
		expect(src).toMatch(/trap .*ERR/);
		expect(src).toMatch(/trap .*EXIT/);
	});

	it('konzistentnosť: online backup cez better-sqlite3 .backup() (nie surová kópia)', () => {
		expect(src).toMatch(/better-sqlite3/);
		expect(src).toMatch(/\.backup\(/);
		// zdroj otvorený read-only — skript nikdy nesmie vedieť zapisovať do živej DB
		expect(src).toMatch(/readonly:\s*true/);
	});

	it('overuje zálohu: PRAGMA integrity_check a fail pri != ok', () => {
		expect(src).toMatch(/integrity_check/);
		expect(src).toMatch(/INTEGRITY.*!=?\s*"?ok"?|"\$INTEGRITY"\s*=\s*"ok"/);
	});

	it('kompresia: gzip', () => {
		expect(src).toMatch(/\bgzip\b/);
	});

	it('atomický artefakt: píše do .part, overí gzip -t a až potom mv (žiadny useknutý .gz)', () => {
		expect(src).toMatch(/\.part/);
		expect(src).toMatch(/gzip -t/);
		expect(src).toMatch(/mv "\$\{FINAL\}\.part" "\$FINAL"/);
	});

	it('zámok proti súbežnému behu: flock', () => {
		expect(src).toMatch(/flock -n 9/);
	});

	it('alert pri zlyhaní nezávislý na cron výstupe: logger -p user.err do journald', () => {
		expect(src).toMatch(/logger -p user\.err/);
	});

	it('rotácia: find -mtime s RETENTION_DAYS a -delete', () => {
		expect(src).toMatch(/RETENTION_DAYS/);
		expect(src).toMatch(/find .*-mtime .*-delete/);
	});

	it('default retencia 14 dní', () => {
		expect(src).toMatch(/RETENTION_DAYS:-14/);
	});

	it('ukladá MIMO named volume (do BACKUP_DIR = /opt/automatizacie-montalu/backups)', () => {
		expect(src).toMatch(/BACKUP_DIR:-\/opt\/automatizacie-montalu\/backups/);
	});

	it('loguje do /var/log/automatizacie-montalu-backup.log', () => {
		expect(src).toMatch(/\/var\/log\/automatizacie-montalu-backup\.log/);
	});

	it('NEdotýka sa Money mountov (dlv-import / montalu) — používa /tmp v kontajneri', () => {
		expect(src).not.toMatch(/dlv-import/);
		expect(src).not.toMatch(/\/data\/montalu/);
		expect(src).toMatch(/IN_CONTAINER_PATH="\/tmp\//);
	});
});
