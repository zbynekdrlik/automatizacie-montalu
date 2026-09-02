// #5822: deploy-remote.sh musí zložiť base-aware HEALTH_URL default (`<base>/health`) — pod
// bakovaným base kit 404-uje holý `/health` (mimo base) → unhealthy → rollback pri KAŽDOM
// deployi. APP_BASE_PATH žije v .env COMPOSE_DIR (zdroj, ktorý compose interpoluje), takže
// skript ho musí vedieť dobrať z .env aj keď ho shell env deploy jobu nemá. base='' ⇒ holý
// `/health` (dnešný VPS, byte-identicky). Mock `curl` logujúci URL — bez neho bol default
// netestovaný (harness v deploy-remote.test.ts vždy posiela HEALTH_URL explicitne).
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../deploy/deploy-remote.sh', import.meta.url));

/** Spustí skript s happy mockom docker + curl (loguje URL); vráti zoznam curl URL. */
function healthUrls(opts: { appBasePath?: string; viaDotEnv?: string }): string[] {
	const dir = mkdtempSync(join(tmpdir(), 'deploy-base-'));
	const bin = join(dir, 'bin');
	mkdirSync(bin);
	const curlLog = join(dir, 'curl-urls.log');
	// docker: všetko prejde (inspect = žiadny prev, aby netreba rollback)
	writeFileSync(
		join(bin, 'docker'),
		'#!/usr/bin/env bash\ncase "$1" in inspect) exit 1;; *) exit 0;; esac\n'
	);
	chmodSync(join(bin, 'docker'), 0o755);
	// curl: zaloguj poslednú URL args, vráť zdravý health so SHA
	writeFileSync(
		join(bin, 'curl'),
		`#!/usr/bin/env bash\necho "\${!#}" >> ${JSON.stringify(curlLog)}\necho '{"ok":true,"version":"0.24.8-dev.1 (abc1234)","live":false}'\n`
	);
	chmodSync(join(bin, 'curl'), 0o755);
	if (opts.viaDotEnv !== undefined) {
		writeFileSync(
			join(dir, '.env'),
			`SEED_USERS=x\nAPP_BASE_PATH=${opts.viaDotEnv}\nMONEY_LIVE=0\n`
		);
	}
	const env: Record<string, string> = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		COMPOSE_DIR: dir,
		SHA7: 'abc1234',
		APP_VERSION: '0.24.8-dev.1 (abc1234)',
		CONTAINER: 'automatizacie-montalu',
		IMAGE: 'automatizacie-montalu',
		POLL_TRIES: '1',
		POLL_SLEEP: '0'
		// HEALTH_URL zámerne NEnastavené → skript ho zloží base-aware
	} as Record<string, string>;
	if (opts.appBasePath !== undefined) env.APP_BASE_PATH = opts.appBasePath;
	const res = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
	const urls = readFileSync(curlLog, 'utf8').split('\n').filter(Boolean);
	rmSync(dir, { recursive: true, force: true });
	expect(res.status, `skript zlyhal: ${(res.stdout ?? '') + (res.stderr ?? '')}`).toBe(0);
	return urls;
}

describe('#5822 deploy-remote.sh — base-aware HEALTH_URL default', () => {
	it("base='' (dnešný VPS, APP_BASE_PATH unset) → holý /health (byte-identicky)", () => {
		const urls = healthUrls({});
		expect(urls.length).toBeGreaterThan(0);
		expect(urls.every((u) => u === 'http://127.0.0.1:8090/health')).toBe(true);
	});

	it('APP_BASE_PATH v shell env → /automatizacie/health', () => {
		const urls = healthUrls({ appBasePath: '/automatizacie' });
		expect(urls.every((u) => u === 'http://127.0.0.1:8090/automatizacie/health')).toBe(true);
	});

	it('APP_BASE_PATH len v .env (compose zdroj, nie shell) → /automatizacie/health', () => {
		const urls = healthUrls({ viaDotEnv: '/automatizacie' });
		expect(urls.every((u) => u === 'http://127.0.0.1:8090/automatizacie/health')).toBe(true);
	});
});
