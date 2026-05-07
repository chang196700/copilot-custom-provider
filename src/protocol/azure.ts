import type { ProviderConfig } from '../types';
import type { ChatRequestPayload } from './driver';
import { OpenAIDriver } from './openai';

/** Azure OpenAI: deployment-based URL + api-key header instead of bearer. */
export class AzureOpenAIDriver extends OpenAIDriver {
	override readonly type: ProviderConfig['type'] = 'azure-openai';

	protected override resolveUrl(payload: ChatRequestPayload): string {
		const deployment = payload.model.deployment || payload.model.apiModelId || payload.model.id;
		const apiVersion = payload.model.apiVersion || '2024-10-21';
		return buildAzureChatUrl(payload.provider.baseUrl, deployment, apiVersion);
	}

	protected override buildHeaders(
		provider: ProviderConfig,
		apiKey: string,
	): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			'api-key': apiKey,
			...(provider.extraHeaders ?? {}),
		};
	}

	protected override modelsEndpoint(provider: ProviderConfig): string {
		return `${provider.baseUrl.replace(/\/$/, '')}/openai/models?api-version=2024-10-21`;
	}
}

export function buildAzureChatUrl(
	baseUrl: string,
	deployment: string,
	apiVersion: string,
): string {
	return `${baseUrl.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
}
