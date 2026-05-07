import type { ProviderType } from '../types';
import { AnthropicDriver } from './anthropic';
import { AzureOpenAIDriver } from './azure';
import { BedrockDriver } from './bedrock';
import type { ProtocolDriver } from './driver';
import { GeminiDriver } from './gemini';
import { OpenAIDriver } from './openai';

export function createDriver(type: ProviderType): ProtocolDriver {
	switch (type) {
		case 'openai-compatible':
			return new OpenAIDriver();
		case 'anthropic-compatible':
			return new AnthropicDriver();
		case 'gemini':
			return new GeminiDriver();
		case 'azure-openai':
			return new AzureOpenAIDriver();
		case 'bedrock':
			return new BedrockDriver();
	}
}

export type { ProtocolDriver, ChatRequestPayload, NormalizedMessage, NormalizedTool, RemoteModelDescriptor } from './driver';
