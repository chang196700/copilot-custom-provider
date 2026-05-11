import vscode from 'vscode';
import type { ModelDefinition, ProviderConfig, StreamCallbacks, ThinkingEffort } from '../types';

/** Generic chat message used as input to drivers (post vision-resolution). */
export interface NormalizedMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCalls?: { id: string; name: string; argumentsJson: string }[];
	toolCallId?: string;
	reasoningContent?: string;
}

export interface NormalizedTool {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
}

export interface ChatRequestPayload {
	messages: NormalizedMessage[];
	tools: NormalizedTool[] | undefined;
	maxOutputTokens?: number;
	thinkingEffort: ThinkingEffort;
	model: ModelDefinition;
	provider: ProviderConfig;
	apiKey: string;
}

export interface RemoteModelDescriptor {
	id: string;
	displayName?: string;
	contextWindow?: number;
}

export interface ProtocolDriver {
	readonly type: ProviderConfig['type'];
	streamChatCompletion(
		payload: ChatRequestPayload,
		callbacks: StreamCallbacks,
		token: vscode.CancellationToken,
	): Promise<void>;
	listRemoteModels?(provider: ProviderConfig, apiKey: string): Promise<RemoteModelDescriptor[]>;
}

/**
 * Non-standard JSON Schema keys injected by VS Code or draft-only annotations
 * that strict APIs (Gemini, some OpenAI-compatible backends) reject.
 */
const NON_STANDARD_SCHEMA_KEYS = new Set([
	'$comment',
	'enumDescriptions',
	'markdownDescription',
	'deprecationMessage',
	'errorMessage',
]);

/**
 * Recursively strip non-standard JSON Schema fields from a tool parameter
 * schema before sending it to any remote API.
 */
export function sanitizeJsonSchema(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(sanitizeJsonSchema);
	if (schema !== null && typeof schema === 'object') {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
			if (!NON_STANDARD_SCHEMA_KEYS.has(k)) result[k] = sanitizeJsonSchema(v);
		}
		return result;
	}
	return schema;
}
