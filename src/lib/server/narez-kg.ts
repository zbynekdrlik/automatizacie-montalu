// #606: nárezový / pílový plán s kg/m z Odoo (odpad v kg) — JEDNA prístupová hranica pre všetky
// routy, ktoré kreslia `RozpisRezov` nad Money kódmi profilov (zasklenia, CLIP). Samotné čítanie
// kg/m + obohatenie plánu je v `odoo-katalog.ts` (`planSKgNaM`); tu je len rola:
//   - interný → plán s `kgNaM` (keď Odoo kg/m vráti),
//   - b2b → plán BEZ kg (zobrazenie ako pred #606). Rovnaká hranica ako ceny (`cenyPre` v zasklenia):
//     kg/m je v Odoo obmedzené na interné roly a z kg odpadu by si ho veľkoobchod dopočítal. Na
//     b2b-zakázanej route (/clip) je to obrana do hĺbky popri `hooks.server.ts` denyliste.
// Vstup sa NIKDY nemení (kópia len keď Odoo kg/m vráti) — Money/odpad idú z pôvodného plánu.
// NIKDY nehádže (`planSKgNaM` má vlastný catch), takže sa smie spustiť súbežne so zápisom odpisu.
import { isB2B, type SessionUser } from './auth';
import type { MaterialRow } from './compute-model';
import { planSKgNaM } from './odoo-katalog';

export async function kgPlanPre<T extends { material: MaterialRow[] }>(
	user: SessionUser | null,
	plan: T
): Promise<T> {
	if (isB2B(user)) return plan;
	return planSKgNaM(plan);
}

/** Pohodlný tvar pre routy, ktoré nesú len pole riadkov (CLIP `narez`). */
export async function kgNarezPre(
	user: SessionUser | null,
	narez: MaterialRow[]
): Promise<MaterialRow[]> {
	return (await kgPlanPre(user, { material: narez })).material;
}
