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
