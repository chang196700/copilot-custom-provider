import vscode from 'vscode';
import { logger } from '../logger';
import { safeStringify } from '../json';
import type { AuthMode, ClaudeCodeImpersonation, ProviderConfig, StreamCallbacks } from '../types';
import type { ChatRequestPayload, ProtocolDriver, RemoteModelDescriptor } from './driver';
import { readSse, throwHttpError } from './sse';

/**
 * Hardcoded salt for fingerprint computation — must match backend validation.
 * Source: claude-code/src/utils/fingerprint.ts
 */
const FINGERPRINT_SALT = '59cf53e54c78';

/**
 * Compute the 3-char hex fingerprint for the billing header.
 * Algorithm: SHA256(SALT + msg[4] + msg[7] + msg[20] + VERSION)[:3]
 * This matches Claude Code's computeFingerprint() exactly.
 */
async function computeFingerprint(firstUserMessage: string, version: string): Promise<string> {
	const chars = [4, 7, 20].map(i => firstUserMessage[i] ?? '0').join('');
	const input = new TextEncoder().encode(`${FINGERPRINT_SALT}${chars}${version}`);
	const hashBuf = await crypto.subtle.digest('SHA-256', input);
	const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
	return hex.slice(0, 3);
}

/**
 * Lazily-generated session UUID used as X-Claude-Code-Session-Id when
 * impersonation is active without a fixed sessionId. Survives the entire
 * extension lifetime (reset on reload / host restart).
 */
let _impersonationSessionId: string | undefined;
let _impersonationDeviceId: string | undefined;

function getImpersonationSessionId(): string {
	if (!_impersonationSessionId) {
		_impersonationSessionId = crypto.randomUUID();
	}
	return _impersonationSessionId;
}

/**
 * Returns a 64-char hex string used as device_id in metadata.
 * Matches the SHA-256 format Claude Code uses for its device fingerprint.
 */
function getImpersonationDeviceId(): string {
	if (!_impersonationDeviceId) {
		const bytes = new Uint8Array(32);
		crypto.getRandomValues(bytes);
		_impersonationDeviceId = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
	}
	return _impersonationDeviceId;
}

/**
 * Minimal stubs for Claude Code's 11 built-in tools.
 * The descriptions are intentionally brief — proxies check for the presence
 * and names of these tools as a fingerprint, not their exact content.
 */
const CLAUDE_CODE_TOOL_STUBS: ReadonlyArray<{ name: string; description: string; input_schema: Record<string, unknown> }> = [
	{ name: 'Agent', description: 'Launch a sub-agent for complex multi-step tasks.', input_schema: { type: 'object', properties: { description: { type: 'string' }, prompt: { type: 'string' } }, required: ['description', 'prompt'] } },
	{ name: 'Bash', description: 'Execute a bash command in the shell.', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
	{ name: 'Edit', description: 'Perform exact string replacements in a file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['file_path', 'old_string', 'new_string'] } },
	{ name: 'Glob', description: 'Find files matching a glob pattern.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } },
	{ name: 'Grep', description: 'Search for a pattern in file contents.', input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, include: { type: 'string' } }, required: ['pattern'] } },
	{ name: 'PowerShell', description: 'Execute a PowerShell command (Windows).', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'] } },
	{ name: 'Read', description: 'Read the contents of a file.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, start_line: { type: 'number' }, end_line: { type: 'number' } }, required: ['file_path'] } },
	{ name: 'ScheduleWakeup', description: 'Schedule a delayed wakeup for the agent.', input_schema: { type: 'object', properties: { description: { type: 'string' }, due: { type: 'string' } }, required: ['description', 'due'] } },
	{ name: 'Skill', description: 'Execute a named skill.', input_schema: { type: 'object', properties: { name: { type: 'string' }, query: { type: 'string' } }, required: ['name'] } },
	{ name: 'ToolSearch', description: 'Search available tools by capability description.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
	{ name: 'Write', description: 'Write content to a file, creating it if needed.', input_schema: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } },
];

/** Resolve the effective impersonation config: model-level overrides provider-level. */
function resolveImpersonation(
	provider: ProviderConfig,
	modelImpersonation: ClaudeCodeImpersonation | undefined,
): ClaudeCodeImpersonation | undefined {
	const cfg = modelImpersonation ?? provider.claudeCodeImpersonation;
	return cfg?.enabled ? cfg : undefined;
}

function resolveAuthMode(
	provider: ProviderConfig,
	impersonation: ClaudeCodeImpersonation | undefined,
): AuthMode {
	if (provider.authMode) return provider.authMode;
	// Backward compatibility: honor legacy nested config if present in persisted JSON.
	const legacy = (impersonation as { authMode?: AuthMode } | undefined)?.authMode;
	return legacy ?? 'apiKey';
}

interface AnthropicContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	partial_json?: string;
}

export class AnthropicDriver implements ProtocolDriver {
	readonly type: ProviderConfig['type'] = 'anthropic-compatible';

	private normaliseUrl(provider: ProviderConfig): string {
		return provider.baseUrl.replace(/\/$/, '');
	}

	private modelsUrl(provider: ProviderConfig): string {
		return `${this.normaliseUrl(provider)}/v1/models`;
	}

	private url(provider: ProviderConfig, impersonation?: ClaudeCodeImpersonation): string {
		const base = `${this.normaliseUrl(provider)}/v1/messages`;
		// Claude Code's Anthropic SDK uses beta.messages.create() which appends ?beta=true.
		// Some proxies validate this query parameter as part of Claude Code identification.
		return impersonation ? `${base}?beta=true` : base;
	}

	private headers(payload: ChatRequestPayload): Record<string, string> {
		const { provider, apiKey, model } = payload;
		const impersonation = resolveImpersonation(provider, model.claudeCodeImpersonation);
		const authMode = resolveAuthMode(provider, impersonation);

		const base: Record<string, string> = {
			'Content-Type': 'application/json',
			'Accept': 'application/json',
			'anthropic-version': provider.extraHeaders?.['anthropic-version'] ?? '2023-06-01',
			...(provider.extraHeaders ?? {}),
		};

		if (authMode === 'bearer') {
			base['Authorization'] = `Bearer ${apiKey}`;
		} else {
			base['x-api-key'] = apiKey;
		}

		if (impersonation) {
			const version = impersonation.version ?? '2.1.121';
			const userType = impersonation.userType ?? 'external';
			const entrypoint = impersonation.entrypoint ?? 'sdk-cli';
			const sessionId = impersonation.sessionId ?? getImpersonationSessionId();

			// Core Claude Code identification headers (verified from captured traffic)
			base['User-Agent'] = `claude-cli/${version} (${userType}, ${entrypoint})`;
			base['x-app'] = 'cli';
			base['x-claude-code-session-id'] = sessionId;

			// Full beta list from Claude Code for modern models (captured from real traffic).
			// Proxies validate this set to confirm the request is from Claude Code.
			const defaultBetas = [
				'claude-code-20250219',
				'interleaved-thinking-2025-05-14',
				'context-management-2025-06-27',
				'prompt-caching-scope-2026-01-05',
				'advisor-tool-2026-03-01',
				'advanced-tool-use-2025-11-20',
				'effort-2025-11-24',
			];
			const betasToSend = [...defaultBetas];
			if (impersonation.extraBetas && impersonation.extraBetas.length > 0) {
				for (const b of impersonation.extraBetas) {
					if (!betasToSend.includes(b)) betasToSend.push(b);
				}
			}
			base['anthropic-beta'] = betasToSend.join(',');

			// Stainless SDK telemetry headers — the Anthropic SDK (@anthropic-ai/sdk v0.81.0)
			// injects these automatically. Proxies use them as SDK fingerprints.
			base['x-stainless-lang'] = 'js';
			base['x-stainless-package-version'] = '0.81.0';
			base['x-stainless-runtime'] = 'node';
			base['x-stainless-runtime-version'] = 'v24.3.0';
			base['x-stainless-os'] = 'Windows';
			base['x-stainless-arch'] = 'x64';
			base['x-stainless-retry-count'] = '0';
			base['x-stainless-timeout'] = '600';
			// Required by the Anthropic SDK when running outside a browser sandbox.
			base['anthropic-dangerous-direct-browser-access'] = 'true';
		}

		return base;
	}

	private modelListHeaders(provider: ProviderConfig, apiKey: string): Record<string, string> {
		const impersonation = resolveImpersonation(provider, undefined);
		const authMode = resolveAuthMode(provider, impersonation);
		const headers: Record<string, string> = {
			'Accept': 'application/json',
			'anthropic-version': provider.extraHeaders?.['anthropic-version'] ?? '2023-06-01',
			...(provider.extraHeaders ?? {}),
		};
		if (authMode === 'bearer') {
			headers['Authorization'] = `Bearer ${apiKey}`;
		} else {
			headers['x-api-key'] = apiKey;
		}
		return headers;
	}

	async streamChatCompletion(
		payload: ChatRequestPayload,
		callbacks: StreamCallbacks,
		token: vscode.CancellationToken,
	): Promise<void> {
		const controller = new AbortController();
		const cancelSub = token.onCancellationRequested(() => controller.abort());
		try {
			const body = await this.buildBody(payload);
			const headers = this.headers(payload);
			const impersonation = resolveImpersonation(payload.provider, payload.model.claudeCodeImpersonation);
			const url = this.url(payload.provider, impersonation);
			if (impersonation) {
				// Log sanitized headers for debugging — mask the auth value
				const debugHeaders = { ...headers };
				if (debugHeaders['x-api-key']) debugHeaders['x-api-key'] = debugHeaders['x-api-key'].slice(0, 12) + '...';
				if (debugHeaders['Authorization']) debugHeaders['Authorization'] = debugHeaders['Authorization'].slice(0, 20) + '...';
				logger.debug('Claude Code impersonation request', { url, headers: debugHeaders, bodyKeys: Object.keys(body), toolCount: Array.isArray(body.tools) ? (body.tools as unknown[]).length : 0 });
			}
			const res = await fetch(url, {
				method: 'POST',
				headers,
				body: safeStringify(body),
				signal: controller.signal,
			});
			if (!res.ok) await throwHttpError(res, payload.provider.name);
			if (!res.body) throw new Error('No response body');

			const blocks = new Map<number, { type: string; toolId?: string; toolName?: string; argsJson: string }>();
			for await (const ev of readSse(res.body, controller.signal)) {
				if (!ev.data || ev.data === '[DONE]') continue;
				let json: { type: string; index?: number; delta?: AnthropicContentBlock; content_block?: AnthropicContentBlock; message?: { usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number } }; usage?: { input_tokens: number; output_tokens: number } };
				try {
					json = JSON.parse(ev.data);
				} catch (err) {
					logger.warn('Failed to parse Anthropic SSE chunk', err, ev.data.slice(0, 160));
					continue;
				}
				switch (json.type) {
					case 'message_start':
						if (json.message?.usage && callbacks.onUsage) {
							callbacks.onUsage({
								promptTokens: json.message.usage.input_tokens,
								completionTokens: json.message.usage.output_tokens,
								cachedPromptTokens: json.message.usage.cache_read_input_tokens,
							});
						}
						break;
					case 'content_block_start': {
						const idx = json.index ?? 0;
						const cb = json.content_block;
						if (!cb) break;
						blocks.set(idx, {
							type: cb.type,
							toolId: cb.id,
							toolName: cb.name,
							argsJson: '',
						});
						break;
					}
					case 'content_block_delta': {
						const idx = json.index ?? 0;
						const block = blocks.get(idx);
						const d = json.delta;
						if (!block || !d) break;
						if (d.type === 'text_delta' && d.text) callbacks.onContent(d.text);
						else if (d.type === 'thinking_delta' && d.thinking) callbacks.onThinking(d.thinking);
						else if (d.type === 'input_json_delta' && d.partial_json) block.argsJson += d.partial_json;
						break;
					}
					case 'content_block_stop': {
						const idx = json.index ?? 0;
						const block = blocks.get(idx);
						if (block && block.type === 'tool_use' && block.toolId && block.toolName) {
							callbacks.onToolCall({
								id: block.toolId,
								name: block.toolName,
								argumentsJson: block.argsJson || '{}',
							});
						}
						blocks.delete(idx);
						break;
					}
					case 'message_delta':
						if (json.usage && callbacks.onUsage) {
							callbacks.onUsage({
								promptTokens: json.usage.input_tokens,
								completionTokens: json.usage.output_tokens,
							});
						}
						break;
					case 'message_stop':
						callbacks.onDone();
						return;
				}
			}
			callbacks.onDone();
		} catch (err) {
			if (token.isCancellationRequested && (err as Error).name === 'AbortError') return;
			callbacks.onError(err instanceof Error ? err : new Error(String(err)));
		} finally {
			cancelSub.dispose();
		}
	}

	private async buildBody(payload: ChatRequestPayload): Promise<Record<string, unknown>> {
		const apiModel = payload.model.apiModelId || payload.model.id;
		const impersonation = resolveImpersonation(payload.provider, payload.model.claudeCodeImpersonation);
		// When impersonating Claude Code, prepend the attribution line and identity
		// declaration exactly as the real CLI does.
		const systemBlocks: Record<string, unknown>[] = [];
		const systemSegments: string[] = [];
		if (impersonation) {
			const version = impersonation.version ?? '2.1.121';
			const entrypoint = impersonation.entrypoint ?? 'sdk-cli';
			// Compute fingerprint from first user message, matching Claude Code's
			// computeFingerprintFromMessages() algorithm exactly.
			// cch= is NOT included: it's a Bun-native attestation token computed by
			// Zig code in bun-anthropic, impossible to reproduce in Node.js.
			// Claude Code itself omits cch when NATIVE_CLIENT_ATTESTATION feature is
			// unavailable (non-Bun runtimes).
			const firstUserMsg = payload.messages.find(m => m.role === 'user')?.content ?? '';
			const fingerprint = await computeFingerprint(firstUserMsg, version);
			systemBlocks.push({
				type: 'text',
				text: `x-anthropic-billing-header: cc_version=${version}.${fingerprint}; cc_entrypoint=${entrypoint};`,
			});
			// Claude Code uses SDK agent identity string (not "official CLI for Claude")
			systemBlocks.push({
				type: 'text',
				text: 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.',
				cache_control: { type: 'ephemeral' },
			});
		}

		const messages: Record<string, unknown>[] = [];

		// Anthropic groups consecutive tool_results into a single user message with content array.
		let pendingToolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];
		const flushToolResults = () => {
			if (pendingToolResults.length > 0) {
				messages.push({ role: 'user', content: pendingToolResults });
				pendingToolResults = [];
			}
		};

		for (const m of payload.messages) {
			if (m.role === 'system') {
				if (m.content) {
					if (impersonation) {
						// In array mode, append system messages as additional text blocks
						systemBlocks.push({ type: 'text', text: m.content });
					} else {
						systemSegments.push(m.content);
					}
				}
				continue;
			}
			if (m.role === 'tool') {
				pendingToolResults.push({
					type: 'tool_result',
					tool_use_id: m.toolCallId ?? '',
					content: m.content,
				});
				continue;
			}
			flushToolResults();
			if (m.role === 'user') {
				messages.push({ role: 'user', content: m.content });
				continue;
			}
			// assistant
			const blocks: Record<string, unknown>[] = [];
			if (m.content) blocks.push({ type: 'text', text: m.content });
			if (m.toolCalls) {
				for (const tc of m.toolCalls) {
					let input: unknown = {};
					try {
						input = JSON.parse(tc.argumentsJson || '{}');
					} catch {
						// leave default
					}
					blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
				}
			}
			messages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : m.content });
		}
		flushToolResults();

		const maxTokens = payload.maxOutputTokens && payload.maxOutputTokens > 0
			? payload.maxOutputTokens
			: payload.model.maxOutputTokens || 4096;

		let body: Record<string, unknown>;

		if (impersonation) {
			// Build body in the exact field order Claude Code SDK emits, so proxies
			// that do structural/order-based fingerprinting see a matching layout.
			// Verified from real captured traffic: model, system, messages, tools,
			// metadata, max_tokens, thinking, context_management, output_config, stream.
			const sessionId = impersonation.sessionId ?? getImpersonationSessionId();
			body = { model: apiModel };
			if (systemBlocks.length > 0) body.system = systemBlocks;
			body.messages = messages;

			// Claude Code always sends its 11 built-in tools. Proxies fingerprint on
			// the presence and names of these tools. Inject stubs when caller has no
			// tools (unless explicitly disabled via injectTools: false).
			const callerTools = payload.tools && payload.tools.length > 0
				? payload.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters ?? { type: 'object', properties: {} } }))
				: null;
			if (impersonation.injectTools !== false) {
				body.tools = callerTools ?? [...CLAUDE_CODE_TOOL_STUBS];
			} else if (callerTools) {
				body.tools = callerTools;
			}

			// Mirrors getAPIMetadata() in Claude Code: user_id is a JSON-encoded object.
			// device_id is a 64-char hex (SHA-256 format), not a UUID.
			// account_uuid must match the Bearer token's account for subscription proxies.
			body.metadata = {
				user_id: JSON.stringify({
					device_id: getImpersonationDeviceId(),
					account_uuid: impersonation.accountUuid ?? '',
					session_id: sessionId,
				}),
			};
			body.max_tokens = maxTokens;
			// Claude Code always uses adaptive thinking (effort-2025-11-24 beta).
			body.thinking = { type: 'adaptive' };
			// context_management: clear_thinking edit — part of context-management-2025-06-27 beta.
			body.context_management = {
				edits: [{ type: 'clear_thinking_20251015', keep: 'all' }],
			};
			// output_config: effort level — part of effort-2025-11-24 beta.
			body.output_config = { effort: 'high' };
			body.stream = true;
		} else {
			body = {
				model: apiModel,
				messages,
				stream: true,
				max_tokens: maxTokens,
			};
			if (systemSegments.length > 0) body.system = systemSegments.join('\n\n');
			if (payload.tools && payload.tools.length > 0) {
				body.tools = payload.tools.map((t) => ({
					name: t.name,
					description: t.description,
					input_schema: t.parameters ?? { type: 'object', properties: {} },
				}));
			}
			if (payload.model.capabilities.thinking && payload.thinkingEffort !== 'none') {
				const budget = payload.thinkingEffort === 'max' ? 16000 : 4000;
				body.thinking = { type: 'enabled', budget_tokens: budget };
			}
		}
		return body;
	}

	async listRemoteModels(provider: ProviderConfig, apiKey: string): Promise<RemoteModelDescriptor[]> {
		const res = await fetch(this.modelsUrl(provider), {
			headers: this.modelListHeaders(provider, apiKey),
		});
		if (!res.ok) await throwHttpError(res, provider.name);
		const json = (await res.json()) as {
			data?: Array<{
				id?: string;
				display_name?: string;
				displayName?: string;
				name?: string;
				context_window?: number;
				contextWindow?: number;
				context_length?: number;
			}>;
		};

		return (json.data ?? [])
			.filter((m): m is NonNullable<typeof m> & { id: string } => typeof m.id === 'string' && m.id.length > 0)
			.map((m) => ({
				id: m.id,
				displayName: m.display_name ?? m.displayName ?? m.name,
				contextWindow: m.context_window ?? m.contextWindow ?? m.context_length,
			}));
	}
}
