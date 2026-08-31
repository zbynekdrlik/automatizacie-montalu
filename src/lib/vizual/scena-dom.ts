// #333 — „profi" dom + okolie ako SalesQueze (koniec „detskej hračky"). Extrahované zo
// `scena.ts` (blížil sa 1000-r. stropu, large-file-split.md) — čisté FACTORY funkcie
// (vstup → THREE objekt), životný cyklus (add/dispose) drží `Vizual3D.svelte`. Volané LEN
// pri `zobrazDom` (pergola konfigurátor) — zasklenia scéna sa ich NIKDY nedotkne.
//
// Dom = SVETLÁ 2-podlažná fasáda (prekrytie pred pôvodnou stenou) + sedlová plechová
// strecha (standing-seam) so štítmi a presahom + pravidelný raster okien s tónovaným sklom
// + drevené dvere + sokel. Okolie = trávnik + dlažbová terasa pod pergolou + odsaturované
// stromy. Paleta svetlá/odsaturovaná — pergola (RAL zákazníka) je jediný sýty prvok.
//
// Disposal: KAŽDÁ geometria/materiál/textúra ide do `disposables` (Vizual3D ich pri každom
// `{#key}` remounte / unmount uvoľní — inak by unikol celý dom per zmena rozmeru).
import { mm } from './jednotky';
import {
	vytvorDlazbuTexturu,
	vytvorTerasaAlphaTexturu,
	vytvorStrechaTexturu,
	vytvorTravnikTexturu,
	vytvorDreveneDrevoTexturu,
	vytvorOmietkaTexturu
} from './textury';
import { pridajOkno, pridajDvere, type OtvorMaterialy } from './scena-dom-otvory';
import type { TierNastavenia } from './kvalita';
import type { Disposable } from './scena';

type ThreeNS = typeof import('three');
type StdMat = InstanceType<ThreeNS['MeshStandardMaterial']>;

export interface DomPrvky {
	skupina: InstanceType<ThreeNS['Group']>;
	disposables: Disposable[];
}

// Svetlá odsaturovaná paleta (SalesQueze) — biela/svetlošedá fasáda, antracit strecha.
const FARBA_FASADA = 0xe2ddd4; // svetlá omietka (odsaturovaná, nech pergola vynikne)
const FARBA_STRECHA = 0x3a3f45; // antracit plech (low-tier flat, inak seam textúra)
const FARBA_SOKEL = 0x6f6b64; // #336: tmavší sokel (uzemní fasádu proti terase — CE domy ho vždy majú)
const FARBA_KMEN = 0xa59e90; // bledy sedohnedy kmen
const FARBA_KORUNA = 0xd7dbd2; // bleda sedozelena koruna (SalesQueze near-white, nesutazi s produktom)

// #336 — paleta ZAPUSTENÝCH otvorov (SalesQueze realizmus). Sklo je TMAVÉ — vertex gradient
// (biely base × gradient nesie albedo) + env odraz nesú vzhľad; svetlá base by čítala ako
// plochá pastelová modrá (root cause „lego"). Rám svetlý (jeho vnútorné steny = svetlé ostenie).
const FARBA_OKNO_RAM = 0xeceae4; // svetlý rám okna/dverí (proud extrude)
const FARBA_REVEAL_TIEN = 0x565a5e; // tmavý tieňový prúžok pod horným ostením (fake AO)
const FARBA_PARAPET = 0xcfcabf; // parapet/nadpražie (svetlý kameň)
const FARBA_DREVO = 0x6e5844; // teplé odsaturované drevo dverí (low-tier flat = mapa base)
const FARBA_OCEL = 0x9a9c9e; // brúsená oceľ kľučky
const FARBA_LAT_POZADIE = 0x2b2b28; // tmavé pozadie za latami (tiene medzier)

// #336: z-pozícia roviny fasády (mm), 5 mm PRED pôvodnou stenou. Správnosť celého zapustenia
// otvorov závisí od zhody tejto hodnoty na fasáde AJ v `otvorCtx.fasadaZmm` → jeden zdroj pravdy.
const FASADA_Z_MM = 5;

/** Dvojpodlažná fasáda + sedlová plechová strecha + raster okien + drevené dvere + sokel,
 *  umiestnené PRED pôvodnou (teplou) stenou tak, že ju svetlé prekrytie zakryje. Dvere sú
 *  CENTROVANÉ na x=0 (medzi krajnými stĺpmi pergoly ±S/2 → priechodné, nikdy za nohou).
 *  Čistá box/shape geometria + procedurálne textúry (žiadny externý asset). */
export function vytvorDom(
	THREE: ThreeNS,
	nastavenia: TierNastavenia,
	bboxSirkaMm: number,
	bboxVyskaMm?: number
): DomPrvky {
	const S = Math.max(1, bboxSirkaMm);
	const SV = bboxVyskaMm && bboxVyskaMm > 0 ? bboxVyskaMm : 2800;
	// výška prízemnej fasády = zhodná s `vytvorStenu` (sDverami=false): max(2800, SV+600)
	const PRIZEMIE_H = Math.max(2800, Math.round(SV) + 600);
	const POSCHODIE_H = 2600; // druhé podlažie
	const CELKOVA_H = PRIZEMIE_H + POSCHODIE_H;
	const FASADA_W = S + 600; // 300 mm presah po stranách nad šírku pergoly (ako stena)

	const flat = nastavenia.plochyGradientMiestoMap; // low tier: bez textúr
	const tiene = nastavenia.tiene;

	const skupina = new THREE.Group();
	const disposables: Disposable[] = [];

	// Box helper (rozmery/pozícia v mm; `mm()` → metre). Vlastná geometria + materiál,
	// oba vždy do disposables. `cast` len tam, kde to má zmysel (strecha/stromy — perf).
	const box = (
		wMm: number,
		hMm: number,
		dMm: number,
		farba: number,
		roughness: number,
		metalness: number,
		xMm: number,
		yMm: number,
		zMm: number,
		cast = false
	): void => {
		const g = new THREE.BoxGeometry(mm(wMm), mm(hMm), mm(dMm));
		const m = new THREE.MeshStandardMaterial({ color: farba, roughness, metalness });
		const mesh = new THREE.Mesh(g, m);
		mesh.position.set(mm(xMm), mm(yMm), mm(zMm));
		mesh.receiveShadow = tiene;
		mesh.castShadow = cast && tiene;
		skupina.add(mesh);
		disposables.push(g, m);
	};

	// --- SVETLÁ FASÁDA ako PLANE (nie box → žiadny BOČNÝ z-fight so soklom/oknami rovnakej
	//     šírky), tesne (5 mm) PRED pôvodnou (teplou) stenou, celé 2 podlažia (orbit je predný,
	//     zadnú stranu nikdy nevidno → FrontSide stačí). ---
	const gFasada = new THREE.PlaneGeometry(mm(FASADA_W), mm(CELKOVA_H));
	// #336: jemná procedurálna OMIETKA (mid/high) proti plochosti; low tier = plochá farba.
	let mFasada: StdMat;
	if (flat) {
		mFasada = new THREE.MeshStandardMaterial({
			color: FARBA_FASADA,
			roughness: 0.95,
			metalness: 0
		});
	} else {
		const omietka = vytvorOmietkaTexturu(THREE);
		omietka.wrapS = omietka.wrapT = THREE.RepeatWrapping;
		omietka.repeat.set(mm(FASADA_W) / 1.5, mm(CELKOVA_H) / 1.5); // ~1 dlaždica omietky / 1,5 m
		mFasada = new THREE.MeshStandardMaterial({ map: omietka, roughness: 0.95, metalness: 0 });
		disposables.push(omietka);
	}
	const fasada = new THREE.Mesh(gFasada, mFasada);
	fasada.position.set(0, mm(CELKOVA_H / 2), mm(FASADA_Z_MM));
	fasada.receiveShadow = tiene;
	skupina.add(fasada);
	disposables.push(gFasada, mFasada);

	// --- SEDLOVÁ PLECHOVÁ STRECHA (standing-seam) so štítmi a presahom ---
	const alfa = (20 * Math.PI) / 180; // sklon strechy
	const Dr = 2600; // pôdorysná hĺbka strechy (Z), hrebeň v strede
	const rise = Math.tan(alfa) * (Dr / 2);
	const zRidge = -200; // hrebeň mierne ZA fasádou → predný presah nezakrýva sklo pergoly
	const ROOF_PRESAH_BOK = 400;
	const Wr = FASADA_W + 2 * ROOF_PRESAH_BOK;
	const slopeLen = Dr / 2 / Math.cos(alfa) + 200; // +200 mm presah/prekrytie cez hrebeň

	// zdieľaný materiál strechy (obidva sklony) — jedna textúra + jeden materiál
	let strechaMat: InstanceType<ThreeNS['MeshStandardMaterial']>;
	if (flat) {
		strechaMat = new THREE.MeshStandardMaterial({
			color: FARBA_STRECHA,
			roughness: 0.55,
			metalness: 0.35
		});
	} else {
		const tex = vytvorStrechaTexturu(THREE);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(mm(Wr) / 3.2, 1); // ~1 falc / 400 mm; švy bežia DOLE po sklone
		strechaMat = new THREE.MeshStandardMaterial({
			map: tex,
			roughness: 0.5,
			metalness: 0.35
		});
		disposables.push(tex);
	}
	disposables.push(strechaMat);

	const sklon = (znamienko: 1 | -1): void => {
		const g = new THREE.BoxGeometry(mm(Wr), mm(90), mm(slopeLen));
		g.rotateX(znamienko * alfa); // +Z okraj dole pri +alfa (predný sklon)
		const mesh = new THREE.Mesh(g, strechaMat);
		mesh.position.set(0, mm(CELKOVA_H + rise / 2), mm(zRidge + znamienko * (Dr / 4)));
		// castShadow VYPNUTÝ: shadow frustum je dimenzovaný na bbox produktu (~2–4 m), 6 m
		// strecha by mala orezaný tieň na trávniku (review 🔵 #3). Produkt (pergola) tieň drží.
		mesh.castShadow = false;
		mesh.receiveShadow = tiene;
		skupina.add(mesh);
		disposables.push(g);
	};
	sklon(1); // predný sklon (k pozorovateľovi)
	sklon(-1); // zadný sklon

	// štítové trojuholníky (inak by strecha bola „prázdna" od kraja) — svetlá omietka,
	// na oboch fasádnych hranách x=±FASADA_W/2. Shape v (z,y) → rotateY(−90°) do YZ.
	const stitMat = new THREE.MeshStandardMaterial({
		color: FARBA_FASADA,
		roughness: 0.95,
		metalness: 0,
		side: THREE.DoubleSide
	});
	disposables.push(stitMat);
	for (const znak of [1, -1] as const) {
		const shape = new THREE.Shape();
		shape.moveTo(mm(zRidge - Dr / 2), mm(CELKOVA_H));
		shape.lineTo(mm(zRidge + Dr / 2), mm(CELKOVA_H));
		shape.lineTo(mm(zRidge), mm(CELKOVA_H + rise));
		shape.closePath();
		const g = new THREE.ShapeGeometry(shape);
		g.rotateY(-Math.PI / 2); // shape-x (=z súradnica) → svetová Z
		const mesh = new THREE.Mesh(g, stitMat);
		mesh.position.set(znak * mm(FASADA_W / 2), 0, 0);
		mesh.receiveShadow = tiene;
		skupina.add(mesh);
		disposables.push(g);
	}

	// #336 — ZDIEĽANÉ materiály otvorov (vytvorené RAZ, každý do disposables; per-otvor sa
	// zdieľajú → málo state changes). Sklo: biely base + vertexColors (gradient nesie albedo);
	// mid/high `scene.environment` pridá reálny odraz, low tier ukáže gradient (nie „čierna diera").
	// Drevo: mid/high procedurálna kresba, low plochá farba.
	const skloMat = new THREE.MeshStandardMaterial({
		color: 0xffffff, // biely base — vertex gradient nesie albedo (tmavé sklo)
		vertexColors: true,
		roughness: 0.08,
		metalness: 0,
		envMapIntensity: 1.7
	});
	disposables.push(skloMat);
	let drevoMat: StdMat;
	if (flat) {
		drevoMat = new THREE.MeshStandardMaterial({
			color: FARBA_DREVO,
			roughness: 0.62,
			metalness: 0
		});
	} else {
		const drevoTex = vytvorDreveneDrevoTexturu(THREE);
		drevoTex.wrapS = drevoTex.wrapT = THREE.RepeatWrapping;
		drevoMat = new THREE.MeshStandardMaterial({ map: drevoTex, roughness: 0.62, metalness: 0 });
		disposables.push(drevoTex);
	}
	disposables.push(drevoMat);
	const otvorMat: OtvorMaterialy = {
		sklo: skloMat,
		ram: new THREE.MeshStandardMaterial({ color: FARBA_OKNO_RAM, roughness: 0.6, metalness: 0 }),
		revealTien: new THREE.MeshStandardMaterial({
			color: FARBA_REVEAL_TIEN,
			roughness: 0.95,
			metalness: 0
		}),
		parapet: new THREE.MeshStandardMaterial({
			color: FARBA_PARAPET,
			roughness: 0.85,
			metalness: 0
		}),
		drevo: drevoMat,
		ocel: new THREE.MeshStandardMaterial({ color: FARBA_OCEL, roughness: 0.35, metalness: 0.9 }),
		latPozadie: new THREE.MeshStandardMaterial({
			color: FARBA_LAT_POZADIE,
			roughness: 0.9,
			metalness: 0
		})
	};
	disposables.push(
		otvorMat.ram,
		otvorMat.revealTien,
		otvorMat.parapet,
		otvorMat.ocel,
		otvorMat.latPozadie
	);
	const otvorCtx = { THREE, skupina, disposables, tiene, mat: otvorMat, fasadaZmm: FASADA_Z_MM };

	// Kolízne clampy (#325 zachované): PRÍZEMNÉ prvky (dvere + ich latová bočnica + pravé prízemné
	// okno) sú v priestore PERGOLY → MUSIA ostať pod pripojením pergoly (stropPrvkov) a v |x| ≤
	// budgetHalfXmm (vnútri krajných stĺpov ±(S/2−50)). POSCHODOVÉ okná sú NAD pergolou (bez clampu).
	const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
	const stlpX = S / 2;
	const stropPrvkov = Math.max(1500, Math.round(SV) - 300); // pod bočný nosník pergoly
	const budgetHalfXmm = stlpX - 55; // 5 mm rezerva pod kolíznu hranicu (S/2 − 50) testu

	// --- DVERE (tvar c): drevené krídlo + presklený inlay + kľučka + latová bočnica (vľavo) ---
	const dvereW = clamp(Math.round(0.22 * S), 760, 1000);
	const dvereH = Math.min(2100, stropPrvkov - 100);
	pridajDvere(otvorCtx, { krideloWmm: dvereW, krideloHmm: dvereH, budgetHalfXmm, flat });

	// --- POSCHODOVÉ okná (nad pergolou, bez kolízie s pergolou): stredné VŽDY + 2 bočné LEN keď
	//     sa zmestia BEZ prekrytia (review 🟡 #336: susedné zapustené zostavy sa pri úzkej pergole
	//     prenikali — proud rám bočného okna renderoval na sklo stredného). Min rozstup stredov =
	//     oknoHornaW+100 (šírka parapetu), max |x| = fasáda − (okno/2+140) aby okno sadlo na fasádu. ---
	const oknoHornaW = 820;
	const oknoHornaH = 1150;
	const minRozstup = oknoHornaW + 100; // susedné okná sa neprekrývajú (parapet = w+100)
	const maxHornaX = FASADA_W / 2 - (oknoHornaW / 2 + 140);
	const yPoschodie = PRIZEMIE_H + POSCHODIE_H * 0.5;
	pridajOkno(otvorCtx, 0, yPoschodie, oknoHornaW, oknoHornaH); // stredné okno vždy
	if (maxHornaX >= minRozstup) {
		const oknoHornaX = Math.max(minRozstup, Math.min(S * 0.32, maxHornaX));
		pridajOkno(otvorCtx, -oknoHornaX, yPoschodie, oknoHornaW, oknoHornaH);
		pridajOkno(otvorCtx, oknoHornaX, yPoschodie, oknoHornaW, oknoHornaH);
	}

	// --- PRAVÉ PRÍZEMNÉ okno (asymetria ako SalesQueze: vstup + latová bočnica vľavo, okno
	//     vpravo). Vynechané ak sa medzera nezmestí (malá pergola → NIKDY nekoliduje). ---
	const oknoLo = dvereW / 2 + 120; // pravý okraj rámu dverí + rezerva
	const oknoHi = budgetHalfXmm; // pravý okraj parapetu ≤ toto → pod kolíznu hranicu
	const oknoDolnaHMax = Math.min(1050, stropPrvkov - 960);
	const oknoDolnaW = Math.min(760, Math.round((oknoHi - oknoLo) * 0.7) - 100); // −100 = presah parapetu
	if (oknoDolnaW >= 360 && oknoDolnaHMax >= 500) {
		const parapetHalf = (oknoDolnaW + 100) / 2;
		const oknoDolnaX = clamp((oknoLo + oknoHi) / 2, oknoLo + parapetHalf, oknoHi - parapetHalf);
		const cy = 900 + oknoDolnaHMax / 2; // parapet 900 mm
		pridajOkno(otvorCtx, oknoDolnaX, cy, oknoDolnaW, oknoDolnaHMax);
	}

	// --- SOKEL (tmavší pás pri zemi, uzemní fasádu proti terase) ---
	box(FASADA_W, 340, 70, FARBA_SOKEL, 0.9, 0, 0, 170, 60);

	return { skupina, disposables };
}

/** Okolie SalesQueze: veľký TRÁVNIK (základná zem) + dlažbová TERASA pod pergolou + 2–4
 *  odsaturované low-poly stromy v pozadí. Nahrádza `vytvorZem` LEN pri `zobrazDom` (pergola);
 *  zasklenia scéna ďalej používa `vytvorZem` (jedna dlažba). Kontaktný tieň (y=+2 mm) sa
 *  kreslí zvlášť. */
export function vytvorOkolie(
	THREE: ThreeNS,
	nastavenia: TierNastavenia,
	bboxSirkaMm: number,
	bboxHlbkaMm: number
): DomPrvky {
	const flat = nastavenia.plochyGradientMiestoMap;
	const tiene = nastavenia.tiene;
	const skupina = new THREE.Group();
	const disposables: Disposable[] = [];

	// --- TRAVNIK — VELKA rovina (zaklad zeme), y=0. 130 m: okraj presiahne oblohovu gulu
	//     (r=60) -> hrana sa stretne s oblohou nad horizontom a je NEVIDITELNA (owner: ziadna
	//     tvrda hrana koseho stvorca v zabere). ---
	const TRAVNIK_M = 130;
	const gTravnik = new THREE.PlaneGeometry(TRAVNIK_M, TRAVNIK_M);
	gTravnik.rotateX(-Math.PI / 2);
	let travnikMat: InstanceType<ThreeNS['MeshStandardMaterial']>;
	if (flat) {
		travnikMat = new THREE.MeshStandardMaterial({ color: 0xc6cabd, roughness: 0.95, metalness: 0 }); // parita s trávnik textúrou base
	} else {
		const tex = vytvorTravnikTexturu(THREE);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(TRAVNIK_M / 1.2, TRAVNIK_M / 1.2); // 1 dlaždica ~1,2 m
		travnikMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
		disposables.push(tex);
	}
	const travnik = new THREE.Mesh(gTravnik, travnikMat);
	travnik.receiveShadow = tiene;
	skupina.add(travnik);
	disposables.push(gTravnik, travnikMat);

	// --- DLAŽBOVÁ TERASA pod pergolou (+ okraj), y=+1 mm nad trávnikom ---
	// +4000 (2 m každá strana): footprint pergoly zaberá vnútro terasy tak, že OKRAJOVÝ 10%
	// fade alphaMapy (review 🔴) sa nikdy nedotkne krajných stĺpov — tie stoja na plnej dlažbe.
	const terW = mm(Math.max(1, bboxSirkaMm) + 4000);
	const terD = mm(Math.max(1, bboxHlbkaMm) + 4000);
	const gTerasa = new THREE.PlaneGeometry(terW, terD);
	gTerasa.rotateX(-Math.PI / 2);
	// #333 polish: radialny ALPHA fade na okraji terasy -> mäkke zmiznutie do travnika (owner:
	// ziadna tvrda hrana). `map` (dlazba) ma vlastny repeat, `alphaMap` (1x1) fade cez celu plochu.
	const terasaAlpha = vytvorTerasaAlphaTexturu(THREE);
	disposables.push(terasaAlpha);
	let terasaMat: InstanceType<ThreeNS['MeshStandardMaterial']>;
	if (flat) {
		terasaMat = new THREE.MeshStandardMaterial({
			color: 0xa7a199, // parita s dlažbovou textúrou (base #a7a199) — sivá dlažba je už odsaturovaná
			roughness: 0.85,
			metalness: 0,
			alphaMap: terasaAlpha,
			transparent: true,
			depthWrite: false
		});
	} else {
		const tex = vytvorDlazbuTexturu(THREE);
		tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
		tex.repeat.set(terW / 0.6, terD / 0.6); // 1 dlaždica = 600 mm (mierkový kľúč scény)
		terasaMat = new THREE.MeshStandardMaterial({
			map: tex,
			roughness: 0.85,
			metalness: 0,
			alphaMap: terasaAlpha,
			transparent: true,
			depthWrite: false
		});
		disposables.push(tex);
	}
	const terasa = new THREE.Mesh(gTerasa, terasaMat);
	terasa.position.y = mm(1);
	terasa.receiveShadow = tiene;
	// #333 review 🔵: explicitné poradie v transparentnom priechode — terasa PRED kontaktným
	// tieňom (scena-build tien.renderOrder=1), aby jadro terasy nikdy nevymazalo tieň.
	terasa.renderOrder = 0;
	skupina.add(terasa);
	disposables.push(gTerasa, terasaMat);

	// --- STROMY (2–4 odsaturované low-poly) v pozadí, po stranách domu ---
	const S = Math.max(1, bboxSirkaMm);
	const D = Math.max(1, bboxHlbkaMm);
	const strom = (xMm: number, zMm: number, vyskaMm: number): void => {
		// STIHLY kmen (listnata proporcia), bledy sedohnedy
		const kmenH = vyskaMm * 0.4;
		const gKmen = new THREE.CylinderGeometry(mm(45), mm(60), mm(kmenH), 6);
		const mKmen = new THREE.MeshStandardMaterial({
			color: FARBA_KMEN,
			roughness: 0.9,
			metalness: 0
		});
		const kmen = new THREE.Mesh(gKmen, mKmen);
		kmen.position.set(mm(xMm), mm(kmenH / 2), mm(zMm));
		kmen.castShadow = false; // mimo shadow frustumu produktu (orezaný tieň) — review 🔵 #3
		kmen.receiveShadow = tiene;
		skupina.add(kmen);
		disposables.push(gKmen, mKmen);

		// LISTNATA koruna = elipsoid/blob (nie vianocny kuzel) — bleda sedozelena, low-poly
		const korunaR = vyskaMm * 0.34;
		const gKoruna = new THREE.SphereGeometry(mm(korunaR), 8, 6);
		gKoruna.scale(1, 1.12, 1); // jemne vajcovita silueta
		const mKoruna = new THREE.MeshStandardMaterial({
			color: FARBA_KORUNA,
			roughness: 0.95,
			metalness: 0
		});
		const koruna = new THREE.Mesh(gKoruna, mKoruna);
		koruna.position.set(mm(xMm), mm(kmenH + korunaR * 0.82), mm(zMm));
		koruna.castShadow = false; // mimo shadow frustumu produktu (orezaný tieň)
		koruna.receiveShadow = tiene;
		skupina.add(koruna);
		disposables.push(gKoruna, mKoruna);
	};
	strom(-(S / 2 + 1800), -(D / 2 + 300), 4200);
	strom(S / 2 + 1600, -(D / 2 + 900), 3600);
	strom(-(S / 2 + 2600), 700, 3200);

	return { skupina, disposables };
}
