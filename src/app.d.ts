import type { SessionUser } from '$lib/server/auth';

declare global {
	const __APP_VERSION__: string;

	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
		// #245: handleError vracia bezpečnú správu + dohľadateľné errorId
		// (užívateľ ho nahlási, my ho nájdeme v logu).
		interface Error {
			message: string;
			errorId?: string;
		}
	}

	// #286: `<model-viewer>` custom element (Apache-2.0) v Svelte markupe. Bundlený dist
	// (`dist/model-viewer.min.js`) registruje custom element a nesie vlastný three
	// (decoupled od projektového three@0.185).
	namespace svelteHTML {
		interface IntrinsicElements {
			'model-viewer': {
				src?: string;
				ar?: boolean;
				'ar-modes'?: string;
				'ar-scale'?: string;
				'camera-controls'?: boolean;
				'touch-action'?: string;
				'shadow-intensity'?: string;
				exposure?: string;
				alt?: string;
				'data-testid'?: string;
				[key: string]: unknown;
			};
		}
	}
}

export {};
