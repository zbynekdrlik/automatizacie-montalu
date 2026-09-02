// FIX z CADu (#380) — FIX identita nad zdieľaným CAD→Money mostom (`cad-odpis.ts`, #393).
// Zdieľaný tok (parse/view/ceny/buildJob/akcie) žije v `cad-odpis.ts` — reuse pergola enginu
// + generickej Money vrstvy. Tento súbor drží LEN FIX-špecifickú identitu odpisu:
// modul='fix' (dedup UNIQUE(modul,zak,op,live) → FIX odpisuje SAMOSTATNE od pergoly — tá istá
// ZAK+OP môže mať pergola AJ fix odpis, nekolidujú), cakaSubdir='Fix', popis marker „FIX ".
// Nenamapovaný CAD kód dá TVRDÚ chybu (validatePergola v cad-odpis) — nikdy tichý výpadok
// materiálu, nikdy zlý odpis.
//
// Owner (1.9.2026): FIX má druhý režim analogicky k pergole — vložiť CAD nárez (rovnaký
// textový formát ako pergola CAD režim) a vygenerovať z neho FIX odpis do Money.
import {
	buildCadJob,
	type CadVstup,
	type CadView,
	type CadActionOpts
} from '$lib/server/cad-odpis';
import type { OdpisJob } from '$lib/server/money';

// FIX odpis identita — modul='fix' odlišuje FIX doklad od pergola dokladu; popis
// „FIX OP Zákazník" marker (pergola má „OP Zákazník") vidí operátor v Money importe.
// cakaSubdir='Fix' = parkovací podpriečinok NA ODPIS/Fix.
export const FIX_CAD_OPTS: CadActionOpts = {
	modul: 'fix',
	cakaSubdir: 'Fix',
	popisPrefix: 'FIX ',
	logName: 'fix-cad'
};

// FIX build job cez zdieľaný most (unit test fix-cad.test.ts + budúci FIX-špecifický kód).
export function buildFixCadJob(vstup: CadVstup, v: CadView, createdBy: string): OdpisJob {
	return buildCadJob(vstup, v, createdBy, FIX_CAD_OPTS);
}
