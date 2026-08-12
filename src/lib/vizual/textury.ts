// Zákaznícky 3D náhľad (#170) — procedurálne CanvasTexture (§2.6). VŠETKY
// textúry sa generujú RAZ na `<canvas>` (2D kontext, žiadny WebGL), cachujú a
// dostanú `colorSpace = SRGBColorSpace`. V repe nie je ani jeden binárny
// obrázok (žiadna externá runtime závislosť — §4). Volané VÝLUČNE z `onMount`
// (klientský canvas), nikdy na module top-level.
type ThreeNS = typeof import('three');
type Texture = InstanceType<ThreeNS['CanvasTexture']>;

function canvas2d(rozmer: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = document.createElement('canvas');
	canvas.width = rozmer;
	canvas.height = rozmer;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('vizual/textury: 2D canvas kontext sa nepodarilo získať');
	return { canvas, ctx };
}

function ztexturuj(THREE: ThreeNS, canvas: HTMLCanvasElement): Texture {
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.needsUpdate = true;
	return tex;
}

function hexNaRgb(hex: string): [number, number, number] {
	const n = parseInt(hex.replace('#', ''), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function miesaj(
	a: [number, number, number],
	b: [number, number, number],
	t: number
): [number, number, number] {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Obloha — prevrátená sféra dostane vertikálny gradient `#dfe7ee → #8fb4d6`. */
export function vytvorOblohuTexturu(THREE: ThreeNS): Texture {
	const { canvas, ctx } = canvas2d(256);
	const grad = ctx.createLinearGradient(0, 0, 0, 256);
	grad.addColorStop(0, '#dfe7ee');
	grad.addColorStop(1, '#8fb4d6');
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, 256, 256);
	return ztexturuj(THREE, canvas);
}

/** Dlažba — mriežka dlaždíc so 12 mm špárami, jitter svetlosti ±6 %, 2 % šum.
 *  Canvas reprezentuje `mriezka × mriezka` dlaždíc naraz (nie len jednu), aby
 *  bola vidieť SKUTOČNÁ variácia medzi dlaždicami, nie len opakovaná jedna —
 *  `repeat` sa nastavuje v `scena.ts` tak, aby JEDNA dlaždica = 600×600 mm
 *  (hlavný mierkový kľúč scény). */
export function vytvorDlazbuTexturu(THREE: ThreeNS, rozlisenie = 512, mriezka = 4): Texture {
	const { canvas, ctx } = canvas2d(rozlisenie);
	const bunka = rozlisenie / mriezka;
	const spara = Math.max(1, Math.round((12 / 600) * bunka)); // 12mm špára pri 600mm dlaždici
	const zaklad: [number, number, number] = hexNaRgb('#b9b3ab');

	ctx.fillStyle = '#8a8479';
	ctx.fillRect(0, 0, rozlisenie, rozlisenie);

	for (let gy = 0; gy < mriezka; gy++) {
		for (let gx = 0; gx < mriezka; gx++) {
			const jitter = (Math.random() * 2 - 1) * 0.06;
			const farba = zaklad.map((c) => Math.max(0, Math.min(255, c * (1 + jitter)))) as [
				number,
				number,
				number
			];
			ctx.fillStyle = `rgb(${farba[0] | 0}, ${farba[1] | 0}, ${farba[2] | 0})`;
			ctx.fillRect(gx * bunka + spara, gy * bunka + spara, bunka - 2 * spara, bunka - 2 * spara);
		}
	}

	// 2% šum navrch (per-pixel dithering na hrubších blokoch, nie na každom
	// pixeli — performančne lacnejšie, vizuálne nerozoznateľné)
	const blok = 4;
	for (let y = 0; y < rozlisenie; y += blok) {
		for (let x = 0; x < rozlisenie; x += blok) {
			if (Math.random() < 0.5) continue;
			const sum = (Math.random() * 2 - 1) * 0.02 * 255;
			ctx.fillStyle = `rgba(255,255,255,${sum > 0 ? Math.min(0.08, sum / 255) : 0})`;
			if (sum > 0) ctx.fillRect(x, y, blok, blok);
		}
	}

	return ztexturuj(THREE, canvas);
}

/** Stena domu — 3-oktávový šum, teplý štukový tón, plus samostatná roughness
 *  mapa z toho istého šumu (drobnejšia štuková štruktúra bez farebnej zmeny).
 *  Zámerne TEPLEJŠÍ a SÝTEJŠÍ tón než pôvodný takmer-biely `#e9e4dc` — pri
 *  jasnom kľúčovom svetle (§2.6, 2.4 intenzita) a ACES tonemappingu splýval
 *  vizuálne s bledou oblohou (`#dfe7ee`), takže stena ako samostatná plocha
 *  prakticky zmizla (nájdené pri live vizuálnej kontrole screenshotu). */
export function vytvorStenuTexturu(
	THREE: ThreeNS,
	rozlisenie = 1024
): { map: Texture; roughnessMap: Texture } {
	const zaklad: [number, number, number] = hexNaRgb('#d9cfc0');
	const tmava: [number, number, number] = hexNaRgb('#b9ab95');

	const sum2d = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, farebna: boolean) => {
		const img = ctx.createImageData(canvas.width, canvas.height);
		for (let i = 0; i < img.data.length; i += 4) {
			// 3-oktávový hodnotový šum (jednoduchý, ale lacný — 3 frekvencie
			// náhodnosti sčítané s klesajúcou váhou)
			let v = 0;
			let vaha = 0;
			for (let okt = 0; okt < 3; okt++) {
				const w = 1 / 2 ** okt;
				v += Math.random() * w;
				vaha += w;
			}
			v /= vaha;
			if (farebna) {
				const rgb = miesaj(zaklad, tmava, v);
				img.data[i] = rgb[0];
				img.data[i + 1] = rgb[1];
				img.data[i + 2] = rgb[2];
				img.data[i + 3] = 255;
			} else {
				const g = Math.round(200 + v * 55);
				img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
				img.data[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
	};

	const farebnaCv = canvas2d(rozlisenie);
	sum2d(farebnaCv.canvas, farebnaCv.ctx, true);
	const roughCv = canvas2d(rozlisenie);
	sum2d(roughCv.canvas, roughCv.ctx, false);

	return {
		map: ztexturuj(THREE, farebnaCv.canvas),
		roughnessMap: ztexturuj(THREE, roughCv.canvas)
	};
}

/** Dvojvrstvový kontaktný tieň — mäkká vrstva (radiálny gradient, opacity 0.55)
 *  + tvrdé jadro (samotný pôdorys, opacity 0.20), oba v JEDNEJ textúre (dve
 *  vrstvy nakreslené nad seba), aplikuje sa na alpha-decal rovinu. */
export function vytvorKontaktnyTienTexturu(THREE: ThreeNS, rozlisenie = 512): Texture {
	const { canvas, ctx } = canvas2d(rozlisenie);
	const stred = rozlisenie / 2;

	// mäkká vrstva — radiálny gradient cez celú plochu
	const mekka = ctx.createRadialGradient(stred, stred, 0, stred, stred, stred);
	mekka.addColorStop(0, 'rgba(15,23,42,0.55)');
	mekka.addColorStop(0.6, 'rgba(15,23,42,0.28)');
	mekka.addColorStop(1, 'rgba(15,23,42,0)');
	ctx.fillStyle = mekka;
	ctx.fillRect(0, 0, rozlisenie, rozlisenie);

	// tvrdé jadro — menší, ostrejší tieň v strede (footprint produktu)
	const jadroR = rozlisenie * 0.32;
	const jadro = ctx.createRadialGradient(stred, stred, 0, stred, stred, jadroR);
	jadro.addColorStop(0, 'rgba(15,23,42,0.20)');
	jadro.addColorStop(0.85, 'rgba(15,23,42,0.16)');
	jadro.addColorStop(1, 'rgba(15,23,42,0)');
	ctx.fillStyle = jadro;
	ctx.fillRect(0, 0, rozlisenie, rozlisenie);

	return ztexturuj(THREE, canvas);
}
