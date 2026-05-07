/** Core types shared across the extension. */

export type ProviderType =
	| 'openai-compatible'
	| 'anthropic-compatible'
	| 'gemini'
	| 'azure-openai'
	| 'bedrock';

export type KeyStorage = 'secret' | 'settings';

export interface ProviderCapabilityFlags {
	toolCalling: boolean;
	imageInput: boolean;
	thinking: boolean;
}

export interface ModelDefinition {
	/** Stable id within this provider, used as Copilot Chat model id. */
	id: string;
	/** Internal name (typically same as id). */
	name: string;
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
	/** Whether to invoke vision proxy for non-image-capable models. */
	visionProxy?: boolean;
	/** Extra protocol-specific headers, e.g. anthropic-version, api-key. */
	extraHeaders?: Record<string, string>;
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
