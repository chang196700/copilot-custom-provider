# 1.0.0 (2026-05-07)


### Bug Fixes

* **ci:** create dist dir before vsce package; exclude dev files from vsix ([4a3badf](https://github.com/chang196700/copilot-custom-provider/commit/4a3badf0e665d22ded11eccf9b2f25ca5e731719))
* notify Copilot to refresh model list immediately after bootstrap ([68c45d8](https://github.com/chang196700/copilot-custom-provider/commit/68c45d8a0c504568211a645e2f518ad098f486fa))


### Features

* add semantic-release with GitHub Actions CI workflow ([e108211](https://github.com/chang196700/copilot-custom-provider/commit/e10821112052d75e1f9969d2b60f46e7d0e85a42))

# Changelog

## 0.1.0

Initial release.

- Multi-provider language model registry for GitHub Copilot Chat.
- Five protocol drivers: OpenAI compatible, Anthropic, Gemini, Azure OpenAI, Bedrock (stub).
- Lit-based provider manager webview with native VS Code styling.
- Hot reload of provider config on save (in-flight streams complete with original snapshot).
- Optional Settings Sync mirroring of provider definitions (excluding API keys).
- Per-provider key storage selector (SecretStorage or Settings).
- Multi-turn reasoning_content cache for thinking-capable models.
