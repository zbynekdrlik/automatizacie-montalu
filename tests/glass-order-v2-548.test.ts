// #548: kontrakt glass_order v2 — description, mode, glass_type_manual + price_m2_manual,
// prílohy per riadok, mimetype mapa, strop veľkosti príloh. Money-NEUTRÁLNE (čistý payload shaping).
import { describe, it, expect } from 'vitest';
import {
	buildGlassOrderItem,
	buildGlassOrder,
	mimetypeZNazvu,
	GLASS_ORDER_ATTACH_MAX_BYTES,
	type GlassOrderItemInput,
	type GlassAttachment
} from '../src/lib/server/odoo-rozpis-lines';

function pane(over: Partial<GlassOrderItemInput> = {}): GlassOrderItemInput {
	return {
		sirkaMm: 1200,
		vyskaMm: 800,
		vLavoMm: null,
		vPravoMm: null,
		sikmy: false,
		pocet: 2,
		typSkla: '4.4.2 číre',
		popis: '',
		...over
	};
}

function att(name: string, bytes: number): GlassAttachment {
	return { name, mimetype: mimetypeZNazvu(name), data_base64: 'A'.repeat(bytes) };
}

describe('#548 mimetypeZNazvu — mapa prípona → mimetype', () => {
	it('mapuje známe prípony', () => {
		expect(mimetypeZNazvu('vykres.pdf')).toBe('application/pdf');
		expect(mimetypeZNazvu('a.dxf')).toBe('application/dxf');
		expect(mimetypeZNazvu('a.dwg')).toBe('application/acad');
		expect(mimetypeZNazvu('a.step')).toBe('model/step');
		expect(mimetypeZNazvu('a.stp')).toBe('model/step');
		expect(mimetypeZNazvu('a.igs')).toBe('model/iges');
		expect(mimetypeZNazvu('a.iges')).toBe('model/iges');
		expect(mimetypeZNazvu('objednavka.xlsx')).toBe(
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		);
	});
	it('case-insensitive prípona', () => {
		expect(mimetypeZNazvu('VYKRES.PDF')).toBe('application/pdf');
		expect(mimetypeZNazvu('a.DXF')).toBe('application/dxf');
	});
	it('neznáma / bez prípony → octet-stream', () => {
		expect(mimetypeZNazvu('a.zip')).toBe('application/octet-stream');
		expect(mimetypeZNazvu('bezpripony')).toBe('application/octet-stream');
		expect(mimetypeZNazvu('')).toBe('application/octet-stream');
	});
});

describe('#548 buildGlassOrderItem — v2 kľúče', () => {
	it('description = popis (keď je), mode = režim (vždy)', () => {
		const it0 = buildGlassOrderItem(pane({ popis: 'ATYP podľa výkresu', mode: 'atyp' }));
		expect(it0.description).toBe('ATYP podľa výkresu');
		expect(it0.mode).toBe('atyp');
	});
	it('mode default rozmery keď chýba', () => {
		expect(buildGlassOrderItem(pane()).mode).toBe('rozmery');
	});

	it('katalógový riadok → glass_type, žiadne manuálne kľúče', () => {
		const it0 = buildGlassOrderItem(pane({ typSkla: '4.4.2 číre' }));
		expect(it0.glass_type).toBe('4.4.2 číre');
		expect(it0).not.toHaveProperty('glass_type_manual');
		expect(it0).not.toHaveProperty('price_m2_manual');
	});

	it('„iné sklo" (typSklaManual + cena>0) → glass_type_manual + price_m2_manual, glass_type VYNECHANÝ', () => {
		const it0 = buildGlassOrderItem(
			pane({ typSkla: '', typSklaManual: 'lepené 33.1 bronz', cenaM2Manual: 42.5 })
		);
		expect(it0).not.toHaveProperty('glass_type');
		expect(it0.glass_type_manual).toBe('lepené 33.1 bronz');
		expect(it0.price_m2_manual).toBe(42.5);
		// katalógová derivácia sa NEspustí pre manuál (žiadny composition)
		expect(it0).not.toHaveProperty('composition');
	});

	it('typSklaManual bez ceny (0) → NIE manuál (fallback na glass_type)', () => {
		const it0 = buildGlassOrderItem(
			pane({ typSkla: '4.4.2 číre', typSklaManual: 'x', cenaM2Manual: 0 })
		);
		expect(it0.glass_type).toBe('4.4.2 číre');
		expect(it0).not.toHaveProperty('glass_type_manual');
	});

	it('prílohy sa pripoja (kópia, nie referencia)', () => {
		const a = att('v.pdf', 10);
		const it0 = buildGlassOrderItem(pane({ attachments: [a] }));
		expect(it0.attachments).toHaveLength(1);
		expect(it0.attachments![0]!.name).toBe('v.pdf');
		expect(it0.attachments![0]!.mimetype).toBe('application/pdf');
		expect(it0.attachments![0]).not.toBe(a); // kópia
	});

	it('bez príloh → kľúč attachments vynechaný', () => {
		expect(buildGlassOrderItem(pane())).not.toHaveProperty('attachments');
	});
});

describe('#548 buildGlassOrder — version 2 + strop veľkosti príloh', () => {
	it('order.version === 2', () => {
		expect(buildGlassOrder([pane()]).order.version).toBe(2);
	});

	it('pod stropom → žiadne zahodenie', () => {
		const { order, droppedAttachments } = buildGlassOrder(
			[pane({ attachments: [att('a.pdf', 100)] })],
			{ attachMaxBytes: 1000 }
		);
		expect(droppedAttachments).toEqual([]);
		expect(order.items[0]!.attachments).toHaveLength(1);
	});

	it('nad stropom → zahodí NAJVÄČŠIU prílohu, pripíše poznámku, vráti droppedAttachments', () => {
		const { order, droppedAttachments } = buildGlassOrder(
			[
				pane({ popis: 'A', attachments: [att('small.pdf', 50), att('big.dxf', 400)] }),
				pane({ popis: 'B', attachments: [att('mid.pdf', 200)] })
			],
			{ attachMaxBytes: 500 }
		);
		// total 650 > 500 → zahodí najväčšiu (big.dxf 400) → total 250 <= 500 → stop
		expect(droppedAttachments).toHaveLength(1);
		expect(droppedAttachments[0]!.name).toBe('big.dxf');
		expect(droppedAttachments[0]!.itemIndex).toBe(0);
		// riadok 0 má už len small.pdf + poznámku
		expect(order.items[0]!.attachments!.map((a) => a.name)).toEqual(['small.pdf']);
		expect(order.items[0]!.note).toContain('big.dxf');
		expect(order.items[0]!.note).toContain('vynechaná');
		// riadok 1 nedotknutý
		expect(order.items[1]!.attachments).toHaveLength(1);
	});

	it('strop default = 25 MB base64', () => {
		expect(GLASS_ORDER_ATTACH_MAX_BYTES).toBe(25 * 1024 * 1024);
	});

	it('prázdny vstup → order.version 2, items []', () => {
		expect(buildGlassOrder([]).order).toEqual({ version: 2, items: [] });
	});
});
