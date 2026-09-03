// #443: editor akcia (`/zasklenia/nastavenia` `ulozit`) — `trieda_6`/`trieda_16` zapíšu
// `cfg_sklo_trieda` + audit záznam so 'systémová' sentinelom pri NULL, bounds validácia,
// a redukcia checkbox pre KLASIFIKOVANÉ (trieda != null) sklo sa NEDOTKNE, ani keď form
// nepošle `glass_<id>` (filtrovaný grid, #443 UI) — HTML checkbox nevie odlíšiť
// „nerenderované" od „odškrtnuté", takže akcia musí iterovať LEN trieda-NULL sklá (rovnaký
// form.has() kontrakt ako per-sklo korekcia #440, `access-control §2`: forged POST, nie len
// skryté pole v UI).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-trieda-editor-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'r.db');
const dbMod = await import('../src/lib/server/db');
const { actions, load } = await import('../src/routes/zasklenia/nastavenia/+page.server');

function event(body: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/zasklenia/nastavenia', { method: 'POST', body: fd }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
	} as Parameters<typeof actions.ulozit>[0];
}

function loadEvent(sysStyl: string) {
	return {
		url: new URL(`http://x/zasklenia/nastavenia?sysStyl=${encodeURIComponent(sysStyl)}`)
	} as Parameters<typeof load>[0];
}

const slideSysStyl = () => dbMod.listSysStyly().find((s) => s.system === 'Slide')!.sysStyl;

describe('#443 nastavenia ulozit — korekcia PER TRIEDA', () => {
	it('trieda_6 zapíše cfg_sklo_trieda + audit záznam', async () => {
		const sysStyl = slideSysStyl();
		const skloOffset = dbMod.loadCfg()[sysStyl]!.skloOffset;
		const r = (await actions.ulozit(
			event({ sysStyl, skloOffset: String(skloOffset), trieda_6: '22' })
		)) as { ulozene?: boolean; zmeny?: { pole: string; stara: unknown; nova: unknown }[] };
		expect(r.ulozene).toBe(true);
		expect(dbMod.triedaKorekcia('Slide', 6)).toBe(22);
		expect(r.zmeny?.some((z) => z.pole.includes('trieda 6 mm'))).toBe(true);
	});

	it("prázdne pole trieda_16 po predošlej hodnote zapíše zmenu so 'systémová' sentinelom a zmaže riadok", async () => {
		const sysStyl = slideSysStyl();
		const skloOffset = dbMod.loadCfg()[sysStyl]!.skloOffset;
		await actions.ulozit(event({ sysStyl, skloOffset: String(skloOffset), trieda_16: '18' }));
		expect(dbMod.triedaKorekcia('Slide', 16)).toBe(18);
		const r = (await actions.ulozit(
			event({ sysStyl, skloOffset: String(skloOffset), trieda_16: '' })
		)) as { zmeny?: { pole: string; stara: unknown; nova: unknown }[] };
		expect(dbMod.triedaKorekcia('Slide', 16)).toBeNull();
		const z = r.zmeny?.find((x) => x.pole.includes('trieda 16 mm'));
		expect(z?.nova).toBe('systémová');
	});

	it('korekcia mimo rozsahu 0–500 sa odmietne', async () => {
		const sysStyl = slideSysStyl();
		const skloOffset = dbMod.loadCfg()[sysStyl]!.skloOffset;
		const r = (await actions.ulozit(
			event({ sysStyl, skloOffset: String(skloOffset), trieda_6: '999' })
		)) as { error?: string };
		expect(r.error).toContain('Korekcia');
	});

	it('chýbajúce pole trieda_6 v POST-e NEmení predtým uloženú hodnotu', async () => {
		const sysStyl = slideSysStyl();
		const skloOffset = dbMod.loadCfg()[sysStyl]!.skloOffset;
		await actions.ulozit(event({ sysStyl, skloOffset: String(skloOffset), trieda_6: '5' }));
		expect(dbMod.triedaKorekcia('Slide', 6)).toBe(5);
		await actions.ulozit(event({ sysStyl, skloOffset: String(skloOffset) }));
		expect(dbMod.triedaKorekcia('Slide', 6)).toBe(5);
	});
});

describe('#443 nastavenia ulozit — redukcia checkbox pre klasifikované sklo je mimo formulára', () => {
	it('POST BEZ glass_<id> pre KLASIFIKOVANÉ (trieda != null) sklo NEresetuje jeho redukcia_zero', async () => {
		const sysStyl = slideSysStyl();
		const skloOffset = dbMod.loadCfg()[sysStyl]!.skloOffset;
		const izo = dbMod
			.glassTypesForSystem('Slide')
			.find((g) => g.nazov === 'Izolačné sklo 4/8/4 číre')!;
		expect(izo.hrubkaTrieda).toBe(16);
		expect(izo.redukciaZero).toBe(true);
		// simuluj odoslanie formulára BEZ glass_<izo.id> — UI klasifikované sklo nevykreslí (#443)
		await actions.ulozit(event({ sysStyl, skloOffset: String(skloOffset) }));
		const po = dbMod.glassTypesForSystem('Slide').find((g) => g.id === izo.id)!;
		expect(po.redukciaZero).toBe(true);
	});

	it('trieda-NULL sklo (žiadna klasifikácia) sa checkboxom naďalej dá prepnúť ako predtým (#438)', async () => {
		const sysStyl = dbMod.listSysStyly().find((s) => s.system === 'Robust')!.sysStyl;
		const skloOffset = dbMod.loadCfg()[sysStyl]!.skloOffset;
		const g = dbMod.glassTypesForSystem('Robust').find((x) => x.nazov.includes('4/16/4'))!;
		expect(g.hrubkaTrieda).toBeNull();
		const before = g.redukciaZero;
		await actions.ulozit(
			event({
				sysStyl,
				skloOffset: String(skloOffset),
				[`glass_${g.id}`]: before ? '' : '1'
			})
		);
		const po = dbMod.glassTypesForSystem('Robust').find((x) => x.id === g.id)!;
		expect(po.redukciaZero).toBe(!before);
	});
});

describe('#443 nastavenia load() — maTrieda6/maTrieda16 + trieda*Korekcia', () => {
	it('Slide má klasifikované sklo oboch tried', async () => {
		const data = (await load(loadEvent(slideSysStyl()))) as {
			maTrieda6: boolean;
			maTrieda16: boolean;
		};
		expect(data.maTrieda6).toBe(true);
		expect(data.maTrieda16).toBe(true);
	});

	it('Deluxe nemá klasifikované sklo (trieda sa neuplatňuje)', async () => {
		const sysStyl = dbMod.listSysStyly().find((s) => s.system === 'Deluxe')!.sysStyl;
		const data = (await load(loadEvent(sysStyl))) as { maTrieda6: boolean; maTrieda16: boolean };
		expect(data.maTrieda6).toBe(false);
		expect(data.maTrieda16).toBe(false);
	});
});
