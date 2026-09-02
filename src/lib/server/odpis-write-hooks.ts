// #5825: registrácia + fírovanie observerov po ZÁPISE / UVOĽNENÍ odpisu. Extrahované z `money.ts`
// (large-file-split — pridanie odpis→Odoo hookov pretlačilo money.ts cez 1000-riadkový strop).
// Param-injection / žiaden runtime cyklus: `OdpisJob` je TYPE-ONLY import z money (erased pri builde),
// `fire*`/`set*` sú runtime exporty, ktoré money importuje späť — money → odpis-write-hooks je jediná
// runtime hrana, opačným smerom ide len erased typ.
//
// Observeri (dnes `odoo-odpis.ts` router) sú fire-and-forget a MONEY-NEUTRÁLNI: ich throw NIKDY
// nezhodí už-zapísaný odpis ani nezablokuje uvoľnenie (sync-guard je TU, v `fire*`).
import { logger } from './log';
import type { OdpisJob } from './money';

const log = logger('odpis-hooks');

/** Udalosť po úspešnom zápise odpisu — nesie CELÝ job + content_hash + live + odpis_log id (per-odpis
 *  push do `montalu.material.odpis` potrebuje job/hash; (zak,op) samotné jednu odpis NEidentifikuje). */
export interface OdpisWrittenEvent {
	job: OdpisJob;
	contentHash: string;
	live: boolean;
	odpisLogId: number;
}
export type OdpisWrittenHook = (ev: OdpisWrittenEvent) => void;
let onOdpisWritten: OdpisWrittenHook | null = null;
export function setOdpisWrittenHook(fn: OdpisWrittenHook | null): void {
	onOdpisWritten = fn;
}

/** Udalosť po UVOĽNENÍ odpisu („Uvoľniť"/`povolitReimport`) — fírovaná VNÚTRI delete-transakcie PRED
 *  DELETE, aby durable enqueue release-pushu bol ATOMICKÝ s uvoľnením. Nesie identity na release push. */
export interface OdpisReleasedEvent {
	contentHash: string;
	zak: string;
	op: string;
	modul: string;
	live: boolean;
	actor: string;
}
export type OdpisReleasedHook = (ev: OdpisReleasedEvent) => void;
let onOdpisReleased: OdpisReleasedHook | null = null;
export function setOdpisReleasedHook(fn: OdpisReleasedHook | null): void {
	onOdpisReleased = fn;
}

/** Fíruj po ÚSPEŠNOM + durable zápise. Sync-guard: throw hooku NIKDY nezhodí už-zapísaný odpis. */
export function fireOdpisWritten(ev: OdpisWrittenEvent): void {
	try {
		onOdpisWritten?.(ev);
	} catch (e) {
		log.error('odpis-written hook hodil (ignorované — odpis je zapísaný)', {
			zak: ev.job.zak,
			op: ev.job.op,
			error: e
		});
	}
}

/** Fíruj po uvoľnení (vnútri delete-transakcie). Sync-guard: throw hooku nezablokuje uvoľnenie. */
export function fireOdpisReleased(ev: OdpisReleasedEvent): void {
	try {
		onOdpisReleased?.(ev);
	} catch (e) {
		log.error('odpis-released hook hodil (ignorované — odpis sa uvoľňuje)', {
			modul: ev.modul,
			contentHash: ev.contentHash,
			error: e
		});
	}
}
