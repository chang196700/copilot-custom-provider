import { readFileSync } from 'node:fs';
import path from 'node:path';
import vscode from 'vscode';

let strings: Record<string, string> = {};
let loaded = false;
let extensionRoot: string | undefined;

export function initI18n(context: vscode.ExtensionContext): void {
	extensionRoot = context.extensionPath;
	loaded = false; // allow reload with correct root
	load();
}

function load(): void {
	if (loaded) return;
	loaded = true;
	try {
		const root = extensionRoot;
		if (!root) return;
		const lang = vscode.env.language || 'en';
		const candidates = [
			path.join(root, `package.nls.${lang}.json`),
			path.join(root, `package.nls.${lang.split('-')[0]}.json`),
			path.join(root, 'package.nls.json'),
		];
		for (const file of candidates) {
			try {
				strings = JSON.parse(readFileSync(file, 'utf8'));
				return;
			} catch {
				// try next
			}
		}
	} catch {
		// ignore
	}
}

export function t(key: string, ...args: unknown[]): string {
	load();
	const template = strings[key] ?? key;
	if (args.length === 0) return template;
	return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? ''));
}

export function getStrings(): Record<string, string> {
	load();
	return { ...strings };
}
