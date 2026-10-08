// Audity VEDOMÝCH override-ov blokov `writeOdpis` do `cfg_audit` (#295 kódy, #300 ledger, #307
// prehodené polia, #608 dorobenie). Vytiahnuté z `money.ts` (#608, large-file-split — money.ts bol
// na 1000-r. strope): texty, logger `money` aj volanie AŽ v zápisovej transakcii `writeOdpis` sú
// nezmenené. Importuje LEN `db` + `log` (+ typy — typový import sa pri behu zmaže, žiadny cyklus).
import { db } from './db';
import { logger } from './log';
import type { KodProblem } from './ceny';
import type { OdpisJob } from './money';

const log = logger('money');

/** Audit vedomého override chýbajúcich Money kódov (#295) — NIE tiché preskočenie: do `cfg_audit`
 *  sa zapíše, KTO poslal odpis napriek varovaniu a ktoré kódy Money nepozná. */
export function auditOverrideKody(job: OdpisJob, problemy: KodProblem[]): void {
	const kody = problemy.map((p) => p.kod).join(', ');
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole: `Override chýbajúcich Money kódov (${kody}) — odpis ${job.modul} ${job.zak} OP${job.op} odoslaný napriek varovaniu`,
				stara: 0,
				nova: 1
			}
		])
	);
	log.warn('odpis: override chýbajúcich Money kódov', {
		modul: job.modul,
		zak: job.zak,
		op: job.op,
		kody
	});
}

/** Audit vedomého ledger override (#300) — operátor potvrdil „Odoslať aj tak" pri identickom
 *  obsahu, ktorý ledger blokoval (import v Money zmazal, ale klikol „Uvoľniť" namiesto „Povoliť
 *  rovnaký"). NIE tiché preskočenie: do `cfg_audit` sa zapíše, KTO povolil re-import. */
export function auditOverrideLedger(job: OdpisJob): void {
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole: `Override ledgeru „Odoslať aj tak" — re-import identického obsahu ${job.modul} ${job.zak} OP${job.op} povolený (potvrdené zmazanie importu v Money)`,
				stara: 0,
				nova: 1
			}
		])
	);
	log.warn('odpis: override ledgeru „Odoslať aj tak"', {
		modul: job.modul,
		zak: job.zak,
		op: job.op
	});
}

/** Audit vedomého override PREHODENÝCH polí zak/op (#307) — operátor potvrdil „Odoslať aj tak" pri
 *  podozrení na zamenené číslo zákazky/objednávky. NIE tiché preskočenie: do `cfg_audit` sa zapíše,
 *  KTO poslal odpis napriek varovaniu. */
export function auditOverridePrehodene(job: OdpisJob): void {
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole: `Override prehodených polí zak/op — odpis ${job.modul} ${job.zak} OP${job.op} odoslaný napriek varovaniu (číslo zákazky/objednávky pravdepodobne zamenené)`,
				stara: 0,
				nova: 1
			}
		])
	);
	log.warn('odpis: override prehodených polí zak/op', {
		modul: job.modul,
		zak: job.zak,
		op: job.op
	});
}

/** Audit vedomého DOROBENIA (#608) — operátor potvrdil „Odoslať ako dorobenie" pri zákazke/OP, ktorá už
 *  má v module odoslaný odpis (zlé zameranie, posuv sa vyrába znova). NIE tichý bypass: do `cfg_audit`
 *  sa zapíše KTO poslal ďalší doklad do Money, číslo dorobenia a či to isté potvrdenie prekonalo aj
 *  ledger (identický obsah). Volá sa AŽ v zápisovej transakcii (vzor #300 review 🟡). Vráti id
 *  `cfg_audit` riadku — keď zápis súboru zlyhá, kompenzácia ho zmaže (dorobenie sa NEodoslalo). */
export function auditOverrideDorobenie(
	job: OdpisJob,
	poradie: number,
	ledgerPrekonany: boolean
): number | bigint {
	const id = db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole:
					`Dorobenie č. ${poradie} — odpis ${job.modul} ${job.zak} OP${job.op} odoslaný vedome ` +
					`napriek existujúcemu odpisu tej istej zákazky` +
					(ledgerPrekonany ? ' (identický obsah — ledger prekonaný tým istým potvrdením)' : ''),
				stara: poradie - 1,
				nova: poradie
			}
		])
	).lastInsertRowid;
	log.warn('odpis: dorobenie „Odoslať ako dorobenie"', {
		modul: job.modul,
		zak: job.zak,
		op: job.op,
		poradie,
		ledgerPrekonany
	});
	return id;
}
