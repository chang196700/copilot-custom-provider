import vscode from 'vscode';
import { logger } from '../logger';
import { safeStringify } from '../json';
import type { ProviderConfig, StreamCallbacks, ThinkingEffort } from '../types';
import type {
	ChatRequestPayload,
	NormalizedMessage,
	ProtocolDriver,
	RemoteModelDescriptor,
} from './driver';
import { sanitizeJsonSchema } from './driver';
import { readSse, throwHttpError } from './sse';

interface OpenAIToolCallDelta {
	index: number;
	id?: string;
	function?: { name?: string; arguments?: string };
}

interface OpenAIChunk {
	choices?: {
		delta: {
			content?: string;
			reasoning_content?: string;
			tool_calls?: OpenAIToolCallDelta[];
		};
		finish_reason?: string | null;
	}[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		prompt_tokens_details?: { cached_tokens?: number };
		completion_tokens_details?: { reasoning_tokens?: number };
	};
}

export class OpenAIDriver implements ProtocolDriver {
	readonly type: ProviderConfig['type'] = 'openai-compatible';

	protected normaliseUrl(provider: ProviderConfig): string {
		return provider.baseUrl.replace(/\/$/, '');
	}

	protected buildEndpoint(provider: ProviderConfig): string {
		return `${this.normaliseUrl(provider)}/chat/completions`;
	}

	protected modelsEndpoint(provider: ProviderConfig): string {
		return `${this.normaliseUrl(provider)}/models`;
	}

	protected buildHeaders(provider: ProviderConfig, apiKey: string): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
			...(provider.extraHeaders ?? {}),
		};
	}

	protected resolveUrl(payload: ChatRequestPayload): string {
		return this.buildEndpoint(payload.provider);
	}

	protected buildBody(payload: ChatRequestPayload): Record<string, unknown> {
		const apiModel = payload.model.apiModelId || payload.model.id;
		const body: Record<string, unknown> = {
			model: apiModel,
			messages: payload.messages.map((m) => this.toApiMessage(m)),
			stream: true,
			stream_options: { include_usage: true },
		};
		if (payload.tools && payload.tools.length > 0) {
			body.tools = payload.tools.map((tool) => ({
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters ? sanitizeJsonSchema(tool.parameters) : undefined,
				},
			}));
			body.tool_choice = 'auto';
		}
		if (payload.maxOutputTokens && payload.maxOutputTokens > 0) {
			body.max_tokens = payload.maxOutputTokens;
		}
		if (payload.model.capabilities.thinking) {
			if (payload.thinkingEffort === 'none') {
				body.thinking = { type: 'disabled' };
			} else {
				body.reasoning_effort = mapThinkingEffort(payload.thinkingEffort);
				body.thinking = { type: 'enabled' };
			}
		}
		return body;
	}

	protected toApiMessage(m: NormalizedMessage): Record<string, unknown> {
		if (m.role === 'tool') {
			return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
		}
		if (m.role === 'assistant') {
			const out: Record<string, unknown> = { role: 'assistant', content: m.content };
			if (m.toolCalls && m.toolCalls.length > 0) {
				out.tool_calls = m.toolCalls.map((c) => ({
					id: c.id,
					type: 'function',
					function: { name: c.name, arguments: c.argumentsJson },
				}));
			}
			if (m.reasoningContent) out.reasoning_content = m.reasoningContent;
			return out;
		}
		return { role: m.role, content: m.content };
	}

	async streamChatCompletion(
		payload: ChatRequestPayload,
		callbacks: StreamCallbacks,
		token: vscode.CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelSub = token.onCancellationRequested(() => controller.abort());
		try {
			const body = this.buildBody(payload);
			logger.debug('OpenAI request', body);
			const res = await fetch(this.resolveUrl(payload), {
				method: 'POST',
				headers: this.buildHeaders(payload.provider, payload.apiKey),
				body: safeStringify(body),
				signal: controller.signal,
			});
			if (!res.ok) {
				await throwHttpError(res, payload.provider.name);
			}
			if (!res.body) throw new Error('No response body');

			const pendingToolCalls = new Map<number, { id: string; name: string; argumentsJson: string }>();
			for await (const ev of readSse(res.body, controller.signal)) {
				const data = ev.data;
				if (data === '[DONE]') {
					for (const c of pendingToolCalls.values()) callbacks.onToolCall(c);
					pendingToolCalls.clear();
					callbacks.onDone();
					return;
				}
				let chunk: OpenAIChunk;
				try {
					chunk = JSON.parse(data);
				} catch (err) {
					logger.warn('Failed to parse SSE chunk', err, data.slice(0, 160));
					continue;
				}
				if (chunk.usage && callbacks.onUsage) {
					callbacks.onUsage({
						promptTokens: chunk.usage.prompt_tokens,
						completionTokens: chunk.usage.completion_tokens,
						cachedPromptTokens: chunk.usage.prompt_tokens_details?.cached_tokens,
						reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens,
					});
				}
				const choice = chunk.choices?.[0];
				if (!choice) continue;
				if (choice.delta.reasoning_content) callbacks.onThinking(choice.delta.reasoning_content);
				if (choice.delta.content) callbacks.onContent(choice.delta.content);
				if (choice.delta.tool_calls) {
					for (const tc of choice.delta.tool_calls) {
						let pending = pendingToolCalls.get(tc.index);
						if (!pending && tc.id) {
							pending = { id: tc.id, name: '', argumentsJson: '' };
							pendingToolCalls.set(tc.index, pending);
						}
						if (pending) {
							if (tc.function?.name) pending.name += tc.function.name;
							if (tc.function?.arguments) pending.argumentsJson += tc.function.arguments;
						}
					}
				}
				if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
					for (const c of pendingToolCalls.values()) callbacks.onToolCall(c);
					pendingToolCalls.clear();
				}
			}
			callbacks.onDone();
		} catch (err) {
			if (token.isCancellationRequested && (err as Error).name === 'AbortError') return;
			callbacks.onError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			cancelSub.dispose();
		}
	}

	async listRemoteModels(
		provider: ProviderConfig,
		apiKey: string,
	): Promise<RemoteModelDescriptor[]> {
		const res = await fetch(this.modelsEndpoint(provider), {
			headers: this.buildHeaders(provider, apiKey),
		});
		if (!res.ok) await throwHttpError(res, provider.name);
		const json = (await res.json()) as { data?: { id: string; context_length?: number }[] };
		return (json.data ?? []).map((m) => ({ id: m.id, contextWindow: m.context_length }));
	}
}

function mapThinkingEffort(effort: Exclude<ThinkingEffort, 'none'>): string {
	switch (effort) {
		case 'low':
			return 'low';
		case 'adaptive':
		case 'medium':
			return 'medium';
		case 'high':
		case 'max':
			return 'high';
	}
}
