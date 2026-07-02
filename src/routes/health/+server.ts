import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { isLive } from '$lib/server/money';

export const GET: RequestHandler = async () => {
	const sysCount = (db.prepare('SELECT COUNT(*) c FROM cfg_sys').get() as { c: number }).c;
	return json({ ok: sysCount > 0, version: __APP_VERSION__, live: isLive(), sysCount });
};
