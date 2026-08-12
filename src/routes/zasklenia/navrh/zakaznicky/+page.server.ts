// Zasklenia — zákaznícky TLAČOVÝ list (#170 §2.2/§2.10): jedna child routa pod
// existujúcou /zasklenia/navrh, žiadny nový vstupný bod. Parsuje ROVNAKÉ
// formulárové polia ako `/zasklenia/navrh`'s `?/vykres` akcia (rovnaká
// disciplína — `n` sa ZNOVUPOUŽÍVA z `listSysStyly()`, nikdy neprepočítava).
// Do Money NIČ nezapisuje — rovnaká display-only disciplína ako rodičovská
// routa.
import type { Actions, PageServerLoad } from './$types';
import { listSysStyly } from '$lib/server/db';
import { parseZaskleniaNavrhVstup } from '$lib/server/zasklenia-navrh-vstup';

export const load: PageServerLoad = async () => {
	return {
		// dátum = SERVEROVÝ čas (rovnaká disciplína ako rodičovská routa)
		datumIso: new Date().toISOString()
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const { vstup, error } = parseZaskleniaNavrhVstup(await request.formData(), listSysStyly());
		if (error) return { error, vstup: null };
		return { vstup, error: null as string | null };
	}
};
