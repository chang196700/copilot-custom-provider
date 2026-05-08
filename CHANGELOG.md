# [1.5.0](https://github.com/chang196700/copilot-custom-provider/compare/v1.4.0...v1.5.0) (2026-05-08)


### Features

* add status bar item for quick access to provider manager ([c2db12c](https://github.com/chang196700/copilot-custom-provider/commit/c2db12cfbba80c7b0e8bd74e973746ea709f7c17))

# [1.4.0](https://github.com/chang196700/copilot-custom-provider/compare/v1.3.0...v1.4.0) (2026-05-08)


### Features

* expand ThinkingEffort to none/adaptive/low/medium/high/max ([1a6102e](https://github.com/chang196700/copilot-custom-provider/commit/1a6102e12ce4956dcaebec1442f1e00e26403d77))

# [1.3.0](https://github.com/chang196700/copilot-custom-provider/compare/v1.2.0...v1.3.0) (2026-05-08)


### Bug Fixes

* **ci:** remove persist-credentials:false so git push uses GITHUB_TOKEN ([f0f120e](https://github.com/chang196700/copilot-custom-provider/commit/f0f120e9405631b0ba5ea0ef4ccb1b6894b3dd07))


### Features

* **ui:** add Change button to edit Provider ID in-place ([6cd02d5](https://github.com/chang196700/copilot-custom-provider/commit/6cd02d575d76580d2957d6e4b24f71107dacbe8e))

# [1.1.0](https://github.com/chang196700/copilot-custom-provider/compare/v1.0.0...v1.1.0) (2026-05-08)


### Features

* **anthropic:** support auth mode and claude-code impersonation ([a3cec46](https://github.com/chang196700/copilot-custom-provider/commit/a3cec46868efc3bdb0c1a045e38f8d7eed6cc0b5))
* **config:** replace syncProviders/providersMirror with providers setting ([f4fef85](https://github.com/chang196700/copilot-custom-provider/commit/f4fef8515ae0f0bf6787ab5e897e7f94e8f22e67))
* **presets:** add blank custom preset and make type/baseUrl optional ([62db8d6](https://github.com/chang196700/copilot-custom-provider/commit/62db8d6947ad70ec54f986c9cd62b1ed7424c23e))

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
