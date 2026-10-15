import * as vscode from 'vscode';
import * as path from 'path';
import {
	ConfigError, RunnerCommand, RunnerConfig, RunnerOption, Selection,
	buildSignature, expandCommand, findOption, normalizeSelection, parseConfig,
	parseJsonc, parseLegacyConfig, warningApplies,
} from './model';
import { RunResult, TaskRunner, createTask } from './taskRunner';

const SELECTION_KEY = 'vsrunner.selection';
const SIGNATURE_KEY = 'vsrunner.lastBuildSignature';
const RESULTS_KEY = 'vsrunner.lastResults';

export type CleanPolicy = 'onChange' | 'always' | 'never';

interface LoadedConfig {
	folder: vscode.WorkspaceFolder;
	config: RunnerConfig;
	files: vscode.Uri[];
}

export type ConfigState =
	| { kind: 'disabled' }
	| { kind: 'missing'; folder?: vscode.WorkspaceFolder }
	| { kind: 'error'; folder: vscode.WorkspaceFolder; message: string; file?: vscode.Uri }
	| { kind: 'ready'; folder: vscode.WorkspaceFolder; config: RunnerConfig; files: vscode.Uri[] };

async function readJson(uri: vscode.Uri): Promise<unknown> {
	const bytes = await vscode.workspace.fs.readFile(uri);
	try {
		return parseJsonc(Buffer.from(bytes).toString('utf8'));
	} catch (e) {
		throw new ConfigError(`${path.basename(uri.fsPath)}: ${(e as Error).message}`);
	}
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

function resolveIn(folder: vscode.WorkspaceFolder, p: string): vscode.Uri {
	return path.isAbsolute(p) ? vscode.Uri.file(p) : vscode.Uri.joinPath(folder.uri, ...p.split(/[\\/]/));
}

export class Controller implements vscode.Disposable {
	state: ConfigState = { kind: 'missing' };
	selection: Selection = {};
	lastResults: Record<string, RunResult> = {};

	readonly runner = new TaskRunner();
	readonly output = vscode.window.createOutputChannel('VS Runner', { log: true });

	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	private readonly disposables: vscode.Disposable[] = [this.runner, this.output, this.changed];
	private watchers: vscode.Disposable[] = [];
	private reloadTimer: NodeJS.Timeout | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.lastResults = context.workspaceState.get<Record<string, RunResult>>(RESULTS_KEY, {});
		this.disposables.push(
			this.runner.onDidChange(() => this.changed.fire()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('vsrunner')) {
					this.scheduleReload();
				}
			}),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleReload()),
			vscode.workspace.onDidGrantWorkspaceTrust(() => this.changed.fire()),
		);
	}

	get ready(): (ConfigState & { kind: 'ready' }) | undefined {
		return this.state.kind === 'ready' ? this.state : undefined;
	}

	/** Coalesces the burst of events an editor save or a generator script produces. */
	scheduleReload(): void {
		clearTimeout(this.reloadTimer);
		this.reloadTimer = setTimeout(() => void this.reload(), 200);
	}

	async reload(): Promise<void> {
		const previous = this.state;
		this.state = await this.load();
		this.rewatch();

		if (this.state.kind === 'ready') {
			const stored = this.context.workspaceState.get<Selection>(this.selectionKey(this.state.folder));
			this.selection = normalizeSelection(this.state.config, stored);
			await this.saveSelection();
			if (previous.kind !== 'ready') {
				this.output.info(`Loaded ${this.state.files.map(f => vscode.workspace.asRelativePath(f)).join(', ')}`);
			}
			if (this.state.config.legacy) {
				this.output.warn('Using the legacy options/commands files; run "VS Runner: Migrate Legacy Config" to switch to vsrunner.json');
			}
		} else if (this.state.kind === 'error') {
			this.output.error(this.state.message);
		}

		void vscode.commands.executeCommand('setContext', 'vsrunner.state', this.state.kind);
		void vscode.commands.executeCommand('setContext', 'vsrunner.hasSetupCommand', !!this.setupCommand());
		this.changed.fire();
	}

	private async load(): Promise<ConfigState> {
		const folders = vscode.workspace.workspaceFolders ?? [];
		if (folders.length === 0) {
			return { kind: 'missing' };
		}
		let firstError: ConfigState | undefined;
		for (const folder of folders) {
			const settings = vscode.workspace.getConfiguration('vsrunner', folder);
			if (!settings.get<boolean>('enabled', true)) {
				continue;
			}
			try {
				const loaded = await this.loadFolder(folder);
				if (loaded) {
					return { kind: 'ready', ...loaded };
				}
			} catch (e) {
				firstError ??= { kind: 'error', folder, message: (e as Error).message };
			}
		}
		if (firstError) {
			return firstError;
		}
		const anyEnabled = folders.some(f => vscode.workspace.getConfiguration('vsrunner', f).get('enabled', true));
		return anyEnabled ? { kind: 'missing', folder: folders[0] } : { kind: 'disabled' };
	}

	private async loadFolder(folder: vscode.WorkspaceFolder): Promise<LoadedConfig | undefined> {
		const settings = vscode.workspace.getConfiguration('vsrunner', folder);
		const configUri = resolveIn(folder, settings.get<string>('configFile', '.vscode/vsrunner.json'));
		if (await exists(configUri)) {
			return { folder, config: parseConfig(await readJson(configUri)), files: [configUri] };
		}

		const optionsPath = settings.get<string>('optionsFilePath');
		const commandsPath = settings.get<string>('commandsFilePath');
		if (!optionsPath || !commandsPath) {
			return undefined;
		}
		const optionsUri = resolveIn(folder, optionsPath);
		const commandsUri = resolveIn(folder, commandsPath);
		if (!await exists(optionsUri) || !await exists(commandsUri)) {
			return undefined;
		}
		const config = parseLegacyConfig(await readJson(optionsUri), await readJson(commandsUri));
		return { folder, config, files: [optionsUri, commandsUri] };
	}

	/** Watches whatever could turn into a config, so creating or generating one needs no window reload. */
	private rewatch(): void {
		this.watchers.forEach(w => w.dispose());
		this.watchers = [];
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const settings = vscode.workspace.getConfiguration('vsrunner', folder);
			const paths = [
				settings.get<string>('configFile', '.vscode/vsrunner.json'),
				settings.get<string>('optionsFilePath'),
				settings.get<string>('commandsFilePath'),
			].filter((p): p is string => !!p);
			for (const p of paths) {
				const uri = resolveIn(folder, p);
				const watcher = vscode.workspace.createFileSystemWatcher(
					new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)));
				watcher.onDidChange(() => this.scheduleReload());
				watcher.onDidCreate(() => this.scheduleReload());
				watcher.onDidDelete(() => this.scheduleReload());
				this.watchers.push(watcher);
			}
		}
	}

	private selectionKey(folder: vscode.WorkspaceFolder): string {
		return `${SELECTION_KEY}:${folder.uri.toString()}`;
	}

	private signatureKey(folder: vscode.WorkspaceFolder): string {
		return `${SIGNATURE_KEY}:${folder.uri.toString()}`;
	}

	private async saveSelection(): Promise<void> {
		const ready = this.ready;
		if (ready) {
			await this.context.workspaceState.update(this.selectionKey(ready.folder), this.selection);
		}
	}

	// ── Options ──────────────────────────────────────────────────────────────

	async setOption(optionId: string, value: string): Promise<void> {
		const ready = this.ready;
		const option = ready && findOption(ready.config, optionId);
		if (!ready || !option || this.selection[optionId] === value) {
			return;
		}
		this.runLegacyScript(option.legacyPreCmd, { element: { label: value, parentLabel: optionId } });

		const before = this.selection;
		this.selection = normalizeSelection(ready.config, { ...this.selection, [optionId]: value });
		await this.saveSelection();
		this.changed.fire();

		// Dependent options may have been reset too; their hooks fire like a manual change would.
		for (const opt of ready.config.options) {
			if (before[opt.id] !== this.selection[opt.id]) {
				await this.fireOnChange(opt);
			}
		}
	}

	private async fireOnChange(option: RunnerOption): Promise<void> {
		const value = this.selection[option.id];
		for (const hook of option.onChange ?? []) {
			const args = (hook.args ?? []).map(a => typeof a === 'string'
				? expandCommand(a, this.ready!.config, this.selection, { value, label: value })
				: a);
			try {
				await vscode.commands.executeCommand(hook.command, ...args);
			} catch (e) {
				this.output.warn(`onChange of "${option.id}": ${hook.command} failed: ${(e as Error).message}`);
			}
		}
		this.runLegacyScript(option.legacyPostCmd, { element: { label: value, parentLabel: option.id } });
	}

	// ── Commands ─────────────────────────────────────────────────────────────

	findCommand(kindOrId: string): RunnerCommand | undefined {
		const cmds = this.ready?.config.commands ?? [];
		return cmds.find(c => c.id === kindOrId) ?? cmds.find(c => c.kind === kindOrId);
	}

	commandLine(command: RunnerCommand): string {
		const ready = this.ready!;
		return expandCommand(command.cmd, ready.config, this.selection, {
			workspaceFolder: ready.folder.uri.fsPath,
			workspaceFolderBasename: ready.folder.name,
		});
	}

	needsClean(): boolean {
		const ready = this.ready;
		if (!ready) {
			return false;
		}
		const policy = vscode.workspace.getConfiguration('vsrunner', ready.folder).get<CleanPolicy>('cleanBeforeBuild', 'onChange');
		if (policy !== 'onChange') {
			return policy === 'always';
		}
		const last = this.context.workspaceState.get<string>(this.signatureKey(ready.folder));
		return last !== undefined && last !== buildSignature(ready.config, this.selection);
	}

	/** Build, preceded by a clean when the policy and the last build call for it. */
	async build(forceClean = false): Promise<void> {
		const build = this.findCommand('build');
		if (!build) {
			void vscode.window.showErrorMessage('VS Runner: no command with kind "build" in the config');
			return;
		}
		if (!await this.preflight(build)) {
			return;
		}
		if (forceClean || this.needsClean()) {
			const clean = this.findCommand('clean');
			if (clean) {
				this.output.info(forceClean ? 'Rebuild: cleaning first' : 'Configuration changed since the last build: cleaning first');
				const result = await this.execute(clean);
				if (result?.exitCode !== 0) {
					return;
				}
			}
		}
		await this.execute(build);
	}

	async run(commandId: string): Promise<void> {
		const command = this.findCommand(commandId);
		if (!command) {
			return;
		}
		if (command.kind === 'build') {
			return this.build();
		}
		if (await this.preflight(command)) {
			await this.execute(command);
		}
	}

	private async preflight(command: RunnerCommand): Promise<boolean> {
		if (this.runner.running) {
			const stop = 'Stop and Continue';
			const answer = await vscode.window.showWarningMessage(
				`"${this.runner.running.command.label}" is still running.`, stop);
			if (answer !== stop) {
				return false;
			}
			this.runner.stop();
			await new Promise<void>(resolve => {
				const sub = this.runner.onDidChange(() => {
					if (!this.runner.running) {
						sub.dispose();
						resolve();
					}
				});
			});
		}
		if (command.confirm) {
			const run = 'Run';
			const msg = expandCommand(command.confirm, this.ready!.config, this.selection);
			if (await vscode.window.showWarningMessage(msg, { modal: true }, run) !== run) {
				return false;
			}
		}
		if (command.warning && warningApplies(command.warning, this.selection)) {
			void vscode.window.showWarningMessage(expandCommand(command.warning.message, this.ready!.config, this.selection));
		}
		if (vscode.workspace.getConfiguration('vsrunner', this.ready!.folder).get<boolean>('saveBeforeRun', true)) {
			await vscode.workspace.saveAll(false);
		}
		return true;
	}

	private async execute(command: RunnerCommand): Promise<RunResult | undefined> {
		const ready = this.ready;
		if (!ready) {
			return undefined;
		}
		const commandLine = this.commandLine(command);
		this.output.info(`▶ ${command.label}: ${commandLine}`);
		this.runLegacyScript(command.legacyPreCmd, { runner: this.legacyRunner() });

		if (command.kind === 'build') {
			await this.context.workspaceState.update(this.signatureKey(ready.folder), buildSignature(ready.config, this.selection));
		}

		let result: RunResult;
		try {
			result = await this.runner.run(command, createTask(ready.folder, command, commandLine));
		} catch (e) {
			void vscode.window.showErrorMessage(`VS Runner: ${(e as Error).message}`);
			return undefined;
		}

		if (command.kind === 'clean' && result.exitCode === 0) {
			await this.context.workspaceState.update(this.signatureKey(ready.folder), undefined);
		}
		this.lastResults = { ...this.lastResults, [command.id]: result };
		await this.context.workspaceState.update(RESULTS_KEY, this.lastResults);
		this.changed.fire();

		this.runLegacyScript(command.legacyPostCmd, { runner: this.legacyRunner() });
		this.report(command, result);
		return result;
	}

	private report(command: RunnerCommand, result: RunResult): void {
		const ok = result.exitCode === 0;
		const seconds = (result.durationMs / 1000).toFixed(1);
		const status = result.exitCode === undefined ? 'stopped' : ok ? 'succeeded' : `failed (exit ${result.exitCode})`;
		this.output.info(`■ ${command.label} ${status} in ${seconds}s`);

		const notify = vscode.workspace.getConfiguration('vsrunner', this.ready?.folder).get<string>('notifyOnFinish', 'onFailure');
		if (notify === 'never' || (notify === 'onFailure' && (ok || result.exitCode === undefined))) {
			return;
		}
		const msg = `${command.label} ${status} in ${seconds}s`;
		if (ok) {
			void vscode.window.showInformationMessage(msg);
		} else {
			void vscode.window.showErrorMessage(msg, 'Show Terminal').then(a => {
				if (a) {
					void vscode.commands.executeCommand('workbench.action.terminal.focus');
				}
			});
		}
	}

	// ── Setup ────────────────────────────────────────────────────────────────

	/** Projects that generate their config (and git-ignore it) say here how. */
	setupCommand(): { folder: vscode.WorkspaceFolder; cmd: string } | undefined {
		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const cmd = vscode.workspace.getConfiguration('vsrunner', folder).get<string>('setupCommand');
			if (cmd) {
				return { folder, cmd };
			}
		}
		return undefined;
	}

	async runSetup(): Promise<void> {
		const setup = this.setupCommand();
		if (!setup) {
			return;
		}
		const command: RunnerCommand = { id: 'setup', label: 'Generate config', cmd: setup.cmd, kind: 'other' };
		this.output.info(`▶ ${command.label}: ${setup.cmd}`);
		let result: RunResult;
		try {
			result = await this.runner.run(command, createTask(setup.folder, command, setup.cmd));
		} catch (e) {
			void vscode.window.showErrorMessage(`VS Runner: ${(e as Error).message}`);
			return;
		}
		await this.reload();
		if (result.exitCode !== 0) {
			void vscode.window.showErrorMessage(`VS Runner: "${setup.cmd}" failed (exit ${result.exitCode})`);
		} else if (this.state.kind === 'missing') {
			void vscode.window.showWarningMessage(`VS Runner: "${setup.cmd}" finished but created no config`);
		}
	}

	// ── Legacy scripts ───────────────────────────────────────────────────────

	/** What preCmd/postCmd scripts of the old format were handed as "runner". */
	private legacyRunner(): object {
		return { Build: new Map(Object.entries(this.selection)) };
	}

	/** Old configs carry JavaScript strings; they only run in a trusted workspace. */
	private runLegacyScript(script: string | undefined, scope: { element?: object; runner?: object }): void {
		if (!script) {
			return;
		}
		if (!vscode.workspace.isTrusted) {
			this.output.warn('Skipped a legacy preCmd/postCmd script: the workspace is not trusted');
			return;
		}
		try {
			Function('vscode', 'element', 'runner', script)(vscode, scope.element, scope.runner);
		} catch (e) {
			this.output.error(`Legacy script failed: ${(e as Error).message}`);
		}
	}

	dispose(): void {
		clearTimeout(this.reloadTimer);
		this.watchers.forEach(w => w.dispose());
		this.disposables.forEach(d => d.dispose());
	}
}
