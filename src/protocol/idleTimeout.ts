interface CancellationToken {
	readonly isCancellationRequested: boolean;
	onCancellationRequested(listener: () => void): { dispose(): void };
}

/** One request's timer; counts raw response bytes, including SSE comments. */
export class IdleTimeoutRequest {
	readonly controller = new AbortController();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private readonly subscription: { dispose(): void };
	private disposed = false;
	error: Error | undefined;

	constructor(
		private readonly seconds: number,
		token: CancellationToken,
		private readonly timeoutMessage: string,
	) {
		this.subscription = token.onCancellationRequested(() => {
			this.clearTimer();
			this.controller.abort();
		});
		if (token.isCancellationRequested) this.controller.abort();
	}

	private clearTimer(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	private touch(): void {
		this.clearTimer();
		if (!this.seconds || this.disposed || this.controller.signal.aborted) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.error = new Error(this.timeoutMessage);
			this.error.name = 'RequestIdleTimeoutError';
			this.controller.abort(this.error);
		}, this.seconds * 1000);
	}

	throwIfTimedOut(): void {
		if (this.error) throw this.error;
	}

	async fetch(url: string, init: RequestInit): Promise<Response> {
		this.touch();
		const response = await fetch(url, { ...init, signal: this.controller.signal });
		this.throwIfTimedOut();
		this.touch();
		if (!response.body) return response;
		const reader = response.body.getReader();
		const body = new ReadableStream<Uint8Array>({
			pull: async (stream) => {
				try {
					const { done, value } = await reader.read();
					this.throwIfTimedOut();
					if (done) {
						this.clearTimer();
						reader.releaseLock();
						stream.close();
					} else {
						if (value.byteLength) this.touch();
						stream.enqueue(value);
					}
				} catch (error) {
					this.clearTimer();
					reader.releaseLock();
					stream.error(this.error ?? error);
				}
			},
			cancel: async (reason) => {
				this.clearTimer();
				await reader.cancel(reason);
				reader.releaseLock();
			},
		});
		return new Response(body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	}

	dispose(): void {
		this.disposed = true;
		this.clearTimer();
		this.subscription.dispose();
		// Protocol completion markers can arrive before the HTTP stream closes.
		this.controller.abort();
	}
}
