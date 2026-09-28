// #579 časť 2 (Odoo úloha 1180 po stretnutí 28.9.: „Povolené hrúbky pri systéme si nastaví
// výroba"): povolené hrúbky Odoo skiel per systém — čítanie (cache), validácia a zápis s auditom.
//
// Tabuľka `cfg_sklo_hrubka` (migrácia v52, seed = `ODOO_HRUBKY_SEED`) je JEDINÝ zdroj pre ponuku
// Odoo skiel v nárezáku (`sklo-odoo.ts` `ponukaSkielPre` / `overSkloOdoo`). Výroba mení LEN
// systém × hrúbku (mm) × druh v `/zasklenia/nastavenia`; výpočtové sklo sa NIKDY nezadáva —
// odvodí ho `vypocetneSkloPre` z lokálnej povolenej ponuky systému. Kombinácia, pre ktorú systém
// nemá výpočtové sklo, sa odmietne s hláškou (výpočet/Money by nemali čím počítať). Každý zápis
// má `cfg_audit` riadok v TEJ ISTEJ transakcii (audit invariant editora vzorcov, `cfg-editor.md`).
import { db, listGlassTypes, listSysStyly, systemyZoStylov } from './db';
import { logger } from './log';
import type { CfgZmena } from './cfg-editor';
import {
	ODOO_DRUH_POPIS,
	jeOdooDruh,
	ponukaSkielSystemu,
	vypocetneSkloPre,
	type OdooDruh,
	type OdooHrubka
} from '$lib/sklo-povolene';

const log = logger('sklo-hrubky');

/** Rozsah hrúbky, ktorý editor prijme (mm) — preklep typu 240 sa odmietne skôr než validácia skla. */
export const HRUBKA_BOUNDS = { min: 1, max: 100 } as const;

export interface SkloHrubka extends OdooHrubka {
	readonly id: number;
	readonly system: string;
}

let cache: readonly SkloHrubka[] | null = null;

/** Všetky povolené hrúbky (poradie = id = poradie pridania). Cache do najbližšieho zápisu. */
export function listSkloHrubky(): readonly SkloHrubka[] {
	cache ??= (
		db.prepare('SELECT id, system, mm, druh FROM cfg_sklo_hrubka ORDER BY id').all() as {
			id: number;
			system: string;
			mm: number;
			druh: OdooDruh;
		}[]
	).map((r) => ({ id: r.id, system: r.system, mm: r.mm, druh: r.druh }));
	return cache;
}

/** Povolené hrúbky Odoo skiel systému (bez záznamu = žiadne Odoo sklá v ponuke). */
export function skloHrubkyPre(system: string): SkloHrubka[] {
	return listSkloHrubky().filter((h) => h.system === system);
}

/** Lokálna povolená ponuka systému — z nej sa odvodzuje výpočtové sklo. */
function lokalnaPonuka(system: string): string[] {
	return ponukaSkielSystemu(system, listGlassTypes());
}

const popis = (h: { mm: number; druh: OdooDruh }) =>
	`Povolená hrúbka skla ${h.mm} mm (${ODOO_DRUH_POPIS[h.druh]})`;

function audit(username: string, system: string, zmena: CfgZmena): void {
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		username,
		system,
		JSON.stringify([zmena])
	);
}

type Vysledok = { error: string | null; zmena?: CfgZmena };

/** Odmietnutie editora — vždy zalogované (podvrhnutý POST / zastaraná stránka je signál). */
function odmietni(sprava: string, ctx: Record<string, unknown>): Vysledok {
	log.warn('sklo-hrubky: zmena odmietnutá', { dovod: sprava, ...ctx });
	return { error: sprava };
}

const jeUniqueKolizia = (e: unknown) =>
	(e as { code?: string } | null)?.code === 'SQLITE_CONSTRAINT_UNIQUE';

/** Pridaj povolenú hrúbku (validácia + zápis + audit v jednej transakcii). */
export function pridajSkloHrubku(input: {
	system: string;
	mm: number;
	druh: string;
	username: string;
}): Vysledok {
	const { system, mm, druh, username } = input;
	const ctx = { system, mm, druh, username };
	if (!systemyZoStylov(listSysStyly()).includes(system))
		return odmietni(`Neznámy systém „${system}".`, ctx);
	if (!Number.isFinite(mm) || mm < HRUBKA_BOUNDS.min || mm > HRUBKA_BOUNDS.max)
		return odmietni(`Hrúbka musí byť číslo ${HRUBKA_BOUNDS.min}–${HRUBKA_BOUNDS.max} mm.`, ctx);
	if (!jeOdooDruh(druh)) return odmietni('Neznámy druh skla.', ctx);
	const duplicita = (d: OdooDruh) =>
		`Hrúbka ${mm} mm je pri systéme ${system} už povolená (${ODOO_DRUH_POPIS[d]}).`;
	const existujuca = skloHrubkyPre(system).find((h) => h.mm === mm);
	if (existujuca) return odmietni(duplicita(existujuca.druh), ctx);
	const vypocet = vypocetneSkloPre(mm, druh, lokalnaPonuka(system));
	if (!vypocet)
		return odmietni(
			`Systém ${system} nemá výpočtové sklo pre ${mm} mm (${ODOO_DRUH_POPIS[druh]}) — ` +
				'nárezák by takéto sklo nevedel spočítať. Túto kombináciu nemožno povoliť.',
			ctx
		);
	const zmena: CfgZmena = {
		pole: popis({ mm, druh }),
		stara: 'nie',
		nova: `áno — počíta sa ako ${vypocet}`
	};
	try {
		db.transaction(() => {
			db.prepare('INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)').run(
				system,
				mm,
				druh
			);
			audit(username, system, zmena);
		})();
	} catch (e) {
		// UNIQUE(system, mm) — súbežný zápis z iného procesu (cache nevidí) → hláška, nie 500
		if (!jeUniqueKolizia(e)) throw e;
		cache = null;
		return odmietni(duplicita(druh), ctx);
	}
	cache = null;
	log.info('pridajSkloHrubku: povolená hrúbka pridaná', { system, mm, druh, vypocet, username });
	return { error: null, zmena };
}

/** Odober povolenú hrúbku `id` systému `system` (id iného systému = odmietnuté). */
export function odoberSkloHrubku(input: {
	id: number;
	system: string;
	username: string;
}): Vysledok {
	const { id, system, username } = input;
	const h = skloHrubkyPre(system).find((x) => x.id === id);
	if (!h)
		return odmietni('Táto hrúbka pri zvolenom systéme neexistuje (stránka je zastaraná?).', {
			id,
			system,
			username
		});
	const zmena: CfgZmena = { pole: popis(h), stara: 'áno', nova: 'nie' };
	db.transaction(() => {
		db.prepare('DELETE FROM cfg_sklo_hrubka WHERE id = ?').run(id);
		audit(username, system, zmena);
	})();
	cache = null;
	log.info('odoberSkloHrubku: povolená hrúbka odobratá', {
		system,
		mm: h.mm,
		druh: h.druh,
		username
	});
	return { error: null, zmena };
}

/** Hrúbky systému pre editor — s odvodeným výpočtovým sklom (null = katalóg sa medzitým zmenil,
 *  voľba sa v nárezáku neponúka). */
export function skloHrubkyEditor(
	system: string
): { id: number; mm: number; druh: OdooDruh; vypocet: string | null }[] {
	const lok = lokalnaPonuka(system);
	return skloHrubkyPre(system).map((h) => ({
		id: h.id,
		mm: h.mm,
		druh: h.druh,
		vypocet: vypocetneSkloPre(h.mm, h.druh, lok)
	}));
}
