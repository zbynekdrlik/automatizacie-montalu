import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';

export const load: PageServerLoad = async () => {
	const reports = db
		.prepare('SELECT ts, username, oblast, popis FROM problem_reports ORDER BY id DESC LIMIT 50')
		.all() as { ts: string; username: string; oblast: string; popis: string }[];
	return { reports };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const oblast = String(form.get('oblast') ?? '').trim();
		const popis = String(form.get('popis') ?? '').trim();
		if (!popis) return { error: 'Napíš, čo zle prebehlo.' };
		db.prepare('INSERT INTO problem_reports (username, oblast, popis) VALUES (?, ?, ?)').run(
			locals.user?.username ?? '',
			oblast,
			popis.slice(0, 5000)
		);
		return { ulozene: true };
	}
};
