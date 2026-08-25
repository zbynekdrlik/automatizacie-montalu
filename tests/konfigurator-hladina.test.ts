// #318 — cenová hladina (MO/VO) sa rozhoduje VÝHRADNE server-side z prihláseného používateľa.
// Prihlásený veľkoobchodný (b2b) účet → VO; neprihlásený ALEBO interný → MO. Toto je jediná
// väzba rola → cenová hladina, volaná z verejnej `vypocet` akcie a z `dopyt-action`. Nikdy sa
// neodvodzuje z klientom dodaného poľa (verejný návštevník nesmie forgeovať „som b2b" a vidieť VO).
import { describe, it, expect } from 'vitest';
import { cenovaHladina } from '../src/lib/server/konfigurator-hladina';
import type { SessionUser } from '../src/lib/server/auth';

const b2b: SessionUser = { id: 1, username: 'obchod@phsplus.cz', role: 'b2b' };
const internal: SessionUser = { id: 2, username: 'admin', role: 'internal' };

describe('cenovaHladina (#318) — rola → cenová hladina', () => {
	it('prihlásený b2b (veľkoobchod) → VO', () => {
		expect(cenovaHladina(b2b)).toBe('VO');
	});

	it('prihlásený internal → MO (interný v zákazníckom konfigurátore vidí maloobchod)', () => {
		expect(cenovaHladina(internal)).toBe('MO');
	});

	it('neprihlásený (null) → MO (verejný návštevník)', () => {
		expect(cenovaHladina(null)).toBe('MO');
	});
});
