import vscode from 'vscode';
import { safeStringify } from '../json';
import type { NormalizedMessage, NormalizedTool } from '../protocol/driver';
import {
	createPostToolReasoningKey,
	createToolReasoningKey,
	type ReasoningEntry,
} from './cache';

interface PendingToolCall {
	id: string;
	name: string;
	argumentsJson: string;
}

/** Convert VS Code chat messages to provider-neutral normalised form. */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	isThinkingModel: boolean,
	reasoningCache: Map<string, ReasoningEntry>,
): NormalizedMessage[] {
	const result: NormalizedMessage[] = [];
	let recentToolResultIds: string[] = [];

	for (const message of messages) {
		const role = mapRole(message.role);
		let content = '';
		const toolCalls: PendingToolCall[] = [];
		const toolResults: { callId: string; content: string }[] = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId,
					name: part.name,
					argumentsJson: safeStringify(part.input),
				});
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				let toolContent = '';
				for (const item of part.content) {
					if (item instanceof vscode.LanguageModelTextPart) toolContent += item.value;
				}
				toolResults.push({
					callId: part.callId,
					content: toolContent || safeStringify(part.content),
				});
			}
		}

		if (role === 'assistant') {
			let reasoningContent: string | undefined;
			if (isThinkingModel && toolCalls.length > 0) {
				for (const tc of toolCalls) {
					const cached = reasoningCache.get(createToolReasoningKey(tc.id));
					if (cached) {
						reasoningContent = cached.text;
						break;
					}
				}
			} else if (isThinkingModel && recentToolResultIds.length > 0) {
				reasoningContent = reasoningCache.get(
					createPostToolReasoningKey(recentToolResultIds),
				)?.text;
			}

			if (content || toolCalls.length > 0) {
				result.push({
					role: 'assistant',
					content: content || '',
					toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
					reasoningContent: isThinkingModel ? (reasoningContent ?? '') : undefined,
				});
				recentToolResultIds = [];
			}
		} else if (role === 'user') {
			if (content) {
				recentToolResultIds = [];
				result.push({ role: 'user', content });
			}
		} else {
			// system role goes through as-is
			if (content) result.push({ role: 'system', content });
		}

		for (const tr of toolResults) {
			result.push({ role: 'tool', content: tr.content, toolCallId: tr.callId });
			recentToolResultIds.push(tr.callId);
		}
	}

	return result;
}

function mapRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' | 'system' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			return 'user';
	}
}

export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): NormalizedTool[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		parameters: t.inputSchema as Record<string, unknown> | undefined,
	}));
}

export function countMessageChars(messages: readonly NormalizedMessage[]): number {
	let total = 0;
	for (const m of messages) {
		total += m.content?.length ?? 0;
		if (m.toolCalls) {
			for (const tc of m.toolCalls) {
				total += tc.name.length + tc.argumentsJson.length;
			}
		}
	}
	return total;
}

export function collectTrailingToolResultIds(messages: readonly NormalizedMessage[]): string[] {
	const trailing: string[] = [];
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const m = messages[i];
		if (m.role !== 'tool' || !m.toolCallId) break;
		trailing.push(m.toolCallId);
	}
	return trailing.reverse();
}
