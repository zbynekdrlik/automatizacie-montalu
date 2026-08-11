// Pergola návrhový výkres (#138) — parsovanie formulára. Rovnaká disciplína ako
// fix-vstup.test.ts.
import { describe, it, expect } from 'vitest';
import { parsePergolaNavrhVstup } from '../src/lib/server/pergola-navrh-vstup';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};

const zaklad = {
	polia: JSON.stringify([3000, 3000]),
	hlbka: '3500',
	vyskaVpredu: '2500',
	vyskaPriStene: '2800',
	panelPocet: '8',
	op: 'OP260032'
};

describe('parsePergolaNavrhVstup', () => {
	it('platný vzorový vstup prejde bez chyby', () => {
		const { vstup, error } = parsePergolaNavrhVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.polia).toEqual([3000, 3000]);
		expect(vstup.hlbka).toBe(3500);
		expect(vstup.panelPocet).toBe(8);
		expect(vstup.varianta).toBe('NAVRH'); // default keď chýba
	});

	it('desatinná čiarka v poliach prejde', () => {
		const { vstup, error } = parsePergolaNavrhVstup(
			fd({ ...zaklad, polia: JSON.stringify(['3000,5', 2999.5]) })
		);
		expect(error).toBeNull();
		expect(vstup.polia).toEqual([3000.5, 2999.5]);
	});

	it('bez zoznamu polí, ale s "s" = jedno pole cez celú šírku', () => {
		const { vstup } = parsePergolaNavrhVstup(fd({ ...zaklad, polia: '[]', s: '5000' }));
		expect(vstup.polia).toEqual([5000]);
	});

	it('pokazený JSON polí nezhodí parser', () => {
		const { error } = parsePergolaNavrhVstup(fd({ ...zaklad, polia: '{nie json' }));
		expect(error).toMatch(/počet polí/i); // prázdne polia (bez 's' fallbacku) = chyba
	});

	it('override polí strešnej výplne s desatinnou čiarkou', () => {
		const { vstup } = parsePergolaNavrhVstup(
			fd({ ...zaklad, panelSirkaOverride: '700,5', panelDlzkaOverride: '3000' })
		);
		expect(vstup.panelSirkaOverride).toBe(700.5);
		expect(vstup.panelDlzkaOverride).toBe(3000);
	});

	it('prázdny override = undefined (nepoužije sa, dopočíta sa default)', () => {
		const { vstup } = parsePergolaNavrhVstup(fd(zaklad));
		expect(vstup.panelSirkaOverride).toBeUndefined();
		expect(vstup.panelDlzkaOverride).toBeUndefined();
	});

	it('zvody z JSON pola prejdú', () => {
		const { vstup, error } = parsePergolaNavrhVstup(
			fd({
				...zaklad,
				zvody: JSON.stringify([
					{ postIndex: 0, strana: 'predna' },
					{ postIndex: 2, strana: 'zadna' }
				])
			})
		);
		expect(error).toBeNull();
		expect(vstup.zvody).toEqual([
			{ postIndex: 0, strana: 'predna' },
			{ postIndex: 2, strana: 'zadna' }
		]);
	});

	it('neplatná položka zvodu (chybná strana) sa ticho vynechá', () => {
		const { vstup } = parsePergolaNavrhVstup(
			fd({ ...zaklad, zvody: JSON.stringify([{ postIndex: 0, strana: 'bokom' }]) })
		);
		expect(vstup.zvody).toEqual([]);
	});

	it('pokazený JSON zvodov nezhodí parser', () => {
		const { error } = parsePergolaNavrhVstup(fd({ ...zaklad, zvody: '{nie json' }));
		expect(error).toBeNull();
	});

	// #144 — OP je teraz voliteľné (VO odberateľ nemá Montalu OP číslo)
	it('#144: chýbajúce OP číslo NIE JE chyba (voliteľné)', () => {
		const { error, vstup } = parsePergolaNavrhVstup(fd({ ...zaklad, op: '' }));
		expect(error).toBeNull();
		expect(vstup.op).toBe('');
	});

	it('textové polia sú orezané na max dĺžku', () => {
		const { vstup } = parsePergolaNavrhVstup(
			fd({ ...zaklad, textVyplne: 'x'.repeat(200), poznamkaIzometria: 'y'.repeat(100) })
		);
		expect(vstup.textVyplne.length).toBe(120);
		expect(vstup.poznamkaIzometria.length).toBe(60);
	});

	it('príliš veľa polí sa oreže na PERGOLA_MAX_POLI', () => {
		const { vstup } = parsePergolaNavrhVstup(
			fd({ ...zaklad, polia: JSON.stringify(Array(20).fill(1000)) })
		);
		expect(vstup.polia.length).toBe(8);
	});
});
