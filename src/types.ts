/** Core types shared across the extension. */

/**
 * Hidden config — not exposed in the UI. Set manually in globalState JSON.
 * When enabled on an anthropic-compatible provider/model, the driver injects
 * Claude Code client headers so the endpoint treats the request as coming from
 * the official CLI.
 */
export interface ClaudeCodeImpersonation {
	/** Must be true to activate. */
	enabled: boolean;
	/**
	 * claude-cli version string to advertise, e.g. "1.2.3".
	 * Defaults to "1.0.0" when omitted.
	 */
	version?: string;
	/**
	 * USER_TYPE field in the User-Agent, e.g. "external" | "ant".
	 * Defaults to "external".
	 */
	userType?: string;
	/**
	 * CLAUDE_CODE_ENTRYPOINT field in the User-Agent, e.g. "cli" | "vscode".
	 * Defaults to "cli".
	 */
	entrypoint?: string;
	/**
	 * Fixed session UUID sent as X-Claude-Code-Session-Id.
	 * When omitted a random UUID is generated once per extension activation.
	 */
	sessionId?: string;
	/**
	 * Extra beta identifiers appended to the `anthropic-beta` header alongside
	 * the always-included `claude-code-20250219`.
	 * Example: ["interleaved-thinking-2025-05-14"]
	 */
	extraBetas?: string[];
	/**
	 * Anthropic account UUID to embed in request metadata (user_id.account_uuid).
	 * Required for subscription (OAuth/bearer) mode when the proxy validates that the
	 * account_uuid matches the Bearer token.
	 * Find your UUID by decoding your Anthropic Bearer token (JWT) or from
	 * ~/.claude/credentials.json on a machine running the real Claude Code.
	 */
	accountUuid?: string;
	/**
	 * Whether to inject Claude Code's built-in tool stubs into the request body
	 * when no tools are provided by the caller. Claude Code always sends 11 tools
	 * (Agent, Bash, Edit, Glob, Grep, PowerShell, Read, ScheduleWakeup, Skill,
	 * ToolSearch, Write). Some proxies fingerprint on the presence of these tools.
	 * Defaults to true when impersonation is active.
	 */
	injectTools?: boolean;
}

export type ProviderType =
	| 'openai-compatible'
	| 'anthropic-compatible'
	| 'gemini'
	| 'azure-openai'
	| 'bedrock';

export type KeyStorage = 'secret' | 'settings';
export type AuthMode = 'apiKey' | 'bearer';

export interface ProviderCapabilityFlags {
	toolCalling: boolean;
	imageInput: boolean;
	thinking: boolean;
}

export interface ModelDefinition {
	/** Stable id within this provider, used as Copilot Chat model id. */
	id: string;
	/** Display name shown in the picker. */
	displayName: string;
	family: string;
	version: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: ProviderCapabilityFlags;
	/** Real model id sent to the API (defaults to `id` when absent). */
	apiModelId?: string;
	detail?: string;
	description?: string;
	tooltip?: string;
	isUserSelectable?: boolean;
	/** Azure OpenAI deployment name (azure-openai only). */
	deployment?: string;
	/** Azure OpenAI api-version (azure-openai only). */
	apiVersion?: string;
	/** Hidden — UI does not surface this. Model-level override for Claude Code impersonation. */
	claudeCodeImpersonation?: ClaudeCodeImpersonation;
}

export interface ProviderConfig {
	/** Stable provider id (uuid-ish). Used in composite model ids `<providerId>::<modelId>`. */
	id: string;
	type: ProviderType;
	name: string;
	description?: string;
	baseUrl: string;
	keyStorage: KeyStorage;
	/** Optional preset id this provider was seeded from. */
	presetId?: string;
	/** Authentication header style for Anthropic-compatible requests. */
	authMode?: AuthMode;
	/** Whether to invoke vision proxy for non-image-capable models. */
	visionProxy?: boolean;
	/** Extra protocol-specific headers, e.g. anthropic-version, api-key. */
	extraHeaders?: Record<string, string>;
	/** Hidden — UI does not surface this. Provider-level Claude Code impersonation config. */
	claudeCodeImpersonation?: ClaudeCodeImpersonation;
	models: ModelDefinition[];
}

export interface ProviderConfigStoreShape {
	schemaVersion: number;
	providers: ProviderConfig[];
}

export interface PresetTemplate {
	id: string;
	label: string;
	type?: ProviderType;
	defaultBaseUrl?: string;
	description?: string;
	recommendedModels?: ModelDefinition[];
	defaultHeaders?: Record<string, string>;
	apiKeyHint?: string;
}

export type ThinkingEffort = 'none' | 'high' | 'max';

/** Stream callbacks shared across protocol drivers. */
export interface DeltaToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

export interface StreamUsage {
	promptTokens: number;
	completionTokens: number;
	cachedPromptTokens?: number;
	reasoningTokens?: number;
}

export interface StreamCallbacks {
	onContent: (text: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (call: DeltaToolCall) => void;
	onUsage?: (usage: StreamUsage) => void;
	onDone: () => void;
	onError: (err: Error) => void;
}
