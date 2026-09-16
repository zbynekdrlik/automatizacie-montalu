// #528: QR zákazky do hlavičky tlačených výstupov appky (nárezový plán zasklení, plán rezov PDF,
// pergola nárez/výkres, expedičný zoznam PDF, interný výtlačok podkladu objednávky skla).
//
// KONTRAKT PAYLOADU (PHASE 1, zistené z `zbynekdrlik/odoo-erp` `company_montalu_install_config`):
// Odoo A6 „štítok zákazky" kóduje QR cez `sale_order.py::_montalu_order_label_qr_src` s HOLÝM
// `sale.order.name` (napr. `OP260397` / `OPDL260222`), NIE URL/token. Kiosk matcher
// (`controllers/workstation_kiosk_base.py::_order_by_scan`) robí `strip().casefold()` + substring
// proti `sale.order.name`. Appka už má invariant `sale.order.name === normOp(op)`
// (`src/lib/server/odoo-zakazka.ts:17,235`, používaný pri XML-RPC hľadaní `sale.order`). Preto
// payload QR appky = `normOp(op)` → IDENTICKÝ reťazec ako Odoo štítok, kiosk ho po naskenovaní
// kamerou tabletu otvorí.
//
// Client+server SAFE modul (bez `$lib/server` importu) — print komponenty renderujú QR na klientovi.
// Knižnica: `qrcode-generator` (MIT, 0 tranzitívnych závislostí, čistý JS, žiaden runtime network) —
// konzistentné s repo etosom self-contained generátorov (fonty vendorované base64 v `pdf-common.ts`).
import qrcode from 'qrcode-generator';

/** `data-testid` QR elementu v HTML print views — stabilný kontrakt pre E2E. */
export const QR_ZAKAZKA_TESTID = 'qr-zakazka';

// Error-correction úroveň. 'M' udrží 8–10-znakový OP/OPDL na QR verzii 1 (21 modulov) → pri ~25 mm
// tlači ≈ 1,2 mm bunky, čitateľné lacnou kamerou tabletu. Dekódovaný payload je nezávislý od EC
// úrovne aj módu, takže kiosk (substring `sale.order.name`) zosníma rovnako pri ktorejkoľvek úrovni.
const EC_LEVEL = 'M' as const;

/**
 * Normalizuje `op` na formát `sale.order.name` (Odoo štítok / kiosk): `trim`, `toUpperCase`,
 * zbaliť whitespace + kanonizovať `OP` prefix (`260286` → `OP260286`, `OPOP…` → `OP…`); `OPDL…`
 * a iné prefixy ostávajú nedotknuté; prázdny vstup → prázdny reťazec (žiaden QR sa nekreslí).
 *
 * CLIENT-SAFE DVOJNÍK `normOp` (`src/lib/server/money.ts`) — ten je server-only (`$lib/server/**`),
 * SvelteKit ho do print komponentov nepustí. Drift stráži cross-check unit test
 * `qrZakazkaPayload(x) === normOp(x)` (`tests/qr-zakazka.test.ts`); ak sa niekedy rozídu, ten test
 * zlyhá a obe treba zladiť.
 */
export function qrZakazkaPayload(op: string | null | undefined): string {
	let s = String(op ?? '')
		.trim()
		.toUpperCase()
		.replace(/\s+/g, '');
	if (!s) return '';
	s = s.replace(/^(OP)+(?=\d)/, 'OP'); // OPOP260233 → OP260233 ; OP260286 → OP260286
	if (/^\d/.test(s)) s = 'OP' + s; // 260286 → OP260286
	return s;
}

/** Modulová matica QR (pre kreslenie obdĺžnikmi do pdf-lib) — `null` pri prázdnom payloade. */
export interface QrMatrix {
	count: number;
	isDark(row: number, col: number): boolean;
}

/** Zostaví deterministickú QR maticu pre `payload`; `null` keď je payload prázdny. */
export function buildQrMatrix(payload: string): QrMatrix | null {
	if (!payload) return null;
	const qr = qrcode(0, EC_LEVEL); // typeNumber 0 = auto-vybraná najmenšia vyhovujúca verzia
	qr.addData(payload);
	qr.make();
	const count = qr.getModuleCount();
	return { count, isDark: (r, c) => qr.isDark(r, c) };
}

/**
 * QR ako self-contained SVG reťazec (biele pozadie + 4-modulová quiet zóna, scalable viewBox) —
 * prázdny reťazec pri prázdnom payloade. Deterministický pre daný payload.
 */
export function renderQrSvg(payload: string): string {
	if (!payload) return '';
	const qr = qrcode(0, EC_LEVEL);
	qr.addData(payload);
	qr.make();
	return qr.createSvgTag({ scalable: true, margin: 4 });
}
