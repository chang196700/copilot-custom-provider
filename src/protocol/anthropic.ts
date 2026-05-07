import vscode from 'vscode';
import { logger } from '../logger';
import { safeStringify } from '../json';
import type { ProviderConfig, StreamCallbacks } from '../types';
import type { ChatRequestPayload, ProtocolDriver } from './driver';
import { readSse, throwHttpError } from './sse';

interface AnthropicContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	partial_json?: string;
}

export class AnthropicDriver implements ProtocolDriver {
	readonly type: ProviderConfig['type'] = 'anthropic-compatible';

	private url(provider: ProviderConfig): string {
		return `${provider.baseUrl.replace(/\/$/, '')}/v1/messages`;
	}

	private headers(provider: ProviderConfig, apiKey: string): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'x-api-key': apiKey,
			'anthropic-version': provider.extraHeaders?.['anthropic-version'] ?? '2023-06-01',
			...(provider.extraHeaders ?? {}),
		};
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
			logger.debug('Anthropic request', body);
			const res = await fetch(this.url(payload.provider), {
				method: 'POST',
				headers: this.headers(payload.provider, payload.apiKey),
				body: safeStringify(body),
				signal: controller.signal,
			});
			if (!res.ok) await throwHttpError(res, payload.provider.name);
			if (!res.body) throw new Error('No response body');

			const blocks = new Map<number, { type: string; toolId?: string; toolName?: string; argsJson: string }>();
			for await (const ev of readSse(res.body, controller.signal)) {
				if (!ev.data || ev.data === '[DONE]') continue;
				let json: { type: string; index?: number; delta?: AnthropicContentBlock; content_block?: AnthropicContentBlock; message?: { usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } }; usage?: { input_tokens: number; output_tokens: number } };
				try {
					json = JSON.parse(ev.data);
				} catch (err) {
					logger.warn('Failed to parse Anthropic SSE chunk', err, ev.data.slice(0, 160));
					continue;
				}
				switch (json.type) {
					case 'message_start':
						if (json.message?.usage && callbacks.onUsage) {
							callbacks.onUsage({
								promptTokens: json.message.usage.input_tokens,
								completionTokens: json.message.usage.output_tokens,
								cachedPromptTokens: json.message.usage.cache_read_input_tokens,
							});
						}
						break;
					case 'content_block_start': {
						const idx = json.index ?? 0;
						const cb = json.content_block;
						if (!cb) break;
						blocks.set(idx, {
							type: cb.type,
							toolId: cb.id,
							toolName: cb.name,
							argsJson: '',
						});
						break;
					}
					case 'content_block_delta': {
						const idx = json.index ?? 0;
						const block = blocks.get(idx);
						const d = json.delta;
						if (!block || !d) break;
						if (d.type === 'text_delta' && d.text) callbacks.onContent(d.text);
						else if (d.type === 'thinking_delta' && d.thinking) callbacks.onThinking(d.thinking);
						else if (d.type === 'input_json_delta' && d.partial_json) block.argsJson += d.partial_json;
						break;
					}
					case 'content_block_stop': {
						const idx = json.index ?? 0;
						const block = blocks.get(idx);
						if (block && block.type === 'tool_use' && block.toolId && block.toolName) {
							callbacks.onToolCall({
								id: block.toolId,
								name: block.toolName,
								argumentsJson: block.argsJson || '{}',
							});
						}
						blocks.delete(idx);
						break;
					}
					case 'message_delta':
						if (json.usage && callbacks.onUsage) {
							callbacks.onUsage({
								promptTokens: json.usage.input_tokens,
								completionTokens: json.usage.output_tokens,
							});
						}
						break;
					case 'message_stop':
						callbacks.onDone();
						return;
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

	private buildBody(payload: ChatRequestPayload): Record<string, unknown> {
		const apiModel = payload.model.apiModelId || payload.model.id;
		const systemSegments: string[] = [];
		const messages: Record<string, unknown>[] = [];

		// Anthropic groups consecutive tool_results into a single user message with content array.
		let pendingToolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
		const flushToolResults = () => {
			if (pendingToolResults.length > 0) {
				messages.push({ role: 'user', content: pendingToolResults });
				pendingToolResults = [];
			}
		};

		for (const m of payload.messages) {
			if (m.role === 'system') {
				if (m.content) systemSegments.push(m.content);
				continue;
			}
			if (m.role === 'tool') {
				pendingToolResults.push({
					type: 'tool_result',
					tool_use_id: m.toolCallId ?? '',
					content: m.content,
				});
				continue;
			}
			flushToolResults();
			if (m.role === 'user') {
				messages.push({ role: 'user', content: m.content });
				continue;
			}
			// assistant
			const blocks: Record<string, unknown>[] = [];
			if (m.content) blocks.push({ type: 'text', text: m.content });
			if (m.toolCalls) {
				for (const tc of m.toolCalls) {
					let input: unknown = {};
					try {
						input = JSON.parse(tc.argumentsJson || '{}');
					} catch {
						// leave default
					}
					blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
				}
			}
			messages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : m.content });
		}
		flushToolResults();

		const body: Record<string, unknown> = {
			model: apiModel,
			messages,
			stream: true,
			max_tokens: payload.maxOutputTokens && payload.maxOutputTokens > 0 ? payload.maxOutputTokens : payload.model.maxOutputTokens || 4096,
		};
		if (systemSegments.length > 0) body.system = systemSegments.join('\n\n');
		if (payload.tools && payload.tools.length > 0) {
			body.tools = payload.tools.map((t) => ({
				name: t.name,
				description: t.description,
				input_schema: t.parameters ?? { type: 'object', properties: {} },
			}));
		}
		if (payload.model.capabilities.thinking && payload.thinkingEffort !== 'none') {
			const budget = payload.thinkingEffort === 'max' ? 16000 : 4000;
			body.thinking = { type: 'enabled', budget_tokens: budget };
		}
		return body;
	}
}
