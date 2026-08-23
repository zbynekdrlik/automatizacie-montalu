// AR náhľad pergoly (#286) — `FileReader` polyfill pre Node (SSR / serverový GLB
// endpoint). `THREE.GLTFExporter` binárna vetva (`writeAsync`) číta výsledný `Blob`
// cez `new FileReader().readAsArrayBuffer(blob)`. `Blob` je v Node globálny, ale
// `FileReader` NIE — bez polyfillu padá GLTFExporter na `FileReader is not defined`
// (overené naživo). Polyfill je minimálny: prekladá na `blob.arrayBuffer()`
// (natívne v Node). V PREHLIADAČI sa nepoužije — `ensureFileReaderPolyfill` je
// no-op, keď `globalThis.FileReader` už existuje. Server-only ($lib/server/) —
// nikdy sa nebundluje do klienta.

type FileReaderLike = {
	result: ArrayBuffer | string | null;
	error: unknown;
	onloadend: (() => void) | null;
	onerror: ((err: unknown) => void) | null;
	readAsArrayBuffer(blob: Blob): void;
	readAsDataURL(blob: Blob): void;
};

/** Idempotentne zaručí `globalThis.FileReader` (potrebné pre GLTFExporter v Node).
 *  No-op, ak už existuje (prehliadač / opakované volanie).
 *
 *  Zámerné zjednodušenie oproti reálnemu `FileReader`: `onloadend` sa volá LEN pri úspechu
 *  a `onerror` LEN pri chybe (reálny FileReader volá `loadend` v OBOCH prípadoch). Pre
 *  GLTFExporter to stačí — číta `reader.result` výhradne vo vnútri `onloadend` na úspešnej
 *  ceste (`three/examples/jsm/exporters/GLTFExporter.js`, `writeAsync`). */
export function ensureFileReaderPolyfill(): void {
	const g = globalThis as unknown as { FileReader?: unknown };
	if (typeof g.FileReader !== 'undefined') return;

	class NodeFileReader implements FileReaderLike {
		result: ArrayBuffer | string | null = null;
		error: unknown = null;
		onloadend: (() => void) | null = null;
		onerror: ((err: unknown) => void) | null = null;

		readAsArrayBuffer(blob: Blob): void {
			blob
				.arrayBuffer()
				.then((buf) => {
					this.result = buf;
					this.onloadend?.();
				})
				.catch((err: unknown) => {
					this.error = err;
					this.onerror?.(err);
				});
		}

		readAsDataURL(blob: Blob): void {
			blob
				.arrayBuffer()
				.then((buf) => {
					const b64 = Buffer.from(buf).toString('base64');
					this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
					this.onloadend?.();
				})
				.catch((err: unknown) => {
					this.error = err;
					this.onerror?.(err);
				});
		}
	}

	g.FileReader = NodeFileReader;
}
