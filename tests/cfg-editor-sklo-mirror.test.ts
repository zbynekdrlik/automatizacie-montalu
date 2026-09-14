// #504 [round 4]: skrytý mirror rámový→sklo v `saveCfgChanges` prepisoval NEZÁVISLÉ
// sklo offsety pri KAŽDOM uložení štýlu. Pre opona IZO (Money Excel: sklo výška = V−135,
// rámový stredový = V−33) uloženie zmeny LEN Kladkového/Rozširujúceho ticho prepísalo
// sklo výška −135 → −33 (prod korupcia 14.9., cfg_rez 419/409/399/377; E2E opona-izo.spec
// zachytila expected 1965, got 2067). Predpoklad „sklo = rámový tej istej dim" je nepravdivý
// pre 29 z 39 štýlov. Nový kontrakt: zrkadli rámový→sklo LEN keď sa rámový offset SKUTOČNE
// zmenil A sklo ho práve sledovalo (sklo.offset === starý rámový.offset), a zápis auditni.
import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { saveCfgChanges, getEditableRows, getAuditLog } from '../src/lib/server/cfg-editor';

const skloOffset = (sysStyl: string, dim: 'S' | 'V'): number =>
	(
		db
			.prepare(`SELECT offset FROM cfg_rez WHERE sys_styl = ? AND typ = 'sklo' AND dim = ?`)
			.get(sysStyl, dim) as { offset: number }
	).offset;

describe('#504 editor vzorcov: mirror rámový→sklo je podmienený a auditovaný', () => {
	it('uloženie BEZ zmeny rámového NEsmie prepísať nezávislé sklo výška (opona IZO)', () => {
		const sysStyl = 'Štandard +|2x4K IZO';
		const cur = getEditableRows(sysStyl);
		expect(cur, `${sysStyl} musí existovať (seed/migrácia v47)`).toBeTruthy();

		// predpoklad: sklo výška je NEZÁVISLÁ (−135), rámový V je −33 — LÍŠIA sa
		expect(skloOffset(sysStyl, 'V')).toBe(-135);
		const ramV = cur!.rows.find((r) => /rámový/i.test(r.nazov) && r.dim === 'V')!;
		expect(ramV.offset).toBe(-33);

		// formulár posiela VŠETKY offsety; zmeníme LEN Kladkový profil (šírka), rámový V ostáva −33
		const kladk = cur!.rows.find((r) => /kladk/i.test(r.nazov))!;
		const offsets = new Map<number, number>(cur!.rows.map((r) => [r.id, r.offset]));
		offsets.set(kladk.id, kladk.offset - 5); // reálna zmena → save prebehne

		const { error } = saveCfgChanges({
			sysStyl,
			username: 'vyroba',
			offsets,
			skloOffset: cur!.skloOffset
		});
		expect(error).toBeNull();

		// jadro regresie: sklo výška MUSÍ ostať −135 (staré správanie ju prepísalo na rámový V −33)
		expect(skloOffset(sysStyl, 'V'), 'sklo výška opona IZO sa nesmie zrkadliť z rámového').toBe(
			-135
		);
		// sklo šírka nemá rámový S riadok → vždy nedotknutá
		expect(skloOffset(sysStyl, 'S')).toBe(-407);
	});

	it('zmena rámového na štýle kde sklo == rámový zrkadlí sklo A je AUDITOVANÁ', () => {
		const sysStyl = 'Robust|4K';
		const cur = getEditableRows(sysStyl);
		expect(cur, `${sysStyl} musí existovať`).toBeTruthy();

		// predpoklad: sklo == rámový v OBOCH dimenziách (V −70, S 170.28)
		expect(skloOffset(sysStyl, 'V')).toBe(-70);
		const ramV = cur!.rows.find((r) => /rámový/i.test(r.nazov) && r.dim === 'V')!;
		expect(ramV.offset).toBe(-70);
		const skloSpred = skloOffset(sysStyl, 'S');

		// zmeníme LEN rámový V −70 → −72; rámový S ostáva
		const offsets = new Map<number, number>(cur!.rows.map((r) => [r.id, r.offset]));
		offsets.set(ramV.id, -72);

		const { zmeny, error } = saveCfgChanges({
			sysStyl,
			username: 'tester',
			offsets,
			skloOffset: cur!.skloOffset
		});
		expect(error).toBeNull();

		// sklo V sleduje rámový (rovný štýl) → −72; sklo S nedotknuté (rámový S nezmenený)
		expect(skloOffset(sysStyl, 'V')).toBe(-72);
		expect(skloOffset(sysStyl, 'S')).toBe(skloSpred);

		// zrkadlený sklo záznam MUSÍ byť v `zmeny` a v cfg_audit (staré správanie ho neaudito­valo)
		const mirrorZmena = zmeny.find((z) => /sklo/i.test(z.pole) && z.nova === -72);
		expect(mirrorZmena, 'zrkadlený sklo záznam musí byť v zmeny').toBeTruthy();
		const audit = getAuditLog(1)[0]!;
		const auditZmeny = JSON.parse(audit.zmeny) as { pole: string; stara: number; nova: number }[];
		expect(
			auditZmeny.some((z) => /sklo/i.test(z.pole) && z.nova === -72),
			'cfg_audit musí zaznamenať zrkadlenú sklo zmenu'
		).toBeTruthy();
	});
});
