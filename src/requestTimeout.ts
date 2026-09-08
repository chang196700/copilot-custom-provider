/** Shared validation for settings, provider drafts and request snapshots. */
export const DEFAULT_REQUEST_IDLE_TIMEOUT_SECONDS = 300;
export const MAX_REQUEST_IDLE_TIMEOUT_SECONDS = 2147483;

export function isValidRequestIdleTimeout(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= 0 &&
		value <= MAX_REQUEST_IDLE_TIMEOUT_SECONDS
	);
}

export function resolveRequestIdleTimeout(providerValue: unknown, globalValue: unknown): number {
	return isValidRequestIdleTimeout(providerValue)
		? providerValue
		: isValidRequestIdleTimeout(globalValue)
			? globalValue
			: DEFAULT_REQUEST_IDLE_TIMEOUT_SECONDS;
}
