// Zákaznícky 3D náhľad (#170) — mobilný fallback rebrík T3→T0 (§2.9). Pure
// logic (žiadny THREE/DOM import) — konzument (`Vizual3D.svelte`) nazbiera
// vstupné signály (WebGL2 dostupnosť, `navigator.hardwareConcurrency`,
// `UNMASKED_RENDERER_WEBGL` reťazec…) a odovzdá ich sem.

export type Tier = 'high' | 'mid' | 'low' | 'none';

export interface KvalitaVstup {
	webgl2Dostupny: boolean;
	hardwareConcurrency?: number;
	deviceMemory?: number;
	unmaskedRenderer?: string;
	devicePixelRatio?: number;
	/** ms od začiatku inicializácie po prvý úspešný render */
	initMs?: number;
	/** koľkokrát v tejto session nastal `webglcontextlost` */
	contextLostCount?: number;
}

// slabé mobilné/embedded GPU → low. `Adreno\D*[1-5]\d\d\b` (namiesto pôvodného
// `Adreno [1-5]`) znáša reálny formát „Adreno (TM) 4xx" (Android hlási „(TM)" medzi
// menom a číslom) a zároveň zachováva #170 konvenciu: Adreno 1xx–5xx → low, Adreno
// 6xx+ NIE (`Adreno 330`→slabe, `Adreno 660`→nie — zamknuté vo `vizual-kamera-kvalita`).
const SLABE_GPU_RE = /Mali|Adreno\D*[1-5]\d\d\b|PowerVR/i;

/** #290 (presunuté sem z `snimka.ts` #288): je `UNMASKED_RENDERER_WEBGL` reťazec
 *  SOFTVÉROVÝ (alebo neznámy) renderer? Softvérové WebGL (SwiftShader na GitHub CI
 *  runneri, llvmpipe, Microsoft Basic Render, Mesa Software Rasterizer) hlási VEĽKÉ
 *  per-dimension limity, ale má MALÝ CELKOVÝ alokačný rozpočet — viď
 *  `snimka.ts::supersampleFaktor` (tlačový strop 2×) AJ `postprocPovoleny`
 *  (post-processing composer sa na softvéri vôbec nestavia). Prázdny reťazec
 *  (`WEBGL_debug_renderer_info` nedostupné, napr. privacy) = softvér/neznámy →
 *  konzervatívny fail-safe. Býval v `snimka.ts`; centralizované do `kvalita.ts`
 *  (jediný zdroj pravdy klasifikácie renderer-stringu), `snimka.ts` ho re-exportuje. */
const SOFTVEROVY_RENDERER_RE = /SwiftShader|llvmpipe|softpipe|Software|Basic Render|Microsoft/i;

export function jeSoftverovyRenderer(unmaskedRenderer: string): boolean {
	const s = unmaskedRenderer.trim();
	return s === '' || SOFTVEROVY_RENDERER_RE.test(s);
}

/** #288 „detect-gpu ekvivalent" — kurátorská benchmark klasifikácia GPU z
 *  `UNMASKED_RENDERER_WEBGL` reťazca (0 závislosti, 0 bundle váhy, 0 externého
 *  fetchu — na rozdiel od `detect-gpu` knižnice, ktorá fetchuje benchmark DB z CDN
 *  a porušila by Money-guard). Nahrádza CPU-jadrá/DPR „viewport" heuristiku ako
 *  PRIMÁRNY signál pre mid-vs-high split. `neznamy` (prázdny/maskovaný string kvôli
 *  privacy) → volajúci graceful padne na pôvodnú heuristiku. */
export type GpuTrieda = 'slabe' | 'mobilne' | 'integrovane' | 'diskretne' | 'neznamy';

// diskrétny (dedikovaný) desktop GPU → high. Model-číslované herné/pro karty.
// `(?:\s*\(TM\))?` znáša reálny „(TM)" (rovnaká disciplína ako Adreno `\D*`) — bez
// neho by „AMD Radeon (TM) RX 480" nespadlo sem (review #288). POZOR poradie v
// `klasifikujGpu`: `INTEGROVANE_IGPU_RE` sa kontroluje PRED týmto (integrované GPU
// s „diskrétnym" menom).
const DISKRETNE_GPU_RE =
	/GeForce (?:RTX|GTX)|\bRTX\b|\bGTX\b|Quadro|TITAN|Radeon(?:\s*\(TM\))?\s+(?:RX|Pro)\b|\bArc\b\s*(?:\(TM\)\s*)?[AB]\d{3}\b|Apple M\d+ (?:Pro|Max|Ultra)/i;
// Integrované GPU, ktoré NESÚ „diskrétne" meno — MUSIA sa chytiť PRED `DISKRETNE_GPU_RE`,
// inak by dostali najťažší tier na tenkom zariadení (review #288):
//  - AMD APU: „Radeon(TM) RX Vega 10 Graphics" / „Radeon Vega 8 Graphics" (Ryzen APU;
//    diskrétne „RX Vega 64" NEMÁ „Graphics" suffix → ostane diskrétne),
//  - Intel Core Ultra (Meteor/Lunar Lake) iGPU: „Intel(R) Arc(TM) Graphics" (bez Ax/Bx),
//  - NVIDIA entry: „GeForce MX250" / „GeForce GT 710".
const INTEGROVANE_IGPU_RE =
	/Radeon(?:\s*\(TM\))?(?:\s+RX)?\s+Vega\s+\d+\s+Graphics|\bArc\b(?:\s*\(TM\))?\s+Graphics\b|GeForce\s+(?:MX|GT)\s*\d/i;
// mobilné GPU (telefón/tablet) → mid: neslabé Apple/Adreno. `\D*` znáša „(TM)".
// „Apple GPU" hlási AJ maskované macOS Safari na M-series desktope → mid (bezpečný smer).
const MOBILNE_GPU_RE = /Apple (?:A\d+|GPU)\b|Adreno\D*[6-9]\d\d\b/i;
// ostatné desktop integrované GPU → mid: Apple M base (bez Pro/Max/Ultra), Intel
// Iris/UHD/HD Graphics/Xe (`\bXe\b` aby „Xeon" neprešlo), AMD APU Radeon Vega/Graphics.
const INTEGROVANE_GPU_RE =
	/Apple M\d+\b|Intel.*(?:Iris|UHD|HD Graphics|\bXe\b)|Radeon.*(?:Vega|Graphics)|AMD Radeon(?:\(TM\))? Graphics/i;

export function klasifikujGpu(renderer: string): GpuTrieda {
	const s = renderer.trim();
	if (s === '') return 'neznamy';
	// slabé/softvérové najprv (zachováva #170 konvenciu: každé Mali/Adreno 1-5/
	// PowerVR → low, bez ohľadu na CPU jadrá)
	if (SLABE_GPU_RE.test(s) || jeSoftverovyRenderer(s)) return 'slabe';
	// integrované „vyzerá diskrétne" tvary (APU/iGPU/entry) PRED diskrétnym testom
	if (INTEGROVANE_IGPU_RE.test(s)) return 'integrovane';
	if (DISKRETNE_GPU_RE.test(s)) return 'diskretne';
	if (MOBILNE_GPU_RE.test(s)) return 'mobilne';
	if (INTEGROVANE_GPU_RE.test(s)) return 'integrovane';
	return 'neznamy';
}

/** §2.9 tabuľka + #288 GPU-tier — `none` má prednosť pred všetkým ostatným (WebGL2
 *  chýba, druhá strata kontextu, alebo pomalá inicializácia > 2500 ms). Mid-vs-high
 *  split používa PRIMÁRNE reálny GPU (`klasifikujGpu`), a len pri neznámom/maskovanom
 *  GPU padne na pôvodnú CPU-jadrá/DPR heuristiku (spätne kompatibilné). */
export function detekujTier(vst: KvalitaVstup): Tier {
	if (!vst.webgl2Dostupny) return 'none';
	if ((vst.contextLostCount ?? 0) >= 2) return 'none';
	if ((vst.initMs ?? 0) > 2500) return 'none';

	const gpu = klasifikujGpu(vst.unmaskedRenderer ?? '');

	// tvrdé low: genuinely slabý HW (málo jadier/pamäte) alebo slabé/softvérové GPU
	const slabe =
		(vst.hardwareConcurrency ?? Infinity) <= 4 ||
		(vst.deviceMemory ?? Infinity) <= 2 ||
		gpu === 'slabe';
	if (slabe) return 'low';

	// #288: reálny GPU má prednosť pred viewport heuristikou pre mid/high split
	if (gpu === 'diskretne') return 'high';
	if (gpu === 'mobilne' || gpu === 'integrovane') return 'mid';

	// neznáme/maskované GPU → pôvodná heuristika (§2.9)
	const stredne = (vst.hardwareConcurrency ?? 0) <= 8 || (vst.devicePixelRatio ?? 0) >= 2.5;
	if (stredne) return 'mid';

	return 'high';
}

export interface TierNastavenia {
	/** cap pre `renderer.setPixelRatio` */
	dpr: number;
	antialias: boolean;
	/** 'transmission' = skutočné presvitajúce sklo (jedna zliata skupina);
	 *  'falosne' = lacnejšia priehľadnosť bez transmission passu (low tier) */
	sklo: 'transmission' | 'falosne';
	clearcoat: boolean;
	/** rozlíšenie PMREM environment mapy */
	pmrem: number;
	/** rozlíšenie procedurálnej textúry dlažby */
	dlazba: number;
	/** rozlíšenie procedurálnej textúry steny */
	stena: number;
	/** low tier: plochý gradient namiesto dlaždicovej textúry dlažby/steny */
	plochyGradientMiestoMap: boolean;
	/** #285: reálny HDRI/IBL (Poly Haven CC0) namiesto procedurálneho
	 *  `RoomEnvironment`. `false` na `low` tieri (slabé GPU: RoomEnvironment je
	 *  lacnejší, HDR load + PMREM z equirectu je navyše práca), `true` na mid/high. */
	hdri: boolean;
	/** #285: reálny cast-shadow (PCFSoftShadowMap) z kľúčového svetla. `false`
	 *  na `low` tieri (len kontaktný dekal — perf), `true` na mid/high. */
	tiene: boolean;
	/** #285: rozlíšenie shadow mapy (0 = žiadny shadow map, `tiene===false`). */
	shadowMapa: number;
	/** #288: povoliť post-processing composer (GTAO/SMAA/bloom). `false` na `low`
	 *  (slabé GPU: aditívne passy sú navyše záťaž), `true` na mid/high. Runtime sa
	 *  navyše vypne na SOFTVÉROVOM rendereri (`postprocPovoleny`) — SwiftShader/CI
	 *  má malý alokačný rozpočet (#290). */
	postproc: boolean;
}

const NASTAVENIA: Record<Exclude<Tier, 'none'>, TierNastavenia> = {
	low: {
		dpr: 1.25,
		antialias: false,
		sklo: 'falosne',
		clearcoat: false,
		pmrem: 128,
		dlazba: 256,
		stena: 256,
		plochyGradientMiestoMap: true,
		hdri: false,
		tiene: false,
		shadowMapa: 0,
		postproc: false
	},
	mid: {
		dpr: 1.5,
		antialias: false,
		sklo: 'transmission',
		clearcoat: true,
		pmrem: 128,
		dlazba: 512,
		stena: 512,
		plochyGradientMiestoMap: false,
		hdri: true,
		tiene: true,
		shadowMapa: 1024,
		postproc: true
	},
	high: {
		dpr: 2,
		antialias: true,
		sklo: 'transmission',
		clearcoat: true,
		pmrem: 256,
		dlazba: 512,
		stena: 1024,
		plochyGradientMiestoMap: false,
		hdri: true,
		tiene: true,
		shadowMapa: 2048,
		postproc: true
	}
};

export function nastaveniaPreTier(tier: Exclude<Tier, 'none'>): TierNastavenia {
	return NASTAVENIA[tier];
}

/** #288: má sa pre daný tier + renderer postaviť post-processing composer?
 *  `nastavenia.postproc` (mid/high) A NIE softvérový renderer — SwiftShader (CI)
 *  má malý CELKOVÝ alokačný rozpočet (#290), na ktorom by viac-RT post-processing
 *  riskoval incomplete framebuffer + kaskádu GL warningov. Post-processing tak
 *  cieli na REÁLNE zákaznícke GPU; softvérový/CI render ide nezmenenou priamou
 *  cestou (0 regresie existujúcich mid/high E2E na SwiftShaderi). */
export function postprocPovoleny(nastavenia: TierNastavenia, unmaskedRenderer: string): boolean {
	return nastavenia.postproc && !jeSoftverovyRenderer(unmaskedRenderer);
}

/** #288: per-tier parametre post-processing efektov. Čisté DÁTA (žiadny THREE/DOM) —
 *  žijú TU (v meranej `kvalita.ts`, spolu s ostatnými tier→nastavenia rozhodnutiami),
 *  aby `postproc.ts` ostal čisto nemerateľná THREE-composer továreň. `null` pre
 *  `low`/`none` (composer sa tam nestavia; runtime gate rieši `postprocPovoleny`). */
export interface PostprocKonfig {
	gtao: boolean;
	/** GTAO polomer vzorkovania [svetové metre] — scéna je v metroch (produkt ~4 m),
	 *  ~0,2–0,25 m dáva kontaktné stmavenie v záhyboch bez „muddy" preexponovania. */
	gtaoRadius: number;
	/** GTAO sila (mierka AO príspevku). */
	gtaoScale: number;
	/** miešanie AO cez beauty (0..1) — zámerne < 1 (jemné, predajný konfigurátor). */
	gtaoBlend: number;
	smaa: boolean;
	bloom: boolean;
	bloomStrength: number;
	bloomRadius: number;
	bloomThreshold: number;
}

const POSTPROC_KONFIG: Record<'mid' | 'high', PostprocKonfig> = {
	// mid: AO + SMAA (bez bloomu — jeden pass navyše ušetrený na slabšom hardvéri)
	mid: {
		gtao: true,
		gtaoRadius: 0.22,
		gtaoScale: 1.1,
		gtaoBlend: 0.8,
		smaa: true,
		bloom: false,
		bloomStrength: 0,
		bloomRadius: 0,
		bloomThreshold: 1
	},
	// high: AO + SMAA + jemný bloom (len najjasnejšie HDRI odlesky/obloha lehko žiaria)
	high: {
		gtao: true,
		gtaoRadius: 0.25,
		gtaoScale: 1.2,
		gtaoBlend: 0.85,
		smaa: true,
		bloom: true,
		bloomStrength: 0.12,
		bloomRadius: 0.4,
		bloomThreshold: 0.85
	}
};

/** Per-tier post-processing konfigurácia. `null` pre `low`/`none` (composer sa tam
 *  nestavia). Runtime GATE (mid/high + hardvérový renderer) rieši `postprocPovoleny` —
 *  táto funkcia len dodá parametre keď je gate ON. */
export function postprocKonfig(tier: Tier): PostprocKonfig | null {
	if (tier === 'mid' || tier === 'high') return POSTPROC_KONFIG[tier];
	return null;
}
