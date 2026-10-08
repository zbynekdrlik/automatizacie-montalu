// #604 poistka: systém sa už nikdy NESMIE ticho ocitnúť „bez kovania". Pred #604
// `komponentyPre` porovnával presný reťazec `'Štandard'`, takže `Štandard +` (ten istý
// RS STANDARD) padol do `null` a jeho odpis išiel do Money bez kladiek, zámkov a kefy.
// Teraz má každý systém z konfigurácie buď RODINU kovania, alebo je VÝSLOVNE bez kovania
// (s dôvodom) — inak test padne a `kovanieDoOdpisu` vráti hlasnú chybu.
import { describe, it, expect } from 'vitest';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import {
	KOMPONENTY_STANDARD,
	KOVANIE_NEUPLNE,
	SYSTEMY_BEZ_KOVANIA,
	komponentyPre,
	kovanieZaradene,
	rodinaKovania,
	systemyRodiny
} from '../src/lib/server/komponenty-cfg';
import { pocetUzaverov } from '../src/lib/komponenty';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);
const systemySeedu = [...new Set(seed.sys.map((s) => s.sysStyl.split('|')[0]!))];
const spec = (sysStyl: string): PosuvSpec => ({
	sysStyl,
	S: 3000,
	V: 2200,
	redukciaZero: false,
	skloHrubka: 6
});

describe('#604 rodina kovania — každý systém je zaradený', () => {
	it('KAŽDÝ systém z cfg_seed má rodinu kovania ALEBO je výslovne bez kovania', () => {
		expect(systemySeedu.length).toBeGreaterThanOrEqual(6);
		for (const system of systemySeedu)
			expect({ system, zaradene: kovanieZaradene(system) }).toEqual({ system, zaradene: true });
	});

	it('žiadny systém nie je naraz v rodine AJ výslovne bez kovania (jednoznačné zaradenie)', () => {
		for (const system of Object.keys(SYSTEMY_BEZ_KOVANIA))
			expect({ system, rodina: rodinaKovania(system) }).toEqual({ system, rodina: undefined });
	});

	it('systém bez kovania má zdôvodnenie a v seede naozaj existuje (žiadny mŕtvy záznam)', () => {
		for (const [system, dovod] of Object.entries(SYSTEMY_BEZ_KOVANIA)) {
			expect(systemySeedu).toContain(system);
			expect(dovod.length).toBeGreaterThan(20);
		}
	});

	it('každý systém z cfg_seed s rodinou má tabuľku komponentov (žiadne tiché null)', () => {
		for (const system of systemySeedu.filter((s) => rodinaKovania(s) !== undefined))
			expect({ system, ma: komponentyPre(system) !== null }).toEqual({ system, ma: true });
	});

	it('rodina Štandard = starý Štandard + Štandard + (oba RS STANDARD), Drevo výslovne bez', () => {
		expect(systemyRodiny('Štandard').sort()).toEqual(['Štandard', 'Štandard +']);
		for (const s of systemyRodiny('Štandard')) expect(komponentyPre(s)).toBe(KOMPONENTY_STANDARD);
		expect(rodinaKovania('Štandard Drevo')).toBeUndefined();
		expect(Object.keys(SYSTEMY_BEZ_KOVANIA)).toEqual(['Štandard Drevo']);
		expect(komponentyPre('Štandard Drevo')).toBeNull();
	});

	it('neznámy systém (aj kľúč z Object.prototype) NIE JE zaradený', () => {
		for (const system of ['Štandard X', 'toString', 'constructor', '', 'štandard +']) {
			expect(rodinaKovania(system)).toBeUndefined();
			expect(kovanieZaradene(system)).toBe(false);
			expect(komponentyPre(system)).toBeNull();
		}
	});

	it('honest-null hláška ZASK202541 je kľúčovaná RODINOU (platí aj pre Štandard +)', () => {
		expect(KOVANIE_NEUPLNE.Štandard).toMatch(/ZASK202541/);
		const r = kovanieDoOdpisu(cfg, [spec('Štandard +|4K')], false, 'R7016');
		expect(r.err).toBeNull();
		expect(r.warn).toBe(KOVANIE_NEUPLNE.Štandard);
	});

	it('počet zámkov je nakonfigurovaný pre KAŽDÝ štýl rodiny Štandard z cfg (obe farby zdieľajú)', () => {
		const zamok = KOMPONENTY_STANDARD.find((k) => k.kod === 'ZASK202531')!;
		const styly = Object.keys(cfg).filter((s) =>
			systemyRodiny('Štandard').includes(s.split('|')[0]!)
		);
		expect(styly.length).toBe(28); // 12 Štandard + 16 Štandard +
		for (const sysStyl of styly) {
			const opona = sysStyl.split('|')[1]!.startsWith('2x');
			expect({ sysStyl, ks: pocetUzaverov(zamok, sysStyl) }).toEqual({
				sysStyl,
				ks: opona ? 3 : 2
			});
		}
	});
});

describe('#604 kovanieDoOdpisu — nezaradený systém je HLASNÁ chyba, nie tichý odpis bez kovania', () => {
	// ručne postavené cfg s cudzím systémom (rovnaké riadky ako Štandard + 2K) — systém,
	// ktorý by v budúcnosti pribudol bez zaradenia do RODINA_KOVANIA/SYSTEMY_BEZ_KOVANIA
	const cudziCfg = buildCFG(
		seed.sys
			.filter((s) => s.sysStyl === 'Štandard +|2K')
			.map((s) => ({ ...s, sysStyl: 'Štandard X|2K' })) as never,
		seed.rez
			.filter((r) => r.sysStyl === 'Štandard +|2K')
			.map((r) => ({ ...r, sysStyl: 'Štandard X|2K' })) as never
	);

	it('nezaradený systém → err s názvom systému a číslom posuvu, žiadne položky', () => {
		const r = kovanieDoOdpisu(cudziCfg, [spec('Štandard X|2K')], false, 'R9005');
		expect(r.polozky).toEqual([]);
		expect(r.warn).toBeNull();
		expect(r.err).toMatch(/^Kovanie, posuv 1: systém „Štandard X" nemá v appke určené kovanie/);
	});

	it('nezaradený systém ako 2. posuv zimnej záhrady zastaví CELÝ odpis (aj kovanie 1. posuvu)', () => {
		const zmes = { ...cfg, ...cudziCfg };
		const r = kovanieDoOdpisu(
			zmes as typeof cfg,
			[spec('Robust|2K'), spec('Štandard X|2K')],
			false,
			'R9005'
		);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/posuv 2: systém „Štandard X"/);
	});

	it('Štandard Drevo (výslovne bez kovania) prejde BEZ chyby a bez položiek kovania', () => {
		expect(kovanieDoOdpisu(cfg, [spec('Štandard Drevo|4K')], false, 'R9005')).toEqual({
			polozky: [],
			err: null,
			warn: null
		});
	});

	it('Štandard Drevo + Štandard + v jednej zákazke: kovanie len za Štandard +', () => {
		const r = kovanieDoOdpisu(
			cfg,
			[spec('Štandard Drevo|4K'), spec('Štandard +|2K')],
			false,
			'R9005'
		);
		expect(r.err).toBeNull();
		expect(r.polozky.find((p) => p.kod === 'ZASK00002')?.qty).toBe(4);
		expect(r.polozky.find((p) => p.kod === 'ZASK202531')?.qty).toBe(2);
	});
});
