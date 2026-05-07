import vscode from 'vscode';
import { CONFIG_SECTION } from '../config';
import { logger } from '../logger';
import type { ProviderConfig } from '../types';

const MIRROR_KEY = 'providersMirror';

/** Mirror provider definitions (without API keys) to settings.json so VS Code Settings Sync can carry them. */
export class SyncMirror {
	constructor() {}

	private cfg() {
		return vscode.workspace.getConfiguration(CONFIG_SECTION);
	}

	enabled(): boolean {
		return this.cfg().get<boolean>('syncProviders', false);
	}

	async push(providers: ProviderConfig[]): Promise<void> {
		if (!this.enabled()) return;
		try {
			const sanitised = providers.map((p) => ({ ...p }));
			await this.cfg().update(MIRROR_KEY, sanitised, vscode.ConfigurationTarget.Global);
		} catch (err) {
			logger.warn('Sync mirror push failed', err);
		}
	}

	async clear(): Promise<void> {
		try {
			await this.cfg().update(MIRROR_KEY, undefined, vscode.ConfigurationTarget.Global);
		} catch (err) {
			logger.warn('Sync mirror clear failed', err);
		}
	}

	read(): ProviderConfig[] {
		const raw = this.cfg().get<unknown[]>(MIRROR_KEY, []);
		return Array.isArray(raw) ? (raw as ProviderConfig[]) : [];
	}
}
