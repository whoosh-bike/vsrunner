import * as assert from 'assert';
import {
	ConfigError, availableItems, buildSignature, expandCommand, findOption,
	normalizeSelection, parseConfig, parseJsonc, parseLegacyConfig, warningApplies,
} from '../../model';

const config = parseConfig({
	options: [
		{ id: 'platform', items: ['m3', 'm4'], default: 'm4' },
		{
			id: 'target', dependsOn: 'platform', items: [
				{ label: 'boot', value: 'type=boot' },
				{ label: 'preboot', value: 'type=preboot', when: ['m4'] },
				{ label: 'app_m3', value: 'type=app adeq=1', when: 'm3' },
			],
		},
		{ id: 'extra', type: 'text', default: '-j4' },
		{ id: 'tg', type: 'toggle', value: 'tg', default: false },
	],
	commands: [
		{ id: 'build', cmd: 'b {platform} {target} {extra} {tg} {target.label} {nope} ${workspaceFolder}' },
		{ id: 'clean', cmd: 'c', warning: { message: 'w', when: { platform: 'm3' } } },
	],
});

suite('model', () => {
	test('defaults and kinds', () => {
		assert.deepStrictEqual(normalizeSelection(config, undefined),
			{ platform: 'm4', target: 'boot', extra: '-j4', tg: 'false' });
		assert.strictEqual(config.commands[0].kind, 'build');
		assert.strictEqual(findOption(config, 'extra')!.affectsBuild, false);
	});

	test('dependent items follow the parent', () => {
		const target = findOption(config, 'target')!;
		assert.deepStrictEqual(availableItems(target, { platform: 'm3' }).map(i => i.label), ['boot', 'app_m3']);
		const sel = normalizeSelection(config, { platform: 'm3', target: 'preboot' });
		assert.strictEqual(sel.target, 'boot');
	});

	test('stale stored values are dropped', () => {
		const sel = normalizeSelection(config, { platform: 'gone', removed: 'x', tg: 'yes' });
		assert.strictEqual(sel.platform, 'm4');
		assert.strictEqual(sel.tg, 'false');
		assert.ok(!('removed' in sel));
	});

	test('command expansion', () => {
		const sel = { platform: 'm3', target: 'app_m3', extra: '', tg: 'true' };
		assert.strictEqual(expandCommand(config.commands[0].cmd, config, sel, { workspaceFolder: '/w' }),
			'b m3 type=app adeq=1  tg app_m3 {nope} /w');
	});

	test('signature ignores options that do not affect the build', () => {
		const a = buildSignature(config, { platform: 'm4', target: 'boot', extra: '', tg: 'false' });
		const b = buildSignature(config, { platform: 'm4', target: 'boot', extra: '-j1', tg: 'true' });
		const c = buildSignature(config, { platform: 'm3', target: 'boot', extra: '', tg: 'false' });
		assert.strictEqual(a, b);
		assert.notStrictEqual(a, c);
	});

	test('warning conditions', () => {
		assert.ok(warningApplies(config.commands[1].warning!, { platform: 'm3' }));
		assert.ok(!warningApplies(config.commands[1].warning!, { platform: 'm4' }));
	});

	test('validation', () => {
		assert.throws(() => parseConfig({ options: [{ id: 'a', items: [] }], commands: [] }), ConfigError);
		assert.throws(() => parseConfig({ options: [{ id: 'b', dependsOn: 'a', items: ['x'] }, { id: 'a', items: ['y'] }], commands: [] }), /must come after/);
		assert.throws(() => parseConfig({ options: [], commands: [{ id: 'x' }] }), /"cmd" is required/);
		assert.throws(() => parseConfig({ options: [], commands: [{ id: 'x', cmd: 'a' }, { id: 'x', cmd: 'b' }] }), /Duplicate/);
	});

	test('legacy format', () => {
		const legacy = parseLegacyConfig(
			[{ name: 'p', default: 'a', type: 'nested', items: [{ label: 'a', value: 'A' }], postCmd: 'x()' },
				{ name: 'n', default: 'z', type: 'node', dependsOn: 'p', items: [{ label: 'z', value: 'Z', dependsArray: ['a'] }] }],
			[{ name: 'build', cmd: 'make {p} {n}', type: 'cmdBuild', preCmd: 'y()' }]);
		assert.ok(legacy.legacy);
		assert.strictEqual(legacy.options[0].legacyPostCmd, 'x()');
		assert.strictEqual(expandCommand(legacy.commands[0].cmd, legacy, normalizeSelection(legacy, undefined)), 'make A Z');
	});

	test('jsonc', () => {
		assert.deepStrictEqual(parseJsonc('{\n // c\n "a": "//not", /* b */ "b": [1,],\n}'), { a: '//not', b: [1] });
	});
});
