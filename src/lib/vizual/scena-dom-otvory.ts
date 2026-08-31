// #336 — realistické ZAPUSTENÉ otvory domu (okná + dvere) ako SalesQueze, koniec
// „detského/lego" vzhľadu. Extrahované zo `scena-dom.ts` (large-file-split.md) —
// čisté factory helpery (vstup → THREE meshe pushnuté do zdieľanej skupiny), životný
// cyklus/disposal drží `Vizual3D.svelte` cez `disposables`. Volané LEN pri `zobrazDom`.
//
// Root cause „hračky" (viď #336 dizajn): pôvodné okná/dvere boli ploché kvádre NASADENÉ
// na fasádu (jeden pruh + pahýľ kľučky) → nálepka na kvádri. Kľúčové: fasáda je NEPRIEHĽADNÁ
// PLANE 5 mm pred pôvodnou stenou → NEDÁ sa do nej „vyrezať" diera (odhalila by starú teplú
// stenu, #336 zavrhnutá alternatíva CSG). Preto zapustenie faktujeme DOPREDU: proud EXTRUDE
// RÁM (z=fasáda..+90 mm, plná obruba spojená s fasádou — žiadny plávajúci rám) a SKLO/krídlo
// posunuté DOZADU k lícu fasády → sklo je hlboko ZA čelom rámu → geometrická PARALAXA pri
// otáčaní (najsilnejší cue, funguje AJ na low tieri — je to geometria, nie tieň). Všetko je
// PRED fasádou (z ≥ 5) → nič neokludované, žiadna diera, žiadne odhalenie starej steny.
//
// Sklo je TMAVÉ odrazové (base biely + VERTEX-COLOR vertikálny gradient hore svetlejšie/dole
// tmavšie → faktuje odraz oblohy aj bez env; mid/high pridá reálny `scene.environment` odraz).
// Zrušené krížové delenie (dollhouse cue). Dvere tvar (c): drevené krídlo + presklený inlay +
// zvislá tyčová kľučka + bočnica zvislých lát.
//
// DISPOSAL: KAŽDÁ nová geometria do `disposables`. MATERIÁLY sú ZDIEĽANÉ (vytvorené raz v
// `scena-dom.ts`, tam do `disposables`) → tu sa NEpushujú (inak dvojitý dispose).
import { mm } from './jednotky';
import type { Disposable } from './scena';

type ThreeNS = typeof import('three');
type StdMat = InstanceType<ThreeNS['MeshStandardMaterial']>;
type Group = InstanceType<ThreeNS['Group']>;

/** Zdieľané materiály otvorov (vytvorené RAZ v `scena-dom.ts`, tam aj do `disposables`). */
export interface OtvorMaterialy {
	/** tmavé odrazové sklo — `vertexColors:true`, biely base (gradient nesie farbu) */
	sklo: StdMat;
	/** svetlý rám okna/dverí (proud EXTRUDE, jeho vnútorné steny = svetlé ostenie) */
	ram: StdMat;
	/** tmavý tieňový prúžok pod horným ostením (fake AO — hĺbka aj bez tieňov na low) */
	revealTien: StdMat;
	/** parapet / nadpražie (svetlý kameň) */
	parapet: StdMat;
	/** drevené krídlo dverí (mid/high: mapa; low: plochá farba) */
	drevo: StdMat;
	/** tyčová kľučka (brúsená oceľ) */
	ocel: StdMat;
	/** tmavé pozadie za latovou bočnicou (tiene medzier robia laty latami) */
	latPozadie: StdMat;
}

export interface OtvorCtx {
	THREE: ThreeNS;
	skupina: Group;
	disposables: Disposable[];
	tiene: boolean;
	mat: OtvorMaterialy;
	/** z-pozícia roviny fasády v mm (dom je pred pôvodnou stenou, fasáda na z=5) */
	fasadaZmm: number;
}

/** Vertikálny VERTEX-COLOR gradient na plane geometrii (dole `dolnaHex` → hore `hornaHex`).
 *  Materiál musí mať `vertexColors:true` + biely `color` (three násobí color×vertexColor, biely
 *  base necháva gradient niesť albedo). `THREE.Color` dáva LINEÁRNE `.r/.g/.b` (ColorManagement)
 *  — vertex colors sa čítajú lineárne, takže sedia bez ďalšej konverzie. */
function vertikalnyGradient(
	THREE: ThreeNS,
	geo: InstanceType<ThreeNS['PlaneGeometry']>,
	hornaHex: number,
	dolnaHex: number
): void {
	const pos = geo.attributes.position!; // PlaneGeometry má vždy position (three typing ho značí optional)
	const n = pos.count;
	let minY = Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < n; i++) {
		const y = pos.getY(i);
		if (y < minY) minY = y;
		if (y > maxY) maxY = y;
	}
	const rozsah = Math.max(1e-6, maxY - minY);
	const horna = new THREE.Color(hornaHex);
	const dolna = new THREE.Color(dolnaHex);
	const c = new THREE.Color();
	const farby = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		const t = (pos.getY(i) - minY) / rozsah; // 0 = dole, 1 = hore
		c.copy(dolna).lerp(horna, t);
		farby[i * 3] = c.r;
		farby[i * 3 + 1] = c.g;
		farby[i * 3 + 2] = c.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(farby, 3));
}

/** Proud EXTRUDE RÁM (plná obruba s dierou, z=0..hlbkaMm) — jedna geometria (nie 4 kvádre),
 *  spojená s fasádou (žiadny plávajúci rám). Vnútorné steny diery = svetlé ostenie. Rozmery mm.
 *  Vonkajší obrys CCW, diera CW. Volajúci ju umiestni z=fasáda (čelo na z=fasáda+hlbka). */
function ramExtrude(
	THREE: ThreeNS,
	vonkW: number,
	vonkH: number,
	vnutW: number,
	vnutH: number,
	hlbkaMm: number
): InstanceType<ThreeNS['ExtrudeGeometry']> {
	const wO = mm(vonkW) / 2;
	const hO = mm(vonkH) / 2;
	const wI = mm(vnutW) / 2;
	const hI = mm(vnutH) / 2;
	const shape = new THREE.Shape();
	shape.moveTo(-wO, -hO);
	shape.lineTo(wO, -hO);
	shape.lineTo(wO, hO);
	shape.lineTo(-wO, hO);
	shape.closePath();
	const diera = new THREE.Path();
	diera.moveTo(-wI, -hI);
	diera.lineTo(-wI, hI);
	diera.lineTo(wI, hI);
	diera.lineTo(wI, -hI);
	diera.closePath();
	shape.holes.push(diera);
	return new THREE.ExtrudeGeometry(shape, { depth: mm(hlbkaMm), bevelEnabled: false });
}

/** Interný: kváder so zdieľaným materiálom (mm rozmery/pozícia), do skupiny + disposables. */
function kvader(
	ctx: OtvorCtx,
	wMm: number,
	hMm: number,
	dMm: number,
	mat: StdMat,
	xMm: number,
	yMm: number,
	zMm: number
): void {
	const g = new ctx.THREE.BoxGeometry(mm(wMm), mm(hMm), mm(dMm));
	const mesh = new ctx.THREE.Mesh(g, mat);
	mesh.position.set(mm(xMm), mm(yMm), mm(zMm));
	mesh.receiveShadow = ctx.tiene;
	ctx.skupina.add(mesh);
	ctx.disposables.push(g);
}

/** Interný: proud extrude rám okolo otvoru (svetlý), umiestnený z=fasáda → čelo proud. */
function pridajRam(
	ctx: OtvorCtx,
	cxMm: number,
	cyMm: number,
	vonkW: number,
	vonkH: number,
	vnutW: number,
	vnutH: number,
	hlbkaMm: number
): void {
	const g = ramExtrude(ctx.THREE, vonkW, vonkH, vnutW, vnutH, hlbkaMm);
	const ram = new ctx.THREE.Mesh(g, ctx.mat.ram);
	ram.position.set(mm(cxMm), mm(cyMm), mm(ctx.fasadaZmm));
	ram.receiveShadow = ctx.tiene;
	ctx.skupina.add(ram);
	ctx.disposables.push(g);
}

/** ZAPUSTENÉ okno: proud rám (z=fasáda..+90) + tmavé odrazové SKLO posunuté dozadu k lícu
 *  fasády (hlboko za čelom rámu → paralaxa) + tmavý tieňový prúžok pod horným ostením + proud
 *  PARAPET. `cxMm`/`cyMm` = stred otvoru, `wMm`/`hMm` = svetlý otvor. Šírka NAJŠIRŠIEHO prvku
 *  (parapet = w+100) musí voláčovi vopred sadnúť do clampu. */
export function pridajOkno(
	ctx: OtvorCtx,
	cxMm: number,
	cyMm: number,
	wMm: number,
	hMm: number
): void {
	const { THREE, skupina, disposables, tiene, mat, fasadaZmm } = ctx;
	const ramHlbka = 90; // rám proud 90 mm (hĺbka ostenia)
	const zSklo = fasadaZmm + 12; // sklo tesne PRED fasádou (nie ZA — fasáda je nepriehľadná)

	// --- proud RÁM (svetlé ostenie = jeho vnútorné steny; čelo na z=fasáda+90) ---
	pridajRam(ctx, cxMm, cyMm, wMm + 70, hMm + 70, wMm - 20, hMm - 20, ramHlbka);

	// --- SKLO (zapustené za čelom rámu, tmavé odrazové + vertikálny gradient) ---
	const gSklo = new THREE.PlaneGeometry(mm(wMm - 16), mm(hMm - 16));
	vertikalnyGradient(THREE, gSklo, 0x4a5a63, 0x28313a); // hore svetlejšie (odraz oblohy), dole tmavšie
	const sklo = new THREE.Mesh(gSklo, mat.sklo);
	sklo.position.set(mm(cxMm), mm(cyMm), mm(zSklo));
	sklo.receiveShadow = tiene;
	skupina.add(sklo);
	disposables.push(gSklo);

	// --- tmavý tieňový prúžok pod horným ostením (fake AO — hĺbka aj bez cast tieňov na low) ---
	kvader(ctx, wMm - 20, 60, 6, mat.revealTien, cxMm, cyMm + hMm / 2 - 40, zSklo + 3);

	// --- PARAPET (proud rímsa pod oknom, svetlý kameň) ---
	kvader(ctx, wMm + 100, 60, 140, mat.parapet, cxMm, cyMm - hMm / 2 - 20, fasadaZmm + 55);
}

export interface DvereOpts {
	/** šírka drevené krídla (mm) — clampnuté voláčom */
	krideloWmm: number;
	/** výška krídla (mm) — clampnutá pod pripojenie pergoly */
	krideloHmm: number;
	/** dostupná polovica X (mm): |x| + w/2 každého prvku ≤ toto (kolízne clampy #325) */
	budgetHalfXmm: number;
	/** low tier (bez textúr) — drevo je plochá farba */
	flat: boolean;
}

/** DVERE tvar (c): proud rám + drevené krídlo centrované na x=0 (priechodné medzi nohami
 *  pergoly), zapustené za čelo rámu, + presklený zvislý inlay + zvislá tyčová kľučka + bočnica
 *  zvislých lát (ak sa zmestí do budgetu). Krídlo STOJÍ na zemi (spodok y=0). */
export function pridajDvere(ctx: OtvorCtx, opts: DvereOpts): void {
	const { THREE, skupina, disposables, tiene, mat, fasadaZmm } = ctx;
	const W = opts.krideloWmm;
	const H = opts.krideloHmm;
	const ramHlbka = 100; // rám dverí proud 100 mm
	const zKridlo = fasadaZmm + 22; // krídlo tesne pred fasádou, hlboko za čelom rámu (paralaxa)
	const cy = H / 2; // stred krídla (spodok na y=0)
	const licoKridla = zKridlo + 28; // predné líce krídla (box hrúbka 55)

	// --- proud RÁM dverí (svetlé ostenie) ---
	pridajRam(ctx, 0, cy, W + 70, H + 60, W - 12, H - 6, ramHlbka);

	// --- DREVENÉ KRÍDLO (centrované na x=0, spodok na y=0, zapustené za čelo rámu) ---
	const gKridlo = new THREE.BoxGeometry(mm(W), mm(H), mm(55));
	const kridlo = new THREE.Mesh(gKridlo, mat.drevo);
	kridlo.position.set(0, mm(cy), mm(zKridlo));
	kridlo.receiveShadow = tiene;
	skupina.add(kridlo);
	disposables.push(gKridlo);

	// --- PRESKLENÝ ZVISLÝ INLAY (zväzuje dvere s oknami, rozbíja siluetu „dosky") ---
	const inlayW = Math.min(120, Math.round(W * 0.16));
	const inlayH = Math.round(H * 0.66);
	const gInlay = new THREE.PlaneGeometry(mm(inlayW), mm(inlayH));
	vertikalnyGradient(THREE, gInlay, 0x4a5a63, 0x28313a);
	const inlay = new THREE.Mesh(gInlay, mat.sklo);
	inlay.position.set(mm(W * 0.24), mm(cy), mm(licoKridla + 1)); // tesne pred lícom krídla
	inlay.receiveShadow = tiene;
	skupina.add(inlay);
	disposables.push(gInlay);

	// --- ZVISLÁ TYČOVÁ KĽUČKA (Ø40 mm, ~min(1200, 0,6·H), brúsená oceľ) ---
	const kluckaH = Math.min(1200, Math.round(H * 0.6));
	kvader(ctx, 42, kluckaH, 42, mat.ocel, W / 2 - 80, cy, licoKridla + 6);

	// --- BOČNICA ZVISLÝCH LÁT (SalesQueze cue) — LEN ak sa zmestí do budgetu ---
	const latW = 44; // šírka laty
	const rozstup = 88; // rozstup lát
	const pocetLat = 5;
	const bocnicaW = (pocetLat - 1) * rozstup + latW; // ~396 mm panel
	const medzera = 120;
	const bocnicaVonkajsiaX = W / 2 + medzera + bocnicaW; // najľavejší okraj bočnice
	if (bocnicaVonkajsiaX <= opts.budgetHalfXmm) {
		const bocnicaStredX = -(W / 2 + medzera + bocnicaW / 2);
		const bocnicaH = Math.round(H * 0.92);
		const bcy = bocnicaH / 2;
		// tmavé pozadie (tiene medzier robia laty latami)
		kvader(ctx, bocnicaW, bocnicaH, 20, mat.latPozadie, bocnicaStredX, bcy, fasadaZmm + 10);
		// zvislé laty (proud), zdieľaný drevený materiál
		const lavyOkraj = bocnicaStredX - bocnicaW / 2 + latW / 2;
		for (let i = 0; i < pocetLat; i++) {
			kvader(ctx, latW, bocnicaH, 30, mat.drevo, lavyOkraj + i * rozstup, bcy, fasadaZmm + 28);
		}
	}
}
