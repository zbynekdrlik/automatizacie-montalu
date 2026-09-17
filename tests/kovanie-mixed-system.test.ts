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
import { kovanieDoOdpisu, farbaPreSpec } from '../src/lib/server/kovanie';
import { platneFarbyPre } from '../src/lib/server/komponenty-cfg';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import type { Farba } from '../src/lib/komponenty';
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

	it('(a) fallback MUSÍ hlásiť varovanie — do odpisu ide iná farba než operátor zvolil (#537 review 🟡)', () => {
		// Deluxe 10mm posuv spadol z R9005 na predvolenú R9006 → náhľad to musí ukázať
		// (Money-kritické: do skladového pohybu ide farba, ktorú operátor NEZVOLIL).
		const r = kov([spec('Deluxe|2K', 10), spec('Robust|2K', 6)], 'R9005');
		expect(r.err).toBeNull();
		expect(r.warn).not.toBeNull();
		expect(r.warn).toContain('R9005');
		expect(r.warn).toContain('R9006');
		expect(r.warn).toContain('Deluxe');
	});

	it('single-systém Deluxe 6mm + 10mm pod jednou R9005 → 6mm R9005, 10mm predvolená R9006 + varovanie', () => {
		// Zámerné per-hrúbku správanie (r2): R9005 je platná pre Deluxe 6mm, nie 10mm →
		// jedna objednávka vyprodukuje krytky v DVOCH farbách; 10mm fallback sa hlási.
		const r = kov([spec('Deluxe|3K', 6), spec('Deluxe|3K', 10)], 'R9005');
		expect(r.err).toBeNull();
		expect(kody(r)).toContain('ZASK202520'); // 6mm stredová L R9005 (zvolená)
		expect(kody(r)).toContain('ZASK202525'); // 10mm stredová L R9006 (fallback)
		expect(kody(r)).not.toContain('ZASK202526'); // 10mm R7016 absent
		expect(r.warn).toContain('R9006'); // fallback zviditeľnený
	});

	it('platná farba pre všetky posuvy → žiadne fallback varovanie', () => {
		const r = kov([spec('Robust|2K', 6), spec('Deluxe|2K', 10)], 'R7016');
		expect(r.err).toBeNull();
		expect(r.warn).toBeNull();
	});
});

describe('platneFarbyPre — JEDEN zdroj pravdy validity farby (#537)', () => {
	it('Robust je hrúbko-neutrálny: R9005/R7016 na každej hrúbke', () => {
		expect(platneFarbyPre('Robust', 6).sort()).toEqual(['R7016', 'R9005']);
		expect(platneFarbyPre('Robust', undefined).sort()).toEqual(['R7016', 'R9005']);
	});
	it('Štandard: R9005/R7016 (zámok)', () => {
		expect(platneFarbyPre('Štandard', 10).sort()).toEqual(['R7016', 'R9005']);
	});
	it('Slide: len R7016 (R9005 zámok má 0 ks, vynechaný #357)', () => {
		expect(platneFarbyPre('Slide', 10)).toEqual(['R7016']);
	});
	it('Deluxe závisí od hrúbky: 6mm R9006/R9005, 10mm R9006/R7016', () => {
		expect(platneFarbyPre('Deluxe', 6).sort()).toEqual(['R9005', 'R9006']);
		expect(platneFarbyPre('Deluxe', 10).sort()).toEqual(['R7016', 'R9006']);
	});
	it('Deluxe bez hrúbky → prázdne (krytky sú hrúbko-viazané) = farbo-neutrálny fallback', () => {
		expect(platneFarbyPre('Deluxe', undefined)).toEqual([]);
	});
	it('neznámy systém → prázdne pole', () => {
		expect(platneFarbyPre('Neznamy', 10)).toEqual([]);
	});
});

describe('farbaPreSpec — čisté vetvy rezolúcie (#537)', () => {
	const vObj = (fs: Farba[]) => new Set<Farba>(fs);
	it('farbo-neutrálny (prázdne platné) → prejde surová farba', () => {
		expect(farbaPreSpec('Deluxe', undefined, 'R9005', vObj(['R9005']))).toEqual({ farba: 'R9005' });
	});
	it('zvolená platná pre spec → použije sa', () => {
		expect(farbaPreSpec('Robust', 6, 'R9005', vObj(['R9005']))).toEqual({ farba: 'R9005' });
	});
	it('nezvolená (undefined) → undefined (obrana in-depth, nie tichý default)', () => {
		expect(farbaPreSpec('Deluxe', 10, undefined, vObj(['R9006']))).toEqual({ farba: undefined });
	});
	it('neplatná pre spec ale platná v objednávke + má predvolenú → predvolená + varovanie', () => {
		const r = farbaPreSpec('Deluxe', 10, 'R9005', vObj(['R9005', 'R9006']));
		expect(r.farba).toBe('R9006');
		expect(r.chyba).toBeUndefined();
		expect(r.varovanie).toContain('R9006'); // fallback sa hlási
	});
	it('neplatná pre spec, platná v objednávke, bez predvolenej → chyba menuje systém', () => {
		const r = farbaPreSpec('Robust', 6, 'R9006', vObj(['R9006', 'R9005']));
		expect(r.farba).toBeUndefined();
		expect(r.chyba).toContain('Robust');
	});
	it('neplatná ŽIADNEMU posuvu objednávky → chyba (zlá operátorská voľba)', () => {
		const r = farbaPreSpec('Deluxe', 10, 'R9005', vObj(['R9006', 'R7016']));
		expect(r.chyba).toMatch(/R9005/);
	});
});
