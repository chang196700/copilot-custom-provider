/** SSE line reader. Yields parsed events (data lines joined). */
export interface SseEvent {
	event?: string;
	data: string;
}

export async function* readSse(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let currentEvent: string | undefined;
	const dataLines: string[] = [];

	const flush = (): SseEvent | undefined => {
		if (dataLines.length === 0 && currentEvent === undefined) return undefined;
		const ev: SseEvent = { event: currentEvent, data: dataLines.join('\n') };
		currentEvent = undefined;
		dataLines.length = 0;
		return ev;
	};

	try {
		while (true) {
			if (signal?.aborted) return;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			let nlIdx: number;
			while ((nlIdx = buffer.indexOf('\n')) !== -1) {
				const rawLine = buffer.slice(0, nlIdx).replace(/\r$/, '');
				buffer = buffer.slice(nlIdx + 1);
				if (rawLine === '') {
					const ev = flush();
					if (ev) yield ev;
					continue;
				}
				if (rawLine.startsWith(':')) continue;
				if (rawLine.startsWith('event:')) {
					currentEvent = rawLine.slice(6).trim();
				} else if (rawLine.startsWith('data:')) {
					dataLines.push(rawLine.slice(5).replace(/^ /, ''));
				}
			}
		}
		const tail = flush();
		if (tail) yield tail;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}
}

/** Throw a friendly error from a non-OK fetch response. */
export async function throwHttpError(response: Response, providerName: string): Promise<never> {
	const text = await response.text().catch(() => '');
	let detail = text;
	try {
		const j = JSON.parse(text);
		detail = j.error?.message || j.message || text;
	} catch {
		// ignore
	}
	throw new Error(`${providerName} API error (${response.status}): ${detail || response.statusText}`);
}
