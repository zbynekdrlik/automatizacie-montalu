// Client-safe pravidlo uhla rezu (používa ho aj klientský komponent RozpisRezov,
// preto NESMIE byť v $lib/server/*). Nosový AJ Oponový profil sa režú rovno (90°),
// zvyšok (rámový, koľajnica) na 45° do vnútra ako pri ráme.
// Dominik: „oponový profil sa reže na 90 stupňov ako nosový u oboch systémov".
export const jeSikmyRez = (nazov: string): boolean => !/nos[oó]v|opon/i.test(nazov);

// Systémy rezané CELÉ na 90° (rovno), bez ohľadu na názov profilu — na týchto
// sa jeSikmyRez neaplikuje. Deluxe (Zbynek) + Štandard + (Dominik/Marek:
// „štandard sa reže všetko na 90"). Uhol je len na nákrese — Money odpis nemení.
export const systemRovnyRez = (system: string): boolean =>
	system === 'Deluxe' || system === 'Štandard +';

// Reálny presah susedných posuvných krídel (mm) per systém — Dominik 2026-07-14:
// Robust 70, Slide 50, Štandard + 40 (Deluxe zatiaľ 50, nepotvrdené). Používa
// kaskáda v Nahlad2D (kreslí presah v mierke okna). Len náhľad — Money nemení.
// POZOR: kľúč MUSÍ presne sedieť s názvom systému v cfg (drift-guard test to stráži);
// neznámy systém padne na OVERLAP_DEFAULT.
export const OVERLAP_DEFAULT = 50;
export const OVERLAP_MM: Record<string, number> = {
	Robust: 70,
	Slide: 50,
	'Štandard +': 40,
	Deluxe: 50
};
export const overlapMm = (system: string): number => OVERLAP_MM[system] ?? OVERLAP_DEFAULT;
