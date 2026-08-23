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
