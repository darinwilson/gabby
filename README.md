# Gabby

A Mastodon client built with [Exact](https://github.com/expo/exact). Work in progress.

## Setup

Gabby expects a checkout of Exact next to it, at `../exact-repo`:

```sh
git clone https://github.com/expo/exact ../exact-repo
bun install
```

## Running

```sh
bun exact.mjs web          # web dev server, reloads on save
bun exact.mjs mac --run    # macOS app
bun exact.mjs ios --run    # iOS simulator
```

## Testing

Tests run against a local Mastodon fixture server (`fixture/server.ts`) rather than live servers:

```sh
bun exact.mjs server       # in a separate terminal
bun exact.mjs test-local
bun exact.mjs verify-local
```

## Sandbox server

To try Gabby against a real server without posting to a public one, run a local
[GoToSocial](https://gotosocial.org/) server filled with test accounts and posts:

```sh
bun exact.mjs sandbox        # in a separate terminal; Ctrl-C stops it
bun exact.mjs web-sandbox    # Gabby's dev server, pointed at the sandbox
```

The first run downloads GoToSocial into `.sandbox/` (on macOS it builds it from source, which
needs Go: `brew install go`), creates the accounts and posts in `sandbox/seed.ts`, and keeps the
data in `.sandbox/data`. `bun exact.mjs sandbox-reset` deletes the data and seeds it again;
`bun sandbox/sandbox.ts clean` removes everything, GoToSocial included.

The sandbox takes Gabby's local backend address (`http://127.0.0.1:4790`), so every server
address you enter in Gabby reaches it, and it can't run while `test-local` or `verify-local`
does. Log in through `fosstodon.org`, `mastodon.social` or `mastodon.art` (the servers Gabby
can sign in to) with one of these accounts:

| Email | Account |
|---|---|
| `alice@example.test` | admin; followed by bob, carol and dave; has pinned posts |
| `bob@example.test` | posts photos and boosts |
| `carol@example.test` | a reply thread, a poll, a content warning, a direct message |
| `dave@example.test` | no display name; 25 posts, enough to page through a timeline |
| `erin@example.test` | locked, with no posts |

Every account's password is `gabby sandbox password 2026`. Signed out, GoToSocial shows the public
timeline but refuses hashtag timelines and account lookups.

`bun exact.mjs help` lists all commands.
