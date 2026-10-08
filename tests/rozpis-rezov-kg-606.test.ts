// #606 — `RozpisRezov` (nárezový plán na obrazovke aj v tlači) ukazuje odpad aj v kg:
//   hlavička profilu: „odpad 1204 mm (8 %) · 1,55 kg" (alebo „· kg/m chýba"),
//   riadok súčtu:     „Odpad spolu (naprieč 3 profilmi): 9820 mm (26,2 %) · X kg z Y kg (Z % hmotnosti)"
//                     + „neúplné — kg/m chýba: KÓD", keď niektorému profilu kg/m chýba.
// Žiadny profil s kg/m (dnešný PROD 403, CI bez Odoo) → výstup BEZ akéhokoľvek kg textu (ako dnes).
// SSR render komponentu (vzor `tests/sklad-varovania-zdroj-599.test.ts`); E2E kryje CI vetvu bez Odoo.
// Literály att 40349; kg/m = FIXTÚRA (1,288 z návrhu odoo-erp 9076, ostatné vymyslené).
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import RozpisRezov from '../src/lib/components/RozpisRezov.svelte';
import type { MaterialRow } from '../src/lib/server/compute';

function mk(o: Partial<MaterialRow>): MaterialRow {
	return {
		kod: '',
		nazov: '',
		rezy: [{ rozmer: 2500, ks: 1 }],
		tyce: 1,
		bary: [],
		odpadMm: 0,
		odpadPct: 0,
		barLen: 7500,
		sikmyRez: false,
		...o
	};
}

const PLAN = [
	mk({ kod: 'ZASP00002', nazov: 'Rámový profil', tyce: 2, odpadMm: 1204, odpadPct: 8 }),
	mk({ kod: 'ZASP00010', nazov: 'Nosový profil', tyce: 1, odpadMm: 3632, odpadPct: 48.4 }),
	mk({ kod: 'ZASP00014', nazov: 'Koľajnica', tyce: 2, odpadMm: 4984, odpadPct: 33.2 })
];
const KG: Record<string, number | null> = { ZASP00002: 1.288, ZASP00010: 0.9, ZASP00014: 0.75 };
const sKg = (kg: Record<string, number | null>) => PLAN.map((m) => ({ ...m, kgNaM: kg[m.kod] }));

/** HTML → čistý text (bez tagov a komentárov, zlúčené medzery) — tak, ako ho číta človek. */
function text(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}
const html = (material: MaterialRow[]) => render(RozpisRezov, { props: { material } }).body;
/** text prvku s daným data-testid (prvý výskyt, alebo pre konkrétny kód) */
function prvok(h: string, testid: string, kod?: string): string {
	const re = new RegExp(
		`<(\\w+)[^>]*data-testid="${testid}"${kod ? `[^>]*data-kod="${kod}"` : ''}[^>]*>([\\s\\S]*?)</\\1>`
	);
	return text(h.match(re)?.[2] ?? '');
}

describe('RozpisRezov — odpad v kg (#606)', () => {
	it('kg/m pri všetkých profiloch → kg pri profile + súčet „X kg z Y kg (Z % hmotnosti)"', () => {
		const h = html(sKg(KG));
		expect(text(h)).toContain('odpad 1204 mm (8 %) · 1,55 kg · rez rovný');
		expect(prvok(h, 'odpad-kg', 'ZASP00002')).toBe('· 1,55 kg');
		expect(prvok(h, 'odpad-kg', 'ZASP00010')).toBe('· 3,27 kg');
		expect(prvok(h, 'odpad-kg', 'ZASP00014')).toBe('· 3,74 kg');
		expect(text(h.match(/data-testid="odpad-spolu"[^>]*>([\s\S]*?)<\/div>/)![1]!)).toBe(
			'Odpad spolu (naprieč 3 profilmi): 9820 mm (26,2 %) · 8,56 kg z 37,32 kg (22,93 % hmotnosti)'
		);
		expect(h).not.toContain('odpad-kg-neuplne');
	});

	it('kg/m chýba pri jednom profile → „kg/m chýba" pri ňom, súčet NEÚPLNÝ s kódom (nikdy 0 kg)', () => {
		const h = html(sKg({ ...KG, ZASP00010: null }));
		expect(prvok(h, 'odpad-kg', 'ZASP00010')).toBe('· kg/m chýba');
		expect(prvok(h, 'odpad-kg-neuplne')).toBe('· neúplné — kg/m chýba: ZASP00010');
		expect(prvok(h, 'odpad-spolu-kg')).toBe('· 5,29 kg z 30,57 kg (17,3 % hmotnosti)');
		expect(text(h)).not.toMatch(/\b0 kg/);
	});

	it('ŽIADNY profil nemá kg/m (403 / CI bez Odoo) → výstup bez akéhokoľvek kg textu, ako pred #606', () => {
		const bezKg = html(PLAN);
		expect(text(bezKg)).not.toContain('kg');
		expect(bezKg).not.toContain('odpad-kg');
		expect(text(bezKg)).toContain('Odpad spolu (naprieč 3 profilmi): 9820 mm (26,2 %)');
		// hlavička profilu presne ako pred #606 (oddeľovač pred „rez" sa pri `{#if}` nestratí)
		expect(text(bezKg)).toContain('odpad 1204 mm (8 %) · rez rovný');
		// Odoo odpovedalo, ale karty kg/m nemajú → rovnako (žiadny „kg/m chýba" šum)
		const nuly = html(sKg({ ZASP00002: null, ZASP00010: null, ZASP00014: null }));
		expect(text(nuly)).toBe(text(bezKg));
	});

	it('jeden profil s kg/m → kg v hlavičke, súčtový riadok sa (ako dnes) nekreslí', () => {
		const h = html([{ ...PLAN[0]!, kgNaM: 1.288 }]);
		expect(prvok(h, 'odpad-kg', 'ZASP00002')).toBe('· 1,55 kg');
		expect(h).not.toContain('odpad-spolu');
	});
});
