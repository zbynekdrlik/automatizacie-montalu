import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { isLive } from '$lib/server/money';
import { zistiCenyZdroj } from '$lib/server/odoo-prices';

export const GET: RequestHandler = async () => {
	// verejný endpoint — žiadne interné počty, len ok/verzia/režim
	const sysCount = (db.prepare('SELECT COUNT(*) c FROM cfg_sys').get() as { c: number }).c;
	// #599: zdroj cien (`odoo` keď Odoo kanál cien odpovedá, inak `snapshot` = Money) — len stav,
	// žiadne ceny; sonda ide cez cache kanála (max 1 request / 5 min, pri výpadku 1 / 60 s)
	const cenyZdroj = await zistiCenyZdroj();
	return json({ ok: sysCount > 0, version: __APP_VERSION__, live: isLive(), cenyZdroj });
};
