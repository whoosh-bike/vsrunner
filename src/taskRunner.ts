import * as vscode from 'vscode';
import { RunnerCommand } from './model';

export const TASK_SOURCE = 'vsrunner';
export const TASK_TYPE = 'vsrunner';

export interface RunResult {
	commandId: string;
	exitCode: number | undefined;
	startedAt: number;
	durationMs: number;
}

export interface RunningTask {
	command: RunnerCommand;
	startedAt: number;
	execution: vscode.TaskExecution;
}

type RevealMode = 'always' | 'silent' | 'never';

export function createTask(folder: vscode.WorkspaceFolder, command: RunnerCommand, commandLine: string): vscode.Task {
	const settings = vscode.workspace.getConfiguration('vsrunner', folder);
	const task = new vscode.Task(
		{ type: TASK_TYPE, command: command.id },
		folder,
		command.label,
		TASK_SOURCE,
		new vscode.ShellExecution(commandLine, { cwd: folder.uri.fsPath }),
		command.problemMatcher ?? [],
	);
	const reveal: Record<RevealMode, vscode.TaskRevealKind> = {
		always: vscode.TaskRevealKind.Always,
		silent: vscode.TaskRevealKind.Silent,
		never: vscode.TaskRevealKind.Never,
	};
	task.presentationOptions = {
		reveal: reveal[settings.get<RevealMode>('revealTerminal', 'always')],
		clear: settings.get<boolean>('clearTerminal', true),
		panel: vscode.TaskPanelKind.Shared,
		showReuseMessage: false,
	};
	if (command.kind === 'build') {
		task.group = vscode.TaskGroup.Build;
	} else if (command.kind === 'clean') {
		task.group = vscode.TaskGroup.Clean;
	}
	return task;
}

/**
 * Runs one task at a time and reports its exit code. The previous implementation
 * matched finished tasks by name, so a "clean" started from anywhere else could
 * trigger the pending build; here completion is tied to the exact execution.
 */
export class TaskRunner implements vscode.Disposable {
	private current: RunningTask | undefined;
	private readonly pending = new Map<vscode.TaskExecution, (code: number | undefined) => void>();
	private readonly disposables: vscode.Disposable[] = [];
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;

	constructor() {
		this.disposables.push(
			this.changed,
			vscode.tasks.onDidEndTaskProcess(e => this.finish(e.execution, e.exitCode)),
			// A task killed before its process started never reports a process end.
			vscode.tasks.onDidEndTask(e => this.finish(e.execution, undefined)),
		);
	}

	get running(): RunningTask | undefined {
		return this.current;
	}

	async run(command: RunnerCommand, task: vscode.Task): Promise<RunResult> {
		if (this.current) {
			throw new Error(`"${this.current.command.label}" is still running`);
		}
		const startedAt = Date.now();
		const execution = await vscode.tasks.executeTask(task);
		const done = new Promise<number | undefined>(resolve => this.pending.set(execution, resolve));
		this.current = { command, startedAt, execution };
		this.changed.fire();
		try {
			const exitCode = await done;
			return { commandId: command.id, exitCode, startedAt, durationMs: Date.now() - startedAt };
		} finally {
			this.current = undefined;
			this.changed.fire();
		}
	}

	stop(): void {
		this.current?.execution.terminate();
	}

	private finish(execution: vscode.TaskExecution, exitCode: number | undefined): void {
		for (const [exec, resolve] of this.pending) {
			// TaskExecution objects are not guaranteed to be the same instance across events.
			if (exec === execution || exec.task === execution.task) {
				this.pending.delete(exec);
				resolve(exitCode);
				return;
			}
		}
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}
