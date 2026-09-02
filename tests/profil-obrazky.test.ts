// Rezy profilov: zoznam `PROFIL_S_OBRAZKOM` musí presne zodpovedať súborom
// v `static/profil/` A musí pokrývať každý profil, ktorý appka reálne používa.
//
// Šéf 2026-07-30: „iba koľajnice majú obrázky, aj to tuším len spodné." Príčina
// bola dvojitá: sync (`scripts/sync-profil-obrazky.sh`) sa po pridaní systémov
// Štandard / Štandard + nikdy nespustil, a zoznam v `profil-obrazky.ts` sa
// dopĺňal RUČNE — takže aj keby sa stiahol, mohol ostať nezapísaný. Tieto testy
// sú tá zámka: nový profil bez rezu spadne v CI, nie až u dielne.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PROFIL_S_OBRAZKOM, maObrazok, obrazokUrl } from '../src/lib/profil-obrazky';
import seed from '../src/lib/server/cfg_seed.json';

const KOR = path.resolve(__dirname, '..');
const suboryNaDisku = () =>
	fs
		.readdirSync(path.join(KOR, 'static/profil'))
		.filter((f) => f.endsWith('.webp'))
		.map((f) => f.replace(/\.webp$/, ''))
		.sort();

/** kódy profilov, ktoré appka používa — rovnaký zdroj ako sync skript */
function kodyVPouziti(): string[] {
	const zdroje = ['src/lib/server/pergola.ts', 'src/lib/server/bazen.ts'].map((p) =>
		fs.readFileSync(path.join(KOR, p), 'utf8')
	);
	zdroje.push(JSON.stringify(seed));
	const kody = new Set<string>();
	for (const s of zdroje) for (const m of s.matchAll(/(?:PRP|BPP|ZASP)\d+/g)) kody.add(m[0]);
	return [...kody].sort();
}

describe('rezy profilov (static/profil)', () => {
	it('zoznam v profil-obrazky.ts presne zodpovedá súborom na disku', () => {
		expect([...PROFIL_S_OBRAZKOM].sort()).toEqual(suboryNaDisku());
	});

	it('každý profil, ktorý appka používa, má rez', () => {
		const bez = kodyVPouziti().filter((k) => !maObrazok(k));
		expect(bez, `bez rezu: ${bez.join(' ')} — pusti scripts/sync-profil-obrazky.sh`).toEqual([]);
	});

	it('URL rezu ukazuje na existujúci súbor', () => {
		for (const kod of PROFIL_S_OBRAZKOM) {
			expect(obrazokUrl(kod)).toBe(`/profil/${kod}.webp`);
			expect(fs.existsSync(path.join(KOR, 'static', 'profil', `${kod}.webp`))).toBe(true);
		}
	});

	it('neznámy kód nemá rez (UI ho vynechá, nikdy nezobrazí rozbitý obrázok)', () => {
		expect(maObrazok('ZASP-NEEXISTUJE')).toBe(false);
	});

	// #432: Delux 5K horná koľajnica (ZASP202427, „…6000 mm") a Štandard +/Štandard
	// 5K horná koľajnica (ZASP202433, „…7500 mm") sú FYZICKY RÔZNE profily — Money má
	// pre každý vlastný prierez. #296 opravil Money KÓD (ZASP202434 → ZASP202427), ale
	// obrázok preniesol cez `git mv ZASP202434.webp → ZASP202427.webp` s predpokladom
	// rovnakého prierezu; ZASP202434 mal však v Money identický prierez ako štandardná
	// ZASP202433, takže Delux 5K rail od vtedy ukazoval ŠTANDARDNÝ rez (Patrik #432:
	// „dáva 5K koľaj hornú zo štandardu … kód sedí, ale obrázok je zlý"). Zámka proti
	// takej zámene obrázka — profil-obrazky.test.ts inak kontroluje len zoznam==súbory.
	it('Delux 5K horná koľajnica má vlastný rez, nie prierez štandardnej 5K (#432)', () => {
		const bajty = (kod: string) =>
			fs.readFileSync(path.join(KOR, 'static', 'profil', `${kod}.webp`));
		expect(bajty('ZASP202427').equals(bajty('ZASP202433'))).toBe(false);
	});
});
