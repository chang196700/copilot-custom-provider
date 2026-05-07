import { MAX_REASONING_CACHE } from '../consts';

export interface ReasoningEntry {
	text: string;
	timestamp: number;
}

export function createToolReasoningKey(toolCallId: string): string {
	return `tool:${toolCallId}`;
}

export function createPostToolReasoningKey(toolCallIds: readonly string[]): string {
	return `post-tool:${JSON.stringify(toolCallIds)}`;
}

export function pruneReasoningCache(cache: Map<string, ReasoningEntry>, clearAll: boolean): void {
	if (clearAll) {
		cache.clear();
		return;
	}
	if (cache.size <= MAX_REASONING_CACHE) return;
	const sorted = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
	const toRemove = sorted.slice(0, sorted.length - MAX_REASONING_CACHE);
	for (const [key] of toRemove) cache.delete(key);
}
