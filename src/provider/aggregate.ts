import vscode from 'vscode';
import { t } from '../i18n';
import { logger } from '../logger';
import { createDriver, type ProtocolDriver } from '../protocol';
import type { NormalizedMessage } from '../protocol/driver';
import type { ConfigStore } from '../store/configStore';
import type {
	DeltaToolCall,
	ModelDefinition,
	ProviderConfig,
	StreamUsage,
} from '../types';
import {
	createPostToolReasoningKey,
	createToolReasoningKey,
	pruneReasoningCache,
	type ReasoningEntry,
} from './cache';
import {
	collectTrailingToolResultIds,
	convertMessages,
	convertTools,
	countMessageChars,
} from './convert';
import {
	getConfiguredThinkingEffort,
	toChatInfo,
	type ModelConfigurationOptions,
	type ModelPickerChatInformation,
} from './models';
import { estimateTokenCount } from './tokens';

/** Composite id `<providerId>::<modelId>` so models from different providers don't collide. */
export function buildCompositeId(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`;
}

function parseCompositeId(composite: string): { providerId: string; modelId: string } | undefined {
	const idx = composite.indexOf('::');
	if (idx === -1) return undefined;
	return { providerId: composite.slice(0, idx), modelId: composite.slice(idx + 2) };
}

interface RequestSnapshot {
	provider: ProviderConfig;
	driver: ProtocolDriver;
	apiKey: string;
}

/**
 * Single LM provider exposing models from every configured provider under one vendor (`copilot-custom-provider`).
 *
 * Hot-reload semantics:
 *   * Listing fires `onDidChangeLanguageModelChatInformation` whenever any provider/secret changes.
 *   * In-flight requests captured a RequestSnapshot at entry and complete naturally.
 *   * New chat turns observe the latest config because `makeSnapshot` re-reads the store.
 */
export class AggregateChatProvider implements vscode.LanguageModelChatProvider {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this.emitter.event;

	private readonly reasoningCaches = new Map<string, Map<string, ReasoningEntry>>();
	private charsPerToken = 4.0;

	constructor(private readonly store: ConfigStore) {}

	dispose(): void {
		this.emitter.dispose();
	}

	notifyChange(): void {
		this.emitter.fire();
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const out: ModelPickerChatInformation[] = [];
		for (const provider of this.store.list()) {
			const apiKey = await this.store.secrets.get(provider.id, provider.keyStorage);
			const hasKey = !!apiKey;
			for (const m of provider.models) {
				out.push(toChatInfo(m, hasKey, provider, buildCompositeId(provider.id, m.id)));
			}
		}
		return out;
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const parsed = parseCompositeId(modelInfo.id);
		if (!parsed) throw new Error(`Invalid model id: ${modelInfo.id}`);
		const snapshot = await this.makeSnapshot(parsed.providerId);
		const modelDef = snapshot.provider.models.find((m) => m.id === parsed.modelId);
		if (!modelDef) {
			throw new Error(`Model ${parsed.modelId} not found in provider ${snapshot.provider.id}`);
		}
		const isThinkingModel = modelDef.capabilities.thinking;
		const thinkingEffort = getConfiguredThinkingEffort(options as ModelConfigurationOptions);

		const reasoningCache = this.cacheFor(snapshot.provider.id);
		if (messages.length <= 2) {
			pruneReasoningCache(reasoningCache, true);
		}

		const normalised = convertMessages(messages, isThinkingModel, reasoningCache);
		const tools = modelDef.capabilities.toolCalling ? convertTools(options.tools) : undefined;
		const trailingToolResultIds = collectTrailingToolResultIds(normalised);
		const totalRequestChars = countMessageChars(normalised);

		await this.runStream({
			snapshot,
			modelDef,
			normalised,
			tools,
			thinkingEffort,
			trailingToolResultIds,
			totalRequestChars,
			progress,
			token,
			reasoningCache,
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		return estimateTokenCount(text, this.charsPerToken);
	}

	private cacheFor(providerId: string): Map<string, ReasoningEntry> {
		let c = this.reasoningCaches.get(providerId);
		if (!c) {
			c = new Map();
			this.reasoningCaches.set(providerId, c);
		}
		return c;
	}

	private async makeSnapshot(providerId: string): Promise<RequestSnapshot> {
		const provider = this.store.get(providerId);
		if (!provider) throw new Error(`Provider ${providerId} not found`);
		const apiKey = await this.store.secrets.get(provider.id, provider.keyStorage);
		if (!apiKey) throw new Error(t('copilot-custom-provider.errors.notConfigured'));
		return { provider, driver: createDriver(provider.type), apiKey };
	}

	private runStream(args: {
		snapshot: RequestSnapshot;
		modelDef: ModelDefinition;
		normalised: NormalizedMessage[];
		tools: ReturnType<typeof convertTools>;
		thinkingEffort: 'none' | 'adaptive' | 'low' | 'medium' | 'high' | 'max';
		trailingToolResultIds: string[];
		totalRequestChars: number;
		progress: vscode.Progress<vscode.LanguageModelResponsePart>;
		token: vscode.CancellationToken;
		reasoningCache: Map<string, ReasoningEntry>;
	}): Promise<void> {
		const {
			snapshot,
			modelDef,
			normalised,
			tools,
			thinkingEffort,
			trailingToolResultIds,
			totalRequestChars,
			progress,
			token,
			reasoningCache,
		} = args;

		let accumulatedReasoning = '';
		const emittedToolCallIds: string[] = [];
		const isThinkingModel = modelDef.capabilities.thinking;

		return new Promise<void>((resolve, reject) => {
			snapshot.driver
				.streamChatCompletion(
					{
						messages: normalised,
						tools,
						maxOutputTokens: modelDef.maxOutputTokens,
						thinkingEffort,
						model: modelDef,
						provider: snapshot.provider,
						apiKey: snapshot.apiKey,
					},
					{
						onContent: (text) => progress.report(new vscode.LanguageModelTextPart(text)),
						onThinking: (text) => {
							accumulatedReasoning += text;
							progress.report(
								new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart,
							);
						},
						onToolCall: (call: DeltaToolCall) => {
							emittedToolCallIds.push(call.id);
							let parsed: unknown = {};
							try {
								parsed = JSON.parse(call.argumentsJson || '{}');
							} catch {
								// ignore
							}
							progress.report(
								new vscode.LanguageModelToolCallPart(
									call.id,
									call.name,
									parsed as Record<string, unknown>,
								),
							);
						},
						onUsage: (usage: StreamUsage) => {
							if (totalRequestChars > 0 && usage.promptTokens > 0) {
								const observed = totalRequestChars / usage.promptTokens;
								this.charsPerToken = this.charsPerToken * 0.7 + observed * 0.3;
							}
						},
						onDone: () => {
							if (isThinkingModel && accumulatedReasoning) {
								const entry: ReasoningEntry = {
									text: accumulatedReasoning,
									timestamp: Date.now(),
								};
								if (emittedToolCallIds.length > 0) {
									for (const id of emittedToolCallIds) {
										reasoningCache.set(createToolReasoningKey(id), entry);
									}
								} else if (trailingToolResultIds.length > 0) {
									reasoningCache.set(
										createPostToolReasoningKey(trailingToolResultIds),
										entry,
									);
								}
							}
							pruneReasoningCache(reasoningCache, false);
							resolve();
						},
						onError: (err) => {
							logger.error(`Provider ${snapshot.provider.id} stream error:`, err);
							reject(err);
						},
					},
					token,
				)
				.catch(reject);
		});
	}
}
