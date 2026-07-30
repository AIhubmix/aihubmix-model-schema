# @aihubmix/model-schema

The knowledge-base vocabulary layer for AIHubMix model pages. It turns capability records from the model knowledge base into the wire-only input that [`@aihubmix/codegen`](https://github.com/AIhubmix/aihubmix-codegen) accepts, and answers "may the user tick this capability, and what should we warn them about" — nothing else.

```
  knowledge base  (open set: 64 capability keys and growing)
        │
        ▼   caller fetches; neither package does I/O
  @aihubmix/model-schema   ← verdict semantics, capability key → wire shape, sample values
        │
        ▼   wire vocabulary only: CodeGenCtx
  @aihubmix/codegen        ← 4 protocols × 7 languages (closed set)
```

The dependency is one-way. `@aihubmix/codegen` contains no capability key, no verdict, and no knowledge-base protocol id; its `tests/vocabulary-isolation.test.ts` fails if one is added. That split is the point of this package: a new capability upstream is a change here only, and `@aihubmix/codegen` does not need a release.

## Install

```sh
pnpm add @aihubmix/model-schema @aihubmix/codegen
```

`@aihubmix/codegen` is a regular dependency, but keep exactly one copy of it in the tree — the same `buildBody()` must produce both the snippet you show and the request you send. Two copies compile fine and silently drift.

## Usage

```ts
import { generateFromCapabilities, PROTO_TO_CANON } from '@aihubmix/model-schema';

const { code, body, used, notes, availability } = generateFromCapabilities({
  model: 'claude-opus-5',
  protocol: 'messages',
  lang: 'python',
  capabilities: ['system-instruction', 'reasoning-effort', 'function-calling'],
  baseUrl: 'https://aihubmix.com',
  // You supply the lookup. This package never reads the knowledge base itself.
  resolve: (cap, proto) => myCanonIndex[cap]?.[PROTO_TO_CANON[proto]] ?? null,
});
```

- `code` — the snippet, with a comment line prepended for any capability whose verdict says it is silently ignored upstream.
- `body` — the same wire body the snippet sends. Usable directly for the real request, which is what keeps the two from drifting.
- `used` — capabilities that actually reached `body`, verified by each put's `landed()` check rather than by "we called `apply()`".
- `notes` — machine codes plus default English wording (`verdict`, `no-put-for-proto`, `missing-prerequisite`, `not-landed`, `resolver-error`, …).
- `availability` — status for **all** capabilities, not just the requested ones, so a UI can render a full chip row.

`resolve` returning `null` means "no record" and the capability is left unselectable — the package does not guess. If `resolve` throws, only that one capability is dropped, with a `resolver-error` note; the rest of the generation is unaffected.

## What this package does not do

- **No I/O.** No network, no filesystem, no env reads. Fetching, caching, and content-addressed paths are the consumer's job — this package knows the knowledge base's *vocabulary*, not its *transport*. It must stay `require()`-able from a bare Node prerender script.
- **No body assembly.** A put only writes wire fields onto `CodeGenCtx`; `@aihubmix/codegen`'s `buildBody()` is the sole thing that produces a body. There is no second implementation.
- **No UI.** Structured `availability` and `notes` come back; mapping them to chips, strikethrough, and warning banners is the consumer's.

## Coverage

`CAPABILITY_PUTS` currently covers 11 capability keys. Where the knowledge base says a protocol supports something this package cannot yet express, the result carries a `no-put-for-proto` note with a written reason rather than silently omitting it — see the `gap` entries in `src/catalog.ts`.

## Development

```sh
pnpm install
pnpm test:all     # typecheck + unit tests
pnpm build        # ESM + CJS + .d.ts + .d.cts
```

MIT.
