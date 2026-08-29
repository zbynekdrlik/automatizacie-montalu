// AR náhľad pergoly (#286) — serverový GLB endpoint. `GET /konfigurator/model.glb?…`
// zostaví binárny glTF konfigurácie zákazníka a servuje ho ako `model/gltf-binary`.
// `<model-viewer src>` naň mieri reálnou http URL → funguje so VŠETKÝMI AR režimami
// (WebXR / Scene Viewer / Quick Look). Klientsky blob by pre Scene Viewer (Android
// intent do externej appky) NEfungoval — dôvod pre serverový endpoint (viď dizajn #286).
//
// Money-neutrálny (verejná route): vstup sú LEN rozmery + typ skla (`cire/dymove/…`,
// vizuálny kľúč, nie katalóg) + RAL kód; výstup je čistá geometria + materiály, žiadny
// text/Money kód/cena/nárez. NEimportuje `sklo-strecha`/`sklo-cena`/`money`/`narez`
// (guard: tests/konfigurator-money-safety.test.ts (B)).
//
// GLTFExporter beží v Node — potrebuje `FileReader` polyfill (viď
// `$lib/server/filereader-polyfill.ts`). `three`, `mergeGeometries` aj `GLTFExporter`
// sa načítavajú DYNAMICKY (nie statický import) — (a) three sa tak nenačíta pri štarte
// servera, len pri prvej AR požiadavke (endpoint je zriedkavý oproti zvyšku appky),
// (b) drží to disciplínu „three je mimo vizual/ vždy lazy" (guard:
// tests/vizual-money-guard.test.ts — statický `three` mimo vizual/ je zakázaný).
import type { RequestHandler } from './$types';
import { pergolaSpec, type PergolaModel } from '$lib/vizual/geo/pergola';
import {
	pergolaSkloVzhlad,
	PERGOLA_SKLA_NAZVY,
	PERGOLA_TYP_SKLA_DEFAULT,
	type PergolaTypSkla
} from '$lib/vizual/pergola-sklo';
import { postavGlbScenu, exportGlb, uvolniGlbScenu } from '$lib/vizual/glb';
import { ensureFileReaderPolyfill } from '$lib/server/filereader-polyfill';
import { allowRequest, KONF_WINDOW_MS } from '$lib/server/public-throttle';
import { resolveClientIp } from '$lib/server/client-ip';
import {
	KONF_SIRKA_MIN,
	KONF_SIRKA_MAX,
	KONF_HLBKA_MIN,
	KONF_HLBKA_MAX,
	KONF_VYSKA_MIN,
	KONF_VYSKA_MAX,
	KONF_VYSKA_STENA_MAX
} from '$lib/konfigurator';

/** Číslo z query param (akceptuje desatinnú čiarku), alebo NaN. */
function qcislo(v: string | null): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.trim()
	);
}

/** Overí, či je hodnota v [min, max] a konečná. */
function vRozmedzi(x: number, min: number, max: number): boolean {
	return Number.isFinite(x) && x >= min && x <= max;
}

const PLATNE_SKLO = new Set<string>(Object.keys(PERGOLA_SKLA_NAZVY));

// Lazy singleton: three + mergeGeometries + GLTFExporter sa načítajú až pri prvej AR
// požiadavke (Node module cache → ďalšie požiadavky sú cache hit). Dynamický import
// zámerne (nie statický) — viď hlavičkový komentár.
type ThreeModuly = {
	THREE: typeof import('three');
	mergeGeometries: (typeof import('three/examples/jsm/utils/BufferGeometryUtils.js'))['mergeGeometries'];
	GLTFExporter: (typeof import('three/examples/jsm/exporters/GLTFExporter.js'))['GLTFExporter'];
};
let threeModuly: ThreeModuly | null = null;
async function nacitajThree(): Promise<ThreeModuly> {
	if (!threeModuly) {
		const [three, bgu, gltf] = await Promise.all([
			import('three'),
			import('three/examples/jsm/utils/BufferGeometryUtils.js'),
			import('three/examples/jsm/exporters/GLTFExporter.js')
		]);
		threeModuly = {
			THREE: three,
			mergeGeometries: bgu.mergeGeometries,
			GLTFExporter: gltf.GLTFExporter
		};
	}
	return threeModuly;
}

export const GET: RequestHandler = async ({ url, getClientAddress, request, setHeaders }) => {
	// per-IP rate-limit (rovnaká politika ako /konfigurator ?/vypocet)
	let edgeIp: string | undefined;
	try {
		edgeIp = getClientAddress();
	} catch {
		edgeIp = undefined;
	}
	const ip = resolveClientIp(edgeIp, request.headers.get('cf-connecting-ip'));
	if (!allowRequest(ip)) {
		return new Response('Priveľa požiadaviek.', {
			status: 429,
			headers: { 'retry-after': String(Math.ceil(KONF_WINDOW_MS / 1000)) }
		});
	}

	const q = url.searchParams;
	const sirka = qcislo(q.get('sirka'));
	const hlbka = qcislo(q.get('hlbka'));
	const vyskaVpredu = qcislo(q.get('vyskaVpredu'));
	const vyskaPriStene = qcislo(q.get('vyskaPriStene'));

	if (
		!vRozmedzi(sirka, KONF_SIRKA_MIN, KONF_SIRKA_MAX) ||
		!vRozmedzi(hlbka, KONF_HLBKA_MIN, KONF_HLBKA_MAX) ||
		!vRozmedzi(vyskaVpredu, KONF_VYSKA_MIN, KONF_VYSKA_MAX) ||
		// výška pri stene: nikdy nižšia než vpredu, nikdy nad konštrukčné max enginu
		!vRozmedzi(vyskaPriStene, vyskaVpredu, KONF_VYSKA_STENA_MAX)
	) {
		return new Response('Neplatné rozmery.', { status: 400 });
	}

	const skloParam = String(q.get('sklo') ?? '');
	const typSkla: PergolaTypSkla = PLATNE_SKLO.has(skloParam)
		? (skloParam as PergolaTypSkla)
		: PERGOLA_TYP_SKLA_DEFAULT;
	// RAL kód: `farbaKonstrukcie` (vo vnútri postavGlbScenu) gracefully padne na
	// neutrálnu šeď pri neznámom kóde → nemusíme tvrdo odmietať
	const ralKod = String(q.get('farba') ?? '').trim();
	// #329 časť 2: model → hrúbky profilov aj v AR GLB (inak by AR vždy ukázal ROBUST-škálu, kým 3D
	// náhľad LIGHT/MASSIVE škáluje → nekonzistencia). Neznámy/chýbajúci → undefined (škála 1.0).
	const modelParam = String(q.get('model') ?? '').trim();
	const model: PergolaModel | undefined =
		modelParam === 'LIGHT' || modelParam === 'ROBUST' || modelParam === 'MASSIVE'
			? modelParam
			: undefined;

	const vysledok = pergolaSpec({
		sirkaMm: sirka,
		hlbkaMm: hlbka,
		vyskaVpreduMm: vyskaVpredu,
		vyskaPriSteneMm: vyskaPriStene,
		typStrechy: 'pultova',
		ralKod,
		model
	});

	const { THREE, mergeGeometries, GLTFExporter } = await nacitajThree();
	ensureFileReaderPolyfill();
	const glbScena = postavGlbScenu(
		vysledok,
		ralKod,
		pergolaSkloVzhlad(typSkla),
		THREE,
		mergeGeometries
	);
	let glb: ArrayBuffer;
	try {
		glb = await exportGlb(glbScena.scene, GLTFExporter);
	} finally {
		uvolniGlbScenu(glbScena);
	}

	setHeaders({
		'content-type': 'model/gltf-binary',
		'content-disposition': 'inline; filename="pergola.glb"',
		// nemenné pre danú konfiguráciu → cache (verejná, bez cien/kódov)
		'cache-control': 'public, max-age=3600'
	});
	return new Response(new Uint8Array(glb));
};
