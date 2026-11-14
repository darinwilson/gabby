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

`bun exact.mjs help` lists all commands.
