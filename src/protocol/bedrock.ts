import vscode from 'vscode';
import { t } from '../i18n';
import type { ProviderConfig, StreamCallbacks } from '../types';
import type { ChatRequestPayload, ProtocolDriver } from './driver';

/** Placeholder Bedrock driver — real SigV4 implementation deferred. */
export class BedrockDriver implements ProtocolDriver {
	readonly type: ProviderConfig['type'] = 'bedrock';

	async streamChatCompletion(
		_payload: ChatRequestPayload,
		callbacks: StreamCallbacks,
		_token: vscode.CancellationToken,
	): Promise<void> {
		callbacks.onError(new Error(t('copilot-custom-provider.errors.bedrockNotSupported')));
	}
}
