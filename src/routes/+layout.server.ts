import type { LayoutServerLoad } from './$types';
import { isLive } from '$lib/server/money';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user,
		version: __APP_VERSION__,
		live: isLive()
	};
};
