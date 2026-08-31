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
}

export {};
