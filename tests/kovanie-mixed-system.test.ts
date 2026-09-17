// #537 / gk odoo-erp#6413 — Kovanie: farba PER SPEC pri zmiešaných systémoch.
//
// Design r2 (Prístup 2, ROZHODNUTÉ main 17.9.): farba krytiek/komponentov sa rieši
// PER SPEC. Pre daný posuv:
//   - `farbaKovania` ak je PLATNÁ pre systém posuvu (a hrúbku skla) → použije sa;
//   - inak, ak je platná pre INÝ posuv objednávky (legitímna objednávková farba, len
//     na tento systém nesedí) → `predvolenaFarba(system)`, ak platná; inak HLASNÁ
//     chyba menujúca systém + jeho platné farby;
//   - farba, ktorá nesedí ŽIADNEMU posuvu objednávky → HLASNÁ chyba (operátorská
//     voľba, #354 správanie — nikdy tichý odpis bez farebnej rodiny).
// Mušľa Deluxe (kovanie) ostáva pevne nerezová — netýka sa krytiek (farba = KRYTKY).
import { describe, it, expect } from 'vitest';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);

const spec = (sysStyl: string, skloHrubka: number | undefined): PosuvSpec => ({
	sysStyl,
	S: 3000,
	V: 2200,
	redukciaZero: false,
	skloHrubka
});
const kov = (specs: PosuvSpec[], farba?: 'R9005' | 'R9006' | 'R7016') =>
	kovanieDoOdpisu(cfg, specs, false, farba);
const kody = (r: { polozky: { kod: string }[] }) => r.polozky.map((p) => p.kod);

// Money kódy (komponenty-cfg.ts):
//   Robust kľučka: R9005=ZASK202533, R7016=ZASK202534
//   Štandard zámok: R9005=ZASK202531, R7016=ZASK202532
//   Deluxe stredová L 10mm: R9006=ZASK202525, R7016=ZASK202526

describe('kovanieDoOdpisu — farba PER SPEC pri zmiešaných systémoch (#537)', () => {
	it('(a) Deluxe10 primárny + Robust6 posuv, R9005 → Robust R9005, Deluxe fallback R9006', () => {
		// R9005 je platná pre Robust (aj pre Deluxe 6mm), ale NIE pre Deluxe 10mm →
		// Deluxe 10mm posuv dostane svoju predvolenú R9006, Robust dostane R9005.
		const r = kov([spec('Deluxe|2K', 10), spec('Robust|2K', 6)], 'R9005');
		expect(r.err).toBeNull();
		// Deluxe 10mm stredová L = R9006 (nie R7016) — predvolená farba, žiadny bleed
		expect(kody(r)).toContain('ZASK202525'); // Deluxe stredová L R9006
		expect(kody(r)).not.toContain('ZASK202526'); // Deluxe stredová L R7016
		// Robust kľučka = R9005 (nie R7016) — zvolená farba, per-spec
		expect(kody(r)).toContain('ZASK202533'); // Robust kľučka R9005
		expect(kody(r)).not.toContain('ZASK202534'); // Robust kľučka R7016
	});

	it('(b) Robust6 primárny + Deluxe10 posuv, R7016 → OBA R7016 (platná obom)', () => {
		const r = kov([spec('Robust|2K', 6), spec('Deluxe|2K', 10)], 'R7016');
		expect(r.err).toBeNull();
		expect(kody(r)).toContain('ZASK202534'); // Robust kľučka R7016
		expect(kody(r)).toContain('ZASK202526'); // Deluxe stredová L R7016
		expect(kody(r)).not.toContain('ZASK202525'); // Deluxe R9006 absent
	});

	it('(c) Deluxe10 primárny + Robust6 posuv, R9006 (neplatná Robustu, bez predvolenej) → chyba menuje Robust + platné farby', () => {
		// R9006 je platná pre Deluxe, na Robust nesedí a Robust nemá predvolenú farbu
		// → HLASNÁ chyba, ktorá MENUJE systém (Robust) a jeho platné farby (R9005/R7016).
		const r = kov([spec('Deluxe|2K', 10), spec('Robust|2K', 6)], 'R9006');
		expect(r.err).not.toBeNull();
		expect(r.polozky).toEqual([]);
		expect(r.err).toContain('Robust');
		expect(r.err).toMatch(/R9005/);
		expect(r.err).toMatch(/R7016/);
	});

	it('(e) žiadny bleed medzi posuvmi: Štandard6 + Deluxe10, R9005 → Štandard R9005, Deluxe fallback R9006', () => {
		// Štandard predvolenú farbu nemá (R9005 zvolí operátor); Deluxe 10mm R9005
		// nedokáže → svoja predvolená R9006. Predvolená jedného systému nepretečie
		// na druhý (dôkaz zrušenia specs[0] fallbacku v kovanieFor).
		const r = kov([spec('Štandard|2K', 6), spec('Deluxe|2K', 10)], 'R9005');
		expect(r.err).toBeNull();
		expect(kody(r)).toContain('ZASK202531'); // Štandard zámok R9005
		expect(kody(r)).not.toContain('ZASK202532'); // Štandard zámok R7016
		expect(kody(r)).toContain('ZASK202525'); // Deluxe stredová L R9006 (fallback)
		expect(kody(r)).not.toContain('ZASK202526'); // Deluxe R7016 absent
	});
});
