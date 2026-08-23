// Zdieľané typy + čisté helpery pre verejnú PDF ponuku (#277). ŽIADNY server import
// (žiadny DB/Money/pdf-lib) — použiteľné aj na klientovi (DopytForm náhľad) aj na serveri
// (ponuka-pdf, dopyt-action). Money-neutrálne: iba zákaznícka konfigurácia, NULA cien.

/**
 * Zákaznícka konfigurácia pergoly tak, ako ju odovzdá verejný konfigurátor (#275).
 * Všetky polia sú VOLITEĽNÉ — konfigurátor sa vyvíja a PDF súhrn vykreslí len to,
 * čo je reálne prítomné (honest-degrade). Rozmery sú v mm.
 */
export interface PonukaConfig {
	system?: string;
	typStrechy?: string;
	sirka?: number;
	hlbka?: number;
	vyskaVpredu?: number;
	vyskaPriStene?: number;
	farba?: string;
	sklo?: string;
	pocetPoli?: number;
	/** voliteľný voľný technický popis z konfigurátora */
	popis?: string;
}

const STR_MAX = 120;

/** string|number → orezaný string (cap), prázdny/neplatný → undefined. */
function optStr(v: unknown, max = STR_MAX): string | undefined {
	if (typeof v !== 'string' && typeof v !== 'number') return undefined;
	const s = String(v).trim().slice(0, max);
	return s.length ? s : undefined;
}

/** kladné konečné číslo (rozmer v mm / počet), inak undefined. */
function optPosNum(v: unknown): number | undefined {
	const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
	return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Obranné parsovanie klientom dodaného JSON konfigurácie na kanonický `PonukaConfig`.
 * Neznáme kľúče sa ignorujú, dĺžky sú capnuté — nikdy nehádže. Toto je verzia, ktorá sa
 * ukladá do `dopyt` (audit) aj kŕmi PDF, takže je jediný zdroj pravdy tvaru.
 */
export function sanitizePonukaConfig(raw: unknown): PonukaConfig {
	let obj: Record<string, unknown> = {};
	if (typeof raw === 'string') {
		try {
			const parsed: unknown = JSON.parse(raw);
			if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
		} catch {
			obj = {};
		}
	} else if (raw && typeof raw === 'object') {
		obj = raw as Record<string, unknown>;
	}
	const out: PonukaConfig = {};
	const system = optStr(obj.system);
	if (system) out.system = system;
	const typStrechy = optStr(obj.typStrechy);
	if (typStrechy) out.typStrechy = typStrechy;
	const sirka = optPosNum(obj.sirka);
	if (sirka !== undefined) out.sirka = sirka;
	const hlbka = optPosNum(obj.hlbka);
	if (hlbka !== undefined) out.hlbka = hlbka;
	const vyskaVpredu = optPosNum(obj.vyskaVpredu);
	if (vyskaVpredu !== undefined) out.vyskaVpredu = vyskaVpredu;
	const vyskaPriStene = optPosNum(obj.vyskaPriStene);
	if (vyskaPriStene !== undefined) out.vyskaPriStene = vyskaPriStene;
	const farba = optStr(obj.farba);
	if (farba) out.farba = farba;
	const sklo = optStr(obj.sklo);
	if (sklo) out.sklo = sklo;
	const pocetPoli = optPosNum(obj.pocetPoli);
	if (pocetPoli !== undefined) out.pocetPoli = Math.round(pocetPoli);
	const popis = optStr(obj.popis, 400);
	if (popis) out.popis = popis;
	return out;
}

/** celé mm bez desatinných (rozmery sú celé čísla). */
const mm = (n: number) => `${Math.round(n)} mm`;

/**
 * Súhrn konfigurácie ako riadky label/value — zdieľaný medzi PDF a prípadným náhľadom.
 * Zahŕňa LEN prítomné polia (honest-degrade). ŽIADNA cena — toto je špecifikácia.
 */
export function zhrnutieRiadky(cfg: PonukaConfig): { label: string; value: string }[] {
	const rows: { label: string; value: string }[] = [];
	if (cfg.system) rows.push({ label: 'Systém', value: cfg.system });
	if (cfg.typStrechy) rows.push({ label: 'Typ strechy', value: cfg.typStrechy });
	if (cfg.sirka !== undefined && cfg.hlbka !== undefined)
		rows.push({ label: 'Rozmery (š × h)', value: `${Math.round(cfg.sirka)} × ${mm(cfg.hlbka)}` });
	else if (cfg.sirka !== undefined) rows.push({ label: 'Šírka', value: mm(cfg.sirka) });
	else if (cfg.hlbka !== undefined) rows.push({ label: 'Hĺbka', value: mm(cfg.hlbka) });
	if (cfg.vyskaVpredu !== undefined && cfg.vyskaPriStene !== undefined)
		rows.push({
			label: 'Výška',
			value: `vpredu ${mm(cfg.vyskaVpredu)} / pri stene ${mm(cfg.vyskaPriStene)}`
		});
	else if (cfg.vyskaVpredu !== undefined)
		rows.push({ label: 'Výška vpredu', value: mm(cfg.vyskaVpredu) });
	else if (cfg.vyskaPriStene !== undefined)
		rows.push({ label: 'Výška pri stene', value: mm(cfg.vyskaPriStene) });
	if (cfg.pocetPoli !== undefined) rows.push({ label: 'Počet polí', value: String(cfg.pocetPoli) });
	if (cfg.farba) rows.push({ label: 'Farba konštrukcie', value: cfg.farba });
	if (cfg.sklo) rows.push({ label: 'Sklo / výplň', value: cfg.sklo });
	if (cfg.popis) rows.push({ label: 'Popis', value: cfg.popis });
	return rows;
}

/**
 * Kontaktné údaje firmy na PDF. Web je známy; e-mail/telefón/adresu doplní OWNER pri
 * integrácii (#277) — prázdne polia sa na PDF nevykreslia (žiadne vymyslené dáta).
 */
export const FIRMA = {
	nazov: 'Montalu',
	web: 'app.montalu.cloud',
	email: '',
	telefon: '',
	adresa: ''
} as const;

/** Disclaimer — PDF je špecifikácia, NIE cenová ponuka. */
export const DISCLAIMER =
	'Toto je nezáväzná špecifikácia produktu, nie cenová ponuka. Presnú cenu pripravíme ' +
	'po obhliadke miesta stavby. Uvedené rozmery a prvky vychádzajú z vašej konfigurácie ' +
	'a môžu sa po zameraní upresniť.';

/** Neprázdne kontaktné riadky firmy (na vykreslenie do PDF). Param kvôli testovateľnosti
 *  (default = `FIRMA`); prázdne polia sa vynechajú, aby PDF neukázalo vymyslené dáta. */
export function firmaRiadky(
	firma: { adresa?: string; telefon?: string; email?: string; web?: string } = FIRMA
): string[] {
	const r: string[] = [];
	if (firma.adresa) r.push(firma.adresa);
	if (firma.telefon) r.push(`Tel.: ${firma.telefon}`);
	if (firma.email) r.push(firma.email);
	if (firma.web) r.push(firma.web);
	return r;
}
