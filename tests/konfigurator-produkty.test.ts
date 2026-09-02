// #384: client-safe katalóg produktových radov + produkt diskriminátor. Overuje invarianty
// výberovej obrazovky (7 radov, pergola live prvá, ostatné pripravujeme), obranné parsovanie
// produktu (default pergola), produkt-aware názvy pre lead/PDF, a že každá webp fotka reálne
// existuje v `static/konfigurator/vyber/` (žiadny mŕtvy obrázok, žiadny hotlink).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	KONF_PRODUKTY,
	produktNazov,
	produktPdfNadpis,
	produktPodlaKodu,
	maCenovyZdroj
} from '../src/lib/konfigurator-produkty';

describe('KONF_PRODUKTY katalóg', () => {
	it('má 7 produktových radov (parita so 6 kategóriami montalu.sk + prístrešky)', () => {
		expect(KONF_PRODUKTY).toHaveLength(7);
	});

	it('pergola je PRVÁ a live; #385 pridal bazén ako live (ostatné „pripravujeme")', () => {
		expect(KONF_PRODUKTY[0]!.kod).toBe('pergola');
		expect(KONF_PRODUKTY[0]!.stav).toBe('live');
		const live = KONF_PRODUKTY.filter((p) => p.stav === 'live');
		expect(live.map((p) => p.kod)).toEqual(['pergola', 'bazen']);
	});

	it('kódy sú unikátne', () => {
		const kody = KONF_PRODUKTY.map((p) => p.kod);
		expect(new Set(kody).size).toBe(kody.length);
	});

	it('live produkt vedie na internú podstránku, „pripravujeme" na externú montalu.sk (externy=true)', () => {
		for (const p of KONF_PRODUKTY) {
			if (p.stav === 'live') {
				expect(p.externy).toBe(false);
				expect(p.odkaz).toMatch(/^\/konfigurator\//);
			} else {
				expect(p.externy).toBe(true);
				expect(p.odkaz).toMatch(/^https:\/\/montalu\.sk\/produkty\//);
			}
		}
	});

	it('každá webp fotka reálne existuje v static/konfigurator/vyber/ (žiadny mŕtvy obrázok)', () => {
		const dir = path.resolve(process.cwd(), 'static/konfigurator/vyber');
		for (const p of KONF_PRODUKTY) {
			expect(p.foto).toMatch(/\.webp$/);
			expect(fs.existsSync(path.join(dir, p.foto)), `chýba fotka ${p.foto}`).toBe(true);
		}
	});

	it('každý LIVE produkt má reálnu route podstránku src/routes/konfigurator/<slug>/+page.svelte', () => {
		// stráži nekontrolovaný `p.odkaz as LiveRoute` cast v KonfVyber — typo v internom odkaze by
		// inak skompiloval a 404-oval na prode. Slug = posledný segment `/konfigurator/<slug>`.
		const routesDir = path.resolve(process.cwd(), 'src/routes/konfigurator');
		for (const p of KONF_PRODUKTY) {
			if (p.stav !== 'live') continue;
			expect(p.odkaz).toMatch(/^\/konfigurator\/[a-z-]+$/);
			const slug = p.odkaz.replace('/konfigurator/', '');
			const routeFile = path.join(routesDir, slug, '+page.svelte');
			expect(fs.existsSync(routeFile), `live produkt ${p.kod}: chýba route ${routeFile}`).toBe(
				true
			);
		}
	});
});

describe('produkt-aware názvy pre lead / PDF', () => {
	it('produktNazov: známy → nominatív, NULL/neznámy → Pergola', () => {
		expect(produktNazov('bazen')).toBe('Bazénové zastrešenie');
		expect(produktNazov('pergola')).toBe('Pergola');
		expect(produktNazov(null)).toBe('Pergola');
		expect(produktNazov('xxx')).toBe('Pergola');
	});

	it('produktPdfNadpis: známy → nadpis, NULL/neznámy → Špecifikácia pergoly', () => {
		expect(produktPdfNadpis('bazen')).toBe('Špecifikácia bazénového zastrešenia');
		expect(produktPdfNadpis('pergola')).toBe('Špecifikácia pergoly');
		expect(produktPdfNadpis(null)).toBe('Špecifikácia pergoly');
		expect(produktPdfNadpis('xxx')).toBe('Špecifikácia pergoly');
	});

	it('produktPodlaKodu vráti undefined pri neznámom', () => {
		expect(produktPodlaKodu('xxx')).toBeUndefined();
		expect(produktPodlaKodu(null)).toBeUndefined();
		expect(produktPodlaKodu('pergola')?.kod).toBe('pergola');
	});
});

describe('#385 cenový zdroj (honest-null gate)', () => {
	it('LEN pergola má cenovyZdroj=true; bazén a ostatné false', () => {
		expect(produktPodlaKodu('pergola')?.cenovyZdroj).toBe(true);
		expect(produktPodlaKodu('bazen')?.cenovyZdroj).toBe(false);
		// každý iný rad (pripravujeme) je tiež bez zdroja
		for (const p of KONF_PRODUKTY.filter((x) => x.kod !== 'pergola')) {
			expect(p.cenovyZdroj, `${p.kod} nemá mať cenový zdroj`).toBe(false);
		}
	});

	it('maCenovyZdroj: pergola true, bazén false, NULL/neznámy → true (pergola default)', () => {
		expect(maCenovyZdroj('pergola')).toBe(true);
		expect(maCenovyZdroj('bazen')).toBe(false);
		// NULL/neznámy = starý pergolový dopyt pred v35 → true (honest-degrade prepočet ostáva)
		expect(maCenovyZdroj(null)).toBe(true);
		expect(maCenovyZdroj(undefined)).toBe(true);
		expect(maCenovyZdroj('xxx')).toBe(true);
	});
});
