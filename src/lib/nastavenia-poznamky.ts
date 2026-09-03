// Vysvetľujúce „prečo sa to robí" texty pri nastaveniach, ktoré menia výpočty (#444).
// Špetta (Odoo ch207, msg 1789036): „Je to niekde aj v poznámke pre čo sa to robí alebo
// upozornenie ked bude pato chorý aby to dávalo zmysel aj ostatným" — owner (msg 1789037):
// „jasne mozme dorobit do appky nech su tam take veci".
//
// STATICKÉ texty v kóde (nie DB) — design rozhodnutie na #444: (1) splní požiadavku
// OKAMŽITE (text existuje od prvého nasadenia, nie až keď ho niekto vyplní), (2) texty sú
// load-bearing doménové poznanie → patria do PR review (preklep/nepravda sa chytí v
// diffe, nie v prode), (3) menia sa zriedka a vždy s kontextom ticketu, (4) nulová
// DB/audit/UI réžia. Ak šéf neskôr bude chcieť in-app editáciu, kľúče tohto objektu sú
// stabilné identifikátory — `cfg_poznamky(key)` sa dá položiť AKO OVERLAY nad tieto
// statické defaulty bez prerábky.
//
// KAŽDÝ text MUSÍ mať OVERENÝ zdroj (Odoo msg id / migrácia) — NIKDY nevymýšľaj výrobný
// dôvod (honest-null pre prózu: radšej žiadny text než vymyslený). Chýbajúce „prečo" pre
// ostatné nastavenia (odsadenia profilov, systémová sklo-korekcia, kontrolné rozmery) sú
// checklist na #444 pre Patrika — pridaj sem NOVÝ kľúč až keď dodá overený dôvod.
export const POZNAMKY: Record<string, string> = {
	korekcia:
		'Prečo korekcia: pod IZO sklá išli väčšie podložky; zmenšili sme ich, aby sa zmestilo ' +
		'väčšie sklo a lepšie držalo v ráme — preto sa rozmer skla koriguje oproti pôvodnému ' +
		'vzorcu. Nastavuje sa podľa TRIEDY skla (6 mm / 16 mm), nie pre každé sklo zvlášť — pri ' +
		'desiatkach skladieb z Odoo by bola korekcia per sklo neudržateľná. (Patrik, Odoo msg ' +
		'1789477 a 1789480; Špetta, Odoo msg 1789036)',
	redukcia:
		'Prečo nulovanie Redukcie 6mm: pri 16 mm (IZO) skladbách sa redukcia nereže; pri 6 mm ' +
		'skladbách (3.3.1 a pod.) sa reže priamo s rámovým profilom. Platí len v systéme Slide. ' +
		'(Patrik — pozri migráciu v17 v migracie.ts)'
};
