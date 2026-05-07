import vscode from 'vscode';
import { CONFIG_SECTION } from '../config';
import { SECRET_KEY_PREFIX } from '../consts';
import type { KeyStorage } from '../types';

/**
 * Routes API key reads/writes between SecretStorage and workspace settings,
 * based on each provider's configured `keyStorage` preference.
 */
export class SecretBackend {
	constructor(private readonly secrets: vscode.SecretStorage) {}

	private secretKey(providerId: string): string {
		return `${SECRET_KEY_PREFIX}${providerId}.apiKey`;
	}

	private readSettingsMap(): Record<string, string> {
		const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
		const v = cfg.get<Record<string, string>>('apiKeys', {});
		return v && typeof v === 'object' ? v : {};
	}

	private async writeSettingsMap(map: Record<string, string>): Promise<void> {
		const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
		await cfg.update('apiKeys', map, vscode.ConfigurationTarget.Global);
	}

	async get(providerId: string, storage: KeyStorage): Promise<string | undefined> {
		if (storage === 'settings') {
			const v = this.readSettingsMap()[providerId];
			return v && v.trim() ? v.trim() : undefined;
		}
		const v = await this.secrets.get(this.secretKey(providerId));
		return v && v.length > 0 ? v : undefined;
	}

	async set(providerId: string, storage: KeyStorage, key: string): Promise<void> {
		const trimmed = key.trim();
		if (storage === 'settings') {
			const map = { ...this.readSettingsMap(), [providerId]: trimmed };
			await this.writeSettingsMap(map);
			return;
		}
		await this.secrets.store(this.secretKey(providerId), trimmed);
	}

	async delete(providerId: string, storage: KeyStorage): Promise<void> {
		if (storage === 'settings') {
			const map = { ...this.readSettingsMap() };
			if (providerId in map) {
				delete map[providerId];
				await this.writeSettingsMap(map);
			}
			return;
		}
		await this.secrets.delete(this.secretKey(providerId));
	}

	/** Move key between storages when user changes provider's keyStorage preference. */
	async migrate(providerId: string, from: KeyStorage, to: KeyStorage): Promise<void> {
		if (from === to) return;
		const v = await this.get(providerId, from);
		if (v !== undefined) {
			await this.set(providerId, to, v);
		}
		await this.delete(providerId, from);
	}

	onDidChange(handler: (event: { providerId: string }) => void): vscode.Disposable {
		return this.secrets.onDidChange((e) => {
			if (e.key.startsWith(SECRET_KEY_PREFIX)) {
				const id = e.key.slice(SECRET_KEY_PREFIX.length).replace(/\.apiKey$/, '');
				handler({ providerId: id });
			}
		});
	}
}
