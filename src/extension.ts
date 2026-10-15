import * as vscode from 'vscode';
import { Controller } from './controller';
import { RunnerConfig, availableItems, displayValue, findOption } from './model';
import { initIcons, resolveIcon } from './icons';
import { TASK_TYPE, createTask } from './taskRunner';
import { ActionsView, CMD, ConfigurationView, StatusBar } from './views';

const SAMPLE_CONFIG = {
	options: [
		{ id: 'platform', label: 'Platform', icon: 'chip', default: 'board-a', items: ['board-a', 'board-b'] },
		{
			id: 'target', label: 'Target', icon: 'target', dependsOn: 'platform', items: [
				{ label: 'app', value: 'type=app' },
				{ label: 'boot', value: 'type=boot', when: ['board-a'] },
			],
		},
		{ id: 'tag', label: 'Tag', icon: 'tag', default: 'dev', items: ['prd', 'dev'] },
		{ id: 'extra', label: 'Extra arguments', type: 'text', default: '', placeholder: 'e.g. -j8' },
	],
	commands: [
		{ id: 'build', label: 'Build', cmd: 'make platform={platform} {target} tag={tag} {extra}', problemMatcher: '$gcc' },
		{ id: 'clean', label: 'Clean', cmd: 'make clean' },
	],
};

export function activate(context: vscode.ExtensionContext): { controller: Controller } {
	initIcons(context.extensionUri);
	const ctl = new Controller(context);
	context.subscriptions.push(ctl);

	const configView = vscode.window.createTreeView('vsrunner.configuration', {
		treeDataProvider: new ConfigurationView(ctl), showCollapseAll: true,
	});
	const actionsView = vscode.window.createTreeView('vsrunner.actions', { treeDataProvider: new ActionsView(ctl) });
	context.subscriptions.push(configView, actionsView, new StatusBar(ctl));

	context.subscriptions.push(
		configView.onDidChangeCheckboxState(e => {
			for (const [node, state] of e.items) {
				if (node.kind === 'option') {
					void ctl.setOption(node.option.id, String(state === vscode.TreeItemCheckboxState.Checked));
				}
			}
		}),
		ctl.onDidChange(() => {
			void vscode.commands.executeCommand('setContext', 'vsrunner.running', !!ctl.runner.running);
			const errorMessage = ctl.state.kind === 'error' ? ctl.state.message : undefined;
			configView.message = errorMessage ? `⚠ ${errorMessage}` : undefined;
		}),
	);

	const register = (id: string, fn: (...args: any[]) => unknown) =>
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));

	register('vsrunner.build', () => ctl.build());
	register('vsrunner.rebuild', () => ctl.build(true));
	register('vsrunner.clean', () => ctl.run('clean'));
	register('vsrunner.stop', () => ctl.runner.stop());
	register('vsrunner.reload', () => ctl.reload());
	register('vsrunner.showOutput', () => ctl.output.show());
	register(CMD.runCommand, (arg?: string | { command?: { id: string } }) => {
		const id = typeof arg === 'string' ? arg : arg?.command?.id;
		return id ? ctl.run(id) : pickCommand(ctl);
	});
	register(CMD.select, (optionId: string, label: string) => ctl.setOption(optionId, label));
	register(CMD.pickOption, (arg: string | { option?: { id: string } }) => {
		const id = typeof arg === 'string' ? arg : arg?.option?.id;
		return id ? pickOption(ctl, id) : undefined;
	});
	register('vsrunner.pickConfiguration', () => pickConfiguration(ctl));
	register('vsrunner.copyCommandLine', async (arg?: { command?: { id: string } }) => {
		const cmd = ctl.findCommand(arg?.command?.id ?? 'build');
		if (cmd) {
			await vscode.env.clipboard.writeText(ctl.commandLine(cmd));
			void vscode.window.setStatusBarMessage('$(copy) Command line copied', 2000);
		}
	});
	register('vsrunner.openConfig', () => openConfig(ctl));
	register('vsrunner.createConfig', () => createConfig(ctl, SAMPLE_CONFIG));
	register('vsrunner.runSetup', () => ctl.runSetup());
	register('vsrunner.migrateLegacyConfig', () => {
		const ready = ctl.ready;
		if (!ready?.config.legacy) {
			void vscode.window.showInformationMessage('VS Runner: no legacy config is loaded');
			return;
		}
		return createConfig(ctl, toJson(ready.config));
	});

	context.subscriptions.push(vscode.tasks.registerTaskProvider(TASK_TYPE, {
		provideTasks: () => {
			const ready = ctl.ready;
			return ready ? ready.config.commands.map(c => createTask(ready.folder, c, ctl.commandLine(c))) : [];
		},
		resolveTask: task => {
			const ready = ctl.ready;
			const cmd = ready && ctl.findCommand(task.definition.command);
			if (!ready || !cmd) {
				return undefined;
			}
			const resolved = createTask(ready.folder, cmd, ctl.commandLine(cmd));
			resolved.definition = task.definition;
			return resolved;
		},
	}));

	void ctl.reload();
	return { controller: ctl };
}

async function pickCommand(ctl: Controller): Promise<void> {
	const cmds = ctl.ready?.config.commands ?? [];
	const pick = await vscode.window.showQuickPick(
		cmds.map(c => ({ label: c.label, description: ctl.commandLine(c), id: c.id })),
		{ title: 'VS Runner: Run Command', matchOnDescription: true });
	if (pick) {
		await ctl.run(pick.id);
	}
}

/** Returns false when the user dismissed the picker. */
async function pickOption(ctl: Controller, optionId: string, step?: { n: number; total: number }): Promise<boolean> {
	const ready = ctl.ready;
	const opt = ready && findOption(ready.config, optionId);
	if (!opt) {
		return false;
	}
	const title = step ? `${opt.label} (${step.n}/${step.total})` : opt.label;
	if (opt.type === 'text') {
		const value = await vscode.window.showInputBox({
			title, value: ctl.selection[opt.id], placeHolder: opt.placeholder, prompt: opt.description,
		});
		if (value === undefined) {
			return false;
		}
		await ctl.setOption(opt.id, value);
		return true;
	}
	if (opt.type === 'toggle') {
		await ctl.setOption(opt.id, String(ctl.selection[opt.id] !== 'true'));
		return true;
	}
	const current = ctl.selection[opt.id];
	const items = availableItems(opt, ctl.selection).map(it => ({
		label: it.label,
		description: it.description,
		detail: it.value !== it.label ? it.value : undefined,
		picked: it.label === current,
		iconPath: it.label === current ? new vscode.ThemeIcon('check') : undefined,
	}));
	const pick = await vscode.window.showQuickPick(items, {
		title, placeHolder: `Current: ${current}`, matchOnDescription: true, matchOnDetail: true,
	});
	if (!pick) {
		return false;
	}
	await ctl.setOption(opt.id, pick.label);
	return true;
}

async function pickConfiguration(ctl: Controller): Promise<void> {
	const ready = ctl.ready;
	if (!ready) {
		await vscode.commands.executeCommand('workbench.view.extension.vsrunner');
		return;
	}
	type Entry = vscode.QuickPickItem & { id?: string };
	const entries: Entry[] = ready.config.options.map(o => ({
		label: o.label,
		description: displayValue(o, ctl.selection) || '—',
		iconPath: resolveIcon(o.icon, 'option') as vscode.QuickPickItem['iconPath'],
		id: o.id,
	}));
	entries.push(
		{ label: '', kind: vscode.QuickPickItemKind.Separator },
		{ label: '$(list-ordered) Step through all options', id: '*' },
	);
	const pick = await vscode.window.showQuickPick(entries, { title: 'VS Runner: Configuration' });
	if (!pick?.id) {
		return;
	}
	if (pick.id !== '*') {
		await pickOption(ctl, pick.id);
		return;
	}
	const steps = ready.config.options.filter(o => o.type !== 'toggle');
	for (let i = 0; i < steps.length; i++) {
		if (!await pickOption(ctl, steps[i].id, { n: i + 1, total: steps.length })) {
			return;
		}
	}
}

async function openConfig(ctl: Controller): Promise<void> {
	const state = ctl.state;
	const file = state.kind === 'ready' ? state.files[0] : state.kind === 'error' ? state.file : undefined;
	if (file) {
		await vscode.window.showTextDocument(file);
	} else if (state.kind === 'error') {
		ctl.output.show();
	} else {
		await vscode.commands.executeCommand(ctl.setupCommand() ? 'vsrunner.runSetup' : 'vsrunner.createConfig');
	}
}

async function createConfig(ctl: Controller, content: object): Promise<void> {
	const folder = ctl.ready?.folder ?? (ctl.state.kind !== 'disabled' ? ctl.state.folder : undefined)
		?? vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('VS Runner: open a folder first');
		return;
	}
	const rel = vscode.workspace.getConfiguration('vsrunner', folder).get<string>('configFile', '.vscode/vsrunner.json');
	const uri = vscode.Uri.joinPath(folder.uri, ...rel.split(/[\\/]/));
	try {
		await vscode.workspace.fs.stat(uri);
		const overwrite = 'Overwrite';
		if (await vscode.window.showWarningMessage(`${rel} already exists.`, { modal: true }, overwrite) !== overwrite) {
			return;
		}
	} catch {
		// does not exist yet
	}
	await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(content, null, 4) + '\n'));
	await vscode.window.showTextDocument(uri);
	await ctl.reload();
}

/** Serializes a loaded config to the current format; legacy scripts become a comment-free hint. */
function toJson(config: RunnerConfig): object {
	return {
		options: config.options.map(o => ({
			id: o.id,
			label: o.label,
			default: o.default,
			dependsOn: o.dependsOn,
			items: o.items.map(it => ({ label: it.label, value: it.value, when: it.when })),
			...(o.legacyPostCmd || o.legacyPreCmd ? { onChange: [{ command: 'TODO: replace preCmd/postCmd', args: [o.legacyPreCmd ?? o.legacyPostCmd] }] } : {}),
		})),
		commands: config.commands.map(c => ({ id: c.id, label: c.label, cmd: c.cmd, kind: c.kind })),
	};
}

export function deactivate(): void {}
