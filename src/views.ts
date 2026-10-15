import * as vscode from 'vscode';
import { Controller } from './controller';
import { OptionItem, RunnerCommand, RunnerOption, availableItems, displayValue, selectedItem } from './model';
import { brandIcon, resolveIcon } from './icons';

export const CMD = {
	select: 'vsrunner.selectItem',
	pickOption: 'vsrunner.pickOption',
	runCommand: 'vsrunner.runCommand',
} as const;

const OPTION_ICON = { pick: 'option', text: 'text', toggle: 'toggle' } as const;

function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Configuration view ───────────────────────────────────────────────────────

type ConfigNode =
	| { kind: 'option'; option: RunnerOption }
	| { kind: 'item'; option: RunnerOption; item: OptionItem };

export class ConfigurationView implements vscode.TreeDataProvider<ConfigNode> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly ctl: Controller) {
		ctl.onDidChange(() => this.changed.fire());
	}

	getChildren(node?: ConfigNode): ConfigNode[] {
		const ready = this.ctl.ready;
		if (!ready) {
			return [];
		}
		if (!node) {
			return ready.config.options.map(option => ({ kind: 'option', option }));
		}
		if (node.kind === 'option' && node.option.type === 'pick') {
			return availableItems(node.option, this.ctl.selection).map(item => ({ kind: 'item', option: node.option, item }));
		}
		return [];
	}

	getParent(node: ConfigNode): ConfigNode | undefined {
		return node.kind === 'item' ? { kind: 'option', option: node.option } : undefined;
	}

	getTreeItem(node: ConfigNode): vscode.TreeItem {
		const sel = this.ctl.selection;
		if (node.kind === 'item') {
			const selected = sel[node.option.id] === node.item.label;
			const ti = new vscode.TreeItem(node.item.label, vscode.TreeItemCollapsibleState.None);
			ti.id = `${node.option.id}/${node.item.label}`;
			ti.description = node.item.description;
			ti.iconPath = brandIcon(selected ? 'selected' : 'unselected');
			ti.contextValue = selected ? 'item.selected' : 'item';
			ti.tooltip = new vscode.MarkdownString(
				`**${node.item.label}**${node.item.description ? ` — ${node.item.description}` : ''}\n\n\`{${node.option.id}}\` → \`${node.item.value}\``);
			ti.command = { title: 'Select', command: CMD.select, arguments: [node.option.id, node.item.label] };
			return ti;
		}

		const opt = node.option;
		const ti = new vscode.TreeItem(opt.label);
		ti.id = opt.id;
		ti.iconPath = resolveIcon(opt.icon, OPTION_ICON[opt.type]);
		ti.contextValue = `option.${opt.type}`;
		const tooltip = new vscode.MarkdownString(`**${opt.label}**`);
		if (opt.description) {
			tooltip.appendMarkdown(`\n\n${opt.description}`);
		}
		if (opt.dependsOn) {
			tooltip.appendMarkdown(`\n\nFiltered by *${opt.dependsOn}*`);
		}
		ti.tooltip = tooltip;

		switch (opt.type) {
			case 'pick': {
				const item = selectedItem(opt, sel);
				ti.description = item ? (item.description ? `${item.label} · ${item.description}` : item.label) : '—';
				ti.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				break;
			}
			case 'text':
				ti.description = sel[opt.id] || opt.placeholder || 'empty';
				ti.command = { title: 'Edit', command: CMD.pickOption, arguments: [opt.id] };
				break;
			case 'toggle':
				ti.description = displayValue(opt, sel);
				ti.checkboxState = sel[opt.id] === 'true'
					? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
				break;
		}
		return ti;
	}
}

// ── Actions view ─────────────────────────────────────────────────────────────

type ActionNode =
	| { kind: 'command'; command: RunnerCommand }
	| { kind: 'commandLine'; command: RunnerCommand };

const KIND_ICON = { build: 'build', clean: 'clean', other: 'run' } as const;

export class ActionsView implements vscode.TreeDataProvider<ActionNode> {
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changed.event;

	constructor(private readonly ctl: Controller) {
		ctl.onDidChange(() => this.changed.fire());
	}

	getChildren(node?: ActionNode): ActionNode[] {
		const ready = this.ctl.ready;
		if (!ready) {
			return [];
		}
		if (node) {
			return node.kind === 'command' ? [{ kind: 'commandLine', command: node.command }] : [];
		}
		const order = { build: 0, clean: 1, other: 2 };
		return [...ready.config.commands]
			.sort((a, b) => order[a.kind] - order[b.kind])
			.map(command => ({ kind: 'command', command }));
	}

	getTreeItem(node: ActionNode): vscode.TreeItem {
		const cmd = node.command;
		if (node.kind === 'commandLine') {
			const line = this.ctl.commandLine(cmd);
			const ti = new vscode.TreeItem(line, vscode.TreeItemCollapsibleState.None);
			ti.id = `${cmd.id}/line`;
			ti.iconPath = new vscode.ThemeIcon('terminal');
			ti.tooltip = line;
			ti.contextValue = 'commandLine';
			return ti;
		}

		const ti = new vscode.TreeItem(cmd.label, vscode.TreeItemCollapsibleState.Collapsed);
		ti.id = cmd.id;
		const running = this.ctl.runner.running;
		const last = this.ctl.lastResults[cmd.id];
		const tooltip = new vscode.MarkdownString(`**${cmd.label}**`);
		if (cmd.description) {
			tooltip.appendMarkdown(`\n\n${cmd.description}`);
		}

		if (running?.command.id === cmd.id) {
			ti.iconPath = new vscode.ThemeIcon('loading~spin');
			ti.description = 'running…';
			ti.contextValue = 'command.running';
		} else {
			ti.iconPath = resolveIcon(cmd.icon, KIND_ICON[cmd.kind]);
			ti.contextValue = 'command';
			if (last) {
				const status = last.exitCode === 0 ? '✓' : last.exitCode === undefined ? '■' : '✗';
				ti.description = `${status} ${formatDuration(last.durationMs)} · ${formatTime(last.startedAt)}`;
				tooltip.appendMarkdown(`\n\nLast run ${new Date(last.startedAt).toLocaleString()}: ` +
					(last.exitCode === 0 ? 'succeeded' : last.exitCode === undefined ? 'stopped' : `failed, exit code ${last.exitCode}`));
			} else if (cmd.kind === 'build' && this.ctl.needsClean()) {
				ti.description = 'will clean first';
			}
			if (cmd.kind === 'build' && this.ctl.needsClean()) {
				tooltip.appendMarkdown('\n\n$(warning) Configuration changed since the last build: a clean runs first.');
				tooltip.supportThemeIcons = true;
			}
		}
		ti.tooltip = tooltip;
		ti.command = { title: 'Run', command: CMD.runCommand, arguments: [cmd.id] };
		return ti;
	}
}

// ── Status bar ───────────────────────────────────────────────────────────────

export class StatusBar implements vscode.Disposable {
	private readonly configItem = vscode.window.createStatusBarItem('vsrunner.config', vscode.StatusBarAlignment.Left, 50);
	private readonly buildItem = vscode.window.createStatusBarItem('vsrunner.build', vscode.StatusBarAlignment.Left, 49);

	constructor(private readonly ctl: Controller) {
		this.configItem.name = 'VS Runner Configuration';
		this.buildItem.name = 'VS Runner Build';
		ctl.onDidChange(() => this.update());
		vscode.workspace.onDidChangeConfiguration(e => e.affectsConfiguration('vsrunner.showStatusBar') && this.update());
		this.update();
	}

	private update(): void {
		const ready = this.ctl.ready;
		const show = vscode.workspace.getConfiguration('vsrunner').get<boolean>('showStatusBar', true);
		if (!ready || !show) {
			this.configItem.hide();
			this.buildItem.hide();
			return;
		}

		const sel = this.ctl.selection;
		const shown = ready.config.options.filter(o => o.type === 'pick' || (o.type === 'toggle' && sel[o.id] === 'true'));
		this.configItem.text = `$(circuit-board) ${shown.map(o => o.type === 'toggle' ? o.label : sel[o.id]).join(' · ')}`;
		const tip = new vscode.MarkdownString('**VS Runner configuration**\n\n');
		for (const o of ready.config.options) {
			tip.appendMarkdown(`- ${o.label}: \`${displayValue(o, sel) || '—'}\`\n`);
		}
		tip.appendMarkdown('\nClick to change');
		this.configItem.tooltip = tip;
		this.configItem.command = 'vsrunner.pickConfiguration';
		this.configItem.show();

		const running = this.ctl.runner.running;
		const build = this.ctl.findCommand('build');
		if (running) {
			this.buildItem.text = `$(loading~spin) ${running.command.label}`;
			this.buildItem.tooltip = 'Click to stop';
			this.buildItem.command = 'vsrunner.stop';
			this.buildItem.backgroundColor = undefined;
		} else if (build) {
			const last = this.ctl.lastResults[build.id];
			const failed = last && last.exitCode !== 0 && last.exitCode !== undefined;
			this.buildItem.text = failed ? '$(error) Build' : '$(tools) Build';
			this.buildItem.tooltip = this.ctl.needsClean() ? 'Build (configuration changed: cleans first)' : 'Build';
			this.buildItem.command = 'vsrunner.build';
			this.buildItem.backgroundColor = failed ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
		} else {
			this.buildItem.hide();
			return;
		}
		this.buildItem.show();
	}

	dispose(): void {
		this.configItem.dispose();
		this.buildItem.dispose();
	}
}
