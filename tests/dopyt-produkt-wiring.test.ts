// #384: end-to-end WIRING produktu cez pipeline (nie len pure helpery). Overuje, že `produkt`
// reálne prejde: insert → getDopyt/getDopytForLead round-trip, buildLeadPayload → názov leadu,
// generatePonukaPdf → titul PDF, listDopyty → admin zoznam. Bez tohto by zlá referencia stĺpca/
// propy (wiring regresia) ostala zelená (pure-helper testy ju nezachytia). Izolovaná test DB
// (setup/db-isolation.ts).
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { insertDopyt, getDopyt, getDopytForLead, listDopyty } from '../src/lib/server/dopyt-store';
import { buildLeadPayload } from '../src/lib/server/odoo-lead';
import { generatePonukaPdf } from '../src/lib/server/ponuka-pdf';

const cfg = { system: 'Robust', sirka: 4000, hlbka: 3500 };

describe('produkt wiring — store round-trip', () => {
	it('insertDopyt s produktom → getDopyt/getDopytForLead ho vrátia; bez produktu → NULL', () => {
		const idB = insertDopyt({
			konfiguracia: JSON.stringify(cfg),
			meno: 'Test Bazén',
			email: 'bazen@example.com',
			telefon: '',
			miesto: 'Nitra',
			poznamka: '',
			produkt: 'bazen'
		});
		expect(getDopyt(idB)?.produkt).toBe('bazen');
		expect(getDopytForLead(idB)?.produkt).toBe('bazen');

		const idNull = insertDopyt({
			konfiguracia: JSON.stringify(cfg),
			meno: 'Test Starý',
			email: 'stary@example.com',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		expect(getDopyt(idNull)?.produkt ?? null).toBeNull();
	});

	it('listDopyty (admin) nesie produkt stĺpec', () => {
		const rows = listDopyty(0, 50);
		const bazen = rows.find((r) => r.email === 'bazen@example.com');
		expect(bazen?.produkt).toBe('bazen');
	});
});

describe('produkt wiring — Odoo lead názov je produkt-aware', () => {
	it('bazén dopyt → lead name s prefixom Bazénové zastrešenie; NULL dopyt → prefix Pergola', () => {
		const idB = insertDopyt({
			konfiguracia: JSON.stringify(cfg),
			meno: 'Ján Bazén',
			email: 'lead-bazen@example.com',
			telefon: '',
			miesto: 'Košice',
			poznamka: '',
			produkt: 'bazen'
		});
		const payloadB = buildLeadPayload(getDopytForLead(idB)!);
		expect(payloadB.name).toBe('Bazénové zastrešenie – dopyt: Ján Bazén (Košice)');

		const idP = insertDopyt({
			konfiguracia: JSON.stringify(cfg),
			meno: 'Ján Pergola',
			email: 'lead-pergola@example.com',
			telefon: '',
			miesto: '',
			poznamka: ''
		});
		const payloadP = buildLeadPayload(getDopytForLead(idP)!);
		expect(payloadP.name).toBe('Pergola – dopyt: Ján Pergola');
	});
});

describe('produkt wiring — PDF titul je produkt-aware', () => {
	it('generatePonukaPdf({produkt:"bazen"}) → Title „Špecifikácia bazénového zastrešenia — Montalu"', async () => {
		const bytes = await generatePonukaPdf(cfg, { produkt: 'bazen' });
		const doc = await PDFDocument.load(bytes);
		expect(doc.getTitle()).toBe('Špecifikácia bazénového zastrešenia — Montalu');
	});

	it('generatePonukaPdf bez produktu → Title „Špecifikácia pergoly — Montalu" (spätná kompatibilita)', async () => {
		const bytes = await generatePonukaPdf(cfg, {});
		const doc = await PDFDocument.load(bytes);
		expect(doc.getTitle()).toBe('Špecifikácia pergoly — Montalu');
	});
});
