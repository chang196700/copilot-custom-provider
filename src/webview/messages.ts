import type { PresetTemplate, ProviderConfig } from '../types';
import type { RemoteModelDescriptor } from '../protocol/driver';

/** Messages from extension host → webview. */
export type HostToWebviewMessage =
	| { type: 'init'; providers: ProviderConfig[]; presets: PresetTemplate[]; strings: Record<string, string> }
	| { type: 'providersUpdated'; providers: ProviderConfig[] }
	| { type: 'remoteModels'; providerId: string; models: RemoteModelDescriptor[] }
	| { type: 'error'; message: string }
	| { type: 'info'; message: string };

/** Messages from webview → extension host. */
export type WebviewToHostMessage =
	| { type: 'ready' }
	| { type: 'saveProvider'; provider: ProviderConfig; apiKey?: string }
	| { type: 'deleteProvider'; providerId: string }
	| { type: 'fetchRemoteModels'; providerId: string }
	| { type: 'showLogs' };
