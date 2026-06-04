# Grid MCP Eval Harness

Stage 3 MVP — programmatic regression net for the MCP, codifying the 6-phase manual test pass run at the end of Stage 2.

Files named `*.eval.ts` so they stay out of `npm test` (which only runs `*.test.ts` unit tests).

## Layout

```
evals/
  README.md                     # this file
  fixtures/
    env.ts                      # ORGFARM_INSTANCE_URL + ORGFARM_OAUTH_TOKEN gating
    setup.ts                    # GridClient builder + per-suite workbook lifecycle
  helpers/
    polling.ts                  # waitForCellsTerminal() + sleep()
  phases/
    01-sanity.eval.ts           # workbook.list, discover.llm_models
    02-typed-config.eval.ts     # Bucket C.2 typed-object column.add/edit/save/reprocess
    03-typed-params.eval.ts     # Bucket C.1 cell/discover/column-mutation typed params
    04-yaml-dsl.eval.ts         # Bucket D apply_grid happy paths + filter ergonomics
    05-error-paths.eval.ts      # Bucket E.2 parse-error surfacing + isError envelope
    06-bug-regressions.eval.ts  # W-22711273 follow-up: scalar-filter wrap + soql validator skip
```

## Running

```bash
export ORGFARM_INSTANCE_URL="https://orgfarmout.my.localhost.sfdcdev.salesforce.com:6101"
export ORGFARM_OAUTH_TOKEN="<bearer token from client_credentials flow>"
npm run evals
```

If either env var is missing, each suite prints a single skip notice and exits cleanly. `npm test` (unit tests) is unaffected.

To get a token from a fresh orgfarm, follow the ECA + client_credentials flow setup. Quick form:

```bash
curl -k -X POST "$ORGFARM_INSTANCE_URL/services/oauth2/token" \
  -d 'grant_type=client_credentials' \
  -d "client_id=$CONSUMER_KEY" \
  -d "client_secret=$CONSUMER_SECRET"
```

## Conventions

- **One workbook per suite.** Each suite calls `createSuiteWorkbook` in `beforeAll` and `cleanupSuiteWorkbook` in `afterAll`. Failures don't leak debris.
- **No cross-suite state.** Suites are independent — phases can be run in isolation when debugging.
- **Hit the real endpoint.** The harness uses the same `GridClient` the MCP runtime uses; assertions exercise the whole stack end-to-end.
- **Fail loudly on Core changes.** If Core changes a response shape or status code, the matching phase should fail with a clear diagnostic so the regression isn't missed.