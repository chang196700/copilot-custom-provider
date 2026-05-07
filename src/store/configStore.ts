import vscode from 'vscode';
import { PROVIDERS_STATE_KEY, SCHEMA_VERSION_KEY, SCHEMA_VERSION } from '../consts';
import { logger } from '../logger';
import type { ProviderConfig, ProviderConfigStoreShape } from '../types';
import { migrate } from './schema';
import { SecretBackend } from './secrets';
import { SyncMirror } from './sync';

export interface ProviderChangeEvent {
	type: 'add' | 'update' | 'delete' | 'reload';
	providerId?: string;
	provider?: ProviderConfig;
}

export class ConfigStore {
	private readonly emitter = new vscode.EventEmitter<ProviderChangeEvent>();
	readonly onDidChange = this.emitter.event;

	readonly secrets: SecretBackend;
	readonly sync: SyncMirror;

	private cache: ProviderConfigStoreShape;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.secrets = new SecretBackend(context.secrets);
		this.sync = new SyncMirror();
		const raw = context.globalState.get<unknown>(PROVIDERS_STATE_KEY);
		this.cache = migrate(raw);
		void context.globalState.update(SCHEMA_VERSION_KEY, SCHEMA_VERSION);

		// If globalState empty but mirror has data, restore from mirror.
		if (this.cache.providers.length === 0 && this.sync.enabled()) {
			const restored = this.sync.read();
			if (restored.length > 0) {
				this.cache = { schemaVersion: SCHEMA_VERSION, providers: restored };
				void this.persist();
				logger.info(`Restored ${restored.length} provider(s) from sync mirror.`);
			}
		}

		// React to external setting changes (Settings Sync from another device).
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('copilot-custom-provider.providersMirror') && this.sync.enabled()) {
					const remote = this.sync.read();
					this.cache = { schemaVersion: SCHEMA_VERSION, providers: remote };
					void this.context.globalState.update(PROVIDERS_STATE_KEY, this.cache);
					this.emitter.fire({ type: 'reload' });
				}
				if (e.affectsConfiguration('copilot-custom-provider.syncProviders')) {
					if (this.sync.enabled()) {
						void this.sync.push(this.cache.providers);
					} else {
						void this.sync.clear();
					}
				}
			}),
			this.emitter,
		);
	}

	list(): ProviderConfig[] {
		return this.cache.providers.map((p) => structuredClone(p));
	}

	get(id: string): ProviderConfig | undefined {
		const p = this.cache.providers.find((x) => x.id === id);
		return p ? structuredClone(p) : undefined;
	}

	async upsert(provider: ProviderConfig): Promise<void> {
		const idx = this.cache.providers.findIndex((p) => p.id === provider.id);
		const isAdd = idx === -1;
		if (isAdd) {
			this.cache.providers.push(provider);
		} else {
			this.cache.providers[idx] = provider;
		}
		await this.persist();
		this.emitter.fire({ type: isAdd ? 'add' : 'update', providerId: provider.id, provider });
	}

	async delete(id: string): Promise<void> {
		const idx = this.cache.providers.findIndex((p) => p.id === id);
		if (idx === -1) return;
		const [removed] = this.cache.providers.splice(idx, 1);
		await this.persist();
		try {
			await this.secrets.delete(id, removed.keyStorage);
		} catch (err) {
			logger.warn(`Failed to delete secret for ${id}`, err);
		}
		this.emitter.fire({ type: 'delete', providerId: id });
	}

	private async persist(): Promise<void> {
		await this.context.globalState.update(PROVIDERS_STATE_KEY, this.cache);
		if (this.sync.enabled()) {
			await this.sync.push(this.cache.providers);
		}
	}
}
