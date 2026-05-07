// Minimal proposed-API augmentation for LanguageModelThinkingPart.
// Cast to LanguageModelResponsePart at the call site.
declare module 'vscode' {
	export class LanguageModelThinkingPart {
		value: string;
		metadata?: Record<string, unknown>;
		constructor(value: string, metadata?: Record<string, unknown>);
	}
}
export {};
