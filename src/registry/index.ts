import vscode from 'vscode';
import { VENDOR_ID } from '../consts';
import { logger } from '../logger';
import { AggregateChatProvider } from '../provider/aggregate';
import type { ConfigStore } from '../store/configStore';

/**
 * Owns the single `vscode.lm.registerLanguageModelChatProvider` registration for vendor `copilot-custom-provider`.
 * The aggregating adapter exposes models from every configured provider; on any provider
 * change we just fire onDidChangeLanguageModelChatInformation so the model picker refreshes.
 */
export class ProviderRegistry {
	private adapter: AggregateChatProvider | undefined;
	private registration: vscode.Disposable | undefined;

	constructor(
		context: vscode.ExtensionContext,
		private readonly store: ConfigStore,
	) {
		context.subscriptions.push(
			store.onDidChange(() => this.adapter?.notifyChange()),
			store.secrets.onDidChange(() => this.adapter?.notifyChange()),
			new vscode.Disposable(() => this.dispose()),
		);
	}

	bootstrap(): void {
		if (this.registration) return;
		this.adapter = new AggregateChatProvider(this.store);
		try {
			this.registration = vscode.lm.registerLanguageModelChatProvider(VENDOR_ID, this.adapter);
			logger.info(
				`Registered LM provider vendor=${VENDOR_ID} with ${this.store.list().length} configured provider(s).`,
			);
		} catch (err) {
			logger.error('Failed to register LM provider', err);
			this.adapter.dispose();
			this.adapter = undefined;
		}
	}

	refresh(): void {
		this.adapter?.notifyChange();
	}

	dispose(): void {
		this.registration?.dispose();
		this.registration = undefined;
		this.adapter?.dispose();
		this.adapter = undefined;
	}
}
