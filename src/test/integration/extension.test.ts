import * as assert from 'assert';
import * as vscode from 'vscode';
import type { Controller } from '../../controller';

async function controller(): Promise<Controller> {
	const ext = vscode.extensions.getExtension('whoosh-embedded.we-project-runner-ui')!;
	const { controller: ctl } = await ext.activate() as { controller: Controller };
	for (let i = 0; i < 50 && !ctl.ready; i++) {
		await new Promise(r => setTimeout(r, 100));
	}
	return ctl;
}

suite('extension', function () {
	this.timeout(30000);

	test('loads the example config', async () => {
		const ctl = await controller();
		assert.strictEqual(ctl.state.kind, 'ready');
		assert.strictEqual(ctl.selection.platform, 'm4');
	});

	test('dependent option is reset when its item disappears', async () => {
		const ctl = await controller();
		await vscode.commands.executeCommand('vsrunner.selectItem', 'target', 'preboot');
		await vscode.commands.executeCommand('vsrunner.selectItem', 'platform', 'm3');
		assert.strictEqual(ctl.selection.target, 'app');
		await vscode.commands.executeCommand('vsrunner.selectItem', 'platform', 'm4');
	});

	test('runs a task and records its exit code', async () => {
		const ctl = await controller();
		await vscode.commands.executeCommand('vsrunner.runCommand', 'fail');
		assert.strictEqual(ctl.lastResults.fail.exitCode, 3);
	});

	test('build after a configuration change cleans first', async () => {
		const ctl = await controller();
		await vscode.commands.executeCommand('vsrunner.build');
		assert.strictEqual(ctl.lastResults.build.exitCode, 0);
		assert.ok(!ctl.needsClean());

		await vscode.commands.executeCommand('vsrunner.selectItem', 'tag', 'prd');
		assert.ok(ctl.needsClean());
		const cleanBefore = ctl.lastResults.clean?.startedAt ?? 0;
		await vscode.commands.executeCommand('vsrunner.build');
		assert.ok(ctl.lastResults.clean.startedAt > cleanBefore);
		assert.ok(!ctl.needsClean());
	});

	test('config edits are picked up without a reload', async () => {
		const ctl = await controller();
		const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, '.vscode', 'vsrunner.json');
		const original = await vscode.workspace.fs.readFile(uri);
		try {
			const json = JSON.parse(Buffer.from(original).toString());
			json.commands.push({ id: 'added', cmd: 'echo added' });
			await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(json)));
			for (let i = 0; i < 50 && !ctl.findCommand('added'); i++) {
				await new Promise(r => setTimeout(r, 100));
			}
			assert.ok(ctl.findCommand('added'));
		} finally {
			await vscode.workspace.fs.writeFile(uri, original);
			for (let i = 0; i < 50 && ctl.findCommand('added'); i++) {
				await new Promise(r => setTimeout(r, 100));
			}
		}
	});

	test('commands are offered as VS Code tasks', async () => {
		const tasks = await vscode.tasks.fetchTasks({ type: 'vsrunner' });
		assert.deepStrictEqual(tasks.map(t => t.name).sort(), ['Build', 'Clean', 'Failing command', 'Flash']);
	});
});
