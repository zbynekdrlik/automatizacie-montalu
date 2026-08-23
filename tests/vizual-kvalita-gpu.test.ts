// #288 — GPU „detect-gpu ekvivalent" klasifikácia + post-processing gate/konfig
// (`kvalita.ts`). Pure logic, žiadny THREE/DOM. Existujúce `detekujTier`/`nastaveniaPreTier`
// testy sú vo `vizual-kamera-kvalita.test.ts` — TU sú LEN #288 rozšírenia (GPU trieda,
// mid-vs-high podľa reálneho GPU, softvérový renderer, postproc gate + per-tier konfig).
import { describe, expect, it } from 'vitest';
import {
	detekujTier,
	jeSoftverovyRenderer,
	klasifikujGpu,
	nastaveniaPreTier,
	postprocKonfig,
	postprocPovoleny
} from '../src/lib/vizual/kvalita';

describe('jeSoftverovyRenderer (#288 presunuté z snimka.ts) — softvér/neznámy = true', () => {
	it('prázdny reťazec (maskovaný WEBGL_debug_renderer_info) → true (fail-safe)', () => {
		expect(jeSoftverovyRenderer('')).toBe(true);
		expect(jeSoftverovyRenderer('   ')).toBe(true);
	});

	it('softvérové renderery (SwiftShader/llvmpipe/Basic Render/Microsoft) → true', () => {
		expect(jeSoftverovyRenderer('Google SwiftShader')).toBe(true);
		expect(jeSoftverovyRenderer('llvmpipe (LLVM 15.0.0, 256 bits)')).toBe(true);
		expect(jeSoftverovyRenderer('Microsoft Basic Render Driver')).toBe(true);
		expect(jeSoftverovyRenderer('Mesa Software Rasterizer')).toBe(true);
	});

	it('hardvérové GPU → false', () => {
		expect(
			jeSoftverovyRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)')
		).toBe(false);
		expect(jeSoftverovyRenderer('Apple GPU')).toBe(false);
	});
});

describe('klasifikujGpu (#288) — kurátorská benchmark trieda z renderer-stringu', () => {
	it('prázdny reťazec → neznamy (→ fallback heuristika u volajúceho)', () => {
		expect(klasifikujGpu('')).toBe('neznamy');
		expect(klasifikujGpu('  ')).toBe('neznamy');
	});

	it('slabé mobilné/embedded + softvér → slabe (zachováva #170 konvenciu Mali/Adreno 1-5/PowerVR)', () => {
		expect(klasifikujGpu('Mali-G52')).toBe('slabe');
		expect(klasifikujGpu('Adreno 330')).toBe('slabe');
		expect(klasifikujGpu('Adreno (TM) 405')).toBe('slabe');
		expect(klasifikujGpu('PowerVR SGX 543')).toBe('slabe');
		expect(klasifikujGpu('Google SwiftShader')).toBe('slabe');
	});

	it('diskrétny desktop GPU → diskretne', () => {
		expect(
			klasifikujGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)')
		).toBe('diskretne');
		expect(klasifikujGpu('NVIDIA GeForce GTX 1660')).toBe('diskretne');
		expect(klasifikujGpu('AMD Radeon RX 6800 XT')).toBe('diskretne');
		expect(klasifikujGpu('AMD Radeon Pro 5500M')).toBe('diskretne');
		expect(klasifikujGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)')).toBe('diskretne');
		expect(klasifikujGpu('Intel Arc A770 Graphics')).toBe('diskretne');
	});

	it('mobilné (telefón/tablet) neslabé → mobilne', () => {
		expect(klasifikujGpu('Apple GPU')).toBe('mobilne'); // iOS Safari
		expect(klasifikujGpu('Apple A15 GPU')).toBe('mobilne');
		expect(klasifikujGpu('Adreno (TM) 660')).toBe('mobilne'); // vlajkový Android GPU
		expect(klasifikujGpu('Adreno 740')).toBe('mobilne');
	});

	it('desktop integrované GPU → integrovane', () => {
		expect(klasifikujGpu('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)')).toBe(
			'integrovane'
		);
		expect(klasifikujGpu('Intel(R) UHD Graphics 620')).toBe('integrovane');
		expect(klasifikujGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2)')).toBe('integrovane');
		expect(klasifikujGpu('AMD Radeon(TM) Graphics')).toBe('integrovane'); // APU
	});

	it('neznáme hardvérové GPU → neznamy (graceful fallback)', () => {
		expect(klasifikujGpu('Some Exotic GPU 9000')).toBe('neznamy');
	});
});

describe('detekujTier (#288) — reálny GPU má prednosť pred viewport heuristikou', () => {
	it('diskrétny desktop GPU → high (aj pri nižšom počte CPU jadier)', () => {
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 8, // pôvodná heuristika by dala mid
				unmaskedRenderer: 'NVIDIA GeForce RTX 4070'
			})
		).toBe('high');
	});

	it('mobilné vlajkové GPU → mid (nikdy najťažší tier, aj pri vysokom DPR)', () => {
		// #170 pôvodne: Adreno 660 + 16 jadier → high; #288 zlepšenie: mobil → mid
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 16,
				devicePixelRatio: 3,
				unmaskedRenderer: 'Adreno (TM) 660'
			})
		).toBe('mid');
	});

	it('integrované desktop GPU → mid', () => {
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 16,
				devicePixelRatio: 1,
				unmaskedRenderer: 'Intel(R) Iris(R) Xe Graphics'
			})
		).toBe('mid');
	});

	it('slabé GPU → low bez ohľadu na CPU jadrá (zachované)', () => {
		expect(
			detekujTier({ webgl2Dostupny: true, hardwareConcurrency: 16, unmaskedRenderer: 'Mali-G52' })
		).toBe('low');
	});

	it('softvérový renderer (SwiftShader) pri reálnej detekcii → low', () => {
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 16,
				unmaskedRenderer: 'Google SwiftShader'
			})
		).toBe('low');
	});

	it('neznáme GPU → pôvodná CPU-jadrá/DPR heuristika (spätne kompatibilné)', () => {
		// neznámy string → fallback: cores 16, dpr 1 → high
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 16,
				deviceMemory: 16,
				devicePixelRatio: 1,
				unmaskedRenderer: 'Some Exotic GPU 9000'
			})
		).toBe('high');
		// neznámy string → fallback: cores 6 → mid
		expect(
			detekujTier({
				webgl2Dostupny: true,
				hardwareConcurrency: 6,
				unmaskedRenderer: 'Some Exotic GPU 9000'
			})
		).toBe('mid');
	});
});

describe('postprocPovoleny (#288) — mid/high + HARDVÉROVÝ renderer', () => {
	it('mid/high na hardvéri → true', () => {
		expect(postprocPovoleny(nastaveniaPreTier('mid'), 'NVIDIA GeForce RTX 4070')).toBe(true);
		expect(postprocPovoleny(nastaveniaPreTier('high'), 'Apple M1 Pro')).toBe(true);
	});

	it('low tier → false (postproc flag je false)', () => {
		expect(postprocPovoleny(nastaveniaPreTier('low'), 'NVIDIA GeForce RTX 4070')).toBe(false);
	});

	it('SOFTVÉROVÝ renderer (SwiftShader/CI) na mid/high → false (#290 alokačný rozpočet)', () => {
		expect(postprocPovoleny(nastaveniaPreTier('high'), 'Google SwiftShader')).toBe(false);
		expect(postprocPovoleny(nastaveniaPreTier('mid'), 'llvmpipe')).toBe(false);
	});

	it('prázdny renderer string (maskovaný) → false (fail-safe: softvér)', () => {
		expect(postprocPovoleny(nastaveniaPreTier('high'), '')).toBe(false);
	});
});

describe('postprocKonfig (#288) — per-tier efekty', () => {
	it('low/none → null (composer sa tam nestavia)', () => {
		expect(postprocKonfig('low')).toBeNull();
		expect(postprocKonfig('none')).toBeNull();
	});

	it('mid → GTAO + SMAA, bez bloomu', () => {
		const k = postprocKonfig('mid');
		expect(k).not.toBeNull();
		expect(k!.gtao).toBe(true);
		expect(k!.smaa).toBe(true);
		expect(k!.bloom).toBe(false);
		expect(k!.gtaoBlend).toBeGreaterThan(0);
		expect(k!.gtaoBlend).toBeLessThan(1); // jemné, nie muddy
	});

	it('high → GTAO + SMAA + jemný bloom', () => {
		const k = postprocKonfig('high');
		expect(k).not.toBeNull();
		expect(k!.gtao).toBe(true);
		expect(k!.smaa).toBe(true);
		expect(k!.bloom).toBe(true);
		// bloom je ZÁMERNE jemný (predajný konfigurátor, nie „gamey" glow)
		expect(k!.bloomStrength).toBeGreaterThan(0);
		expect(k!.bloomStrength).toBeLessThan(0.3);
		expect(k!.bloomThreshold).toBeGreaterThan(0.5); // len najjasnejšie plochy žiaria
	});

	it('mid má menší/rovný GTAO polomer ako high (postupný tier gradient)', () => {
		expect(postprocKonfig('mid')!.gtaoRadius).toBeLessThanOrEqual(
			postprocKonfig('high')!.gtaoRadius
		);
	});
});
