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
