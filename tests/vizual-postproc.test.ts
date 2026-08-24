// #288 — `vytvorComposer` (postproc.ts) unit test cez FAKE pass ctory. `vytvorComposer`
// berie všetky THREE ctory INJEKCIOU (`PostprocModuly` + `THREE`), takže build vetvy
// (gtao/bloom/smaa on/off) AJ leak-kritická dispose slučka (per-pass `dispose?.()` +
// try/catch, potom `composer.dispose()`) sa dajú testovať bez reálneho WebGL kontextu —
// preto NIE JE `postproc.ts` vylúčené z coverage (na rozdiel od `snimka.ts`).
import { describe, expect, it, beforeEach } from 'vitest';
import { vytvorComposer, type PostprocModuly } from '../src/lib/vizual/postproc';
import { postprocKonfig, type PostprocKonfig } from '../src/lib/vizual/kvalita';

// zachytené inštancie composera (FakeComposer sa vytvára VNÚTRI vytvorComposer)
let composers: FakeComposer[] = [];

class FakePass {
	disposed = 0;
	throwOnDispose = false;
	dispose() {
		this.disposed++;
		if (this.throwOnDispose) throw new Error('fake dispose zlyhalo');
	}
}
class FakeRenderPass extends FakePass {
	constructor(
		public scene: unknown,
		public camera: unknown
	) {
		super();
	}
}
class FakeGTAOPass extends FakePass {
	static OUTPUT = { Off: -1, Default: 0, Diffuse: 1, Depth: 2, Normal: 3, AO: 4, Denoise: 5 };
	output = -99;
	blendIntensity = -1;
	gtaoParams: { radius?: number; scale?: number } | null = null;
	constructor(
		public scene: unknown,
		public camera: unknown,
		public w: number,
		public h: number
	) {
		super();
	}
	updateGtaoMaterial(p: { radius?: number; scale?: number }) {
		this.gtaoParams = p;
	}
}
class FakeBloomPass extends FakePass {
	constructor(
		public res: FakeVector2,
		public strength: number,
		public radius: number,
		public threshold: number
	) {
		super();
	}
}
class FakeOutputPass extends FakePass {}
class FakeSMAAPass extends FakePass {}
class FakeComposer {
	passes: FakePass[] = [];
	sizes: Array<[number, number]> = [];
	rendered = 0;
	disposed = 0;
	constructor(public renderer: unknown) {
		composers.push(this);
	}
	addPass(p: FakePass) {
		this.passes.push(p);
	}
	setSize(w: number, h: number) {
		this.sizes.push([w, h]);
	}
	render() {
		this.rendered++;
	}
	dispose() {
		this.disposed++;
	}
}
class FakeVector2 {
	constructor(
		public x: number,
		public y: number
	) {}
}

function moduly(): PostprocModuly {
	return {
		EffectComposer: FakeComposer as unknown as PostprocModuly['EffectComposer'],
		RenderPass: FakeRenderPass as unknown as PostprocModuly['RenderPass'],
		GTAOPass: FakeGTAOPass as unknown as PostprocModuly['GTAOPass'],
		UnrealBloomPass: FakeBloomPass as unknown as PostprocModuly['UnrealBloomPass'],
		OutputPass: FakeOutputPass as unknown as PostprocModuly['OutputPass'],
		SMAAPass: FakeSMAAPass as unknown as PostprocModuly['SMAAPass']
	};
}
const THREE = { Vector2: FakeVector2 } as unknown as typeof import('three');
const renderer = {} as never;
const scene = {} as never;
const camera = {} as never;

function postav(konfig: PostprocKonfig, w = 800, h = 500) {
	const zc = vytvorComposer(THREE, moduly(), renderer, scene, camera, konfig, w, h);
	const composer = composers[composers.length - 1]!;
	return { zc, composer };
}

beforeEach(() => {
	composers = [];
});

describe('vytvorComposer — high konfig (GTAO + bloom + SMAA)', () => {
	it('poradie passov: RenderPass → GTAO → Bloom → OutputPass → SMAA', () => {
		const { composer } = postav(postprocKonfig('high')!);
		expect(composer.passes.map((p) => p.constructor.name)).toEqual([
			'FakeRenderPass',
			'FakeGTAOPass',
			'FakeBloomPass',
			'FakeOutputPass',
			'FakeSMAAPass'
		]);
	});

	it('GTAO nakonfigurované: output=Default(0), blendIntensity + radius/scale z konfigu', () => {
		const k = postprocKonfig('high')!;
		const { composer } = postav(k);
		const gtao = composer.passes[1] as unknown as FakeGTAOPass;
		expect(gtao.output).toBe(FakeGTAOPass.OUTPUT.Default);
		expect(gtao.blendIntensity).toBe(k.gtaoBlend);
		expect(gtao.gtaoParams).toEqual({ radius: k.gtaoRadius, scale: k.gtaoScale });
	});

	it('bloom dostane Vector2(w,h) + strength/radius/threshold z konfigu', () => {
		const k = postprocKonfig('high')!;
		const { composer } = postav(k, 800, 500);
		const bloom = composer.passes[2] as unknown as FakeBloomPass;
		expect(bloom.res).toBeInstanceOf(FakeVector2);
		expect([bloom.res.x, bloom.res.y]).toEqual([800, 500]);
		expect(bloom.strength).toBe(k.bloomStrength);
		expect(bloom.radius).toBe(k.bloomRadius);
		expect(bloom.threshold).toBe(k.bloomThreshold);
	});

	it('composer.setSize(w,h) sa zavolá pri stavbe', () => {
		const { composer } = postav(postprocKonfig('high')!, 800, 500);
		expect(composer.sizes).toContainEqual([800, 500]);
	});
});

describe('vytvorComposer — mid konfig (GTAO + SMAA, BEZ bloomu)', () => {
	it('poradie passov bez bloomu: RenderPass → GTAO → OutputPass → SMAA', () => {
		const { composer } = postav(postprocKonfig('mid')!);
		expect(composer.passes.map((p) => p.constructor.name)).toEqual([
			'FakeRenderPass',
			'FakeGTAOPass',
			'FakeOutputPass',
			'FakeSMAAPass'
		]);
	});
});

describe('vytvorComposer — minimálny konfig (všetky efekty vypnuté)', () => {
	it('len RenderPass + OutputPass (pokrýva false vetvy gtao/bloom/smaa)', () => {
		const minimal: PostprocKonfig = {
			gtao: false,
			gtaoRadius: 0,
			gtaoScale: 0,
			gtaoBlend: 0,
			smaa: false,
			bloom: false,
			bloomStrength: 0,
			bloomRadius: 0,
			bloomThreshold: 1
		};
		const { composer } = postav(minimal);
		expect(composer.passes.map((p) => p.constructor.name)).toEqual([
			'FakeRenderPass',
			'FakeOutputPass'
		]);
	});
});

describe('vytvorComposer — ZivyComposer API (render/setSize/dispose)', () => {
	it('render() deleguje na composer.render()', () => {
		const { zc, composer } = postav(postprocKonfig('high')!);
		zc.render();
		zc.render();
		expect(composer.rendered).toBe(2);
	});

	it('setSize() deleguje na composer.setSize()', () => {
		const { zc, composer } = postav(postprocKonfig('high')!);
		zc.setSize(400, 300);
		expect(composer.sizes).toContainEqual([400, 300]);
	});

	it('dispose() zlikviduje KAŽDÝ pass + composer (leak prevencia)', () => {
		const { zc, composer } = postav(postprocKonfig('high')!);
		zc.dispose();
		for (const p of composer.passes) expect(p.disposed).toBe(1);
		expect(composer.disposed).toBe(1);
	});

	it('dispose() jedného passu, ktorý HODÍ, NEZASTAVÍ slučku — zvyšok + composer sa uvoľnia', () => {
		const m = moduly();
		// OutputPass fake hodí pri dispose
		class ThrowingOutput extends FakeOutputPass {
			constructor() {
				super();
				this.throwOnDispose = true;
			}
		}
		m.OutputPass = ThrowingOutput as unknown as PostprocModuly['OutputPass'];
		const zc = vytvorComposer(THREE, m, renderer, scene, camera, postprocKonfig('high')!, 800, 500);
		const composer = composers[composers.length - 1]!;
		expect(() => zc.dispose()).not.toThrow();
		// všetky passy sa pokúsili o dispose (throwing tiež), composer sa uvoľnil
		for (const p of composer.passes) expect(p.disposed).toBe(1);
		expect(composer.disposed).toBe(1);
	});
});
