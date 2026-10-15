import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/integration/**/*.test.js',
	workspaceFolder: 'examples/basic',
	useInstallation: { fromPath: '/Applications/Visual Studio Code.app/Contents/MacOS/Code' },
	launchArgs: ['--disable-extensions'],
	mocha: { ui: 'tdd', timeout: 30000 },
});
