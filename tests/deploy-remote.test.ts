// Regresný shell test rollback vetvy deploy skriptu (#254). Beží pod `npm test`
// (vitest) cez built-in `node:child_process` — ŽIADNA nová závislosť. Spustí
// `deploy/deploy-remote.sh` s MOCKNUTÝM `docker` + `curl` na `PATH`, takže
// nepotrebuje reálny Docker ani VPS a padne, keď sa rollback logika pokazí.
//
// Skript beží na VPS cez SSH z ci.yml deploy jobu. Rollback = natívny Docker
// image re-tag: pred `up` odchytí ID bežiaceho image, pri zlyhaní health polla
// ho re-tagne späť na `:current` a `up -d` (návrat na overený build).
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
const PREV_IMAGE = 'sha256:PREVIMAGE0000';

interface DeployRun {
	code: number;
	out: string;
	dockerCalls: string[];
}

/**
 * Spustí deploy skript s mockom `docker`/`curl`.
 * @param mockHealthJson čo mock `curl` vráti na KAŽDÝ /health poll
 * @param hasPrev či `docker inspect` uspeje (beží predchádzajúci kontajner)
 * @param sha7 nasadený SHA (forward poll ho vyžaduje vo verzii)
 */
function runDeploy(mockHealthJson: string, hasPrev: boolean, sha7: string): DeployRun {
	const dir = mkdtempSync(join(tmpdir(), 'deploy-remote-'));
	const bin = join(dir, 'bin');
	mkdirSync(bin);
	const dockerLog = join(dir, 'docker-calls.log');

	// mock docker: zaloguje args; `inspect` simuluje (ne)existujúci kontajner,
	// všetko ostatné (compose build/up, tag, logs) len prejde.
	writeFileSync(
		join(bin, 'docker'),
		[
			'#!/usr/bin/env bash',
			`echo "$*" >> ${JSON.stringify(dockerLog)}`,
			'case "$1" in',
			'  inspect)',
			`    if [ "${hasPrev ? '1' : '0'}" = "1" ]; then echo ${PREV_IMAGE}; exit 0; else exit 1; fi ;;`,
			'  *) exit 0 ;;',
			'esac',
			''
		].join('\n')
	);
	chmodSync(join(bin, 'docker'), 0o755);

	// mock curl: vráti daný health JSON na každý dopyt.
	writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\necho ${JSON.stringify(mockHealthJson)}\n`);
	chmodSync(join(bin, 'curl'), 0o755);

	const res = spawnSync('bash', [SCRIPT], {
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			COMPOSE_DIR: dir,
			SHA7: sha7,
			APP_VERSION: `0.24.8-dev.1 (${sha7})`,
			CONTAINER: 'automatizacie-montalu',
			IMAGE: 'automatizacie-montalu',
			HEALTH_URL: 'http://127.0.0.1:8090/health',
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
		dockerCalls
	};
}

const upCount = (r: DeployRun) => r.dockerCalls.filter((l) => l === 'compose up -d').length;
const rollbackTagged = (r: DeployRun) =>
	r.dockerCalls.some((l) => l === `tag ${PREV_IMAGE} automatizacie-montalu:current`);

describe('#254 deploy-remote.sh — rollback pri neúspešnom health', () => {
	it('happy: health OK + SHA sedí → exit 0, žiadny rollback, jediný `up -d`', () => {
		const r = runDeploy(
			'{"ok":true,"version":"0.24.8-dev.1 (abc1234)","live":false}',
			true,
			'abc1234'
		);
		expect(r.code).toBe(0);
		expect(upCount(r)).toBe(1);
		expect(rollbackTagged(r)).toBe(false);
		// build + durable SHA tag prebehli
		expect(r.dockerCalls).toContain('compose build');
		expect(r.dockerCalls).toContain(
			'tag automatizacie-montalu:current automatizacie-montalu:abc1234'
		);
	});

	it('rollback OK: forward SHA nesedí → re-tag prev + druhý `up -d` + exit 1', () => {
		// ok:true ale verzia má INÝ sha → forward (mode sha) zlyhá; rollback poll
		// (mode live) na ok:true uspeje → prod beží na starom builde.
		const r = runDeploy(
			'{"ok":true,"version":"0.24.8-dev.1 (WRONGSH)","live":false}',
			true,
			'abc1234'
		);
		expect(r.code).toBe(1); // deploy zlyhal (job červený), aj keď rollback OK
		expect(rollbackTagged(r)).toBe(true); // KĽÚČOVÉ: prev image re-tagnutý na :current
		expect(upCount(r)).toBe(2); // pôvodný up + rollback up
		expect(r.out).toMatch(/rollback.*OK|prod beží/i);
	});

	it('first-deploy: žiadny predchádzajúci kontajner → žiadny rollback, exit 1', () => {
		const r = runDeploy(
			'{"ok":true,"version":"0.24.8-dev.1 (WRONGSH)","live":false}',
			false,
			'abc1234'
		);
		expect(r.code).toBe(1);
		expect(rollbackTagged(r)).toBe(false); // nie je na čo rollbacknúť
		expect(upCount(r)).toBe(1);
		expect(r.out).toMatch(/žiadna predchádzajúca verzia|prvý deploy/i);
	});

	it('rollback tiež zlyhá: health nikdy ok → re-tag prev + up, ale exit 1 s alarmom', () => {
		const r = runDeploy('{"ok":false}', true, 'abc1234');
		expect(r.code).toBe(1);
		expect(rollbackTagged(r)).toBe(true); // rollback sa POKÚSIL
		expect(upCount(r)).toBe(2);
		expect(r.out).toMatch(/rollback health.*zlyhal|prod je pravdepodobne DOWN/i);
	});
});
