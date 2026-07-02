import type { PageServerLoad } from './$types';
import { listOdpisy } from '$lib/server/money';

export const load: PageServerLoad = async () => {
	return { odpisy: listOdpisy(200) as Record<string, unknown>[] };
};
