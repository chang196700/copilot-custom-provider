import vscode from 'vscode';
import { getStrings } from '../i18n';
import { logger } from '../logger';
import { PRESETS } from '../presets';
import type { ConfigStore } from '../store/configStore';
import { createDriver } from '../protocol';
import type { HostToWebviewMessage, WebviewToHostMessage } from './messages';

/**
 * Owns the singleton Provider Manager webview panel and bridges messages
 * between the extension host and the Lit-based UI.
 */
export class ProviderManagerPanel {
	private static current: ProviderManagerPanel | undefined;

	static show(context: vscode.ExtensionContext, store: ConfigStore): ProviderManagerPanel {
		if (ProviderManagerPanel.current) {
			ProviderManagerPanel.current.panel.reveal(vscode.ViewColumn.Active);
			return ProviderManagerPanel.current;
		}
		const panel = vscode.window.createWebviewPanel(
			'copilot-custom-provider.providerManager',
			'Copilot Custom Provider',
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out', 'webview')],
			},
		);
		ProviderManagerPanel.current = new ProviderManagerPanel(panel, context, store);
		return ProviderManagerPanel.current;
	}

	private readonly disposables: vscode.Disposable[] = [];

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		private readonly store: ConfigStore,
	) {
		this.panel.webview.html = this.renderHtml(context);

		this.disposables.push(
			this.panel.onDidDispose(() => this.dispose()),
			this.panel.webview.onDidReceiveMessage((m: WebviewToHostMessage) => {
				void this.handleMessage(m);
			}),
			this.store.onDidChange(() => {
				void this.post({ type: 'providersUpdated', providers: this.store.list() });
			}),
		);
	}

	dispose(): void {
		ProviderManagerPanel.current = undefined;
		while (this.disposables.length) this.disposables.pop()!.dispose();
		this.panel.dispose();
	}

	private async handleMessage(m: WebviewToHostMessage): Promise<void> {
		try {
			switch (m.type) {
				case 'ready':
					await this.post({
						type: 'init',
						providers: this.store.list(),
						presets: PRESETS,
						strings: getStrings(),
					});
					return;
				case 'saveProvider':
					await this.store.upsert(m.provider);
					if (m.apiKey !== undefined) {
						await this.store.secrets.set(m.provider.id, m.provider.keyStorage, m.apiKey);
					}
					await this.post({ type: 'info', message: `Saved ${m.provider.name}` });
					return;
				case 'deleteProvider':
					await this.store.delete(m.providerId);
					return;
				case 'fetchRemoteModels': {
					const provider = this.store.get(m.providerId);
					if (!provider) return;
					const apiKey = await this.store.secrets.get(provider.id, provider.keyStorage);
					if (!apiKey) {
						await this.post({ type: 'error', message: 'API key required to fetch models' });
						return;
					}
					const driver = createDriver(provider.type);
					if (!driver.listRemoteModels) {
						await this.post({ type: 'error', message: 'This provider type does not support remote model listing' });
						return;
					}
					const models = await driver.listRemoteModels(provider, apiKey);
					await this.post({ type: 'remoteModels', providerId: provider.id, models });
					return;
				}
				case 'showLogs':
					await vscode.commands.executeCommand('copilot-custom-provider.showLogs');
					return;
			}
		} catch (err) {
			logger.error('Webview handler error', err);
			await this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
		}
	}

	private async post(message: HostToWebviewMessage): Promise<void> {
		await this.panel.webview.postMessage(message);
	}

	private renderHtml(context: vscode.ExtensionContext): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.js'),
		);
		const codiconCssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'codicons', 'codicon.css'),
		);
		const cspSource = webview.cspSource;
		const nonce = generateNonce();
		return /* html */ `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource}; script-src 'nonce-${nonce}';" />
	<link id="vscode-codicon-stylesheet" href="${codiconCssUri}" rel="stylesheet" nonce="${nonce}" />
	<title>Copilot Custom Provider</title>
	<style>
		html, body { padding: 0; margin: 0; height: 100%; }
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			background: var(--vscode-editor-background);
		}
	</style>
</head>
<body>
	<copilot-custom-provider-app></copilot-custom-provider-app>
	<script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function generateNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let s = '';
	for (let i = 0; i < 32; i += 1) s += chars.charAt(Math.floor(Math.random() * chars.length));
	return s;
}
