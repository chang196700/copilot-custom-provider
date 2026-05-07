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
