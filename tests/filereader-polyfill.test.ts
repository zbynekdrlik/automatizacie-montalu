// AR náhľad pergoly (#286) — Node `FileReader` polyfill (pre GLTFExporter server-side).
// Testuje obe metódy (readAsArrayBuffer/readAsDataURL), chybovú vetvu aj idempotenciu.
import { describe, expect, it } from 'vitest';
import { ensureFileReaderPolyfill } from '../src/lib/server/filereader-polyfill';

// Node 24 NEMÁ natívny globálny FileReader (overené: GLTFExporter padne bez polyfillu),
// takže po ensureFileReaderPolyfill je `globalThis.FileReader` PRÁVE náš shim.
type ShimReader = {
	result: ArrayBuffer | string | null;
	error: unknown;
	onloadend: (() => void) | null;
	onerror: ((err: unknown) => void) | null;
	readAsArrayBuffer(blob: Blob): void;
	readAsDataURL(blob: Blob): void;
};
function novyReader(): ShimReader {
	ensureFileReaderPolyfill();
	const FR = (globalThis as unknown as { FileReader: new () => ShimReader }).FileReader;
	return new FR();
}

describe('server/filereader-polyfill', () => {
	it('ensureFileReaderPolyfill nastaví globalThis.FileReader', () => {
		ensureFileReaderPolyfill();
		expect(typeof (globalThis as unknown as { FileReader?: unknown }).FileReader).toBe('function');
	});

	it('readAsArrayBuffer vráti bajty blobu cez onloadend', async () => {
		const r = novyReader();
		const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
		const result = await new Promise<ArrayBuffer>((resolve, reject) => {
			r.onloadend = () => resolve(r.result as ArrayBuffer);
			r.onerror = (e) => reject(e);
			r.readAsArrayBuffer(blob);
		});
		expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it('readAsDataURL vráti data: URL s base64 obsahom', async () => {
		const r = novyReader();
		const blob = new Blob([new Uint8Array([65, 66, 67])], { type: 'text/plain' }); // "ABC"
		const url = await new Promise<string>((resolve, reject) => {
			r.onloadend = () => resolve(r.result as string);
			r.onerror = (e) => reject(e);
			r.readAsDataURL(blob);
		});
		expect(url).toBe('data:text/plain;base64,QUJD'); // btoa("ABC") = QUJD
	});

	it('readAsDataURL bez typu použije application/octet-stream', async () => {
		const r = novyReader();
		const blob = new Blob([new Uint8Array([0])]);
		const url = await new Promise<string>((resolve, reject) => {
			r.onloadend = () => resolve(r.result as string);
			r.onerror = (e) => reject(e);
			r.readAsDataURL(blob);
		});
		expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
	});

	it('chyba blobu → onerror + nastaví error (obe metódy)', async () => {
		const zlyBlob = {
			type: '',
			arrayBuffer: () => Promise.reject(new Error('boom'))
		} as unknown as Blob;

		const r1 = novyReader();
		const err1 = await new Promise<unknown>((resolve) => {
			r1.onerror = (e) => resolve(e);
			r1.readAsArrayBuffer(zlyBlob);
		});
		expect((err1 as Error).message).toBe('boom');
		expect((r1.error as Error).message).toBe('boom');

		const r2 = novyReader();
		const err2 = await new Promise<unknown>((resolve) => {
			r2.onerror = (e) => resolve(e);
			r2.readAsDataURL(zlyBlob);
		});
		expect((err2 as Error).message).toBe('boom');
	});
});
