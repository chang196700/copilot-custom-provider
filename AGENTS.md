# AGENTS.md

Operational notes for AI coding agents working in this repository.

## What this is

VS Code extension that registers custom Language Model providers (OpenAI / Anthropic /
Gemini / Azure OpenAI compatible) into GitHub Copilot Chat via the
`vscode.lm.registerLanguageModelChatProvider` API. A Lit-based webview lets users add,
edit and remove providers and their models.

## Toolchain (pinned, do not float)

- Node: `24.15.0` (managed by `fnm`, see `.node-version`)
- pnpm: `11.0.5` (declared via `packageManager` field, enabled with `corepack`)
- TypeScript: `6.0.3`
- esbuild: `0.28.0` — bundles the webview only
- Lit: `3.3.2`, `@vscode-elements/elements`: `2.5.1`, `@vscode/codicons`: `0.0.45`
- Linter / formatter: `oxlint` `1.61.0`, `oxfmt` `0.46.0`
- Packager: `@vscode/vsce` `3.9.1`

All deps are pinned to exact versions. Never introduce `^` or `~` ranges. Renovate keeps
them up to date (see `renovate.json`).

## Common commands

```
pnpm install                # bootstrap
pnpm run compile            # clean + tsc + esbuild webview (production-style)
pnpm run compile:ext        # tsc only (extension host code)
pnpm run compile:webview    # esbuild only (webview UI bundle)
pnpm run watch              # parallel tsc + esbuild watch
pnpm run lint               # oxlint
pnpm run format             # oxfmt --write src/
pnpm run package            # produce dist/*.vsix (vsce, no-dependencies)
```

Run the extension via the VS Code `Run and Debug` panel using one of the
`Launch Extension Host (Stable CLI)` / `(Insiders CLI)` configurations.

## Code layout

- `src/extension.ts` — activation, command registration, store + registry wiring, status bar item (shows live provider count; updates via `store.onDidChange`)
- `src/registry/index.ts` — single static `vscode.lm.registerLanguageModelChatProvider`
  call. Vendor id is the static string `copilot-custom-provider`. Per-provider model ids are composite:
  `<providerId>::<modelId>`. **Do not register multiple vendors.**
- `src/provider/aggregate.ts` — fans out chat requests across user-defined providers
- `src/provider/convert.ts` — VS Code `LanguageModelChatRequestMessage` ↔ `NormalizedMessage`
  conversion, including tool-call grouping and reasoning re-injection
- `src/provider/cache.ts` — in-memory reasoning-text cache (keys via
  `createToolReasoningKey` / `createPostToolReasoningKey`); bounded by `MAX_REASONING_CACHE`
- `src/provider/models.ts` — `/models` discovery + capability inference per protocol
- `src/provider/tokens.ts` — adaptive `charsPerToken` EMA + token estimation
- `src/protocol/*` — protocol drivers (`openai`, `anthropic`, `gemini`, `azure`,
  `bedrock` stub). Each implements `Driver` from `protocol/driver.ts`.
  `protocol/sse.ts` is the shared SSE line-reader.
- `src/store/configStore.ts` — provider configs in `settings.json` (synced via VS Code Settings Sync), with `EventEmitter`. Migrates from legacy `globalState` on first run.
- `src/store/schema.ts` — `SCHEMA_VERSION = 1`; bump + migrate when persisted shape changes
- `src/store/secrets.ts` — API key storage. Two backends per provider:
  `secret` (SecretStorage, recommended) or `settings` (single dict
  `copilot-custom-provider.apiKeys: { [providerId]: string }` so it can sync). **Never declare per-provider
  config keys** — VS Code requires every settings key to be statically declared.
- `src/webview/panel.ts` — host side of the management webview, message dispatcher
- `src/webview/messages.ts` — typed message protocol between host and webview
- `src/webview/ui/main.ts` — Lit `<ccp-app>` component, single-file UI
- `src/i18n.ts`, `package.nls*.json` — host-side localization. The `init` message ships
  the full string map to the webview; the webview uses its own `t()` helper. UI keys are
  prefixed `copilot-custom-provider.ui.*`.
- `src/presets.ts` — built-in provider preset templates

## Build pipeline

The extension host code is plain `tsc` (root `tsconfig.json`, requires
`"types": ["node"]`). The webview UI is bundled separately by `esbuild.webview.mjs`
into `out/webview/main.js` (~127 KB) and uses its own
`src/webview/ui/tsconfig.json` with `experimentalDecorators: true` and
`useDefineForClassFields: false` (Lit requires legacy decorators). The build also copies
`@vscode/codicons` CSS + TTF into `out/webview/codicons/`.

**oxlint** does not lint `src/webview/ui/**` (Lit legacy decorators make it incompatible). Run `pnpm run lint` freely — it only covers extension host code.

`vscode.proposed.languageModelThinkingPart.d.ts` is an ambient module augmentation that
declares `vscode.LanguageModelThinkingPart` for type-checking only — `enabledApiProposals`
in `package.json` is intentionally empty. Cast to `LanguageModelResponsePart` at the call
site. Don't move this file under `src/`; `tsconfig.json` picks it up from the repo root.

## Constraints proven the hard way

- Vendor id passed to `registerLanguageModelChatProvider` MUST match a vendor declared in
  `package.json#contributes.languageModelChatProviders`. Dynamic vendors (`ccp-<id>`)
  silently fail in the picker. Use the static `copilot-custom-provider` vendor + composite model ids.
- VS Code rejects unregistered settings keys, so per-provider settings keys are not
  allowed. Use the single dict `copilot-custom-provider.apiKeys`.
- `<vscode-icon>` only renders if the codicon stylesheet `<link>` carries
  `id="vscode-codicon-stylesheet"`.
- Grid children that hold long content need `min-width: 0` (or `minmax(0, …)`) or the
  whole panel develops horizontal scroll.
- Hot-reload during streaming: capture a `RequestSnapshot { provider, driver, apiKey }`
  inside `provideLanguageModelChatResponse`. Edits to a provider must NOT interrupt an
  in-flight request; they should only affect new conversations.
- Unsaved provider drafts only live in webview state. The Delete button must remove from
  the local `providers` array AND only post `deleteProvider` to the host when the id was
  actually persisted.
- Provider configs are stored directly in `settings.json` under `copilot-custom-provider.providers`.
  API keys are stored separately in `copilot-custom-provider.apiKeys` (or SecretStorage).
  VS Code Settings Sync automatically syncs the providers (without keys) across devices.

## ThinkingEffort

`ThinkingEffort = 'none' | 'adaptive' | 'low' | 'medium' | 'high' | 'max'`

The type is declared in **two places that must be kept in sync**:
- `src/types.ts` — used by protocol drivers via `ChatRequestPayload`
- `src/provider/models.ts` — local alias + `buildThinkingEffortSchema()` enum

When adding a new level, update both declarations, `getConfiguredThinkingEffort()`,
`buildThinkingEffortSchema()`, `mapThinkingEffort()` in `openai.ts`, and
`mapAnthropicThinkingBudget()` in `anthropic.ts`.

Protocol mapping:
- **Anthropic**: `adaptive` → `{type:'adaptive'}`; others → `{type:'enabled', budget_tokens: N}` where `low=1024 / medium=4000 / high=8000 / max=16000`. `none` skips the `thinking` block entirely.
- **OpenAI-compatible**: `none` → only `thinking:{type:'disabled'}`, no `reasoning_effort`. Others → `reasoning_effort: low|medium|high` (`low`→`low`, `adaptive`/`medium`→`medium`, `high`/`max`→`high`).

## Branding

The extension's **displayName is "LM Custom Provider"** (renamed from "Copilot Custom Provider" to avoid trademark conflict). Internal identifiers (`copilot-custom-provider` command prefix, vendor id, settings keys) are preserved for backward compatibility and cannot be changed without breaking existing user configurations.

## Localization

Both `package.nls.json` (en) and `package.nls.zh-cn.json` must stay in sync. UI literals
in `src/webview/ui/main.ts` go through `this.t('copilot-custom-provider.ui.<key>')`. Placeholders use
`{0}`, `{1}` syntax matching `src/i18n.ts`.

## Known gaps

See [TODO.md](TODO.md) for the authoritative backlog. Key stubs agents must not silently fix or work around:
- **Bedrock** — `protocol/bedrock.ts` throws immediately; SigV4 not implemented.
- **Vision proxy** — images are dropped; `vision/` subtree does not exist yet.
- **Diagnostics** — `provider/diagnostics.ts` does not exist yet.

## Git / release

Commits use Conventional Commits. `main` is the only long-lived branch. Releases are
produced from CI; locally use `pnpm run package` to dry-run a `.vsix`.
