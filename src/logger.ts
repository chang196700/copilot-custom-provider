import vscode from 'vscode';
import { CONFIG_SECTION } from './config';
import { safeStringify } from './json';

class Logger {
	private channel: vscode.OutputChannel | undefined;

	private get out(): vscode.OutputChannel {
		if (!this.channel) {
			this.channel = vscode.window.createOutputChannel('Copilot Custom Provider');
		}
		return this.channel;
	}

	private write(level: string, args: unknown[]): void {
		const ts = new Date().toISOString();
		const text = args
			.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : safeStringify(a)))
			.join(' ');
		this.out.appendLine(`[${ts}] [${level}] ${text}`);
	}

	info(...args: unknown[]): void {
		this.write('info', args);
	}

	warn(...args: unknown[]): void {
		this.write('warn', args);
	}

	error(...args: unknown[]): void {
		this.write('error', args);
	}

	debug(...args: unknown[]): void {
		const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
		if (cfg.get<boolean>('debug', false)) {
			this.write('debug', args);
		}
	}

	show(): void {
		this.out.show(true);
	}

	dispose(): void {
		this.channel?.dispose();
		this.channel = undefined;
	}
}

export const logger = new Logger();
