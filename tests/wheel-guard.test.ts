// #453 (Patrik, Odoo ch207 msg 1792131): koliesko myši nad ZAOSTRENÝM
// <input type="number"> natívne mení hodnotu namiesto scrollovania stránky —
// nebezpečné pri nárezových plánoch (nebadaná zmena rozmeru/počtu → zlý
// materiál na odpise). Fix: `odfokusujCisloInputPriWheeli` na wheel evente
// odfokusuje (blur) target, AK vyzerá ako <input type="number"> — blur
// prebehne SYNCHRÓNNE počas dispatchu, teda skôr než prehliadač vyhodnotí
// svoju predvolenú (hodnotu meniacu) akciu, takže sa tá vráti na normálny
// scroll (viď design komentár na #453 — prečo NIE preventDefault()).
//
// Duck-typed kontrola (žiadny `instanceof HTMLElement`/`document.activeElement`)
// — testovateľné v 'node' vitest prostredí bez jsdom (repo ho zámerne nemá,
// rovnaký dôvod ako tests/vizual-textury.test.ts). `blur()` na nezaostrenom
// prvku je no-op, preto sa netestuje/nekontroluje focus stav osobitne.
//
// RED (potvrdené pred implementáciou): `src/lib/wheel-guard.ts` ešte neexistuje
// → import zlyhá (module not found), všetkých 5 testov padá. GREEN v ďalšom
// commite.
import { describe, it, expect, vi } from 'vitest';
import { odfokusujCisloInputPriWheeli } from '../src/lib/wheel-guard';

function fakeWheelEvent(target: unknown) {
	return { target } as unknown as WheelEvent;
}

describe('odfokusujCisloInputPriWheeli — #453 wheel guard nad number inputmi', () => {
	it('target = <input type="number"> → zavolá blur() presne raz', () => {
		const target = { tagName: 'INPUT', type: 'number', blur: vi.fn() };
		odfokusujCisloInputPriWheeli(fakeWheelEvent(target));
		expect(target.blur).toHaveBeenCalledOnce();
	});

	it('target = <input type="text"> → blur sa NEvolá (nie je to číselné pole)', () => {
		const target = { tagName: 'INPUT', type: 'text', blur: vi.fn() };
		odfokusujCisloInputPriWheeli(fakeWheelEvent(target));
		expect(target.blur).not.toHaveBeenCalled();
	});

	it('target = <div> → blur sa NEvolá (iný element, aj keby náhodou mal .blur)', () => {
		const target = { tagName: 'DIV', type: 'number', blur: vi.fn() };
		odfokusujCisloInputPriWheeli(fakeWheelEvent(target));
		expect(target.blur).not.toHaveBeenCalled();
	});

	it('target = null (wheel mimo elementu) → nič nepadne', () => {
		expect(() => odfokusujCisloInputPriWheeli(fakeWheelEvent(null))).not.toThrow();
	});

	it('number input bez .blur metódy (cudzí/chybný objekt) → nič nepadne, len sa ignoruje', () => {
		const target = { tagName: 'INPUT', type: 'number' };
		expect(() => odfokusujCisloInputPriWheeli(fakeWheelEvent(target))).not.toThrow();
	});
});
