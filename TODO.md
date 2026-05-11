# TODO

> Living roadmap for `copilot-custom-provider`. 💡 = nice-to-have.

## Todo

### Features

- [ ] Vision proxy — images are silently dropped from messages; port the vision layer:
  - [ ] `vision/types.ts` — image descriptor + cache entry
  - [ ] `vision/cache.ts` — hash → description cache (LRU)
  - [ ] `vision/resolve.ts` — resolve `vscode.LanguageModelDataPart` (base64/URL) to bytes
  - [ ] `vision/model.ts` — pick the configured `copilot-custom-provider.visionModel` via `vscode.lm.selectChatModels`
  - [ ] `vision/index.ts` — orchestrate: resolve → hash → cache lookup → describe → inject as text
  - [ ] Adapter integration: convert image parts via vision proxy before driver call
  - [ ] Per-provider opt-in via `ProviderConfig.visionProxy` flag in webview
  - [ ] Fallback warning `t('copilot-custom-provider.vision.unavailable')` when provider lacks vision and proxy is off
- [ ] `copilot-custom-provider.exportProviders` / `copilot-custom-provider.importProviders` (redacted JSON, no keys)
- [ ] First-run experience: open the manager panel automatically when zero providers exist
- [ ] AWS Bedrock real implementation (SigV4 + `InvokeModelWithResponseStream`)
- [ ] OpenAI Responses API (`/v1/responses`) for o-series reasoning models
- [ ] Anthropic prompt caching control (`cache_control` blocks) when provider supports it
- [ ] Mistral / Cohere / Ollama presets (still OpenAI-compatible drivers)

### Webview UX polish

- [ ] Inline validation (baseUrl format, duplicate model id)
- [ ] Per-row drag-to-reorder for models
- [ ] "Test connection" button next to Save (one-shot non-streaming probe)
- [ ] Clipboard import/export of a single provider as JSON
- [ ] **Clear Key** button — currently clearing the key field on save keeps the existing key with no way to delete it
- [ ] 💡 Per-provider color/icon picker for the sidebar
- [ ] 💡 Markdown preview of provider description

### Diagnostics

- [ ] Port `provider/diagnostics.ts` — request/response trace dump on `copilot-custom-provider.debug`
- [ ] Optional command `copilot-custom-provider.exportDiagnostics` writing redacted JSON to a temp file
- [ ] 💡 Streaming token-per-second readout in the Output channel

### Protocol

- [ ] Tool call id normalisation when crossing protocol families (already partially handled)
- [ ] Server-side `usage.cache_read_input_tokens` (Anthropic) → `cachedPromptTokens` mapping

### Quality & DX

- [ ] Unit tests via `vitest` for `convertMessages`, `readSse`, driver `buildBody`/`buildHeaders`
- [ ] Integration test using `@vscode/test-electron` for command activation
- [ ] CI matrix: extend `build.yml` to Windows / macOS / Linux (currently Linux-only)
- [ ] Schema-validate `copilot-custom-provider.providers` array items on read (defensive against hand-edits)
- [ ] Localised English-source review pass over `package.nls.zh-cn.json`
- [ ] Telemetry-free privacy statement in README

### Packaging & release

- [ ] `resources/icon.png` — actual extension icon (currently dropped from manifest)
- [ ] `resources/screenshots/*.png` referenced in README
- [x] `.vscodeignore` audit (excludes `src/`, `*.map`, dev configs)
- [x] GitHub Actions release workflow (semantic-release on push to `main`)
- [x] Marketplace publisher account: `chang196700`
- [ ] `repository` field in `package.json` (currently uses `--allow-missing-repository`)

### Maintenance

- [ ] Quarterly: re-run version audit and bump pinned deps to versions ≥ 2 weeks old
- [ ] Whenever VS Code releases a new minimum API: bump `engines.vscode` + `@types/vscode`
- [ ] When Node releases a new LTS minor: bump `engines.node` + `.node-version`
- [ ] When a new pnpm patch lands and stabilises (>2 weeks): bump `packageManager`

### Known issues

- Bedrock driver is a stub — selecting a Bedrock provider for chat will throw immediately.
- `copilot-custom-provider.refreshAll` only re-bootstraps the registry; it does not retry failed `notifyChange`
  fan-outs to in-flight adapters. Acceptable for now (next chat turn sees fresh config).
- Webview does not currently restore scroll position after `providersUpdated`.

## Done

### Scaffold & infrastructure

- [x] `package.json`, NLS files, walkthroughs, configuration schema
- [x] tsconfig (strict, `types: ["node"]` for TS 6)
- [x] esbuild bundler for the Lit webview
- [x] Logger with `copilot-custom-provider.debug` gating
- [x] i18n loader with `t(key, ...args)`

### Config store

- [x] `ConfigStore` (globalState + EventEmitter)
- [x] `SecretBackend` routing between `SecretStorage` and Settings
- [x] `SyncMirror` for opt-in Settings Sync
- [x] Schema migration scaffold (`SCHEMA_VERSION = 1`)
- [x] Reload on `copilot-custom-provider.providersMirror` external change

### Protocol drivers

- [x] `ProtocolDriver` interface + `NormalizedMessage` model
- [x] SSE reader generator
- [x] OpenAI compatible (DeepSeek, OpenRouter, Groq, Together, SiliconFlow, Moonshot, …)
- [x] Anthropic native (`/v1/messages`, thinking budget, tool_results grouping)
- [x] Anthropic auth-mode + claude-code impersonation
- [x] Google Gemini (`streamGenerateContent?alt=sse`)
- [x] Azure OpenAI (deployment-based URL)
- [x] AWS Bedrock stub (throws `t('copilot-custom-provider.errors.bedrockNotSupported')`)
- [x] `ThinkingEffort` levels: `none | adaptive | low | medium | high | max`

### Adapter & registry

- [x] `ChatProviderAdapter` implements `vscode.LanguageModelChatProvider`
- [x] `RequestSnapshot` captures provider + driver + apiKey at request entry (hot reload safety)
- [x] Adaptive `charsPerToken` EMA
- [x] Reasoning-content cache for thinking-capable models (multi-turn re-injection)
- [x] `ProviderRegistry` — single static `copilot-custom-provider` vendor with `AggregateChatProvider`
- [x] Composite model ids `<providerId>::<modelId>`

### Webview Lit UI

- [x] `ProviderManagerPanel` singleton webview host
- [x] Typed message protocol (`HostToWebviewMessage` / `WebviewToHostMessage`)
- [x] `copilot-custom-provider-app` Lit element with native VS Code styling
- [x] Provider sidebar + editor (preset/type/name/baseUrl/description/key/keyStorage)
- [x] Model rows with Tools/Vision/Thinking capability checkboxes
- [x] Fetch-from-remote model picker
- [x] Add manually flow
- [x] In-place Provider ID rename ("Change" button)
- [x] Token-count fields accept SI/IEC suffixes (e.g. `128k`, `1Mi`)
- [x] Blank "Custom" preset with optional type/baseUrl

### Commands & activation

- [x] `copilot-custom-provider.openManager`, `copilot-custom-provider.addProvider`, `copilot-custom-provider.refreshAll`, `copilot-custom-provider.showLogs`
- [x] Welcome notification on first install (walkthrough hook)
- [x] Status bar item showing live provider count (clicks open manager)

### CI / Release

- [x] `build.yml` — compile on every push / PR
- [x] `release.yml` — semantic-release driven publishing on `main`
- [x] Renovate config for dependency updates
- [x] Conventional Commits enforced via `.releaserc.json` (`conventionalcommits` preset)

### Packaging

- [x] `README.md`, `CHANGELOG.md`, `LICENSE`
- [x] `pnpm run package` produces a clean VSIX
