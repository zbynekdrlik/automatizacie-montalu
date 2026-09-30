// #599 (ROZHODNUTÉ main 30.9., Odoo úloha 1218 — Patrik: „Štandardy — 4, 6, 16 mm"): lokálny
// záložný zoznam skiel `POVOLENE_SKLA` (ponuka pri NEDOSTUPNOM Odoo + validácia + „Použiť znova")
// sa zosúladí so živou Odoo konfiguráciou hrúbok — Štandard + aj starý Štandard BEZ 24 mm
// (izolačné 4/16/4). Staré odpisy so 4/16/4 sa NEZAHADZUJÚ: sklo je „pôvodné" (`povodne`) — ponuka
// ho nemá, server ho PRIJME a „Použiť znova" ho ukáže ako „<sklo> · pôvodné sklo z appky" (vzor
// #594). Výpočtové sklo Odoo typov sa odvodzuje z PRIJATÝCH skiel (ponúkané ∪ pôvodné) — výroba si
// 24 mm vie v editore hrúbok znova zapnúť bez releasu. Výpočtový katalóg, Money a compute vektory
// sa nemenia.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sklo-povolene-599-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');

const { db, glassTypesForSystem, listGlassTypes } = await import('../src/lib/server/db');
const { parseVstup, parseMultiVstup } = await import('../src/lib/server/vstup');
const { znovaZOdpisu } = await import('../src/lib/server/znova');
const { ponukaSkielPre } = await import('../src/lib/server/sklo-odoo');
const { pridajSkloHrubku, odoberSkloHrubku, skloHrubkyPre } =
	await import('../src/lib/server/sklo-hrubky');
const {
	POVOLENE_SKLA,
	ponukaSkielSystemu,
	prijateSklaSystemu,
	predvoleneSklo,
	skloPovolene,
	vypocetneSkloPre
} = await import('../src/lib/sklo-povolene');
const { ponukaPreStyl, volbaSkla, POVODNE_SKLO_APPKY } = await import('../src/lib/sklo-odoo');
const { SKLO_INE } = await import('../src/lib/sklo');

const STANDARDY = ['Štandard +', 'Štandard'] as const;
const SKLA_24 = [
	'Izolačné sklo 4/16/4 číre',
	'Izolačné sklo 4/16/4 mliečne',
	'Izolačné sklo 4/16/4 stopsol'
];
const CIRE_24 = SKLA_24[0]!;

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const vstupSP = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	system: 'Štandard +',
	styl: '3K',
	s: '4645',
	v: '2320',
	otvaranie: 'P - L'
};

describe('#599 lokálna ponuka Štandardov bez 24 mm', () => {
	it.each(STANDARDY)('%s: ponuka (záloha bez Odoo) nemá žiadne 4/16/4', (sys) => {
		const p = ponukaSkielSystemu(sys, listGlassTypes());
		expect(p.filter((g) => SKLA_24.includes(g))).toEqual([]);
		expect(p).toContain('Float sklo 6 mm');
		expect(p).toContain('Izolačné sklo 4/8/4 číre');
	});

	it('starý Štandard stratí LEN 24 mm — 10 mm aj 3.3.2 ostávajú (rozhodnutie hovorí len o 24 mm)', () => {
		const p = ponukaSkielSystemu('Štandard', listGlassTypes());
		const katalog = glassTypesForSystem('Štandard').map((g) => g.nazov);
		expect(p).toEqual(katalog.filter((g) => !SKLA_24.includes(g)));
		expect(p).toContain('ESG kalené 10 mm');
		expect(p).toContain('3.3.2');
	});

	it.each(STANDARDY)('%s: Iné (vlastná skladba) bez triedy 24', (sys) => {
		expect(skloPovolene(sys, SKLO_INE, 24)).toBe(false);
		expect(skloPovolene(sys, SKLO_INE, 16)).toBe(true);
	});

	it('pôvodné sklá sú riadky katalógu systému a NIE SÚ zároveň v ponuke', () => {
		for (const sys of STANDARDY) {
			const p = POVOLENE_SKLA[sys]!;
			expect([...(p.povodne ?? [])].sort()).toEqual([...SKLA_24].sort());
			const katalog = glassTypesForSystem(sys).map((g) => g.nazov);
			expect(katalog).toEqual(expect.arrayContaining([...(p.povodne ?? [])]));
			for (const g of p.povodne ?? []) expect(p.nazvy).not.toContain(g);
		}
	});

	it('Drevostavby a Robust sa nemenia (4/16/4 ďalej v ponuke)', () => {
		expect(ponukaSkielSystemu('Štandard Drevo', listGlassTypes())).toContain(CIRE_24);
		expect(ponukaSkielSystemu('Robust', listGlassTypes())).toContain(CIRE_24);
	});

	it('Odoo nedostupné → záložná ponuka zo servera Štandardov bez 24 mm', () => {
		for (const sys of STANDARDY) {
			const p = ponukaSkielPre(
				sys,
				ponukaSkielSystemu(sys, listGlassTypes()),
				{ source: 'local', items: [] },
				[]
			);
			const items = p.skupiny.flatMap((g) => g.items.map((i) => i.vypocet));
			expect(items.filter((g) => SKLA_24.includes(g))).toEqual([]);
		}
	});
});

describe('#599 pôvodné 4/16/4 zo starých odpisov sa nezahadzuje', () => {
	it.each(STANDARDY)('%s: server 4/16/4 PRIJME (skloPovolene + parseVstup)', (sys) => {
		for (const g of SKLA_24) expect(skloPovolene(sys, g)).toBe(true);
		expect(parseVstup(fd({ ...vstupSP, system: sys, sklo: CIRE_24 })).error).toBeNull();
	});

	it('viac posuvov so 4/16/4 v Štandard + prejde', () => {
		const posuv = {
			system: 'Štandard +',
			styl: '3K',
			s: 3000,
			v: 2400,
			sklo: CIRE_24,
			otvaranie: 'P - L'
		};
		expect(
			parseMultiVstup(fd({ zak: 'Z', op: 'O', zakaznik: 'X', posuvy: JSON.stringify([posuv]) }))
				.error
		).toBeNull();
	});

	it('prijateSklaSystemu = ponúkané ∪ pôvodné (poradie katalógu); predvolené nikdy pôvodné', () => {
		for (const sys of STANDARDY) {
			const prijate = prijateSklaSystemu(sys, listGlassTypes());
			for (const g of SKLA_24) expect(prijate).toContain(g);
			for (const g of ponukaSkielSystemu(sys, listGlassTypes())) expect(prijate).toContain(g);
			expect(SKLA_24).not.toContain(predvoleneSklo(prijate, sys));
			// aj keby v zozname nebolo nič iné — pôvodné sklo sa nikdy neprednastaví
			expect(predvoleneSklo([CIRE_24], sys)).not.toBe(CIRE_24);
		}
	});

	it('klient: záložná ponuka + pôvodné 4/16/4 → doplnková voľba „· pôvodné sklo z appky", zvolená', () => {
		const lokalne = ponukaSkielSystemu('Štandard +', listGlassTypes());
		const server = ponukaSkielPre('Štandard +', lokalne, { source: 'local', items: [] }, []);
		const prijate = prijateSklaSystemu('Štandard +', listGlassTypes());
		const sk = ponukaPreStyl(server, prijate, CIRE_24);
		const doplnok = sk.flatMap((g) => g.items).filter((i) => i.vypocet === CIRE_24);
		expect(doplnok).toHaveLength(1);
		expect(doplnok[0]!.label).toBe(`${CIRE_24} · ${POVODNE_SKLO_APPKY}`);
		expect(volbaSkla(CIRE_24, '', sk)).toBe(CIRE_24);
		// bez pôvodného skla vo formulári sa 4/16/4 neponúka
		const bez = ponukaPreStyl(server, prijate, 'Float sklo 6 mm').flatMap((g) => g.items);
		expect(bez.filter((i) => SKLA_24.includes(i.vypocet))).toEqual([]);
	});

	it('„Použiť znova" odpisu Štandard + so 4/16/4 sklo NEZAHODÍ (žiadne chybajuce)', () => {
		const id = Number(
			db
				.prepare(
					`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
					 VALUES ('zasklenia', 'ZAK-599-24', '01', 'Z', 0, 0, '/tmp', 'x.xlsx', 'h', ?, 'test')`
				)
				.run(
					JSON.stringify({
						system: 'Štandard +',
						styl: '3K',
						s: 3000,
						v: 2400,
						sklo: CIRE_24,
						skloZaklad: CIRE_24,
						otvaranie: 'P - L'
					})
				).lastInsertRowid
		);
		const r = znovaZOdpisu(id)!;
		expect(r.vstup!.sklo).toBe(CIRE_24);
		expect(r.chybajuce).toEqual([]);
	});
});

describe('#599 výpočtové sklo Odoo typov z PRIJATÝCH skiel (editor hrúbok ostáva voľný)', () => {
	it('24 mm izolačné pri Štandardoch sa stále odvodí na 4/16/4 číre', () => {
		for (const sys of STANDARDY)
			expect(vypocetneSkloPre(24, 'izolacne', prijateSklaSystemu(sys, listGlassTypes()))).toBe(
				CIRE_24
			);
	});

	it('editor hrúbok: 24 mm pre Štandard + sa dá znova povoliť (počíta sa ako 4/16/4 číre)', () => {
		const r = pridajSkloHrubku({
			system: 'Štandard +',
			mm: 24,
			druh: 'izolacne',
			username: 'vyroba'
		});
		expect(r.error).toBeNull();
		expect(r.zmena?.nova).toBe(`áno — počíta sa ako ${CIRE_24}`);
		const id = skloHrubkyPre('Štandard +').find((h) => h.mm === 24)!.id;
		expect(odoberSkloHrubku({ id, system: 'Štandard +', username: 'vyroba' }).error).toBeNull();
	});
});
