// #349: pomôcka pre testy, ktoré čítajú XML-RPC request na DRÔTE (mock transport).
// Encoder (`odoo-rpc.ts` encodeValue) XML-escapuje string hodnoty; Odoo ich dekóduje späť.
// `wireStringMember` vráti DEKÓDOVANÚ hodnotu struct člena — t. j. presne ten Python str,
// ktorý Odoo dostane ako kwarg (napr. telo poznámky).
import { xmlUnescape } from '../../src/lib/server/odoo-rpc';

/** Dekódovaná string hodnota struct člena `name` z XML-RPC requestu; `null` keď chýba. */
export function wireStringMember(body: string, name: string): string | null {
	const m = new RegExp(`<name>${name}</name><value><string>([\\s\\S]*?)</string></value>`).exec(
		body
	);
	const raw = m?.[1];
	return raw === undefined ? null : xmlUnescape(raw);
}
