import type { SessionUser } from '$lib/server/auth';

declare global {
	const __APP_VERSION__: string;

	namespace App {
		interface Locals {
			user: SessionUser | null;
		}
	}
}

export {};
