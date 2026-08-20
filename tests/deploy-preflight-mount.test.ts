// Regresný shell test PRE-FLIGHT kontroly host bind-mount zdrojov v deploy skripte (#270).
//
// Incident (kolo 9, 2026-08-20): `docker compose up -d` bežal, keď CIFS mounty na Money
// server boli „Host is down". Docker nevie bind-mountnúť mŕtvy path → recreate zabil bežiaci
// kontajner, nový nenaštartoval, rollback (#254) zlyhal na tom istom mounte → prod DOWN ~12 min.
//
// Fix: `deploy/deploy-remote.sh` má PRED akýmkoľvek recreate skontrolovať dostupnosť každého
// host bind-mount zdroja DEKLAROVANÉHO v compose (`stat` + `ls` s `timeout`). Ak je aspoň jeden
// nedostupný → exit≠0 PRED `up -d`, takže starý kontajner ostáva bežať (prod UP na starej verzii).
//
// Zoznam zdrojov sa ODVODZUJE z compose (žiadna druhá hardcoded kópia, ktorá by driftla):
// list položky pod `volumes:`, ktorých ľavá strana pred prvým `:` je absolútna cesta `/…`.
// Named volumes (`appdata:`) sa NEkontrolujú.
//
// Beží pod `npm test` (vitest) cez built-in `node:child_process` s MOCKNUTÝM `docker`/`curl`
// na `PATH` (vzor `tests/deploy-remote.test.ts`) — žiadny reálny Docker/VPS, žiadna nová dep.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	chmodSync,
	readFileSync,
	existsSync,
	rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../deploy/deploy-remote.sh', import.meta.url));
const SHA7 = 'abc1234';

interface Run {
	code: number;
	out: string;
	dockerCalls: string[];
	binds: { src: string; ok: boolean }[];
}

interface Fixture {
	healthy?: number; // počet zdravých bind-mount zdrojov (reálne existujúce adresáre)
	unreachable?: number; // počet nedostupných bind-mount zdrojov (neexistujúce cesty)
	named?: string[]; // named volumes (ľavá strana = meno) — pre-flight ich NEmá kontrolovať
}

/**
 * Spustí deploy skript s mockom `docker`/`curl` a compose fixture, ktorý deklaruje dané
 * bind-mount zdroje + named volumes. Pre-flight číta compose z COMPOSE_DIR.
 * `curl` vracia zdravý health so správnym SHA (forward poll prejde), takže happy path
 * dôjde k exit 0; keď pre-flight padne, mock `docker` sa NIKDY nezavolá.
 */
function runPreflight({ healthy = 0, unreachable = 0, named = ['appdata'] }: Fixture): Run {
	const dir = mkdtempSync(join(tmpdir(), 'deploy-preflight-'));
	const bin = join(dir, 'bin');
	mkdirSync(bin);
	const dockerLog = join(dir, 'docker-calls.log');

	writeFileSync(
		join(bin, 'docker'),
		[
			'#!/usr/bin/env bash',
			`echo "$*" >> ${JSON.stringify(dockerLog)}`,
			'case "$1" in',
			'  inspect) echo sha256:PREVIMAGE0000; exit 0 ;;',
			'  *) exit 0 ;;',
			'esac',
			''
		].join('\n')
	);
	chmodSync(join(bin, 'docker'), 0o755);

	writeFileSync(
		join(bin, 'curl'),
		`#!/usr/bin/env bash\necho '{"ok":true,"version":"0.24.15 (${SHA7})","live":false}'\n`
	);
	chmodSync(join(bin, 'curl'), 0o755);

	const binds: { src: string; ok: boolean }[] = [];
	for (let i = 0; i < healthy; i++) {
		const p = join(dir, `mnt-ok-${i}`);
		mkdirSync(p);
		binds.push({ src: p, ok: true });
	}
	for (let i = 0; i < unreachable; i++) {
		// zámerne NEvytvorený adresár → `stat`/`ls` zlyhá = nedostupný zdroj
		binds.push({ src: join(dir, `mnt-dead-${i}`), ok: false });
	}

	// compose fixture: named volumes (ľavá strana = meno) + bind-mounty (ľavá strana = /cesta).
	// Formát zodpovedá reálnemu deploy/docker-compose.yml (list položky pod services.app.volumes).
	const volLines = [
		...named.map((n) => `      - ${n}:/data/${n}`),
		...binds.map((b, i) => `      - ${b.src}:/data/mnt${i}`)
	].join('\n');
	writeFileSync(
		join(dir, 'docker-compose.yml'),
		`services:\n  app:\n    image: automatizacie-montalu:current\n    volumes:\n${volLines}\nvolumes:\n  appdata:\n`
	);

	const res = spawnSync('bash', [SCRIPT], {
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			COMPOSE_DIR: dir,
			SHA7,
			APP_VERSION: `0.24.15 (${SHA7})`,
			CONTAINER: 'automatizacie-montalu',
			IMAGE: 'automatizacie-montalu',
			HEALTH_URL: 'http://127.0.0.1:8090/health',
			STAT_TIMEOUT: '5',
			POLL_TRIES: '2',
			POLL_SLEEP: '0'
		},
		encoding: 'utf8'
	});

	const dockerCalls = existsSync(dockerLog)
		? readFileSync(dockerLog, 'utf8').split('\n').filter(Boolean)
		: [];
	rmSync(dir, { recursive: true, force: true });
	return {
		code: res.status ?? 1,
		out: (res.stdout ?? '') + (res.stderr ?? ''),
		dockerCalls,
		binds
	};
}

// počet „OK  <src>" riadkov (jeden na skontrolovaný dostupný zdroj)
const okCount = (r: Run) => (r.out.match(/^\s*OK\s+/gm) || []).length;

describe('#270 deploy-remote.sh — pre-flight kontrola bind-mount zdrojov pred recreate', () => {
	it('(a) všetky bind-mount zdroje dostupné → pre-flight prejde, deploy pokračuje (up -d), exit 0', () => {
		const r = runPreflight({ healthy: 3 });
		expect(r.code, r.out).toBe(0);
		// deploy prešiel cez pre-flight k reálnemu recreate
		expect(r.dockerCalls).toContain('compose up -d');
		expect(r.dockerCalls).toContain('compose build');
		// pre-flight naozaj bežal a skontroloval PRESNE tie 3 zdroje
		expect(r.out).toMatch(/pre-flight: kontrolujem/);
		expect(okCount(r)).toBe(3);
		for (const b of r.binds) expect(r.out).toContain(`OK  ${b.src}`);
	});

	it('(b) jeden bind-mount zdroj nedostupný → exit≠0 PRED recreate, žiadny docker call (ani build ani up)', () => {
		const r = runPreflight({ healthy: 2, unreachable: 1 });
		expect(r.code).not.toBe(0);
		const dead = r.binds.find((b) => !b.ok)!.src;
		expect(r.out).toContain(`bind-mount zdroj '${dead}' nedostupný`);
		expect(r.out).toMatch(/deploy sa NEvykon|NEVYKONAL|bežiaci kontajner .* ostáva/i);
		// KĽÚČOVÉ: fail je PRED akýmkoľvek recreate — pre-flight je prvá akcia, žiaden docker
		expect(r.dockerCalls).not.toContain('compose up -d');
		expect(r.dockerCalls.some((l) => l.startsWith('compose build'))).toBe(false);
		expect(r.dockerCalls).toHaveLength(0);
	});

	it('(c) zoznam sa odvodí z compose: named volume sa NEkontroluje (len bind-mounty s /cestou)', () => {
		// 2 zdravé bind-mounty + named volume `appdata`. Keby pre-flight (chybne) kontroloval
		// aj named volume, `stat appdata` (meno, nie cesta) by v COMPOSE_DIR zlyhalo → exit≠0.
		// Prejde → named volume je z kontroly vylúčený.
		const r = runPreflight({ healthy: 2, named: ['appdata'] });
		expect(r.code, r.out).toBe(0);
		expect(okCount(r)).toBe(2); // PRESNE 2 bind-mounty, nie 3 (named volume nerátaný)
		for (const b of r.binds) expect(r.out).toContain(`OK  ${b.src}`);
		expect(r.out).not.toMatch(/OK\s+appdata\b/);
		expect(r.out).not.toMatch(/appdata.*nedostupn|nedostupn.*appdata/);
	});

	it('(d) viac nedostupných → nahlási KAŽDÝ mŕtvy zdroj a exit≠0 pred recreate', () => {
		const r = runPreflight({ healthy: 1, unreachable: 2 });
		expect(r.code).not.toBe(0);
		for (const b of r.binds.filter((x) => !x.ok)) {
			expect(r.out).toContain(`bind-mount zdroj '${b.src}' nedostupný`);
		}
		expect(r.dockerCalls).toHaveLength(0);
	});
});
