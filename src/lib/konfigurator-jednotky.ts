// Verejný konfigurátor pergoly (#333) — prevod ROZMEROV medzi internými milimetrami
// a zákazníckym zobrazením v METROCH. Owner: „plus nech pridáva v metroch", hodnota
// v metroch s 1 desatinným miestom a čiarkou („4,0 m"). INTERNE ostáva všetko v mm
// (výpočty, POST, cena, PDF, Odoo — nič v pipeline sa nemení); tento modul je len
// display/parse vrstva pre stepper. Čisté funkcie bez akejkoľvek závislosti (žiadny
// DOM/THREE/Money) → client-safe (leak-guard zelený) a priamo unit-testovateľné.

/** Zaokrúhľovacia mriežka pre ručný zápis v metroch — 100 mm = 0,1 m. Zaručuje, že
 *  zobrazená hodnota (1 desatinné miesto) sa VŽDY presne rovná internej mm hodnote
 *  (žiadne „4,3" pri internom 4250) a že min/max (vždy násobky 100) ostanú na mriežke. */
const MRIEZKA_MM = 100;

/** mm → zákaznícky text v metroch s 1 desatinným miestom a ČIARKOU („4000" → „4,0").
 *  `null` (prázdna hodnota) → prázdny reťazec (input ostane prázdny, nie „0,0"). */
export function mmNaMetreText(mm: number | null): string {
	if (mm == null || !Number.isFinite(mm)) return '';
	return (mm / 1000).toFixed(1).replace('.', ',');
}

/** Zákaznícky text v metroch (čiarka AJ bodka) → interné mm, zaokrúhlené na 100 mm a
 *  zovreté do [min, max]. Prázdny/nečíselný vstup → `null` (volajúci hodnotu NEmení,
 *  aby sa počas mazania inputu hodnota neprepísala na clamp). Zaokrúhlenie PRED
 *  clampom (napr. „15" pri max 12000 → 15000 → clamp 12000). */
export function parseMetreNaMm(text: string, min: number, max: number): number | null {
	const s = text.trim().replace(',', '.');
	if (s === '') return null;
	const metre = Number(s);
	if (!Number.isFinite(metre)) return null;
	const mm = Math.round((metre * 1000) / MRIEZKA_MM) * MRIEZKA_MM;
	return Math.min(max, Math.max(min, mm));
}

/** Krok stepperom o `deltaMm` (±500 mm pre šírku/hĺbku, ±100 mm pre výšku), so
 *  SMEROVÝM prichytením na mriežku kroku: z hodnoty NA mriežke sa posunie presne o
 *  jeden krok; z hodnoty MIMO mriežky (ručne zadaný medzikrok) na najbližšiu čiaru
 *  mriežky v smere kroku. Vždy zovreté do [min, max]. `null` (prázdna) → od `min`. */
export function krokMetre(cur: number | null, deltaMm: number, min: number, max: number): number {
	const krok = Math.abs(deltaMm);
	const zaklad = cur ?? min;
	const g = zaklad / krok;
	// +1/−1 v smere kroku: on-grid hodnota sa posunie presne o krok, off-grid na
	// najbližšiu mriežku dopredu/dozadu (floor pre +, ceil pre −).
	const next = deltaMm > 0 ? Math.floor(g + 1) * krok : Math.ceil(g - 1) * krok;
	return Math.min(max, Math.max(min, next));
}
