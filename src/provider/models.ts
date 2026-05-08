import vscode from 'vscode';
import { t } from '../i18n';
import type { ModelDefinition, ProviderConfig, ProviderType } from '../types';

type ThinkingEffortConfigurationSchema = ReturnType<typeof buildThinkingEffortSchema>;

export type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
	readonly configurationSchema?: ThinkingEffortConfigurationSchema;
};

export type ModelConfigurationOptions = vscode.ProvideLanguageModelChatResponseOptions & {
	readonly modelConfiguration?: Record<string, unknown>;
	readonly configuration?: Record<string, unknown>;
};

export type ThinkingEffort = 'none' | 'adaptive' | 'low' | 'medium' | 'high' | 'max';

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	provider: ProviderConfig,
	compositeId: string,
): ModelPickerChatInformation {
	const providerLabel = provider.name || provider.id;
	const displayName = `${providerLabel}: ${m.displayName || m.id}`;
	return {
		id: compositeId,
		name: displayName,
		family: familyFromType(provider.type),
		version: m.version,
		detail: hasApiKey ? (m.detail ?? providerLabel) : t('copilot-custom-provider.errors.notConfigured'),
		tooltip: hasApiKey ? (m.tooltip ?? displayName) : t('copilot-custom-provider.errors.notConfigured'),
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		maxInputTokens: m.maxInputTokens,
		maxOutputTokens: m.maxOutputTokens,
		isUserSelectable: m.isUserSelectable !== false,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
		...(m.capabilities.thinking ? { configurationSchema: buildThinkingEffortSchema() } : {}),
	};
}

export function getConfiguredThinkingEffort(options: ModelConfigurationOptions): ThinkingEffort {
	const v = options.modelConfiguration?.reasoningEffort ?? options.configuration?.reasoningEffort;
	if (v === 'none') return 'none';
	if (v === 'adaptive') return 'adaptive';
	if (v === 'low') return 'low';
	if (v === 'medium') return 'medium';
	if (v === 'max') return 'max';
	return 'high';
}

function buildThinkingEffortSchema() {
	return {
		properties: {
			reasoningEffort: {
				type: 'string',
				title: t('copilot-custom-provider.thinking.title'),
				enum: ['none', 'adaptive', 'low', 'medium', 'high', 'max'],
				enumItemLabels: [
					t('copilot-custom-provider.thinking.none'),
					t('copilot-custom-provider.thinking.adaptive'),
					t('copilot-custom-provider.thinking.low'),
					t('copilot-custom-provider.thinking.medium'),
					t('copilot-custom-provider.thinking.high'),
					t('copilot-custom-provider.thinking.max'),
				],
				enumDescriptions: [
					t('copilot-custom-provider.thinking.none.desc'),
					t('copilot-custom-provider.thinking.adaptive.desc'),
					t('copilot-custom-provider.thinking.low.desc'),
					t('copilot-custom-provider.thinking.medium.desc'),
					t('copilot-custom-provider.thinking.high.desc'),
					t('copilot-custom-provider.thinking.max.desc'),
				],
				default: 'high',
				group: 'navigation',
			},
		},
	} as const;
}
function familyFromType(type: ProviderType): string {
	switch (type) {
		case 'anthropic-compatible': return 'claude';
		case 'gemini': return 'gemini';
		case 'openai-compatible': return 'openai';
		case 'azure-openai': return 'openai';
		case 'bedrock': return 'bedrock';
	}
}
