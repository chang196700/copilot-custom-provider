# LM Custom Provider

Add **any** OpenAI / Anthropic / Gemini / Azure OpenAI compatible provider straight into the
GitHub Copilot Chat model picker. Bring your own keys, your own models, your own providers —
all behind a single, native-looking management panel.

## Features

- **Multi-provider** — five protocol drivers built in:
  - OpenAI Compatible (DeepSeek, OpenRouter, Groq, Together, SiliconFlow, Moonshot, …)
  - Anthropic Compatible (Claude native `/v1/messages`)
  - Google Gemini (`generativelanguage.googleapis.com`)
  - Azure OpenAI (deployment-based routing)
  - AWS Bedrock (placeholder, coming soon)
- **Native UI** — a Lit + `@vscode-elements/elements` webview that matches the VS Code theme.
- **Two ways to add models** — fetch the live `/models` list and click `+`, or enter the
  metadata manually for providers without a discovery endpoint.
- **Flexible presets** — choose from built-in presets (DeepSeek, Anthropic, Gemini, etc.) or
  use the blank custom preset to configure any provider manually. Type and base URL are optional
  for custom configurations.
- **Per-model capability flags** — `tools`, `vision`, and `thinking` toggles surface the
  matching VS Code Chat capabilities (including the per-model thinking-effort dropdown).
- **Hot reload** — editing a provider takes effect on the **next** chat turn; in-flight
  streaming responses keep their original config snapshot and finish naturally.
- **Settings Sync** — provider definitions (without API keys) are stored in `settings.json` and
  automatically synced across devices via VS Code Settings Sync.
- **Per-provider key storage** — choose `SecretStorage` (default, never leaves the device) or
  `Settings` (sync-able but visible to everyone with read access to your config).
- **Anthropic auth modes** — support for different authentication methods for Anthropic-compatible providers.
- **Reasoning cache** — for thinking-capable models, the same multi-turn `reasoning_content`
  re-injection logic generalised across providers.

## Quick start

1. Install the extension.
2. Run **LM Custom Provider: Open Provider Manager** from the command palette.
3. Click **+**, pick a preset (e.g. `DeepSeek` or `Anthropic`) or use `Custom` for manual configuration, enter your API key, save.
4. Click **Fetch From Remote** (OpenAI-compatible providers) to import models — or click
   **Add Manually** for everything else.
5. Open Copilot Chat → model picker → your provider's models appear under their own vendor.

## Configuration

| Setting               | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `copilot-custom-provider.providers`   | Array of provider configurations. Synced via VS Code Settings Sync (excluding API keys).       |
| `copilot-custom-provider.apiKeys`     | Object mapping provider IDs to API keys. Use SecretStorage backend for better security.  |
| `copilot-custom-provider.visionModel`     | Model id used by the vision proxy (when forwarding images).            |
| `copilot-custom-provider.visionPrompt`    | Prompt sent to the vision proxy when describing images.                |
| `copilot-custom-provider.debug`           | Enable verbose diagnostic logging in the output channel.               |

## Develop

```pwsh
# Required: Node 24 (see .node-version) and pnpm via corepack.
corepack enable
pnpm install
pnpm run compile
```

Press <kbd>F5</kbd> to launch the Extension Development Host.

## Architecture overview

```
extension.ts
 ├─ ConfigStore (settings.json + SecretStorage + VS Code Settings Sync)
 ├─ ProviderRegistry → AggregateChatProvider → vscode.lm.registerLanguageModelChatProvider (vendor: ccp)
 │   ├─ per-provider model ids: <providerId>::<modelId>
 │   └─ ProtocolDriver (OpenAI / Anthropic / Gemini / Azure / Bedrock)
 └─ ProviderManagerPanel (Lit webview)
```

A single static vendor `copilot-custom-provider` is registered. All configured providers are exposed as models
under that vendor with composite ids `<providerId>::<modelId>`. In-flight streams capture
a `RequestSnapshot` and complete with their original driver + config + key, so saving
config never interrupts the user.

## License

MIT
