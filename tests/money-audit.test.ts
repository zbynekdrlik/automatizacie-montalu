// #297: Perzistentný forenzný money-audit súbor. Money-doménové log udalosti
// (logger('money') / 'money:*') sa okrem stdout zapíšu aj do súboru na
// perzistentnom docker volume, aby PREŽILI redeploy kontajnera (stdout json-file
// logy sú container-scoped a pri recreate zmiznú — #294 verdikt §2.3-4).
//
// Testuje: modul money-audit.ts (zapnutie/vypnutie, rotácia, prehltnutie chyby,
// isMoneyModule) + integráciu v log.ts (money → súbor, non-money → nie, nezávislosť
// od LOG_LEVEL, redakcia tajomstiev).
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { appendMoneyAudit, isMoneyModule, auditPath } from '../src/lib/server/money-audit';
import { logger } from '../src/lib/server/log';

function freshFile(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-money-audit-'));
	return path.join(dir, 'money.jsonl');
}

function readLines(file: string): Record<string, unknown>[] {
	if (!fs.existsSync(file)) return [];
	return fs
		.readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

afterEach(() => {
	delete process.env.MONEY_AUDIT_LOG;
	delete process.env.MONEY_AUDIT_MAX_BYTES;
	delete process.env.MONEY_AUDIT_KEEP;
	delete process.env.LOG_LEVEL;
});

describe('money-audit modul', () => {
	it('auditPath() vráti cestu keď MONEY_AUDIT_LOG nastavené, inak null', () => {
		expect(auditPath()).toBeNull();
		process.env.MONEY_AUDIT_LOG = '/x/y.jsonl';
		expect(auditPath()).toBe('/x/y.jsonl');
		process.env.MONEY_AUDIT_LOG = '   ';
		expect(auditPath()).toBeNull(); // whitespace-only = vypnuté
	});

	it('isMoneyModule: presná zhoda money / money:* — nie moneybags, nie app', () => {
		expect(isMoneyModule('money')).toBe(true);
		expect(isMoneyModule('money:sub')).toBe(true);
		expect(isMoneyModule('moneybags')).toBe(false);
		expect(isMoneyModule('app')).toBe(false);
		expect(isMoneyModule('auth')).toBe(false);
	});

	it('appendMoneyAudit zapíše riadok keď zapnuté; vytvorí chýbajúci parent adresár', () => {
		const file = path.join(freshFile(), '..', 'nested', 'deep', 'money.jsonl');
		process.env.MONEY_AUDIT_LOG = file;
		appendMoneyAudit('{"a":1}\n');
		appendMoneyAudit('{"a":2}\n');
		expect(readLines(file)).toEqual([{ a: 1 }, { a: 2 }]);
	});

	it('appendMoneyAudit je no-op keď vypnuté (žiadny MONEY_AUDIT_LOG)', () => {
		const file = freshFile();
		// env NEnastavené
		appendMoneyAudit('{"a":1}\n');
		expect(fs.existsSync(file)).toBe(false);
	});

	it('rotácia: po prekročení MAX_BYTES sa current posunie na .1, drží sa KEEP archívov', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		process.env.MONEY_AUDIT_MAX_BYTES = '50'; // každý riadok > 50 B ⇒ rotuje pri 2.+ zápise
		process.env.MONEY_AUDIT_KEEP = '2';
		const line = JSON.stringify({ msg: 'x'.repeat(60) }) + '\n';
		appendMoneyAudit(line); // 1: current
		appendMoneyAudit(line); // 2: current→.1
		appendMoneyAudit(line); // 3: .1→.2, current→.1
		appendMoneyAudit(line); // 4: .1→.2 (prepis), current→.1
		expect(fs.existsSync(file)).toBe(true);
		expect(fs.existsSync(`${file}.1`)).toBe(true);
		expect(fs.existsSync(`${file}.2`)).toBe(true);
		expect(fs.existsSync(`${file}.3`)).toBe(false); // KEEP=2 ⇒ najstarší zahodený
	});

	it('neplatné MAX_BYTES/KEEP ⇒ default (žiadna rotácia pri malých zápisoch)', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		process.env.MONEY_AUDIT_MAX_BYTES = 'abc'; // neplatné → default 5 MB
		process.env.MONEY_AUDIT_KEEP = '-3'; // neplatné → default
		appendMoneyAudit('{"a":1}\n');
		appendMoneyAudit('{"a":2}\n');
		expect(fs.existsSync(`${file}.1`)).toBe(false); // pod 5 MB, nerotuje
		expect(readLines(file)).toHaveLength(2);
	});

	it('zlyhanie zápisu (parent je SÚBOR) ⇒ NEhodí (best-effort prehltnutie)', () => {
		const base = freshFile();
		fs.writeFileSync(base, 'súbor, nie adresár\n'); // base je súbor
		process.env.MONEY_AUDIT_LOG = path.join(base, 'money.jsonl'); // parent=súbor ⇒ ENOTDIR
		expect(() => appendMoneyAudit('{"a":1}\n')).not.toThrow();
	});
});

describe('log.ts → money-audit integrácia', () => {
	it('money.info sa zapíše do súboru (nezávisle od stdout LOG_LEVEL=silent)', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		process.env.LOG_LEVEL = 'silent'; // stdout umlčaný — forenzný súbor musí písať aj tak
		logger('money').info('odpis zapísaný', { zak: 'ZAK1', op: 'OP1' });
		const recs = readLines(file);
		expect(recs).toHaveLength(1);
		expect(recs[0]!.module).toBe('money');
		expect(recs[0]!.msg).toBe('odpis zapísaný');
		expect(recs[0]!.zak).toBe('ZAK1');
	});

	it('money:sub child modul sa tiež zapíše', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		logger('money').child('validacia').warn('kódy chýbajú', { kod: 'X' });
		const recs = readLines(file);
		expect(recs).toHaveLength(1);
		expect(recs[0]!.module).toBe('money:validacia');
	});

	it('non-money modul (auth) sa do money súboru NEzapíše', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		logger('auth').info('login ok', { username: 'a' });
		expect(fs.existsSync(file)).toBe(false);
	});

	it('money.debug (pod AUDIT_MIN=info) sa do súboru NEzapíše', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		process.env.LOG_LEVEL = 'debug';
		logger('money').debug('trace', { x: 1 });
		expect(fs.existsSync(file)).toBe(false);
	});

	it('redakcia tajomstiev platí aj v súbore', () => {
		const file = freshFile();
		process.env.MONEY_AUDIT_LOG = file;
		logger('money').error('zlyhalo', { token: 'tajne', zak: 'ZAK9' });
		const recs = readLines(file);
		expect(recs[0]!.token).toBe('[redacted]');
		expect(recs[0]!.zak).toBe('ZAK9');
	});

	it('audit vypnutý ⇒ money.info nič nezapíše (feature off)', () => {
		const file = freshFile();
		// MONEY_AUDIT_LOG NEnastavené
		const spy = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation((() => true) as typeof process.stdout.write);
		try {
			logger('money').info('odpis', { zak: 'Z' });
		} finally {
			spy.mockRestore();
		}
		expect(fs.existsSync(file)).toBe(false);
	});
});
