import vscode from 'vscode';
import { logger } from '../logger';
import { safeStringify } from '../json';
import type { ProviderConfig, StreamCallbacks } from '../types';
import type { ChatRequestPayload, NormalizedMessage, ProtocolDriver } from './driver';
import { readSse, throwHttpError } from './sse';

interface GeminiPart {
	text?: string;
	functionCall?: { name: string; args: Record<string, unknown> };
	functionResponse?: { name: string; response: Record<string, unknown> };
}

export class GeminiDriver implements ProtocolDriver {
	readonly type: ProviderConfig['type'] = 'gemini';

	private url(provider: ProviderConfig, model: string, apiKey: string): string {
		const base = provider.baseUrl.replace(/\/$/, '');
		return `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
	}

	async streamChatCompletion(
		payload: ChatRequestPayload,
		callbacks: StreamCallbacks,
		token: vscode.CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelSub = token.onCancellationRequested(() => controller.abort());
		try {
			const apiModel = payload.model.apiModelId || payload.model.id;
			const body = this.buildBody(payload.messages, payload);
			logger.debug('Gemini request', body);
			const res = await fetch(this.url(payload.provider, apiModel, payload.apiKey), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(payload.provider.extraHeaders ?? {}) },
				body: safeStringify(body),
				signal: controller.signal,
			});
			if (!res.ok) await throwHttpError(res, payload.provider.name);
			if (!res.body) throw new Error('No response body');

			for await (const ev of readSse(res.body, controller.signal)) {
				if (!ev.data) continue;
				let json: {
					candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
					usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
				};
				try {
					json = JSON.parse(ev.data);
				} catch (err) {
					logger.warn('Failed to parse Gemini SSE chunk', err, ev.data.slice(0, 160));
					continue;
				}
				if (json.usageMetadata && callbacks.onUsage) {
					callbacks.onUsage({
						promptTokens: json.usageMetadata.promptTokenCount ?? 0,
						completionTokens: json.usageMetadata.candidatesTokenCount ?? 0,
					});
				}
				const cand = json.candidates?.[0];
				if (!cand) continue;
				const parts = cand.content?.parts ?? [];
				for (const p of parts) {
					if (p.text) callbacks.onContent(p.text);
					if (p.functionCall) {
						callbacks.onToolCall({
							id: `gemini-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
							name: p.functionCall.name,
							argumentsJson: safeStringify(p.functionCall.args ?? {}),
						});
					}
				}
				if (cand.finishReason && cand.finishReason !== 'OTHER') {
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

	private buildBody(messages: NormalizedMessage[], payload: ChatRequestPayload): Record<string, unknown> {
		const systemSegments: string[] = [];
		const contents: Record<string, unknown>[] = [];
		for (const m of messages) {
			if (m.role === 'system') {
				if (m.content) systemSegments.push(m.content);
				continue;
			}
			if (m.role === 'tool') {
				let response: Record<string, unknown> = {};
				try {
					response = JSON.parse(m.content);
				} catch {
					response = { result: m.content };
				}
				contents.push({
					role: 'function',
					parts: [{ functionResponse: { name: m.toolCallId ?? 'tool', response } }],
				});
				continue;
			}
			const role = m.role === 'assistant' ? 'model' : 'user';
			const parts: GeminiPart[] = [];
			if (m.content) parts.push({ text: m.content });
			if (m.toolCalls) {
				for (const tc of m.toolCalls) {
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(tc.argumentsJson || '{}');
					} catch {
						// ignore
					}
					parts.push({ functionCall: { name: tc.name, args } });
				}
			}
			contents.push({ role, parts });
		}
		const body: Record<string, unknown> = { contents };
		if (systemSegments.length > 0) {
			body.systemInstruction = { role: 'user', parts: [{ text: systemSegments.join('\n\n') }] };
		}
		if (payload.tools && payload.tools.length > 0) {
			body.tools = [
				{
					functionDeclarations: payload.tools.map((t) => ({
						name: t.name,
						description: t.description,
						parameters: t.parameters,
					})),
				},
			];
		}
		const generationConfig: Record<string, unknown> = {};
		if (payload.maxOutputTokens && payload.maxOutputTokens > 0) {
			generationConfig.maxOutputTokens = payload.maxOutputTokens;
		}
		if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
		return body;
	}
}
