import vscode from 'vscode';
import { PROVIDERS_STATE_KEY, SCHEMA_VERSION_KEY, SCHEMA_VERSION } from '../consts';
import { CONFIG_SECTION } from '../config';
import { logger } from '../logger';
import type { ProviderConfig } from '../types';
import { migrate } from './schema';
import { SecretBackend } from './secrets';

const PROVIDERS_SETTINGS_KEY = 'providers';

export interface ProviderChangeEvent {
	type: 'add' | 'update' | 'delete' | 'reload';
	providerId?: string;
	provider?: ProviderConfig;
}

export class ConfigStore {
	private readonly emitter = new vscode.EventEmitter<ProviderChangeEvent>();
	readonly onDidChange = this.emitter.event;

	readonly secrets: SecretBackend;

	private cache: ProviderConfig[];

	constructor(context: vscode.ExtensionContext) {
		this.secrets = new SecretBackend(context.secrets);

		// Primary store: settings.json (synced natively via VS Code Settings Sync).
		const fromSettings = this.readFromSettings();
		if (fromSettings.length > 0) {
			this.cache = fromSettings;
		} else {
			// One-time migration from legacy globalState storage.
			const raw = context.globalState.get<unknown>(PROVIDERS_STATE_KEY);
			const migrated = migrate(raw);
			this.cache = migrated.providers;
			if (this.cache.length > 0) {
				void this.persistToSettings();
				void context.globalState.update(PROVIDERS_STATE_KEY, undefined);
				logger.info(`Migrated ${this.cache.length} provider(s) from globalState to settings.json`);
			}
		}

		void context.globalState.update(SCHEMA_VERSION_KEY, SCHEMA_VERSION);

		// Hot-reload when settings.json changes externally (e.g. via Settings Sync or manual edit).
		context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (!e.affectsConfiguration(`${CONFIG_SECTION}.${PROVIDERS_SETTINGS_KEY}`)) return;
				const remote = this.readFromSettings();
				// Skip if the change was caused by our own write.
				if (JSON.stringify(remote) === JSON.stringify(this.cache)) return;
				this.cache = remote;
				this.emitter.fire({ type: 'reload' });
			}),
			this.emitter,
		);
	}

	private readFromSettings(): ProviderConfig[] {
		const raw = vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.get<unknown[]>(PROVIDERS_SETTINGS_KEY, []);
		const migrated = migrate({ schemaVersion: SCHEMA_VERSION, providers: Array.isArray(raw) ? raw : [] });
		return migrated.providers;
	}

	private async persistToSettings(): Promise<void> {
		try {
			await vscode.workspace
				.getConfiguration(CONFIG_SECTION)
				.update(PROVIDERS_SETTINGS_KEY, this.cache, vscode.ConfigurationTarget.Global);
		} catch (err) {
			logger.warn('Failed to persist providers to settings.json', err);
		}
	}

	list(): ProviderConfig[] {
		return this.cache.map((p) => structuredClone(p));
	}

	get(id: string): ProviderConfig | undefined {
		const p = this.cache.find((x) => x.id === id);
		return p ? structuredClone(p) : undefined;
	}

	async upsert(provider: ProviderConfig): Promise<void> {
		const idx = this.cache.findIndex((p) => p.id === provider.id);
		const isAdd = idx === -1;
		if (isAdd) {
			this.cache.push(provider);
		} else {
			this.cache[idx] = provider;
		}
		await this.persistToSettings();
		this.emitter.fire({ type: isAdd ? 'add' : 'update', providerId: provider.id, provider });
	}

	async delete(id: string): Promise<void> {
		const idx = this.cache.findIndex((p) => p.id === id);
		if (idx === -1) return;
		const [removed] = this.cache.splice(idx, 1);
		await this.persistToSettings();
		try {
			await this.secrets.delete(id, removed.keyStorage);
		} catch (err) {
			logger.warn(`Failed to delete secret for ${id}`, err);
		}
		this.emitter.fire({ type: 'delete', providerId: id });
	}
}
