# Gabby

A Mastodon client built with [Exact](https://github.com/expo/exact). Work in progress.

Gabby can:

- open any Mastodon server's public timeline signed out, and hashtag timelines from there;
- sign in to `fosstodon.org`, `mastodon.social` or `mastodon.art` and show the home timeline;
- open a post with its thread, and a person's profile with their posts;
- write posts and replies, with pictures, video or audio and a visibility;
- boost and like posts;
- show pictures, video, audio and link previews in posts, with sensitive media hidden until
  revealed.

## Setup

You need [Bun](https://bun.sh) and Rust ([rustup](https://rustup.rs)); Exact's web build compiles
part of itself with Rust. Gabby expects a checkout of Exact next to it, at `../exact-repo`:

```sh
git clone https://github.com/expo/exact ../exact-repo
(cd ../exact-repo && bun install --frozen-lockfile)
bun ../exact-repo/scripts/exact.mjs setup     # installs what the builds need
bun install
```

`bun ../exact-repo/scripts/exact.mjs setup --check --platform ios` (or `macos`) names anything a
native build still lacks. With Homebrew's `rustup`, put `/opt/homebrew/opt/rustup/bin` on your
`PATH`.

## Running

```sh
bun exact.mjs web          # web dev server at http://127.0.0.1:8765/, reloads on save
bun exact.mjs mac --run    # macOS app
bun exact.mjs ios --run    # iOS simulator
```

These talk to the real servers you type in. The iOS build needs Xcode 27.1 or later (Exact's iOS
host needs the iOS 27.1 SDK). To try Gabby without touching a real server, use the
[sandbox](#gotosocial-sandbox) or the [fixture](#testing).

## Testing

Tests run against a local stand-in for Mastodon (`fixture/server.ts`) rather than live servers:

```sh
bun exact.mjs test-local     # the tests in app.test.contract
bun exact.mjs verify-local   # the tests, plus layout and accessibility checks in light and dark
```

Both start the fixture themselves on `http://127.0.0.1:4790` and refuse to run while anything
else (the fixture or the sandbox) holds that port. Never run plain `test` or `verify`: without the
local backend the build is live, and the tests fail rather than reach the network.

To click through the fixture's canned data by hand, run `bun exact.mjs server` in one terminal and
`bun exact.mjs web-sandbox` in another. The fixture serves every server name under `/<host>` and
signs in without a password.

## GoToSocial sandbox

The fixture answers only what the tests ask for. To try Gabby against a real ActivityPub server,
with posting, replies and uploads that persist, without writing to a public one, run a local
[GoToSocial](https://gotosocial.org/) server filled with test accounts and posts.

### First run

1. On macOS, install Go: `brew install go`. GoToSocial publishes binaries only for Linux and the
   BSDs, so on a Mac the sandbox builds it from source. Linux needs nothing extra.
2. Make sure nothing else holds port 4790: stop `bun exact.mjs server` and any running
   `test-local` or `verify-local`.
3. Start the sandbox in its own terminal:

   ```sh
   bun exact.mjs sandbox
   ```

   The first run downloads GoToSocial 0.22.3 into `.sandbox/` and checks it against the release
   checksums (on macOS it then builds it, which takes a few minutes), starts it, and creates the
   accounts and posts in `sandbox/seed.ts`. It is ready when it prints
   `sandbox: GoToSocial 0.22.3 is up`. Ctrl-C stops it.
4. In a second terminal, start Gabby pointed at the sandbox:

   ```sh
   bun exact.mjs web-sandbox
   ```

   and open http://127.0.0.1:8765/.
5. Enter `fosstodon.org`, `mastodon.social` or `mastodon.art` and press **Connect**. Every server
   address leads to the sandbox, but Gabby can only sign in to those three. Choose **Log In**; the
   sandbox's sign-in page opens. Sign in with an account below, then allow Gabby on the next page.

Later starts reuse the build and the data, so they take seconds.

### Accounts

Every account's password is `gabby sandbox password 2026`.

| Email | Account |
|---|---|
| `alice@example.test` | admin; followed by bob, carol and dave; has pinned posts |
| `bob@example.test` | posts photos and boosts |
| `carol@example.test` | a reply thread, a poll, a content warning, a direct message |
| `dave@example.test` | no display name; 26 posts, enough to page through a timeline; has asked to follow erin |
| `erin@example.test` | locked, with no posts and a pending follow request from dave |

These exist only in the local sandbox.

### Resetting

| Command | Effect |
|---|---|
| `bun exact.mjs sandbox-reset` | deletes the posts and accounts, seeds them again and starts the sandbox |
| `bun sandbox/sandbox.ts clean` | removes `.sandbox/` entirely, GoToSocial included |

A start that was stopped before seeding finished seeds again next time.

### How it works

`sandbox/sandbox.ts` runs GoToSocial on `127.0.0.1:4791` behind a proxy on `127.0.0.1:4790`, the
address Gabby's local backend uses. The proxy strips the `/<host>` prefix Gabby adds, so every
server name reaches the same GoToSocial, which calls itself `localhost:4790`. Its data, database
and uploads live in `.sandbox/data`, which git ignores.

### Limits

- Signed out, GoToSocial shows the public timeline but refuses hashtag timelines and account
  lookups; sign in to see those.
- GoToSocial's API can't backdate a post, so every seeded post is from the moment the sandbox was
  seeded.
- The sandbox and the fixture share port 4790, so stop the sandbox before running `test-local` or
  `verify-local`.

`bun exact.mjs help` lists all commands.
