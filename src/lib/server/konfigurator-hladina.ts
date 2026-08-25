// #318 — cenová hladina (MO/VO) sa rozhoduje VÝHRADNE server-side z prihláseného používateľa.
// Toto je JEDINÁ väzba rola → cenová hladina, volaná z verejnej `vypocet` akcie a z `dopyt-action`.
// Prihlásený veľkoobchodný (b2b) účet → VO (veľkoobchod); neprihlásený ALEBO interný → MO
// (maloobchod, verejná plocha). Hladina sa NIKDY neodvodzuje z klientom dodaného poľa — verejný
// návštevník nesmie forgeovať „som b2b" a dostať VO cenu (bezpečnostná hranica konfigurator.md §2).
//
// Server-only ($lib/server/): importuje `auth` (session/rola). NEIMPORTUJE cenový modul ani nič
// z Money — je to čistá klasifikácia používateľa, cenu z hladiny počíta `konfigurator-cena.ts`.
import { isB2B, type SessionUser } from './auth';
import type { CenovaHladina } from '$lib/konfigurator';

/**
 * Cenová hladina pre daného používateľa: prihlásený b2b (veľkoobchod) → `'VO'`, inak `'MO'`
 * (neprihlásený alebo interný). Väzba na EXISTUJÚCU `b2b` rolu (`auth.isB2B`, null-safe).
 */
export function cenovaHladina(user: SessionUser | null): CenovaHladina {
	return isB2B(user) ? 'VO' : 'MO';
}
