// Guard test pre `scripts/branch-protection.sh` (#267 — branch protection na main).
//
// Repo NEMÁ shell/bats harness (len vitest .ts), tak skript spustíme cez built-in
// `node:child_process` s MOCKNUTÝM `gh` na `PATH` (vzor `tests/deploy-remote.test.ts`)
// — žiadne reálne GitHub API volanie, žiadna nová závislosť. Mock `gh` zaloguje args
// a pri `--input` skopíruje payload súbor, takže vieme overiť PRESNÝ JSON, ktorý by
// skript poslal na `PUT .../branches/main/protection`.
//
// Kľúčové (coordinator amendment): mutation contexts sa NEhardcodujú — skript odvodí
// počet shardov z job-level `SHARDS: N` v mutation.yml a vygeneruje
// `mutation-diff (1..N)`. Test to overí cez fixture workflow so `SHARDS: 4` aj `6`
// (`MUTATION_WORKFLOW` env override), aby protection nikdy nedriftla od workflowu.
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

const SCRIPT = fileURLToPath(new URL('../scripts/branch-protection.sh', import.meta.url));
const TEMPLATE = fileURLToPath(new URL('../deploy/branch-protection.json', import.meta.url));

interface ProtectionPayload {
	required_status_checks: { strict: boolean; contexts: string[] };
	enforce_admins: boolean;
	required_pull_request_reviews: unknown;
	restrictions: unknown;
	allow_force_pushes: boolean;
	allow_deletions: boolean;
	required_linear_history: boolean;
	required_conversation_resolution: boolean;
}

interface Run {
	code: number;
	out: string;
	ghCalls: string[];
	payload: ProtectionPayload | null;
}

/**
 * Spustí branch-protection skript s mockom `gh`.
 * @param shards ak číslo → fixture mutation.yml so `SHARDS: N` cez MUTATION_WORKFLOW.
 *   `'missing'` → fixture bez `SHARDS:` (fail-loud vetva). `null` → default (reálny
 *   repo mutation.yml, bez override) — overuje wiring default cesty.
 */
function run(shards: number | 'missing' | null): Run {
	const dir = mkdtempSync(join(tmpdir(), 'branch-protection-'));
	const bin = join(dir, 'bin');
	mkdirSync(bin);
	const ghLog = join(dir, 'gh-calls.log');
	const payloadLog = join(dir, 'gh-payload.json');

	// mock gh: zaloguje args; pri `--input <file>` skopíruje payload, aby ho test
	// vedel prečítať a JSON.parse-núť. Vždy exit 0 (žiadne reálne API).
	writeFileSync(
		join(bin, 'gh'),
		[
			'#!/usr/bin/env bash',
			`echo "$*" >> ${JSON.stringify(ghLog)}`,
			'prev=""',
			'for a in "$@"; do',
			`  if [ "$prev" = "--input" ]; then cp "$a" ${JSON.stringify(payloadLog)}; fi`,
			'  prev="$a"',
			'done',
			'exit 0',
			''
		].join('\n')
	);
	chmodSync(join(bin, 'gh'), 0o755);

	const env: Record<string, string> = {
		...process.env,
		PATH: `${bin}:${process.env.PATH}`,
		BRANCH_PROTECTION_JSON: TEMPLATE
	};
	if (shards !== null) {
		const wf = join(dir, 'mutation.yml');
		const body =
			shards === 'missing'
				? 'jobs:\n  mutation-diff:\n    env:\n      SHARD: x\n'
				: `jobs:\n  mutation-diff:\n    env:\n      SHARDS: ${shards}\n      SHARD: x\n`;
		writeFileSync(wf, body);
		env.MUTATION_WORKFLOW = wf;
	}

	const res = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' });
	const ghCalls = existsSync(ghLog) ? readFileSync(ghLog, 'utf8').split('\n').filter(Boolean) : [];
	const payload = existsSync(payloadLog)
		? (JSON.parse(readFileSync(payloadLog, 'utf8')) as ProtectionPayload)
		: null;
	rmSync(dir, { recursive: true, force: true });
	return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? ''), ghCalls, payload };
}

const mut = (p: ProtectionPayload) =>
	p.required_status_checks.contexts.filter((c) => c.startsWith('mutation-diff'));

describe('#267 scripts/branch-protection.sh — branch protection na main', () => {
	it('PUT na správny endpoint main/protection cez --input, exit 0', () => {
		const r = run(4);
		expect(r.code, r.out).toBe(0);
		const put = r.ghCalls.find(
			(l) => l.includes('api') && l.includes('PUT') && l.includes('branches/main/protection')
		);
		expect(put, 'gh api PUT .../branches/main/protection sa nezavolal').toBeTruthy();
		expect(put).toContain('repos/zbynekdrlik/automatizacie-montalu/branches/main/protection');
		expect(put).toContain('--input');
	});

	it('payload: strict:false, enforce_admins:true, force-push/delete off, reviews/restrictions null', () => {
		const { payload } = run(4);
		expect(payload).not.toBeNull();
		const p = payload!;
		expect(p.required_status_checks.strict).toBe(false);
		expect(p.enforce_admins).toBe(true);
		expect(p.allow_force_pushes).toBe(false);
		expect(p.allow_deletions).toBe(false);
		expect(p.required_pull_request_reviews).toBeNull();
		expect(p.restrictions).toBeNull();
		expect(p.required_linear_history).toBe(false);
	});

	it('SHARDS:4 → contexts = version-check, test, mutation-diff (1..4); žiadny deploy/sweep', () => {
		const { payload } = run(4);
		const c = payload!.required_status_checks.contexts;
		expect(c).toContain('version-check');
		expect(c).toContain('test');
		for (let i = 1; i <= 4; i++) expect(c).toContain(`mutation-diff (${i})`);
		expect(c).not.toContain('mutation-diff (5)');
		expect(c).not.toContain('deploy');
		expect(c).not.toContain('mutation-sweep');
		expect(mut(payload!)).toHaveLength(4);
		expect(c).toHaveLength(6);
	});

	it('odvodí shardy z mutation.yml — SHARDS:6 → PRESNE 6 mutation contexts (+version-check,test)', () => {
		const { payload } = run(6);
		const c = payload!.required_status_checks.contexts;
		for (let i = 1; i <= 6; i++) expect(c).toContain(`mutation-diff (${i})`);
		expect(mut(payload!)).toHaveLength(6);
		expect(c).toContain('version-check');
		expect(c).toContain('test');
		expect(c).toHaveLength(8);
	});

	it('default (bez MUTATION_WORKFLOW): odvodí z reálneho repo mutation.yml (>=1 shard)', () => {
		const { payload } = run(null);
		expect(payload).not.toBeNull();
		const c = payload!.required_status_checks.contexts;
		expect(c).toContain('version-check');
		expect(c).toContain('test');
		expect(mut(payload!).length).toBeGreaterThanOrEqual(1);
	});

	it('repo edit: merge commits only (squash/rebase off, merge on)', () => {
		const { ghCalls } = run(4);
		const edit = ghCalls.find((l) => l.startsWith('repo edit'));
		expect(edit, 'gh repo edit sa nezavolal').toBeTruthy();
		expect(edit).toContain('--enable-squash-merge=false');
		expect(edit).toContain('--enable-rebase-merge=false');
		expect(edit).toContain('--enable-merge-commit=true');
	});

	it('idempotencia: dva behy dajú identický payload', () => {
		const a = run(4).payload;
		const b = run(4).payload;
		expect(b).toEqual(a);
	});

	it('fail-loud: chýbajúci SHARDS v mutation.yml → nenulový exit, žiadne PUT', () => {
		const r = run('missing');
		expect(r.code).not.toBe(0);
		expect(r.out).toMatch(/SHARDS/);
		expect(r.payload).toBeNull();
	});
});
