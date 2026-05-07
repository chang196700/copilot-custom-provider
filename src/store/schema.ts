import type { ProviderConfig, ProviderConfigStoreShape } from '../types';
import { SCHEMA_VERSION } from '../consts';

/** Migrate persisted config to the current SCHEMA_VERSION. */
export function migrate(raw: unknown): ProviderConfigStoreShape {
	if (!raw || typeof raw !== 'object') {
		return { schemaVersion: SCHEMA_VERSION, providers: [] };
	}
	const obj = raw as Partial<ProviderConfigStoreShape>;
	const providers: ProviderConfig[] = Array.isArray(obj.providers)
		? obj.providers.filter((p): p is ProviderConfig => isProvider(p))
		: [];
	return {
		schemaVersion: SCHEMA_VERSION,
		providers,
	};
}

function isProvider(p: unknown): p is ProviderConfig {
	if (!p || typeof p !== 'object') return false;
	const o = p as Record<string, unknown>;
	return (
		typeof o.id === 'string' &&
		typeof o.type === 'string' &&
		typeof o.name === 'string' &&
		typeof o.baseUrl === 'string' &&
		(o.keyStorage === 'secret' || o.keyStorage === 'settings') &&
		Array.isArray(o.models)
	);
}
