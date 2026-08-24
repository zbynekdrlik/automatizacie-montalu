// Bez-závislostný štruktúrovaný logger (#245). Jeden JSON riadok na udalosť do
// `process.stdout` — Docker json-file ho zbiera (rotácia = CI/Docker ticket).
// Zvolený NAMIESTO pino/winston: ich bundling pod Vite SSR + adapter-node +
// `npm prune --omit=dev` je integračné riziko neoveriteľné v Tier-0 worktree a
// pridaná hodnota (transporty/rotácia) tu nič nerieši — viď design komentár #245.
//
// NIKDY nelogovať heslá / SEED_USERS hodnoty / session tokeny — volajúci ich
// neposiela; navyše kľúče password/token/secret/authorization/cookie sa redigujú
// (defense-in-depth). `Error` hodnoty sa serializujú aj so `stack`.

import { appendMoneyAudit, isMoneyModule, auditPath } from './money-audit';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SILENT = 100;
const REDACT = /^(?:password|pass|pass_hash|token|secret|authorization|cookie)$/i;

/**
 * Prahový level. `LOG_LEVEL` (debug/info/warn/error/silent) má prednosť; pod
 * testom (VITEST / NODE_ENV=test) je default `silent`, aby 700+ testov nezaplavilo
 * stdout, inak `debug` (MVP — comprehensive-logging: radšej viac logov v prode).
 * Číta sa PER volanie, aby test vedel level nastaviť za behu.
 */
function threshold(): number {
	const env = (process.env.LOG_LEVEL || '').toLowerCase();
	if (env in LEVELS) return LEVELS[env as LogLevel];
	if (env === 'silent') return SILENT;
	if (process.env.VITEST || process.env.NODE_ENV === 'test') return SILENT;
	return LEVELS.debug;
}

function serialize(v: unknown): unknown {
	if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
	return v;
}

// Pozn. (review #245): redakcia aj Error-serializácia sú LEN na najvyššej úrovni fieldov
// (nie rekurzívne). Všetky call-sites posielajú ploché objekty; vnorené tajomstvo nikto
// neposiela — keby raz áno, buď to sploští, alebo sem doplň rekurziu.
function redact(fields: Fields): Fields {
	const out: Fields = {};
	for (const [k, v] of Object.entries(fields))
		out[k] = REDACT.test(k) ? '[redacted]' : serialize(v);
	return out;
}

// Forenzný money-audit súbor (#297): money-modulové udalosti (info+) idú OKREM
// stdout aj do perzistentného súboru — NEZÁVISLE od stdout LOG_LEVEL, aby
// operačná zmena log-levelu nikdy neumlčala forenziku (odpis zapísaný/uvoľnený/
// claim sú `info` a forenzne najdôležitejšie; prežijú redeploy — money-audit.ts).
const AUDIT_MIN = LEVELS.info;

function emit(level: LogLevel, module: string, msg: string, fields?: Fields): void {
	const toStdout = LEVELS[level] >= threshold();
	const toAudit = LEVELS[level] >= AUDIT_MIN && isMoneyModule(module) && auditPath() !== null;
	// early-return bez JSON.stringify keď žiaden sink záznam nechce (bežný non-money debug)
	if (!toStdout && !toAudit) return;
	const rec = {
		time: new Date().toISOString(),
		level,
		module,
		msg,
		...(fields ? redact(fields) : {})
	};
	const line = JSON.stringify(rec) + '\n';
	if (toStdout) {
		try {
			process.stdout.write(line);
		} catch {
			// logovanie nesmie NIKDY zhodiť požiadavku
		}
	}
	// money-audit sink má vlastné best-effort try/catch (nikdy nehodí)
	if (toAudit) appendMoneyAudit(line);
}

export interface Logger {
	debug(msg: string, fields?: Fields): void;
	info(msg: string, fields?: Fields): void;
	warn(msg: string, fields?: Fields): void;
	error(msg: string, fields?: Fields): void;
	/** child logger s pod-modulom `module:sub` (rovnaké levely a redakcia). */
	child(sub: string): Logger;
}

export function logger(module: string): Logger {
	return {
		debug: (m, f) => emit('debug', module, m, f),
		info: (m, f) => emit('info', module, m, f),
		warn: (m, f) => emit('warn', module, m, f),
		error: (m, f) => emit('error', module, m, f),
		child: (sub) => logger(`${module}:${sub}`)
	};
}

export const log = logger('app');
