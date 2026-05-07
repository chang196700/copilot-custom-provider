/** JSON.stringify with cycle/non-serialisable safety. */
export function safeStringify(value: unknown): string {
	try {
		const seen = new WeakSet<object>();
		return JSON.stringify(value, (_key, v) => {
			if (typeof v === 'object' && v !== null) {
				if (seen.has(v)) return '[Circular]';
				seen.add(v);
			}
			if (typeof v === 'bigint') return v.toString();
			if (typeof v === 'function') return undefined;
			return v;
		});
	} catch {
		return String(value);
	}
}
