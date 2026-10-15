// Pure configuration model: no 'vscode' import, so it is unit-testable in plain node.

export type OptionType = 'pick' | 'text' | 'toggle';

export interface OptionItem {
	label: string;
	value: string;
	description?: string;
	/** Values of the parent option this item is available for; absent means always. */
	when?: string[];
}

export interface OnChangeCommand {
	command: string;
	args?: unknown[];
}

export interface RunnerOption {
	id: string;
	label: string;
	type: OptionType;
	icon?: string;
	description?: string;
	dependsOn?: string;
	/** pick: item label; text: the string; toggle: "true"/"false". */
	default?: string;
	items: OptionItem[];
	/** toggle only: what {id} expands to when on. */
	value?: string;
	placeholder?: string;
	/** A change of this option invalidates the objects of the previous build. */
	affectsBuild: boolean;
	onChange?: OnChangeCommand[];
	legacyPreCmd?: string;
	legacyPostCmd?: string;
}

export type CommandKind = 'build' | 'clean' | 'other';

export interface CommandWarning {
	message: string;
	when: Record<string, string[]>;
}

export interface RunnerCommand {
	id: string;
	label: string;
	cmd: string;
	kind: CommandKind;
	icon?: string;
	description?: string;
	confirm?: string;
	warning?: CommandWarning;
	problemMatcher?: string[];
	legacyPreCmd?: string;
	legacyPostCmd?: string;
}

export interface RunnerConfig {
	options: RunnerOption[];
	commands: RunnerCommand[];
	legacy: boolean;
}

/** Option id -> selected item label (pick), raw text (text) or "true"/"false" (toggle). */
export type Selection = Record<string, string>;

export class ConfigError extends Error {}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(obj: Json, key: string, where: string, required = false): string | undefined {
	const v = obj[key];
	if (v === undefined) {
		if (required) {
			throw new ConfigError(`${where}: "${key}" is required`);
		}
		return undefined;
	}
	if (typeof v !== 'string') {
		throw new ConfigError(`${where}: "${key}" must be a string`);
	}
	return v;
}

function strArray(obj: Json, key: string, where: string): string[] | undefined {
	const v = obj[key];
	if (v === undefined) {
		return undefined;
	}
	if (typeof v === 'string') {
		return [v];
	}
	if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) {
		throw new ConfigError(`${where}: "${key}" must be a string or an array of strings`);
	}
	return v as string[];
}

function parseItems(raw: unknown, where: string, whenKey: string): OptionItem[] {
	if (!Array.isArray(raw)) {
		throw new ConfigError(`${where}: "items" must be an array`);
	}
	return raw.map((it, i) => {
		const w = `${where}.items[${i}]`;
		if (typeof it === 'string') {
			return { label: it, value: it };
		}
		if (!isObject(it)) {
			throw new ConfigError(`${w}: must be an object or a string`);
		}
		const label = str(it, 'label', w, true)!;
		return {
			label,
			value: str(it, 'value', w) ?? label,
			description: str(it, 'description', w),
			when: strArray(it, whenKey, w),
		};
	});
}

function parseOnChange(raw: unknown, where: string): OnChangeCommand[] | undefined {
	if (raw === undefined) {
		return undefined;
	}
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map((c, i) => {
		if (typeof c === 'string') {
			return { command: c };
		}
		if (!isObject(c) || typeof c.command !== 'string') {
			throw new ConfigError(`${where}.onChange[${i}]: expected { "command": string, "args"?: [] }`);
		}
		return { command: c.command, args: Array.isArray(c.args) ? c.args : undefined };
	});
}

function checkUnique(ids: string[], what: string): void {
	const seen = new Set<string>();
	for (const id of ids) {
		if (seen.has(id)) {
			throw new ConfigError(`Duplicate ${what} id "${id}"`);
		}
		seen.add(id);
	}
}

function validate(config: RunnerConfig): RunnerConfig {
	checkUnique(config.options.map(o => o.id), 'option');
	checkUnique(config.commands.map(c => c.id), 'command');
	const byId = new Map(config.options.map(o => [o.id, o]));
	for (const opt of config.options) {
		if (opt.type === 'pick' && opt.items.length === 0) {
			throw new ConfigError(`Option "${opt.id}": a pick option needs at least one item`);
		}
		if (opt.dependsOn !== undefined) {
			const parent = byId.get(opt.dependsOn);
			if (!parent || parent.type !== 'pick') {
				throw new ConfigError(`Option "${opt.id}": dependsOn "${opt.dependsOn}" is not a pick option`);
			}
			if (config.options.indexOf(parent) > config.options.indexOf(opt)) {
				throw new ConfigError(`Option "${opt.id}" must come after "${opt.dependsOn}", which it depends on`);
			}
		}
	}
	return config;
}

/** The current single-file format (.vscode/vsrunner.json). */
export function parseConfig(raw: unknown): RunnerConfig {
	if (!isObject(raw)) {
		throw new ConfigError('Config must be a JSON object with "options" and "commands"');
	}
	const rawOptions = raw.options ?? [];
	const rawCommands = raw.commands ?? [];
	if (!Array.isArray(rawOptions) || !Array.isArray(rawCommands)) {
		throw new ConfigError('"options" and "commands" must be arrays');
	}

	const options = rawOptions.map((o, i): RunnerOption => {
		const w = `options[${i}]`;
		if (!isObject(o)) {
			throw new ConfigError(`${w}: must be an object`);
		}
		const id = str(o, 'id', w, true)!;
		const type = (str(o, 'type', w) ?? 'pick') as OptionType;
		if (!['pick', 'text', 'toggle'].includes(type)) {
			throw new ConfigError(`${w}: unknown type "${type}", expected pick, text or toggle`);
		}
		let def: string | undefined;
		if (typeof o.default === 'boolean') {
			def = String(o.default);
		} else {
			def = str(o, 'default', w);
		}
		const affects = o.affectsBuild;
		return {
			id,
			label: str(o, 'label', w) ?? id,
			type,
			icon: str(o, 'icon', w),
			description: str(o, 'description', w),
			dependsOn: str(o, 'dependsOn', w),
			default: def,
			items: type === 'pick' ? parseItems(o.items, w, 'when') : [],
			value: str(o, 'value', w),
			placeholder: str(o, 'placeholder', w),
			affectsBuild: typeof affects === 'boolean' ? affects : type === 'pick',
			onChange: parseOnChange(o.onChange, w),
		};
	});

	const commands = rawCommands.map((c, i): RunnerCommand => {
		const w = `commands[${i}]`;
		if (!isObject(c)) {
			throw new ConfigError(`${w}: must be an object`);
		}
		const id = str(c, 'id', w, true)!;
		const kind = (str(c, 'kind', w) ?? (id === 'build' || id === 'clean' ? id : 'other')) as CommandKind;
		let warning: CommandWarning | undefined;
		if (c.warning !== undefined) {
			if (!isObject(c.warning) || typeof c.warning.message !== 'string' || !isObject(c.warning.when)) {
				throw new ConfigError(`${w}.warning: expected { "message": string, "when": { option: [values] } }`);
			}
			const when: Record<string, string[]> = {};
			for (const key of Object.keys(c.warning.when)) {
				when[key] = strArray(c.warning.when, key, `${w}.warning.when`)!;
			}
			warning = { message: c.warning.message, when };
		}
		return {
			id,
			label: str(c, 'label', w) ?? id,
			cmd: str(c, 'cmd', w, true)!,
			kind,
			icon: str(c, 'icon', w),
			description: str(c, 'description', w),
			confirm: str(c, 'confirm', w),
			warning,
			problemMatcher: strArray(c, 'problemMatcher', w),
		};
	});

	return validate({ options, commands, legacy: false });
}

/** The original two-file format: vsrunner-options.json + vsrunner-commands.json. */
export function parseLegacyConfig(rawOptions: unknown, rawCommands: unknown): RunnerConfig {
	if (!Array.isArray(rawOptions) || !Array.isArray(rawCommands)) {
		throw new ConfigError('Legacy options and commands files must both contain arrays');
	}
	const options = rawOptions.map((o, i): RunnerOption => {
		const w = `options[${i}]`;
		if (!isObject(o)) {
			throw new ConfigError(`${w}: must be an object`);
		}
		const id = str(o, 'name', w, true)!;
		return {
			id,
			label: id,
			type: 'pick',
			dependsOn: str(o, 'dependsOn', w),
			default: str(o, 'default', w),
			items: parseItems(o.items, w, 'dependsArray'),
			affectsBuild: true,
			legacyPreCmd: str(o, 'preCmd', w),
			legacyPostCmd: str(o, 'postCmd', w),
		};
	});
	const commands = rawCommands.map((c, i): RunnerCommand => {
		const w = `commands[${i}]`;
		if (!isObject(c)) {
			throw new ConfigError(`${w}: must be an object`);
		}
		const id = str(c, 'name', w, true)!;
		return {
			id,
			label: id.charAt(0).toUpperCase() + id.slice(1),
			cmd: str(c, 'cmd', w, true)!,
			kind: id === 'build' || id === 'clean' ? id : 'other',
			legacyPreCmd: str(c, 'preCmd', w),
			legacyPostCmd: str(c, 'postCmd', w),
		};
	});
	return validate({ options, commands, legacy: true });
}

/** JSON with // and /* comments and trailing commas, as VS Code's own settings files allow. */
export function parseJsonc(text: string): unknown {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const ch = text[i];
		if (ch === '"') {
			const start = i++;
			while (i < text.length && text[i] !== '"') {
				i += text[i] === '\\' ? 2 : 1;
			}
			out += text.slice(start, ++i);
		} else if (ch === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') {
				i++;
			}
		} else if (ch === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 2;
		} else {
			out += ch;
			i++;
		}
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// ── Selection ────────────────────────────────────────────────────────────────

export function findOption(config: RunnerConfig, id: string): RunnerOption | undefined {
	return config.options.find(o => o.id === id);
}

export function availableItems(option: RunnerOption, selection: Selection): OptionItem[] {
	if (option.dependsOn === undefined) {
		return option.items;
	}
	const parentValue = selection[option.dependsOn];
	return option.items.filter(it => it.when === undefined || it.when.includes(parentValue));
}

/**
 * Brings a stored selection in line with the config: unknown keys dropped,
 * missing or no longer available values replaced by the default or the first
 * available item. Options are processed in order, so a dependent option always
 * sees its parent's final value.
 */
export function normalizeSelection(config: RunnerConfig, stored: Selection | undefined): Selection {
	const result: Selection = {};
	for (const opt of config.options) {
		const prev = stored?.[opt.id];
		if (opt.type === 'text') {
			result[opt.id] = prev ?? opt.default ?? '';
			continue;
		}
		if (opt.type === 'toggle') {
			const v = prev ?? opt.default ?? 'false';
			result[opt.id] = v === 'true' ? 'true' : 'false';
			continue;
		}
		const items = availableItems(opt, result);
		const pick = [prev, opt.default].find(l => l !== undefined && items.some(it => it.label === l));
		result[opt.id] = pick ?? items[0]?.label ?? '';
	}
	return result;
}

export function selectedItem(option: RunnerOption, selection: Selection): OptionItem | undefined {
	return availableItems(option, selection).find(it => it.label === selection[option.id]);
}

/** What {id} expands to in a command line. */
export function optionValue(option: RunnerOption, selection: Selection): string {
	const current = selection[option.id] ?? '';
	switch (option.type) {
		case 'text':
			return current;
		case 'toggle':
			return current === 'true' ? (option.value ?? 'true') : '';
		default:
			return selectedItem(option, selection)?.value ?? '';
	}
}

export function displayValue(option: RunnerOption, selection: Selection): string {
	const current = selection[option.id] ?? '';
	if (option.type === 'toggle') {
		return current === 'true' ? 'on' : 'off';
	}
	return current;
}

/**
 * Expands {id} to the option value and {id.label} to the shown label;
 * placeholders that name no option are left as they are.
 */
export function expandCommand(cmd: string, config: RunnerConfig, selection: Selection,
	vars: Record<string, string> = {}): string {
	const expanded = cmd.replace(/\{([\w-]+)(\.label)?\}/g, (match, id: string, label?: string) => {
		const opt = findOption(config, id);
		if (!opt) {
			return match;
		}
		return label ? displayValue(opt, selection) : optionValue(opt, selection);
	});
	return expanded.replace(/\$\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}

/** Identity of a build: the options that leave objects behind that another build cannot reuse. */
export function buildSignature(config: RunnerConfig, selection: Selection): string {
	const parts = config.options
		.filter(o => o.affectsBuild)
		.map(o => [o.id, optionValue(o, selection)]);
	return JSON.stringify(parts);
}

export function warningApplies(warning: CommandWarning, selection: Selection): boolean {
	return Object.entries(warning.when).every(([id, values]) => values.includes(selection[id]));
}
