import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { live } from 'lit/directives/live.js';
import '@vscode-elements/elements/dist/vscode-button';
import '@vscode-elements/elements/dist/vscode-textfield';
import '@vscode-elements/elements/dist/vscode-textarea';
import '@vscode-elements/elements/dist/vscode-single-select';
import '@vscode-elements/elements/dist/vscode-option';
import '@vscode-elements/elements/dist/vscode-checkbox';
import '@vscode-elements/elements/dist/vscode-divider';
import '@vscode-elements/elements/dist/vscode-icon';
import '@vscode-elements/elements/dist/vscode-label';

import type {
	HostToWebviewMessage,
	WebviewToHostMessage,
} from '../messages';
import type {
	AuthMode,
	ModelDefinition,
	PresetTemplate,
	ProviderCapabilityFlags,
	ProviderConfig,
	ProviderType,
} from '../../types';
import type { RemoteModelDescriptor } from '../../protocol/driver';

interface VsCodeApi {
	postMessage(msg: WebviewToHostMessage): void;
	setState(state: unknown): void;
	getState(): unknown;
}
declare const acquireVsCodeApi: () => VsCodeApi;
const vscodeApi = acquireVsCodeApi();

/**
 * Parse a token count string that may contain SI or IEC suffixes.
 * k/K = ×1 000, M/m = ×1 000 000, Ki/ki = ×1 024, Mi/mi = ×1 048 576.
 */
function parseTokenCount(s: string): number {
	const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(ki|mi|k|m)?$/i);
	if (!m) return 0;
	const n = parseFloat(m[1]);
	let result: number;
	switch ((m[2] ?? '').toLowerCase()) {
		case 'k': result = Math.round(n * 1_000); break;
		case 'm': result = Math.round(n * 1_000_000); break;
		case 'ki': result = Math.round(n * 1_024); break;
		case 'mi': result = Math.round(n * 1_048_576); break;
		default: result = Math.round(n);
	}
	return Math.max(0, result);
}

/**
 * Format a token count number back to the most compact human-readable string.
 * Prefers SI units (k, M) over IEC units (Ki, Mi).
 */
function formatTokenCount(n: number): string {
	if (!n) return '';
	if (n % 1_000_000 === 0) return `${n / 1_000_000}M`;
	if (n % 1_000 === 0) return `${n / 1_000}k`;
	if (n % 1_048_576 === 0) return `${n / 1_048_576}Mi`;
	if (n % 1_024 === 0) return `${n / 1_024}Ki`;
	return String(n);
}

function send(msg: WebviewToHostMessage): void {
	vscodeApi.postMessage(msg);
}

function uid(): string {
	return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
	'openai-compatible': 'OpenAI Compatible',
	'anthropic-compatible': 'Anthropic Compatible',
	gemini: 'Google Gemini',
	'azure-openai': 'Azure OpenAI',
	bedrock: 'AWS Bedrock',
};

@customElement('copilot-custom-provider-app')
export class CopilotCustomProviderApp extends LitElement {
	static override styles = css`
		:host {
			display: grid;
			grid-template-columns: 280px 1fr;
			height: 100vh;
			gap: 0;
		}
		aside {
			border-right: 1px solid var(--vscode-panel-border);
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.sidebar-header {
			padding: 12px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.sidebar-header h2 {
			margin: 0;
			font-size: 13px;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: var(--vscode-foreground);
		}
		.provider-list {
			flex: 1;
			overflow-y: auto;
		}
		.provider-item {
			padding: 8px 12px;
			cursor: pointer;
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 8px;
		}
		.provider-item:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.provider-item.selected {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
		}
		.provider-meta {
			font-size: 11px;
			opacity: 0.7;
		}
		main {
			padding: 16px 24px;
			overflow-x: hidden;
			overflow-y: auto;
			min-width: 0;
		}
		.empty {
			opacity: 0.7;
			text-align: center;
			padding: 60px 20px;
		}
		.field {
			display: flex;
			flex-direction: column;
			gap: 4px;
			margin-bottom: 14px;
			min-width: 0;
		}
		.field vscode-textfield,
		.field vscode-textarea,
		.field vscode-single-select {
			width: 100%;
			min-width: 0;
		}
		.field label {
			font-size: 12px;
			color: var(--vscode-foreground);
		}
		.field-row {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 14px;
		}
		.actions {
			display: flex;
			gap: 8px;
			margin-top: 12px;
			flex-wrap: wrap;
		}
		.toolbar {
			position: sticky;
			top: 0;
			z-index: 10;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 10px 0;
			margin: -16px 0 12px 0;
			background: var(--vscode-editor-background);
			border-bottom: 1px solid var(--vscode-panel-border);
		}
		.toolbar .title {
			font-size: 13px;
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.toolbar .dirty {
			font-size: 11px;
			opacity: 0.8;
			color: var(--vscode-charts-yellow, #e2c08d);
			margin-left: 8px;
		}
		.toolbar .toolbar-actions { display: flex; gap: 8px; }
		vscode-button.save-dirty::part(control),
		vscode-button.save-dirty {
			--vscode-button-background: var(--vscode-testing-iconPassed, #388a34);
			--vscode-button-hoverBackground: var(--vscode-testing-iconPassed, #2d6e2a);
			--vscode-button-foreground: #ffffff;
		}
		vscode-button.danger::part(control),
		vscode-button.danger {
			--vscode-button-background: var(--vscode-errorForeground, #c4314b);
			--vscode-button-hoverBackground: var(--vscode-errorForeground, #a52a3f);
			--vscode-button-foreground: #ffffff;
			--vscode-button-secondaryBackground: var(--vscode-errorForeground, #c4314b);
			--vscode-button-secondaryForeground: #ffffff;
			--vscode-button-secondaryHoverBackground: #a52a3f;
		}
		section.models {
			margin-top: 24px;
		}
		section.models h3 {
			margin: 0 0 8px 0;
			font-size: 13px;
		}
		.model-row {
			display: grid;
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.4fr) minmax(0, 96px) minmax(0, 96px) auto;
			gap: 8px;
			align-items: end;
			padding: 8px 0;
			border-top: 1px solid var(--vscode-panel-border);
		}
		.model-row .field { margin: 0; min-width: 0; }
		.model-row vscode-textfield { width: 100%; min-width: 0; }
		.model-row label { font-size: 11px; opacity: 0.75; }
		.model-row:first-of-type {
			border-top: none;
		}
		.cap-row {
			display: flex;
			gap: 12px;
			flex-wrap: wrap;
		}
		.banner {
			padding: 8px 12px;
			margin-bottom: 12px;
			border-radius: 4px;
			font-size: 12px;
		}
		.banner.error {
			background: var(--vscode-inputValidation-errorBackground, #f3d2d2);
			color: var(--vscode-inputValidation-errorForeground, #5a1d1d);
			border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
		}
		.banner.info {
			background: var(--vscode-inputValidation-infoBackground, #d6ecf2);
			color: var(--vscode-inputValidation-infoForeground, #1d3d5a);
			border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
		}
		.remote-models {
			border: 1px solid var(--vscode-panel-border);
			padding: 8px;
			margin-top: 8px;
			max-height: 240px;
			overflow-y: auto;
		}
		.remote-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 4px 0;
			gap: 8px;
		}
		.provider-id-readonly {
			font-family: var(--vscode-editor-font-family, monospace);
			font-size: 12px;
			padding: 4px 8px;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border, transparent);
			color: var(--vscode-disabledForeground, var(--vscode-foreground));
			border-radius: 2px;
			opacity: 0.7;
			user-select: text;
			word-break: break-all;
			flex: 1;
			min-width: 0;
		}
		.provider-id-row {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		.provider-id-row vscode-textfield {
			flex: 1;
			min-width: 0;
		}
	`;

	@state() private providers: ProviderConfig[] = [];
	@state() private presets: PresetTemplate[] = [];
	@state() private selectedId: string | undefined;
	@state() private editing: ProviderConfig | undefined;
	@state() private editingApiKey = '';
	@state() private remoteModels: RemoteModelDescriptor[] = [];
	@state() private banner: { kind: 'error' | 'info'; text: string } | undefined;
	@state() private loadingModels = false;
	@state() private strings: Record<string, string> = {};
	@state() private draftIds: Set<string> = new Set();
	/**
	 * When set, the user has clicked "Change" on an existing provider's id and
	 * this holds the original (persisted) id. Save will then dispatch a
	 * `renameProvider` message before the normal upsert.
	 */
	@state() private renameOriginalId: string | undefined;

	private t(key: string, ...args: unknown[]): string {
		const tpl = this.strings[key] ?? key;
		if (args.length === 0) return tpl;
		return tpl.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
	}

	override connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener('message', this.onMessage);
		send({ type: 'ready' });
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener('message', this.onMessage);
	}

	private onMessage = (event: MessageEvent<HostToWebviewMessage>): void => {
		const m = event.data;
		switch (m.type) {
			case 'init':
				this.providers = m.providers;
				this.presets = m.presets;
				this.strings = m.strings;
				if (this.providers[0] && !this.selectedId) {
					this.selectProvider(this.providers[0].id);
				}
				break;
			case 'providersUpdated':
				this.providers = m.providers;
				// Clear draftIds for providers that are now persisted.
				if (this.draftIds.size > 0) {
					const persistedIds = new Set(m.providers.map((p) => p.id));
					const remaining = new Set([...this.draftIds].filter((id) => !persistedIds.has(id)));
					if (remaining.size !== this.draftIds.size) this.draftIds = remaining;
				}
				// If a rename round-trip completed (new id is now persisted), exit rename mode.
				if (
					this.renameOriginalId !== undefined &&
					this.editing &&
					m.providers.some((p) => p.id === this.editing!.id) &&
					!m.providers.some((p) => p.id === this.renameOriginalId)
				) {
					this.renameOriginalId = undefined;
				}
				if (this.selectedId && !this.providers.find((p) => p.id === this.selectedId)) {
					this.selectedId = undefined;
					this.editing = undefined;
				} else if (this.selectedId) {
					// keep editing draft if the user is mid-edit
					if (!this.editing || this.editing.id !== this.selectedId) {
						this.editing = structuredClone(this.providers.find((p) => p.id === this.selectedId)!);
					}
				}
				break;
			case 'remoteModels':
				this.loadingModels = false;
				this.remoteModels = m.models;
				break;
			case 'error':
				this.banner = { kind: 'error', text: m.message };
				this.loadingModels = false;
				break;
			case 'info':
				this.banner = { kind: 'info', text: m.message };
				break;
		}
	};

	private selectProvider(id: string): void {
		this.selectedId = id;
		this.remoteModels = [];
		this.renameOriginalId = undefined;
		const p = this.providers.find((x) => x.id === id);
		this.editing = p ? structuredClone(p) : undefined;
		this.editingApiKey = '';
	}

	private addProvider(): void {
		const preset = this.presets[0];
		const draft: ProviderConfig = {
			id: uid(),
			type: preset?.type ?? 'openai-compatible',
			name: 'New Provider',
			description: '',
			baseUrl: preset?.defaultBaseUrl ?? '',
			keyStorage: 'secret',
			presetId: preset?.id,
			models: [],
		};
		this.providers = [...this.providers, draft];
		this.draftIds = new Set([...this.draftIds, draft.id]);
		this.selectedId = draft.id;
		this.editing = structuredClone(draft);
		this.editingApiKey = '';
	}

	private applyPreset(presetId: string): void {
		const preset = this.presets.find((p) => p.id === presetId);
		if (!preset || !this.editing) return;
		this.editing = {
			...this.editing,
			...(preset.type !== undefined ? { type: preset.type } : {}),
			name: preset.label,
			...(preset.defaultBaseUrl !== undefined ? { baseUrl: preset.defaultBaseUrl } : {}),
			presetId: preset.id,
			extraHeaders: preset.defaultHeaders ? { ...preset.defaultHeaders } : undefined,
			models:
				this.editing.models.length === 0 && preset.recommendedModels
					? preset.recommendedModels.map((m) => structuredClone(m))
					: this.editing.models,
		};
		this.requestUpdate();
	}

	private save(): void {
		if (!this.editing) return;
		// If the user renamed an existing provider's id, dispatch the rename first
		// so the host migrates the persisted record + secret atomically. The
		// subsequent saveProvider then writes any other field changes under the
		// new id.
		if (
			this.renameOriginalId !== undefined &&
			this.renameOriginalId !== this.editing.id &&
			!this.draftIds.has(this.editing.id)
		) {
			send({ type: 'renameProvider', oldId: this.renameOriginalId, newId: this.editing.id });
		}
		this.renameOriginalId = undefined;
		send({ type: 'saveProvider', provider: this.editing, apiKey: this.editingApiKey || undefined });
		this.editingApiKey = '';
	}

	private deleteProvider(): void {
		if (!this.editing) return;
		const id = this.editing.id;
		// Only notify the host if the provider has actually been persisted.
		// Unsaved drafts only live in webview state.
		if (!this.draftIds.has(id)) {
			send({ type: 'deleteProvider', providerId: id });
		}
		this.providers = this.providers.filter((p) => p.id !== id);
		this.draftIds = new Set([...this.draftIds].filter((did) => did !== id));
		this.editing = undefined;
		this.selectedId = undefined;
		this.renameOriginalId = undefined;
	}

	private fetchRemoteModels(): void {
		if (!this.editing) return;
		this.loadingModels = true;
		this.remoteModels = [];
		send({ type: 'fetchRemoteModels', providerId: this.editing.id });
	}

	private addRemoteModel(remote: RemoteModelDescriptor): void {
		if (!this.editing) return;
		if (this.editing.models.some((m) => m.id === remote.id)) return;
		const def: ModelDefinition = {
			id: remote.id,
			displayName: remote.displayName ?? remote.id,
			version: '1',
			maxInputTokens: remote.contextWindow ?? 128000,
			maxOutputTokens: 4096,
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
		};
		this.editing = { ...this.editing, models: [...this.editing.models, def] };
	}

	private addBlankModel(): void {
		if (!this.editing) return;
		const def: ModelDefinition = {
			id: 'new-model',
			displayName: 'New Model',
			version: '1',
			maxInputTokens: 128000,
			maxOutputTokens: 4096,
			capabilities: { toolCalling: true, imageInput: false, thinking: false },
		};
		this.editing = { ...this.editing, models: [...this.editing.models, def] };
	}

	private updateModel(idx: number, patch: Partial<ModelDefinition>): void {
		if (!this.editing) return;
		const models = this.editing.models.map((m, i) =>
			i === idx ? ({ ...m, ...patch } as ModelDefinition) : m,
		);
		this.editing = { ...this.editing, models };
	}

	private updateModelCap(idx: number, patch: Partial<ProviderCapabilityFlags>): void {
		if (!this.editing) return;
		const models = this.editing.models.map((m, i) =>
			i === idx ? { ...m, capabilities: { ...m.capabilities, ...patch } } : m,
		);
		this.editing = { ...this.editing, models };
	}

	private removeModel(idx: number): void {
		if (!this.editing) return;
		this.editing = {
			...this.editing,
			models: this.editing.models.filter((_, i) => i !== idx),
		};
	}

	private updateField<K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]): void {
		if (!this.editing) return;
		this.editing = { ...this.editing, [key]: value };
	}

	private get isNewProvider(): boolean {
		return !!(this.editing && this.draftIds.has(this.editing.id));
	}

	private get isRenamingId(): boolean {
		return this.renameOriginalId !== undefined;
	}

	private startRenameId(): void {
		if (!this.editing) return;
		if (this.draftIds.has(this.editing.id)) return;
		this.renameOriginalId = this.editing.id;
	}

	private cancelRenameId(): void {
		if (!this.editing || this.renameOriginalId === undefined) return;
		const original = this.renameOriginalId;
		// Revert local state back to the original id so the sidebar & editing buffer match.
		const currentId = this.editing.id;
		if (currentId !== original) {
			this.providers = this.providers.map((p) => (p.id === currentId ? { ...p, id: original } : p));
			this.selectedId = original;
			this.editing = { ...this.editing, id: original };
		}
		this.renameOriginalId = undefined;
	}

	private updateDraftId(newId: string): void {
		if (!this.editing) return;
		const oldId = this.editing.id;
		if (this.draftIds.has(oldId)) {
			this.draftIds = new Set([...this.draftIds].map((id) => (id === oldId ? newId : id)));
		}
		this.providers = this.providers.map((p) => (p.id === oldId ? { ...p, id: newId } : p));
		this.selectedId = newId;
		this.editing = { ...this.editing, id: newId };
	}

	private get isDirty(): boolean {
		if (!this.editing) return false;
		if (this.editingApiKey.length > 0) return true;
		if (this.renameOriginalId !== undefined && this.renameOriginalId !== this.editing.id) return true;
		const saved = this.providers.find((p) => p.id === this.editing!.id);
		if (!saved) return true; // unsaved new draft
		return JSON.stringify(saved) !== JSON.stringify(this.editing);
	}

	override render(): TemplateResult {
		return html`
			<aside>
				<div class="sidebar-header">
					<h2>${this.t('copilot-custom-provider.ui.providers')}</h2>
					<vscode-button appearance="icon" title=${this.t('copilot-custom-provider.ui.addProvider')} @click=${() => this.addProvider()}>
						<vscode-icon name="add"></vscode-icon>
					</vscode-button>
				</div>
				<div class="provider-list">
					${this.providers.length === 0
						? html`<div class="empty">${this.t('copilot-custom-provider.ui.noProviders')}</div>`
						: repeat(
								this.providers,
								(p) => p.id,
								(p) => html`
									<div
										class="provider-item ${p.id === this.selectedId ? 'selected' : ''}"
										@click=${() => this.selectProvider(p.id)}
									>
										<div>
											<div>${p.name}</div>
											<div class="provider-meta">${this.t('copilot-custom-provider.ui.providerMeta', PROVIDER_TYPE_LABELS[p.type], p.models.length)}</div>
										</div>
									</div>
								`,
							)}
				</div>
			</aside>
			<main>
				${this.banner
					? html`<div class="banner ${this.banner.kind}" @click=${() => (this.banner = undefined)}>
							${this.banner.text}
						</div>`
					: ''}
				${this.editing ? this.renderEditor(this.editing) : this.renderEmpty()}
			</main>
		`;
	}

	private renderEmpty(): TemplateResult {
		return html`<div class="empty"><p>${this.t('copilot-custom-provider.ui.empty')}</p></div>`;
	}

	private renderEditor(p: ProviderConfig): TemplateResult {
		const dirty = this.isDirty;
		return html`
			<div class="toolbar">
				<div class="title">
					${p.name || this.t('copilot-custom-provider.ui.untitled')}
					${dirty ? html`<span class="dirty">${this.t('copilot-custom-provider.ui.unsavedChanges')}</span>` : ''}
				</div>
				<div class="toolbar-actions">
					<vscode-button
						class=${dirty ? 'save-dirty' : ''}
						?disabled=${!dirty}
						title=${this.t('copilot-custom-provider.ui.saveTooltip')}
						@click=${() => this.save()}
					>${this.t('copilot-custom-provider.ui.save')}</vscode-button>
					<vscode-button
						appearance="secondary"
						class="danger"
						@click=${() => this.deleteProvider()}
					>${this.t('copilot-custom-provider.ui.delete')}</vscode-button>
					<vscode-button appearance="secondary" @click=${() => send({ type: 'showLogs' })}>
						${this.t('copilot-custom-provider.ui.showLogs')}
					</vscode-button>
				</div>
			</div>

			<div class="field">
				<label>${this.t('copilot-custom-provider.ui.providerId')}</label>
				${this.isNewProvider || this.isRenamingId
					? html`<div class="provider-id-row">
							<vscode-textfield
								.value=${live(p.id)}
								@input=${(e: Event) => this.updateDraftId((e.target as HTMLInputElement).value)}
							></vscode-textfield>
							${this.isRenamingId
								? html`<vscode-button
										appearance="icon"
										title=${this.t('copilot-custom-provider.ui.cancel') || 'Cancel'}
										@click=${() => this.cancelRenameId()}
									>
										<vscode-icon name="close"></vscode-icon>
									</vscode-button>`
								: ''}
						</div>`
					: html`<div class="provider-id-row">
							<div class="provider-id-readonly">${p.id}</div>
							<vscode-button
								appearance="secondary"
								title=${this.t('copilot-custom-provider.ui.changeProviderIdTooltip')}
								@click=${() => this.startRenameId()}
							>${this.t('copilot-custom-provider.ui.changeProviderId')}</vscode-button>
						</div>`}
			</div>

			<div class="field-row">
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.preset')}</label>
					<vscode-single-select
						.value=${p.presetId ?? ''}
						@change=${(e: Event) =>
							this.applyPreset((e.target as HTMLSelectElement).value)}
					>
						${this.presets.map(
							(pr) =>
								html`<vscode-option value=${pr.id} ?selected=${pr.id === p.presetId}>
									${pr.label}
								</vscode-option>`,
						)}
					</vscode-single-select>
				</div>
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.type')}</label>
					<vscode-single-select
						.value=${p.type}
						@change=${(e: Event) =>
							this.updateField('type', (e.target as HTMLSelectElement).value as ProviderType)}
					>
						${Object.entries(PROVIDER_TYPE_LABELS).map(
							([v, label]) =>
								html`<vscode-option value=${v} ?selected=${v === p.type}>${label}</vscode-option>`,
						)}
					</vscode-single-select>
				</div>
			</div>

			<div class="field-row">
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.name')}</label>
					<vscode-textfield
						.value=${p.name}
						@input=${(e: Event) =>
							this.updateField('name', (e.target as HTMLInputElement).value)}
					></vscode-textfield>
				</div>
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.baseUrl')}</label>
					<vscode-textfield
						.value=${p.baseUrl}
						@input=${(e: Event) =>
							this.updateField('baseUrl', (e.target as HTMLInputElement).value)}
					></vscode-textfield>
				</div>
			</div>

			<div class="field">
				<label>${this.t('copilot-custom-provider.ui.description')}</label>
				<vscode-textarea
					rows="2"
					.value=${p.description ?? ''}
					@input=${(e: Event) =>
						this.updateField('description', (e.target as HTMLTextAreaElement).value)}
				></vscode-textarea>
			</div>

			<div class="field-row">
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.apiKey')}</label>
					<vscode-textfield
						type="password"
						placeholder=${this.t('copilot-custom-provider.ui.apiKeyPlaceholder')}
						.value=${this.editingApiKey}
						@input=${(e: Event) => (this.editingApiKey = (e.target as HTMLInputElement).value)}
					></vscode-textfield>
				</div>
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.keyStorage')}</label>
					<vscode-single-select
						.value=${p.keyStorage}
						@change=${(e: Event) =>
							this.updateField(
								'keyStorage',
								(e.target as HTMLSelectElement).value as ProviderConfig['keyStorage'],
							)}
					>
						<vscode-option value="secret" ?selected=${p.keyStorage === 'secret'}>
							${this.t('copilot-custom-provider.ui.keyStorage.secret')}
						</vscode-option>
						<vscode-option value="settings" ?selected=${p.keyStorage === 'settings'}>
							${this.t('copilot-custom-provider.ui.keyStorage.settings')}
						</vscode-option>
					</vscode-single-select>
				</div>
			</div>

			${p.type === 'anthropic-compatible'
				? html`
					<div class="field">
						<label>${this.t('copilot-custom-provider.ui.authMode')}</label>
						<vscode-single-select
							.value=${p.authMode ?? 'apiKey'}
							@change=${(e: Event) =>
								this.updateField(
									'authMode',
									(e.target as HTMLSelectElement).value as AuthMode,
								)}
						>
							<vscode-option value="apiKey" ?selected=${(p.authMode ?? 'apiKey') === 'apiKey'}>
								${this.t('copilot-custom-provider.ui.authMode.apiKey')}
							</vscode-option>
							<vscode-option value="bearer" ?selected=${p.authMode === 'bearer'}>
								${this.t('copilot-custom-provider.ui.authMode.bearer')}
							</vscode-option>
						</vscode-single-select>
					</div>
				`
				: ''}

			<vscode-divider></vscode-divider>

			<section class="models">
				<h3>${this.t('copilot-custom-provider.ui.models')}</h3>
				<div class="actions">
					<vscode-button @click=${() => this.addBlankModel()}>${this.t('copilot-custom-provider.ui.addManually')}</vscode-button>
					<vscode-button
						appearance="secondary"
						?disabled=${this.loadingModels}
						@click=${() => this.fetchRemoteModels()}
					>
						${this.loadingModels ? this.t('copilot-custom-provider.ui.fetching') : this.t('copilot-custom-provider.ui.fetchRemote')}
					</vscode-button>
				</div>

				${this.remoteModels.length > 0
					? html`<div class="remote-models">
							${this.remoteModels.map(
								(rm) => html`
									<div class="remote-row">
										<span>${rm.id}${rm.contextWindow ? html` <em>(${rm.contextWindow})</em>` : ''}</span>
										<vscode-button appearance="icon" @click=${() => this.addRemoteModel(rm)}>
											<vscode-icon name="add"></vscode-icon>
										</vscode-button>
									</div>
								`,
							)}
						</div>`
					: ''}

				${p.models.map((m, idx) => this.renderModelRow(m, idx))}
			</section>
		`;
	}

	private renderModelRow(m: ModelDefinition, idx: number): TemplateResult {
		return html`
			<div class="model-row">
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.modelId')}</label>
					<vscode-textfield
						.value=${m.id}
						placeholder=${this.t('copilot-custom-provider.ui.modelIdPlaceholder')}
						@input=${(e: Event) => this.updateModel(idx, { id: (e.target as HTMLInputElement).value })}
					></vscode-textfield>
				</div>
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.displayName')}</label>
					<vscode-textfield
						.value=${m.displayName}
						placeholder=${this.t('copilot-custom-provider.ui.displayNamePlaceholder')}
						@input=${(e: Event) =>
							this.updateModel(idx, { displayName: (e.target as HTMLInputElement).value })}
					></vscode-textfield>
				</div>
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.contextIn')}</label>
					<vscode-textfield
						.value=${live(formatTokenCount(m.maxInputTokens))}
						placeholder=${this.t('copilot-custom-provider.ui.tokens')}
						@input=${(e: Event) =>
							this.updateModel(idx, {
								maxInputTokens: parseTokenCount((e.target as HTMLInputElement).value),
							})}
					></vscode-textfield>
				</div>
				<div class="field">
					<label>${this.t('copilot-custom-provider.ui.output')}</label>
					<vscode-textfield
						.value=${live(formatTokenCount(m.maxOutputTokens))}
						placeholder=${this.t('copilot-custom-provider.ui.tokens')}
						@input=${(e: Event) =>
							this.updateModel(idx, {
								maxOutputTokens: parseTokenCount((e.target as HTMLInputElement).value),
							})}
					></vscode-textfield>
				</div>
				<vscode-button appearance="icon" title=${this.t('copilot-custom-provider.ui.remove')} @click=${() => this.removeModel(idx)}>
					<vscode-icon name="trash"></vscode-icon>
				</vscode-button>
			</div>
			<div class="cap-row">
				<vscode-checkbox
					?checked=${m.capabilities.toolCalling}
					@change=${(e: Event) =>
						this.updateModelCap(idx, { toolCalling: (e.target as HTMLInputElement).checked })}
				>
					${this.t('copilot-custom-provider.ui.tools')}
				</vscode-checkbox>
				<vscode-checkbox
					?checked=${m.capabilities.imageInput}
					@change=${(e: Event) =>
						this.updateModelCap(idx, { imageInput: (e.target as HTMLInputElement).checked })}
				>
					${this.t('copilot-custom-provider.ui.vision')}
				</vscode-checkbox>
				<vscode-checkbox
					?checked=${m.capabilities.thinking}
					@change=${(e: Event) =>
						this.updateModelCap(idx, { thinking: (e.target as HTMLInputElement).checked })}
				>
					${this.t('copilot-custom-provider.ui.thinking')}
				</vscode-checkbox>
			</div>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'copilot-custom-provider-app': CopilotCustomProviderApp;
	}
}
