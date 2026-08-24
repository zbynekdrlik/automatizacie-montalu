// Perzistentný forenzný money-audit súbor (#297). Money-doménové log udalosti
// (odpis claim/zapísaný/uvoľnený/override/dedup/ledger-blok/validácia z
// `logger('money')`) sa OKREM stdout zapíšu aj do JSONL súboru na perzistentnom
// docker named volume (`moneylog:/data/money-log`, env `MONEY_AUDIT_LOG`), aby
// PREŽILI redeploy kontajnera. stdout json-file logy sú container-scoped: pri
// redeployi (`docker compose build && up` = recreate) sa logy starého kontajnera
// zahodia — 30.7 incident sa dal zrekonštruovať IBA z Money DONE archívu +
// cfg_audit, lebo app logy rotovali pri redeployi 01:08 (#294 verdikt §2.3-4).
//
// Zámerne BEZ pino/pino-roll/winston-daily-rotate (#245 rozhodnutie: ich bundling
// pod Vite SSR + adapter-node + `npm prune --omit=dev` je integračné riziko
// neoveriteľné v Tier-0 worktree, pridaná hodnota tu nulová) — vlastná malá
// size-based rotácia nad `node:fs`, konzistentná s bez-závislostným loggerom.

import { appendFileSync, statSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB na súbor
const DEFAULT_KEEP = 5; // koľko rotovaných archívov (.1..N) držať

function num(env: string | undefined, fallback: number): number {
	const n = env ? Number(env) : NaN;
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Cesta k money-audit súboru, alebo null keď je feature vypnutá (env nenastavené). */
export function auditPath(): string | null {
	const p = process.env.MONEY_AUDIT_LOG;
	return p && p.trim() ? p : null;
}

/**
 * money / money:* modul → ide do forenzného súboru. Presná zhoda, nie `moneybags`
 * (`startsWith('money')` by ho falošne chytil).
 */
export function isMoneyModule(module: string): boolean {
	return module === 'money' || module.startsWith('money:');
}

// mkdirSync(recursive) je idempotentné (nehodí keď adresár existuje) — money
// udalosti sú zriedkavé, takže lacná istota parent adresára pri každom zápise.
function ensureDir(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
}

// Ak by current súbor po pridaní riadku prekročil MAX_BYTES, posuň reťaz archívov:
// .(keep-1)→.keep (prepíše najstarší), … , .1→.2, current→.1. Potom appendFileSync
// vytvorí čerstvý current. Drží current + `keep` archívov.
function rotateIfNeeded(path: string, incomingBytes: number): void {
	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		return; // súbor ešte neexistuje → netreba rotovať
	}
	const max = num(process.env.MONEY_AUDIT_MAX_BYTES, DEFAULT_MAX_BYTES);
	if (size + incomingBytes <= max) return;
	const keep = Math.max(1, Math.floor(num(process.env.MONEY_AUDIT_KEEP, DEFAULT_KEEP)));
	for (let i = keep; i >= 1; i--) {
		const src = i === 1 ? path : `${path}.${i - 1}`;
		const dst = `${path}.${i}`;
		try {
			if (existsSync(src)) renameSync(src, dst);
		} catch {
			// rotácia je best-effort — nikdy nesmie zhodiť logovanie
		}
	}
}

/**
 * Zapíš JEDEN už-serializovaný JSON riadok (vrátane `\n`) do money-audit súboru.
 * Best-effort: akékoľvek zlyhanie (práva, plný disk, ENOTDIR) sa PREHLTNE —
 * forenzný zápis NIKDY nesmie zhodiť požiadavku (rovnaký kontrakt ako stdout v
 * log.ts). No-op keď je feature vypnutá (`MONEY_AUDIT_LOG` nenastavené).
 */
export function appendMoneyAudit(line: string): void {
	const path = auditPath();
	if (!path) return;
	try {
		ensureDir(path);
		rotateIfNeeded(path, Buffer.byteLength(line));
		appendFileSync(path, line);
	} catch {
		// prehltni — forenzný audit nesmie ovplyvniť beh appky
	}
}
