import vscode from 'vscode';
import { t } from '../i18n';
import type { ModelDefinition, ProviderConfig } from '../types';

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

export type ThinkingEffort = 'none' | 'high' | 'max';

export function toChatInfo(
	m: ModelDefinition,
	hasApiKey: boolean,
	provider: ProviderConfig,
	compositeId: string,
): ModelPickerChatInformation {
	const providerLabel = provider.name || provider.id;
	const displayName = `${providerLabel}: ${m.displayName || m.name}`;
	return {
		id: compositeId,
		name: displayName,
		family: m.family || providerLabel,
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
	if (v === 'max') return 'max';
	return 'high';
}

function buildThinkingEffortSchema() {
	return {
		properties: {
			reasoningEffort: {
				type: 'string',
				title: t('copilot-custom-provider.thinking.title'),
				enum: ['none', 'high', 'max'],
				enumItemLabels: [t('copilot-custom-provider.thinking.none'), t('copilot-custom-provider.thinking.high'), t('copilot-custom-provider.thinking.max')],
				enumDescriptions: [
					t('copilot-custom-provider.thinking.none.desc'),
					t('copilot-custom-provider.thinking.high.desc'),
					t('copilot-custom-provider.thinking.max.desc'),
				],
				default: 'high',
				group: 'navigation',
			},
		},
	} as const;
}
