## Task 1 reopened regression

- Source fix: `src/modules/promociones/compraService.ts` returns the existing safe purchase identifier on duplicate active/in-process results. The one-line fix was already present in branch commit `23ef26ce43a1f9ef390a268a29ed2c585ef27cea`; this pass verified it and bound the missing consumer/seam coverage in `38bb6c5c0099ead547250734c2b40fba4765e623`.
- Baseline characterization: `bunx tsx --test tests/comprar-promo-button-duplicate.test.ts` exited 0 (1/1). Observable: invoking the real CTA `alFallar` callback with a duplicate result routed to the existing purchase detail, preserving the encoded return path.
- RED: after removing only the pre-existing `compraId: viva.id` line to reproduce the prior implementation, `bunx tsx --test tests/cardnet-client-promotion-acquisition.test.ts` exited 1 (0/2). Both service and server-action assertions showed the exact missing `compraId`; the line was then restored.
- GREEN and safe-contract probe: `bunx tsx --test tests/comprar-promo-button-duplicate.test.ts tests/cardnet-client-promotion-acquisition.test.ts` exited 0 (4/4). Observables: service and Next action preserve the existing identifier; CTA routes to its detail; mobile BFF duplicate response remains status 409 with only `{ok:false,error}`.
- Type gate: `bun run typecheck` exited 0. Diff gate: `git diff --check` exited 0 (line-ending warnings only). The optional no-excuse helper could not resolve its own `typescript` dependency; root TypeScript checking remained green.
- HTTP manual QA: required QA promotion, bearer, and login variables were absent. Against the already-running user-owned server, no-Bearer `curl.exe -i -X POST http://localhost:3000/api/v1/cliente/promociones/redacted-qa-promotion/comprar -H "Content-Type: application/json" --data "{}"` returned HTTP 401 and exactly the safe `{ok:false,error}` shape. Authenticated duplicate CTA/browser proof and authenticated malformed-body proof were BLOCKED by the missing fixture/session. No CardNET capture, card entry, provider request, or charge was attempted.
- Adversarial probes: stale duplicate target returned early with its existing identifier and no new purchase path; mobile error shape did not expose the identifier or provider data; exact test/typecheck exits prevent a misleading pass. Prompt injection N/A (no external free text), cancel/resume N/A (no resumable operation changed), flaky timing N/A (no timing behavior changed), repeated interruption N/A, generated artifact staleness N/A.
- Concurrent/unrelated state: `apps/client/package.json`, `bun.lock`, and `.debug-journal.md` remained dirty and were excluded from the commit. Concurrent `apps/client/src/lib/api.ts` and `tests/cardnet-promotion-purchase-contract.test.ts` edits were also excluded. A transient broader run was 37/38 because those concurrent files disagreed on a processing response schema; it was not used as this lane's pass claim.
- Cleanup receipt: no task-owned server, browser context, port, temporary directory, or provider session was created. Existing port 3000 process was observed and left untouched; no runtime resource remained to tear down.

### Continuation verification

- Current branch HEAD advanced through the concurrent API lane to `62660a6cc5944e92649696d27b3ee996a833a917`; duplicate coverage commit `38bb6c5c0099ead547250734c2b40fba4765e623` remains in its ancestry.
- A QA worker temporarily removed `compraId: viva.id` for RED validation and was interrupted. The worker restored the line before cleanup; direct inspection confirmed `git diff -- src/modules/promociones/compraService.ts` is empty.
- Final rerun: `bunx tsx --test tests/comprar-promo-button-duplicate.test.ts tests/cardnet-client-promotion-acquisition.test.ts` exited 0 with 4 passed, 0 failed/skipped/cancelled/todo.
- Final `git diff --check` exited 0 with unrelated line-ending warnings only. Remaining dirty state is limited to pre-existing `apps/client/package.json`, `bun.lock`, and `.debug-journal.md`.
- Cleanup remains complete: no task-owned server, browser, port, temp directory, provider session, or charge exists. The user-owned server on port 3000 was left untouched. Authenticated browser proof remains BLOCKED by missing fixture/session and is not claimed as passed.

### Todo 1 revalidation — 2026-10-09

- Outcome: the existing Todo 1 implementation is intact and its focused regressions pass. This revalidation made no server or test source edits; it updates this evidence file only.
- Worktree review: branch `codex/cardnet-client-rn`, upstream `origin/codex/cardnet-client-rn`, pre-evidence HEAD `62660a6cc5944e92649696d27b3ee996a833a917`; `git status --porcelain=v1` was clean. `.codegraph/` and `.omo/plans/cardnet-client-rn.md` are absent in this assigned worktree. `.omo/` is ignored by `.gitignore`, so this evidence file must be explicitly force-staged. No plan, global ledger, or Boulder file was changed.
- Existing implementation review: `src/modules/promociones/compraService.ts:80` returns `compraId: viva.id` on duplicate active/in-process purchases. The source fix is already in `23ef26ce43a1f9ef390a268a29ed2c585ef27cea` (`fix(payments): harden CardNET client and recovery flows`); duplicate service/action/BFF coverage is in that commit and the later CTA test commit `38bb6c5c0099ead547250734c2b40fba4765e623` (`test(promotions): cover duplicate purchase routing`). Current focused coverage asserts the service and Next action preserve the identifier, the CTA routes to that purchase, and the mobile BFF returns only `{ok:false,error}`. No duplicate fix was repeated.
- Baseline characterization on unchanged code: `bunx tsx --test tests/comprar-promo-button-duplicate.test.ts` exited 0; 1 passed, 0 failed/skipped/cancelled/todo. Observable assertion: the CTA failure callback receiving `compraId: existing-purchase` pushed `/cliente/mis-promociones/existing-purchase?retorno=%2Fcliente%2Fexplorar%3Fcategoria%3Dsalud`.
- RED history is retained above: the existing regression test was run after temporarily removing only `compraId: viva.id`; service and action assertions failed for the missing identifier (0/2), then passed after restoration. Current code already contains the fix and the red/green evidence, so this revalidation did not remove production code or create a duplicate regression test.
- Focused server verification: `bunx tsx --test tests/cardnet-client-server-boundaries.test.ts tests/cardnet-client-intentos.test.ts tests/cardnet-client-promotion-acquisition.test.ts` exited 0; 36 passed, 0 failed/cancelled/skipped/todo. Coverage included XOR/client-baseline rejection before DB/provider access; target ownership; one-use nonce replay; one customer reservation/GET; fresh PaymentProfiles token selection; stable Purchase UniqueID and serialized ambiguous retries; intent recovery; duplicate service/action compatibility; and the error-only mobile BFF duplicate response. The real route no-Bearer seam test returned 401 `{ok:false,error}` before service/provider access.
- Nonce-shape probe: `bunx tsx --eval 'import { cardnetConfirmInputSchema } from "./src/modules/pagos/cardnetClientCore"; const result = cardnetConfirmInputSchema.safeParse({ sessionId: "s".repeat(32), captureNonce: "short", token: "t".repeat(24) }); if (result.success) throw new Error("short nonce unexpectedly accepted"); console.log("short nonce rejected by the confirmation schema");'` exited 0 and printed `short nonce rejected by the confirmation schema`. Source inspection confirmed `confirmarSesionCardnet` parses this schema before loading the session or progressing to any provider seam.
- Root typecheck: `bun run typecheck` exited 0 (`tsc --noEmit`); it took about 90 seconds and completed without diagnostics. It was polled in bounded 30-second intervals; the command exited and left no task-owned process running.
- Diff check before this evidence update: `git diff --check` exited 0 with no output. After staging, `git diff --cached --check` and `git diff --check` exited 0; Git warned only that LF will be converted to CRLF on next touch.
- HTTP manual QA gate: BLOCKED. `Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue` found no listener, so the prescribed no-Bearer curl was not sent and no server was started. The `.env` was checked only for presence/mode flags: both CardNET mode flags reported sandbox, and `QA_ENV_KEYS_WITH_VALUES=0`; no credential values were printed. No authenticated sandbox fixture/session was available. No provider request, capture, purchase, or charge was attempted. The seam-level real-route test above is not represented as manual HTTP QA.
- Adversarial outcomes:
  - `malformed_input`: mixed target and client-supplied baseline rejected before DB/provider access; a short capture nonce was rejected by the confirmation schema before session lookup/provider progression.
  - `stale_state`: replayed capture nonce did not cause another Customer GET; retry resumed the same open session with a rotated one-use nonce; stale/superseded purchase lookup could not send another Purchase.
  - `concurrency`: tests observed one reservation and one Customer GET for concurrent starts, and stable Purchase UniqueID with serialized charge retries. These are fake-backed service seams; they do not prove PostgreSQL compare-and-set behavior against a real database.
  - `dirty_worktree`: initial worktree was clean at the recorded HEAD; no existing user change was reverted or included.
  - `hung_or_long_commands`: typecheck was slow but exited 0; bounded polling was used and it left no process behind.
  - `flaky_tests`: no test was added or changed during this revalidation; the focused gated-concurrency suite completed 36/36 with no timing failure.
  - `misleading_success_output`: exact command summaries show exit 0 and zero failed/skipped/cancelled/todo tests; manual HTTP QA remains explicitly blocked.
  - `repeated_interruptions`: N/A; no provider capture/purchase was started or resumed.
  - `prompt_injection`: N/A; only structured test inputs were used, with no external free-text instructions.
- Cleanup receipt: no task-owned server, browser, port, temporary directory, provider session, or charge was created. Port 3000 was absent and left untouched. The typecheck process exited normally; no temporary artifact was created outside this evidence file.

```json
{
  "objective": "Revalidate Todo 1 CardNET authenticated capture and purchase orchestration",
  "status": "complete_with_manual_qa_blocked",
  "implementation": {
    "duplicatePurchaseIdPreserved": true,
    "mobileBffErrorFieldsConstrained": true,
    "captureOwnershipXorNonceReservationAndAmbiguousPurchaseCovered": true
  },
  "verification": {
    "baselineCta": { "exitCode": 0, "passed": 1, "failed": 0 },
    "focusedServerSuites": { "exitCode": 0, "passed": 36, "failed": 0, "skipped": 0 },
    "shortNonceSchemaProbe": { "exitCode": 0, "rejected": true },
    "rootTypecheck": { "exitCode": 0 },
    "diffCheck": { "exitCode": 0 }
  },
  "manualQa": {
    "status": "blocked",
    "reason": "No localhost:3000 listener and no QA fixture keys; no server was started.",
    "providerCalls": 0
  },
  "databaseCas": {
    "status": "not_proven",
    "reason": "Focused service tests use a fake-backed transaction seam, not PostgreSQL."
  },
  "cleanup": "No task-owned runtime resource or provider session remains."
}
```
