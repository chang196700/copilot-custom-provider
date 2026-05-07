import type { PresetTemplate } from './types';

/** Built-in preset templates. Users pick one to pre-fill a provider form. */
export const PRESETS: PresetTemplate[] = [
	{
		id: 'custom-openai',
		label: 'Custom (OpenAI Compatible)',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.openai.com/v1',
		description: 'Generic OpenAI compatible endpoint.',
	},
	{
		id: 'deepseek',
		label: 'DeepSeek',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.deepseek.com',
		description: 'DeepSeek V3/V4 chat models.',
		apiKeyHint: 'sk-...',
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://openrouter.ai/api/v1',
		description: 'Aggregated access to many models.',
	},
	{
		id: 'groq',
		label: 'Groq',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.groq.com/openai/v1',
		description: 'Fast LPU inference.',
	},
	{
		id: 'together',
		label: 'Together AI',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.together.xyz/v1',
		description: 'Open-source model hosting.',
	},
	{
		id: 'siliconflow',
		label: 'SiliconFlow',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.siliconflow.cn/v1',
		description: 'SiliconFlow OpenAI-compatible endpoint.',
	},
	{
		id: 'moonshot',
		label: 'Moonshot (Kimi)',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.moonshot.cn/v1',
		description: 'Moonshot AI Kimi models.',
	},
	{
		id: 'anthropic',
		label: 'Anthropic Claude',
		type: 'anthropic-compatible',
		defaultBaseUrl: 'https://api.anthropic.com',
		description: 'Anthropic native /v1/messages.',
		defaultHeaders: {
			'anthropic-version': '2023-06-01',
		},
		recommendedModels: [
			{
				id: 'claude-3-5-sonnet-latest',
				name: 'claude-3-5-sonnet-latest',
				displayName: 'Claude 3.5 Sonnet',
				family: 'claude',
				version: '3.5',
				maxInputTokens: 200000,
				maxOutputTokens: 8192,
				capabilities: { toolCalling: true, imageInput: true, thinking: false },
			},
			{
				id: 'claude-3-5-haiku-latest',
				name: 'claude-3-5-haiku-latest',
				displayName: 'Claude 3.5 Haiku',
				family: 'claude',
				version: '3.5',
				maxInputTokens: 200000,
				maxOutputTokens: 8192,
				capabilities: { toolCalling: true, imageInput: true, thinking: false },
			},
		],
	},
	{
		id: 'gemini',
		label: 'Google Gemini',
		type: 'gemini',
		defaultBaseUrl: 'https://generativelanguage.googleapis.com',
		description: 'Google Gemini native API.',
		recommendedModels: [
			{
				id: 'gemini-2.0-flash',
				name: 'gemini-2.0-flash',
				displayName: 'Gemini 2.0 Flash',
				family: 'gemini',
				version: '2.0',
				maxInputTokens: 1048576,
				maxOutputTokens: 8192,
				capabilities: { toolCalling: true, imageInput: true, thinking: false },
			},
		],
	},
	{
		id: 'azure-openai',
		label: 'Azure OpenAI',
		type: 'azure-openai',
		defaultBaseUrl: 'https://YOUR-RESOURCE.openai.azure.com',
		description: 'Azure OpenAI deployment-based routing.',
		apiKeyHint: 'Azure resource api-key',
	},
	{
		id: 'xiaomi-mimo-openai',
		label: 'Xiaomi Mimo (OpenAI Compatible)',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
		description: 'Xiaomi Mimo pay-as-you-go, OpenAI-compatible endpoint.',
		apiKeyHint: 'sk-...',
	},
	{
		id: 'xiaomi-mimo-anthropic',
		label: 'Xiaomi Mimo (Anthropic Compatible)',
		type: 'anthropic-compatible',
		defaultBaseUrl: 'https://api.xiaomimimo.com/anthropic',
		description: 'Xiaomi Mimo pay-as-you-go, Anthropic-compatible endpoint.',
		apiKeyHint: 'sk-...',
		defaultHeaders: {
			'anthropic-version': '2023-06-01',
		},
	},
	{
		id: 'xiaomi-mimo-token-plan-openai',
		label: 'Xiaomi Mimo Token Plan (OpenAI Compatible)',
		type: 'openai-compatible',
		defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
		description: 'Xiaomi Mimo Token Plan subscription, OpenAI-compatible endpoint.',
		apiKeyHint: 'tp-...',
	},
	{
		id: 'xiaomi-mimo-token-plan-anthropic',
		label: 'Xiaomi Mimo Token Plan (Anthropic Compatible)',
		type: 'anthropic-compatible',
		defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
		description: 'Xiaomi Mimo Token Plan subscription, Anthropic-compatible endpoint.',
		apiKeyHint: 'tp-...',
		defaultHeaders: {
			'anthropic-version': '2023-06-01',
		},
	},
	{
		id: 'bedrock',
		label: 'AWS Bedrock (Coming Soon)',
		type: 'bedrock',
		defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
		description: 'Not implemented yet.',
	},
];

export function getPreset(id: string): PresetTemplate | undefined {
	return PRESETS.find((p) => p.id === id);
}
