<!-- exact:begin (exact new writes this block; bun exact.mjs update rewrites it) -->
# chirpy: an Exact app

`app.contract` is the view, `app.ts` the data module, `app.test.contract` the tests, `app.json`
the manifest: set `app.name` and `app.id` before building. The app uses Exact at
`../exact-repo` by path (`EXACT` overrides it).

This file is already in your instructions. Start from the nearest pattern: `bun exact.mjs
pattern` lists them and `pattern <name>` writes one, tested. ../exact-repo/docs/start-here-site.md (a site) or
../exact-repo/docs/start-here.md is the only required reading. `bun exact.mjs contract vocab <name>` answers a
name (none: the card); `bun exact.mjs docs <heading words>` a guide's
section. Run `bun exact.mjs verify` when the features work, and `verify ios|android` at the end for a
phone app. When an iPhone app is ready to try, run `bun exact.mjs share` and send its link;
repeat for each change the person should see. `bun exact.mjs help` lists the verbs, including
app.json's `"commands"`.
`bun exact.mjs update` refreshes files. Native verbs (`ios`, `mac`, `linux`, `android`, `windows`)
name their platform in app.json on first use and build in a generated workspace;
`update --without <platform>` stops shipping it.
`bun ../exact-repo/scripts/exact.mjs setup --check` names what a native build lacks.

Generated, so don't edit: `exact.mjs` and this block.

## Feedback (required)

When a doc was wrong or missing, a workaround was needed, something took several tries or a
command confused you, record it: `bun exact.mjs feedback note "<what happened>"`. It attaches
exact2's commit and the last exit code, never output or code. `bun exact.mjs feedback status` says
whether notes are sent and whether to keep a diary; under `never`, skip all of this.
<!-- exact:end -->

## Tests (Chirpy)

Run tests with `bun exact.mjs test-local` and verify with `bun exact.mjs verify-local`, never
plain `test` or `verify`. These pass `--backend http://127.0.0.1:4790`, which points every
Mastodon server at the fixture in `fixture/server.ts` (each server under `/<host>`), so no
test touches a live server. Without it the build is live: `app.test.contract`'s top-level
`fail fetch "https://"` then fails the tests that load data instead of reaching the network.
Any backend other than `http://127.0.0.1` fails the build (the check at the top of `app.ts`).

A test that needs a new server, route or response adds it to `fixture/server.ts`. Sign-in
completes against the fixture with the `authorize` step.
