---
paths:
  - ".github/workflows/*.yml"
---

# CI workflow gotchas

## A run can get stuck as a "zombie" — GitHub sometimes never allocates a runner

Symptom seen on `main` after PR #117 (0.14.4, #118): `test` completed
successfully, but `deploy` waited 15 min with `runner_name` empty, then GitHub
auto-cancelled it. The run's TOP-LEVEL status then stayed inconsistent —
`status: queued`, `conclusion: null` — even though every individual job shows
`completed`:

```bash
gh run view <id> --json status,conclusion,jobs
# status: "queued", conclusion: null, jobs: []  ← API/CLI see nothing, even
# though the run genuinely executed and finished
```

Both the standard recovery commands refuse it:

```bash
gh run cancel <id>   # → "Cannot cancel a workflow run that is completed"
gh run rerun  <id>   # → "run <id> cannot be rerun; its workflow file may be broken"
```

The workflow file is fine — it's not corrupt, this is a GitHub-side
run-bookkeeping glitch, not something in our config. Don't waste time
diagnosing the workflow YAML when you see this shape; it isn't the cause.

## The fix already shipped: `workflow_dispatch`

`ci.yml`'s `on:` block includes `workflow_dispatch:` (added by #118, PR #119)
specifically so a stuck/zombie run never blocks a deploy again. To retry CI on
an existing branch WITHOUT an artificial commit:

```bash
gh workflow run ci.yml --ref main   # or --ref dev
# poll:
gh run list -R zbynekdrlik/automatizacie-montalu --branch main --limit 1 \
  --json databaseId,status,conclusion
```

`github.ref` resolves identically for `workflow_dispatch` as for `push` — the
existing job `if:` guards (`version-check` only on `dev`, `deploy` only on
`main`, `needs: test`) behave exactly the same, no gate is weakened by this
trigger.

## Always verify the deploy actually landed — don't trust "CI green" alone

`main` CI green does not by itself prove the live app updated (the zombie run
above WAS `test: success` with `deploy` never running). After any `main`
merge, confirm the live version matches the merge SHA:

```bash
curl -s https://app.montalu.cloud/health   # {"ok":true,"version":"<X.Y.Z> (<sha7>)"}
```

If it doesn't match the merge commit's short SHA within a few minutes, use
`gh workflow run ci.yml --ref main` above instead of guessing or force-pushing
a dummy commit.
