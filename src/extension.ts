import vscode from 'vscode';
import { initI18n } from './i18n';
import { logger } from './logger';
import { ProviderRegistry } from './registry';
import { ConfigStore } from './store/configStore';
import { ProviderManagerPanel } from './webview/panel';

export function activate(context: vscode.ExtensionContext): void {
	initI18n(context);
	logger.info(`Activating copilot-custom-provider version=${context.extension.packageJSON.version}`);
	try {
		const store = new ConfigStore(context);
		const registry = new ProviderRegistry(context, store);
		registry.bootstrap();

		context.subscriptions.push(
			vscode.commands.registerCommand('copilot-custom-provider.openManager', () => {
				ProviderManagerPanel.show(context, store);
			}),
			vscode.commands.registerCommand('copilot-custom-provider.addProvider', () => {
				ProviderManagerPanel.show(context, store);
			}),
			vscode.commands.registerCommand('copilot-custom-provider.refreshAll', () => {
				registry.refresh();
				vscode.window.showInformationMessage('LM Custom Provider: providers refreshed.');
			}),
			vscode.commands.registerCommand('copilot-custom-provider.showLogs', () => logger.show()),
		);

		logger.info(`copilot-custom-provider activated with ${store.list().length} provider(s).`);
	} catch (err) {
		logger.error('Activation failed', err);
		throw err;
	}
}

export function deactivate(): void {
	logger.info('copilot-custom-provider deactivated');
	logger.dispose();
}
