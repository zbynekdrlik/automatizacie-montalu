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

const SLABE_GPU_RE = /Mali|Adreno [1-5]|PowerVR/;

/** §2.9 tabuľka — `none` má prednosť pred všetkým ostatným (WebGL2 chýba,
 *  druhá strata kontextu, alebo pomalá inicializácia > 2500 ms). */
export function detekujTier(vst: KvalitaVstup): Tier {
	if (!vst.webgl2Dostupny) return 'none';
	if ((vst.contextLostCount ?? 0) >= 2) return 'none';
	if ((vst.initMs ?? 0) > 2500) return 'none';

	const slabe =
		(vst.hardwareConcurrency ?? Infinity) <= 4 ||
		(vst.deviceMemory ?? Infinity) <= 2 ||
		SLABE_GPU_RE.test(vst.unmaskedRenderer ?? '');
	if (slabe) return 'low';

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
		shadowMapa: 0
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
		shadowMapa: 1024
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
		shadowMapa: 2048
	}
};

export function nastaveniaPreTier(tier: Exclude<Tier, 'none'>): TierNastavenia {
	return NASTAVENIA[tier];
}
