---
paths:
  - 'src/routes/**/+page.server.ts'
  - 'src/routes/**/+page.svelte'
---

# SvelteKit form actions — `default` a pomenované sa NEDAJÚ miešať

SvelteKit ZAKAZUJE mať na jednej route `default` akciu SÚČASNE s pomenovanou
(`@sveltejs/kit .../runtime/server/page/actions.js`: *„When using named actions, the
default action cannot be used"*). Nie je to build chyba — GET load prejde, ale KAŽDÝ POST
na `default` (`?/`) hodí 500. Prejaví sa to ako „formulár po submitne nič neurobí"
(žiadny súhrn/výsledok), nie ako jasná chyba — CI E2E to zachytí, lokálny `svelte-check`
NIE (typy sú v poriadku). Stálo to jeden CI cyklus pri #277.

**Keď na route, ktorá má `default`, pridávaš NOVÚ pomenovanú akciu → prerob `default`
tiež na pomenovanú.** Napr. `/konfigurator` (#275/#277):

```ts
// +page.server.ts — obe pomenované
export const actions = { vypocet: async (…) => {…}, dopyt: dopytAction } satisfies Actions;
```

```svelte
<!-- +page.svelte — každý formulár MUSÍ mať explicitné action="?/<meno>" -->
<form method="POST" action="?/vypocet" use:enhance={…}>…</form>
```

Formulár bez `action` POSTuje na `default` — s pomenovanými akciami to 500-ne. Guard
`tests/b2b-route-coverage.test.ts` overuje presnú množinu akcií routy (fail-closed).
