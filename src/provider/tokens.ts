import vscode from 'vscode';

const FALLBACK_CHARS_PER_TOKEN = 4.0;

export function estimateTokenCount(
	input: string | vscode.LanguageModelChatRequestMessage,
	charsPerToken = FALLBACK_CHARS_PER_TOKEN,
): number {
	const text = typeof input === 'string' ? input : extractText(input);
	return Math.ceil(text.length / Math.max(charsPerToken, 1));
}

function extractText(message: vscode.LanguageModelChatRequestMessage): string {
	let out = '';
	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) out += part.value;
	}
	return out;
}
