import * as vscode from 'vscode';

/** Bundled brand icons, media/icons/{light,dark}/<name>.svg. */
export const BRAND_ICONS = [
	'build', 'clean', 'rebuild', 'stop', 'run', 'flash', 'analyze', 'terminal', 'publish',
	'chip', 'target', 'tag', 'board', 'text', 'toggle', 'option',
	'selected', 'unselected', 'success', 'failure',
] as const;

let extensionUri: vscode.Uri;

export function initIcons(uri: vscode.Uri): void {
	extensionUri = uri;
}

export function brandIcon(name: string): { light: vscode.Uri; dark: vscode.Uri } {
	return {
		light: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'light', `${name}.svg`),
		dark: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'dark', `${name}.svg`),
	};
}

/** Config "icon": a bundled icon name, or a codicon as "$(name)". */
export function resolveIcon(spec: string | undefined, fallback: string): vscode.TreeItem['iconPath'] {
	const name = spec ?? fallback;
	const codicon = /^\$\(([\w~-]+)\)$/.exec(name);
	if (codicon) {
		return new vscode.ThemeIcon(codicon[1]);
	}
	return (BRAND_ICONS as readonly string[]).includes(name) ? brandIcon(name) : new vscode.ThemeIcon(name);
}

/** Status bar text only takes codicons, so config icons map to the closest one there. */
export function statusCodicon(spec: string | undefined, fallback: string): string {
	const codicon = /^\$\(([\w~-]+)\)$/.exec(spec ?? '');
	if (codicon) {
		return codicon[0];
	}
	const map: Record<string, string> = {
		build: 'tools', clean: 'trash', rebuild: 'refresh', run: 'play', flash: 'zap',
		analyze: 'graph', terminal: 'terminal', publish: 'cloud-upload', chip: 'circuit-board',
		target: 'package', tag: 'tag', board: 'circuit-board', text: 'edit', toggle: 'settings',
	};
	return `$(${map[spec ?? ''] ?? fallback})`;
}
