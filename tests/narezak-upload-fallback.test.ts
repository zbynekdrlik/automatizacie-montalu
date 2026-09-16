// #532 R2 HOTFIX: PROD Odoo intake (`montalu_narezak_upload`) ešte NEmá odoo-erp#7431, takže odmieta
// neznámy top-level kľúč `cut_plan` s HTTP 422 `ValidationError: Neznámy parameter: cut_plan` (raise
// PRED lookupom objednávky). `uploadNarezak` to reaktívne rieši: na 422-cut_plan zopakuje TEN ISTÝ
// upload BEZ `cut_plan` (lines+PDF vždy doručené), warn RAZ za proces, a označí výsledok
// (`cutPlanRejected`), aby backfill vedel počítať „cut_plan odmietnutý (422)". Kill switch
// `ODOO_NAREZ_CUT_PLAN=0/false` vypne posielanie `cut_plan` úplne (default ON).
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	uploadNarezak,
	isCutPlanEnabled,
	setJson2Transport,
	_resetCutPlanRejectWarn,
	OdooJson2Error,
	type OdooJson2Config
} from '../src/lib/server/odoo-json2';

const CFG: OdooJson2Config = { url: 'https://erp.test', apiKey: 'k' };

/** 422 telo ako z Odoo /json/2 ValidationError „Neznámy parameter: cut_plan". */
const resp422CutPlan = (): Response =>
	new Response(JSON.stringify({ error: { message: 'Neznámy parameter: cut_plan' } }), {
		status: 422,
		statusText: 'Unprocessable Entity'
	});
const respOk = (): Response => new Response(JSON.stringify({ ok: true }), { status: 200 });

function baseKwargs(withCutPlan = true): Record<string, unknown> {
	return {
		order_number: 'OP1',
		doc_id: 'd1',
		kind: 'narezak',
		lines: [{ a: 1 }],
		pdf_base64: 'JVBERi0=',
		filename: 'x.pdf',
		...(withCutPlan ? { cut_plan: { version: 1, bars: [] } } : {})
	};
}

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	delete process.env.LOG_LEVEL;
	_resetCutPlanRejectWarn();
});

describe('isCutPlanEnabled (kill switch #532 R2)', () => {
	it('default ON keď env nie je nastavené', () => {
		vi.stubEnv('ODOO_NAREZ_CUT_PLAN', '');
		expect(isCutPlanEnabled()).toBe(true);
	});
	it('OFF pri "0"', () => {
		vi.stubEnv('ODOO_NAREZ_CUT_PLAN', '0');
		expect(isCutPlanEnabled()).toBe(false);
	});
	it('OFF pri "false" (case-insensitive, s medzerami)', () => {
		vi.stubEnv('ODOO_NAREZ_CUT_PLAN', '  False ');
		expect(isCutPlanEnabled()).toBe(false);
	});
	it('ON pri "1" / inej hodnote', () => {
		vi.stubEnv('ODOO_NAREZ_CUT_PLAN', '1');
		expect(isCutPlanEnabled()).toBe(true);
	});
});

describe('uploadNarezak — cut_plan 422 fallback', () => {
	it('422 „Neznámy parameter: cut_plan" → retry BEZ cut_plan, lines+PDF doručené, cutPlanRejected', async () => {
		const bodies: string[] = [];
		let call = 0;
		setJson2Transport(async (_i, init) => {
			bodies.push(String(init?.body));
			call++;
			return call === 1 ? resp422CutPlan() : respOk();
		});
		const out = await uploadNarezak(CFG, baseKwargs());
		expect(call).toBe(2);
		expect(JSON.parse(bodies[0]!)).toHaveProperty('cut_plan'); // 1. request s cut_plan
		const second = JSON.parse(bodies[1]!);
		expect(second).not.toHaveProperty('cut_plan'); // 2. request bez cut_plan
		expect(second).toHaveProperty('lines'); // lines vždy doručené
		expect(second).toHaveProperty('pdf_base64'); // PDF vždy doručené
		expect(out.cutPlanAccepted).toBe(false);
		expect(out.cutPlanRejected).toBe(true);
		expect(out.result).toEqual({ ok: true });
	});

	it('robustné na \\u escapovanú diakritiku aj viac neznámych kľúčov v tele', async () => {
		let call = 0;
		setJson2Transport(async () => {
			call++;
			return call === 1
				? new Response('Odoo: Nezn\\u00e1my parameter: cut_plan, quite', {
						status: 422,
						statusText: 'Unprocessable Entity'
					})
				: respOk();
		});
		const out = await uploadNarezak(CFG, baseKwargs());
		expect(call).toBe(2);
		expect(out.cutPlanRejected).toBe(true);
	});

	it('warn RAZ za proces aj pri dvoch po sebe idúcich odmietnutiach', async () => {
		process.env.LOG_LEVEL = 'warn';
		let call = 0;
		setJson2Transport(async () => (++call % 2 === 1 ? resp422CutPlan() : respOk()));
		const lines: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
			lines.push(String(c));
			return true;
		}) as typeof process.stdout.write);
		try {
			await uploadNarezak(CFG, baseKwargs());
			await uploadNarezak(CFG, baseKwargs());
		} finally {
			spy.mockRestore();
		}
		const warns = lines
			.join('')
			.split('\n')
			.filter(Boolean)
			.map((l) => JSON.parse(l) as Record<string, unknown>)
			.filter((r) => r.level === 'warn' && /cut_plan/i.test(String(r.msg)));
		expect(warns).toHaveLength(1);
	});

	it('iná 422 (nie cut_plan) → NEretry-uje, hodí OdooJson2Error', async () => {
		let call = 0;
		setJson2Transport(async () => {
			call++;
			return new Response('Neplatný doc_id — povolené znaky a-z 0-9', {
				status: 422,
				statusText: 'Unprocessable Entity'
			});
		});
		await expect(uploadNarezak(CFG, baseKwargs())).rejects.toThrow(OdooJson2Error);
		expect(call).toBe(1); // žiadny retry
	});

	it('ne-422 chyba (500) → NEretry-uje, hodí', async () => {
		let call = 0;
		setJson2Transport(async () => {
			call++;
			return new Response('Neznámy parameter: cut_plan', {
				status: 500,
				statusText: 'Server Error'
			});
		});
		await expect(uploadNarezak(CFG, baseKwargs())).rejects.toThrow(/HTTP 500/);
		expect(call).toBe(1); // 500 NEretry-uje ani pri zhode správy — fallback je len na 422
	});

	it('úspech s cut_plan (bez 422) → cutPlanAccepted, žiadny retry', async () => {
		let call = 0;
		setJson2Transport(async () => {
			call++;
			return respOk();
		});
		const out = await uploadNarezak(CFG, baseKwargs());
		expect(call).toBe(1);
		expect(out.cutPlanAccepted).toBe(true);
		expect(out.cutPlanRejected).toBe(false);
	});

	it('kill switch ODOO_NAREZ_CUT_PLAN=0 → cut_plan v tele NIE JE, žiadny retry, cutPlanAccepted false', async () => {
		vi.stubEnv('ODOO_NAREZ_CUT_PLAN', '0');
		const bodies: string[] = [];
		let call = 0;
		setJson2Transport(async (_i, init) => {
			bodies.push(String(init?.body));
			call++;
			return respOk();
		});
		const out = await uploadNarezak(CFG, baseKwargs());
		expect(call).toBe(1);
		expect(JSON.parse(bodies[0]!)).not.toHaveProperty('cut_plan');
		expect(JSON.parse(bodies[0]!)).toHaveProperty('lines'); // lines stále idú
		expect(out.cutPlanAccepted).toBe(false);
		expect(out.cutPlanRejected).toBe(false); // vypnuté != odmietnuté (nič sa neposlalo)
	});

	it('bez cut_plan v kwargs → normálny upload, cutPlanAccepted false', async () => {
		let call = 0;
		setJson2Transport(async () => {
			call++;
			return respOk();
		});
		const out = await uploadNarezak(CFG, baseKwargs(false));
		expect(call).toBe(1);
		expect(out.cutPlanAccepted).toBe(false);
		expect(out.cutPlanRejected).toBe(false);
	});
});
