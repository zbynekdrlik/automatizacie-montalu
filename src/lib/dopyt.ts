// Zdieľaná (pure) validácia + anti-spam pre verejný zákaznícky dopyt (#277). Žiadny
// server import — testovateľné bez SvelteKit aj použiteľné na klientovi (DopytForm).
// Server (`dopyt-action`) je autoritatívny; klientske echo je len UX.

/** Skryté honeypot pole — reálny človek ho nikdy nevyplní, bot áno. Musí ostať PRÁZDNE. */
export const HONEYPOT_FIELD = 'firma_web';

export interface DopytVstup {
	meno: string;
	email: string;
	telefon: string;
	miesto: string;
	poznamka: string;
}

/** Maximálne dĺžky polí (obrana proti nezmyselne dlhému vstupu, nie biznis pravidlo). */
export const LIMITY = {
	meno: 80,
	email: 120,
	telefon: 40,
	miesto: 120,
	poznamka: 1000
} as const;

const s = (v: unknown, max: number) =>
	String(v ?? '')
		.trim()
		.slice(0, max);

/** FormData/objekt → orezaný a capnutý `DopytVstup` (kanonický tvar na uloženie). */
export function normalizeDopyt(raw: {
	meno?: unknown;
	email?: unknown;
	telefon?: unknown;
	miesto?: unknown;
	poznamka?: unknown;
}): DopytVstup {
	return {
		meno: s(raw.meno, LIMITY.meno),
		email: s(raw.email, LIMITY.email),
		telefon: s(raw.telefon, LIMITY.telefon),
		miesto: s(raw.miesto, LIMITY.miesto),
		poznamka: s(raw.poznamka, LIMITY.poznamka)
	};
}

// Pragmatický e-mail tvar (nie RFC 5322 — cieľ je odhaliť preklep, nie plná validácia).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Telefón: číslice + bežné oddeľovače, aspoň 6 znakov (voliteľné pole).
const TEL_RE = /^[0-9+()/\s-]{6,40}$/;

export type DopytChyby = Partial<Record<keyof DopytVstup, string>>;

/**
 * Serverová validácia. Povinné: meno + e-mail (zákazník musí byť kontaktovateľný).
 * Telefón/miesto/poznámka sú voliteľné, ale ak sú vyplnené, musia dávať zmysel.
 */
export function validateDopyt(v: DopytVstup): { ok: boolean; errors: DopytChyby } {
	const errors: DopytChyby = {};
	if (v.meno.length < 2) errors.meno = 'Zadajte, prosím, meno.';
	if (!v.email) errors.email = 'Zadajte, prosím, e-mail.';
	else if (!EMAIL_RE.test(v.email)) errors.email = 'E-mail nemá správny tvar.';
	if (v.telefon && !TEL_RE.test(v.telefon)) errors.telefon = 'Telefón nemá správny tvar.';
	return { ok: Object.keys(errors).length === 0, errors };
}

/** true = honeypot bol vyplnený → spam (formulár sa ticho zahodí). */
export function jeSpam(honeypotHodnota: unknown): boolean {
	return String(honeypotHodnota ?? '').trim().length > 0;
}

// --- Záväzná objednávka (#319) — kontakt (znovupoužitý) + fakturačné údaje + súhlas s podmienkami ---
// Objednávka je escalácia dopytu: povinný kontakt (ako dopyt) + fakturačné meno/firma + fakturačná
// adresa + POVINNÝ súhlas s obchodnými podmienkami (bez neho nie je záväzná). IČO/DIČ voliteľné.
// PURE (žiadny server import) — server (`objednavkaAction`) je autoritatívny; klientske echo je UX.

export interface ObjednavkaVstup extends DopytVstup {
	/** fakturačné meno alebo firma (povinné) */
	faktMeno: string;
	/** fakturačná adresa — ulica, mesto, PSČ v jednom poli (povinné) */
	faktAdresa: string;
	/** IČO (voliteľné, pri firme) */
	faktIco: string;
	/** DIČ / IČ DPH (voliteľné, pri firme) */
	faktDic: string;
	/** súhlas s obchodnými podmienkami (POVINNÝ pre záväznú objednávku) */
	suhlas: boolean;
}

/** Maximálne dĺžky fakturačných polí (obrana proti nezmyselne dlhému vstupu). */
export const OBJ_LIMITY = {
	faktMeno: 120,
	faktAdresa: 200,
	faktIco: 20,
	faktDic: 20
} as const;

/** Checkbox truthiness — štandardný `<input type=checkbox>` pošle „on" pri zaškrtnutí, nič inak;
 *  tolerujeme aj „1"/„true"/„yes", odmietame prázdne / „0" / „false" / „off" / „no". */
export function jeSuhlas(v: unknown): boolean {
	const s = String(v ?? '')
		.trim()
		.toLowerCase();
	return s !== '' && s !== '0' && s !== 'false' && s !== 'off' && s !== 'no';
}

/** FormData/objekt → orezaný a capnutý `ObjednavkaVstup` (kanonický tvar na uloženie). */
export function normalizeObjednavka(raw: {
	meno?: unknown;
	email?: unknown;
	telefon?: unknown;
	miesto?: unknown;
	poznamka?: unknown;
	faktMeno?: unknown;
	faktAdresa?: unknown;
	faktIco?: unknown;
	faktDic?: unknown;
	suhlas?: unknown;
}): ObjednavkaVstup {
	return {
		...normalizeDopyt(raw),
		faktMeno: s(raw.faktMeno, OBJ_LIMITY.faktMeno),
		faktAdresa: s(raw.faktAdresa, OBJ_LIMITY.faktAdresa),
		faktIco: s(raw.faktIco, OBJ_LIMITY.faktIco),
		faktDic: s(raw.faktDic, OBJ_LIMITY.faktDic),
		suhlas: jeSuhlas(raw.suhlas)
	};
}

export type ObjednavkaChyby = DopytChyby &
	Partial<Record<'faktMeno' | 'faktAdresa' | 'suhlas', string>>;

/**
 * Serverová validácia objednávky. Povinné: kontakt (meno + e-mail, ako dopyt) + fakturačné meno +
 * fakturačná adresa + súhlas s podmienkami. IČO/DIČ voliteľné (ich tvar nekontrolujeme — sú
 * voliteľné a formáty sa líšia). Bez súhlasu objednávka NIE JE záväzná → chyba.
 */
export function validateObjednavka(v: ObjednavkaVstup): { ok: boolean; errors: ObjednavkaChyby } {
	// kontakt: znovupoužij dopyt validáciu (meno povinné, e-mail povinný+tvar, telefón voliteľný)
	const errors: ObjednavkaChyby = { ...validateDopyt(v).errors };
	if (v.faktMeno.length < 2) errors.faktMeno = 'Zadajte, prosím, fakturačné meno alebo firmu.';
	if (v.faktAdresa.length < 3) errors.faktAdresa = 'Zadajte, prosím, fakturačnú adresu.';
	if (!v.suhlas) errors.suhlas = 'Bez súhlasu s obchodnými podmienkami nevieme objednávku prijať.';
	return { ok: Object.keys(errors).length === 0, errors };
}
