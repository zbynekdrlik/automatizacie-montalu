// #453 (Patrik, Odoo ch207 msg 1792131, 4.9.2026): koliesko myši nad ZAOSTRENÝM
// <input type="number"> v prehliadači natívne MENÍ hodnotu namiesto scrollovania
// stránky — nebezpečné pri nárezových plánoch (nebadaná zmena rozmeru/počtu →
// zlý materiál na odpise). Toto nie je bug appky, je to natívne HTML forms
// správanie, ktoré appka doteraz nikde nevypínala.
//
// Fix: na wheel event nad number inputom ho OKAMŽITE odfokusujeme (blur) — blur
// prebehne SYNCHRÓNNE počas dispatchu wheel eventu, teda SKÔR než prehliadač
// vyhodnotí svoju predvolenú akciu ("je target práve zaostrený number input?").
// Keď blur prebehne prv, prehliadač už vidí NEzaostrený input → predvolená
// akcia sa vráti na normálny scroll.
//
// NEpoužívame `event.preventDefault()` — na zaostrenom number inpute je "zmeniť
// hodnotu" TÁ ISTÁ predvolená akcia wheel eventu ako "scrollnúť stránku" (nie
// dve oddelené akcie). `preventDefault()` by teda zablokoval AJ scroll presne
// v momente, keď kurzor prechádza cez number input pri bežnom scrollovaní
// dlhého formulára — čo porušuje akceptačné kritérium #453 ("stránka sa pri
// tom normálne skroluje").
//
// Pripojené CELOPLOŠNE v koreňovom `src/routes/+layout.svelte` (`<svelte:window
// onwheel=... />`) — jedno miesto pre všetky routy vrátane /konfigurator,
// namiesto úpravy 11+ stránok s number inputmi jednotlivo (zamietnutá
// alternatíva — vyššie riziko, že sa na budúcu stránku zabudne).

/** Minimálny tvar, aký guard potrebuje z `event.target` — duck-typed (BEZ
 * `instanceof HTMLElement`/`HTMLInputElement`), aby bola funkcia testovateľná
 * v 'node' vitest prostredí bez jsdom (repo ho zámerne nemá, viď
 * tests/vizual-textury.test.ts rovnaký dôvod). V prehliadači skutočný DOM
 * element tento tvar prirodzene spĺňa. */
interface CisloInputLike {
	tagName: string;
	type?: string;
	blur(): void;
}

function jeCisloInput(target: unknown): target is CisloInputLike {
	return (
		typeof target === 'object' &&
		target !== null &&
		(target as { tagName?: unknown }).tagName === 'INPUT' &&
		(target as { type?: unknown }).type === 'number' &&
		typeof (target as { blur?: unknown }).blur === 'function'
	);
}

/**
 * Wheel handler pripojený globálne (`<svelte:window onwheel={...}>`). Ak je
 * `event.target` číselný input, odfokusuje ho — inak sa nič nedeje (žiadny
 * `preventDefault()`, scroll pokračuje normálne). `blur()` na už nezaostrenom
 * prvku je no-op, takže netreba osobitne kontrolovať `document.activeElement`.
 */
export function odfokusujCisloInputPriWheeli(event: { target: EventTarget | null }): void {
	if (jeCisloInput(event.target)) {
		event.target.blur();
	}
}
