import esbuild from 'esbuild';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');

const outdir = 'out/webview';
mkdirSync(outdir, { recursive: true });
mkdirSync(`${outdir}/codicons`, { recursive: true });

// Copy static assets
if (existsSync('src/webview/ui/index.html')) {
	copyFileSync('src/webview/ui/index.html', `${outdir}/index.html`);
}
if (existsSync('src/webview/ui/styles.css')) {
	copyFileSync('src/webview/ui/styles.css', `${outdir}/styles.css`);
}
// Codicon font for <vscode-icon>
copyFileSync('node_modules/@vscode/codicons/dist/codicon.css', `${outdir}/codicons/codicon.css`);
copyFileSync('node_modules/@vscode/codicons/dist/codicon.ttf', `${outdir}/codicons/codicon.ttf`);

const options = {
	entryPoints: ['src/webview/ui/main.ts'],
	bundle: true,
	format: 'esm',
	target: ['es2022'],
	outfile: `${outdir}/main.js`,
	sourcemap: true,
	minify: !watch,
	logLevel: 'info',
	tsconfig: 'src/webview/ui/tsconfig.json',
};

if (watch) {
	const ctx = await esbuild.context(options);
	await ctx.watch();
	console.log('[webview] watching...');
} else {
	await esbuild.build(options);
	console.log('[webview] built.');
}
