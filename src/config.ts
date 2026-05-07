import vscode from 'vscode';

export const CONFIG_SECTION = 'copilot-custom-provider';

export function cfg() {
	return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

export function getDebugEnabled(): boolean {
	return cfg().get<boolean>('debug', false);
}

export function getSyncProviders(): boolean {
	return cfg().get<boolean>('syncProviders', false);
}

export function getVisionModelId(): string | undefined {
	const v = cfg().get<string>('visionModel', '');
	return v.trim() || undefined;
}

export function getVisionPrompt(): string {
	return (
		cfg()
			.get<string>('visionPrompt', '')
			.trim() ||
		'Describe the visual contents of this image in detail, including any text, objects, people, or context that would be relevant for understanding it. Focus on factual visual elements.'
	);
}
