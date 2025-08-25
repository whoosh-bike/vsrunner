import * as vscode from 'vscode';
import * as fs from 'fs';

const ItemChangedCmd: string = 'runner-main.set';

interface OptionItem {
	label: string;
	value: string;
	dependsArray?: string[];
}

interface OptionInterface {
	name: string;
	default: string;
	type: string;
	dependsOn?: string;
	items: OptionItem[];
	preCmd?: string;
	postCmd?: string;
}

interface CommandInterface {
	name: string;
	cmd: string;
	type: string;
	preCmd?: string;
	postCmd?: string;
}

function isOptionItemArray(itemArray: any): itemArray is OptionItem[] {
	let isCommandFlag = false;
	if (Array.isArray(itemArray) && itemArray.length > 0)
		isCommandFlag = true;

	for (let i = 0; i < itemArray.length; i++) {
		const el = itemArray[i];
		if (typeof el.label !== "string" ||
			typeof el.value !== "string") {
			isCommandFlag = false;
			break;
		}
	}

	return isCommandFlag;
}

function isOptionsArray(optArray: any): optArray is OptionInterface[] {
	let isCommandFlag = false;
	if (Array.isArray(optArray) && optArray.length > 0)
		isCommandFlag = true;

	for (let i = 0; i < optArray.length; i++) {
		const el = optArray[i];
		if (typeof el.name  !== "string" ||
			typeof el.default !== "string" ||
			typeof el.type !== "string" ||
			!Array.isArray(el.items) ||
			el.items.length < 1 ||
			!isOptionItemArray(el.items)) {
			isCommandFlag = false;
			break;
		}
	}

	return isCommandFlag;
}

function isCommandsArray(cmdArray: any): cmdArray is CommandInterface[] {
	let isCommandFlag = false;
	if (Array.isArray(cmdArray) && cmdArray.length > 0)
		isCommandFlag = true;

	for (let i = 0; i < cmdArray.length; i++) {
		const el = cmdArray[i];
		if (typeof el.name  !== "string" ||
			typeof el.cmd !== "string" ||
			typeof el.type !== "string") {
			isCommandFlag = false;
			break;
		}
	}

	return isCommandFlag;
}

interface Test {
    prop: number;
}

function isTest(arg: any): arg is Test {
    return arg && arg.prop && typeof(arg.prop) == 'number';
}

var Commands: CommandInterface[];

function GetCommandString(name: string): string|undefined {
	return Commands.find(cmd => cmd.name == name)?.cmd;
}

export class RunnerMain {

	// context: vscode.ExtensionContext|undefined;
	buildDataProvider: BuildTreeDataProvider;
	historyFilePath: string;

	LastBuild: Map<string, string> = new Map();
	Build: Map<string, string> = new Map();

	saveHistory() {
		this.LastBuild = new Map(this.Build);
		const objFromMap = Object.fromEntries(this.Build);
		let histString = JSON.stringify(objFromMap);
		fs.writeFileSync(this.historyFilePath, histString);
	}

	constructor(context: vscode.ExtensionContext) {
		const config = vscode.workspace.getConfiguration('vsrunner');
	
		const rootPath = (vscode.workspace.workspaceFolders && (vscode.workspace.workspaceFolders.length > 0))
				? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

		let optionsFilePath = config.optionsFilePath;
		if (rootPath != undefined) {
			optionsFilePath = rootPath + '/' + optionsFilePath;
		}
		if (!fs.existsSync(optionsFilePath)) {
			throw new Error("Could not locate Options file!");
		}
		let JsonOpts = fs.readFileSync(optionsFilePath, { encoding: "utf8" });

		let commandsFilePath = config.commandsFilePath;
		if (rootPath != undefined) {
			commandsFilePath = rootPath + '/' + commandsFilePath;
		}
		if (!fs.existsSync(commandsFilePath)) {
			throw new Error("Could not locate Commands file!");
		}
		let JsonCommands = fs.readFileSync(commandsFilePath, { encoding: "utf8" });

		let tmpOptions = JSON.parse(JsonOpts);
		if (!isOptionsArray(tmpOptions))
			throw new Error("Incorrect format of options file!");

		let Options: OptionInterface[] = tmpOptions;
		ItemsInit(Options);

		Options.forEach(el => {
			this.Build.set(el.name, el.default);
		});

		let tmpCommands = JSON.parse(JsonCommands);
		if (!isCommandsArray(tmpCommands))
			throw new Error("Incorrect format of commands file!");

		Commands = tmpCommands;

		this.historyFilePath = config.historyFilePath;
		if (rootPath != undefined) {
			this.historyFilePath = rootPath + '/' + this.historyFilePath;
		}

		let noHistoryFile = true;
		if(fs.existsSync(this.historyFilePath)) {
			let histString = fs.readFileSync(this.historyFilePath, { encoding: "utf8" });
			let tmpHistory = new Map(Object.entries(JSON.parse(histString)));

			let histFileOk = true;
			tmpHistory.forEach((el, key) => {
				console.log(key + ' : ' + el);
				if (!Options.find(opt => opt.name == key))
					histFileOk = false;
			});
			if (histFileOk) {
				Options.forEach(opt => {
					let elOk = false;
					if (tmpHistory.has(opt.name) &&
						typeof tmpHistory.get(opt.name) === "string" &&
						opt.items.find(item => item.label === tmpHistory.get(opt.name))) {
						elOk = true;
					}
					if (!elOk)
						histFileOk = false;
				});
			}
			if (histFileOk)
			{
				this.Build = new Map(Object.entries(JSON.parse(histString)));
				this.LastBuild = new Map(this.Build);
				noHistoryFile = false;
			}
		}

		if (noHistoryFile) {
			try {
				this.saveHistory();
			} catch (error) {
				vscode.window.showInformationMessage('Could not create history file!');
			}
		}

		this.buildDataProvider = new BuildTreeDataProvider();

		const view = vscode.window.createTreeView('runner-main', { treeDataProvider: this.buildDataProvider, showCollapseAll: true });
		context.subscriptions.push(view);
		// this.context = context;

		OptionsItems.forEach((el => {
			if (el.dependsOn != undefined) {
				el.child = [];
				OptionsNodes.get(el.label as string)?.forEach((item => {
					if(item.dependsArray != undefined)
						if (item.dependsArray.includes(this.Build.get(el.dependsOn!)!))
							el.child!.push(item);
				}));
			}
			el.SetIcon(this.Build.get(el.label as string)!);
		}));

		this.buildDataProvider.refresh();

		vscode.commands.registerCommand(ItemChangedCmd, async (element) => {
			if (this.Build.get(element.parentLabel) != element.label) {
				let preCmd = OptionsItems.get(element.parentLabel)?.preCmd;
				if (preCmd != undefined)
					Function('vscode', 'element', preCmd)(vscode, element);

				OptionsItems.get(element.parentLabel)?.SetIcon(element.label);
				this.Build.set(element.parentLabel, element.label);

				if (OptionsItems.get(element.parentLabel)!.type == 'nested') {
					OptionsItems.forEach(rootEl => {
						if (rootEl.dependsOn === element.parentLabel) {
							rootEl.child = [];
							OptionsNodes.get(rootEl.label as string)?.forEach((item => {
								if(item.dependsArray != undefined)
									if (item.dependsArray.includes(element.label)) {
										rootEl.child!.push(item);
									}
							}));

							let elemInList: boolean = false;
							rootEl.child.forEach(item => {
								if (item.label === this.Build.get(rootEl.label as string)) {
									elemInList = true;
									return;
								}
							});

							if (!elemInList)
								this.Build.set(rootEl.label as string, rootEl.child[0].label as string);
							OptionsItems.get(rootEl.label as string)?.SetIcon(this.Build.get(rootEl.label as string)!);
						}
					});
				}

				this.buildDataProvider.refresh();
				let postCmd = OptionsItems.get(element.parentLabel)?.postCmd;
				if (postCmd != undefined)
					Function('vscode', 'element', postCmd)(vscode, element);
			}
		});

		vscode.commands.registerCommand('runner-main.build', async () => {
			let buildCmd = () => {
				this.saveHistory();

				let repl = new Map();
				OptionsItems.forEach(rootEl => {
					repl.set(rootEl.label as string, OptionsItems.get(rootEl.label as string)!.child?.find(item => 
						item.label as string == this.Build.get(rootEl.label as string)
					)?.value);
				});
				let buildString = CreateBuildString(GetCommandString('build')!, repl);
				// console.log('buildString: ' + buildString);

				RunCmd('build', buildString, this);
				vscode.commands.executeCommand('runner-result.refresh', this.Build);	
			};

			if (CompareMaps(this.Build, this.LastBuild) == false) {
				vscode.commands.executeCommand('runner-main.clean');
				let disposable = vscode.tasks.onDidEndTask(e => {
					if (e.execution.task.name == 'clean') {
						disposable.dispose();
						buildCmd();
					}
				});
			}
			else {
				buildCmd();
			}
		});

		vscode.commands.registerCommand('runner-main.clean', async () => {
			Object.assign(this.LastBuild, this.Build);
			RunCmd('clean', GetCommandString('clean')!, this);
			vscode.commands.executeCommand('runner-result.refresh');
		});
	} //constructor
}

class BuildTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
	public _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItem): vscode.TreeItem|Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: TreeItem|undefined): vscode.ProviderResult<TreeItem[]> {
		if (element === undefined) {
			return Items;
		}
		return element.child;
	}

	getParent(element?: TreeItem|undefined): vscode.ProviderResult<TreeItem> {
		if (element === undefined) {
			return undefined;
		}
		for (let idx in Items) {
			if (Items[idx].label === element.parentLabel)
				return Items[idx];
		}
		return undefined;
	}
}

class TreeItem extends vscode.TreeItem {
	parentLabel?: string;
	value?: string;
	child?: TreeItem[];
	dependsOn?: string;
	dependsArray?: string[];
	command: vscode.Command = {title: 'test', command: ItemChangedCmd, arguments: [this]};

	constructor(parentLabel: string|undefined, label: string, value: string,
					child?: TreeItem[], dependsOn?: string, dependsArray?: string[]) {
		super(label, child === undefined ? 	vscode.TreeItemCollapsibleState.None :
											vscode.TreeItemCollapsibleState.Expanded);
		this.parentLabel = parentLabel;
		this.value = value;
		this.child = child;
		this.dependsOn = dependsOn;
		this.dependsArray = dependsArray;
	}

	contextValue = 'dependency';
}

class RootTreeItem extends TreeItem {
	type: string;
	preCmd?: string;
	postCmd?: string;

	constructor(type: string, parentLabel: string|undefined, label: string, value: string,
					child?: TreeItem[], dependsOn?: string, preCmd?: string, postCmd?: string) {
		super(parentLabel, label, value, child, dependsOn);
		this.type = type;
		this.preCmd = preCmd;
		this.postCmd = postCmd;
	}

	SetIcon(labelValue: string) {
		this.child?.forEach((el => {
			if(el.label === labelValue) {
				el.iconPath = new vscode.ThemeIcon('getting-started-setup');
			}
			else {
				el.iconPath = undefined;
			}
		}));
	}
}

var OptionsItems: Map<string, RootTreeItem> = new Map();
var OptionsNodes: Map<string, TreeItem[]> = new Map();

const Items: RootTreeItem[] = [];

function ItemsInit(options: OptionInterface[]) {
	options.forEach((el => {
		var Child: TreeItem[]|undefined = [];
		el.items.forEach((item => {
			Child!.push(new TreeItem(el.name, item.label, item.value, undefined, el.dependsOn, item.dependsArray));
		}));

		if (el.dependsOn != undefined) {
			OptionsItems.set(el.name, new RootTreeItem(el.type, undefined, el.name, el.name, Child,
					el.dependsOn, el.preCmd, el.postCmd));
			if (el.type == 'node')
				OptionsNodes.set(el.name, Child);
		}
		else {
			OptionsItems.set(el.name, new RootTreeItem(el.type, undefined, el.name, el.name, Child,
					undefined, el.preCmd, el.postCmd));
		}
		Items.push(OptionsItems.get(el.name)!);
	}));
}

function CreateBuildString(buildStr: string, replacement: any) {
	return buildStr.replace(/{(\w+)}/g, function (match) {
		let propName = match.substring(1, match.length-1)
		return replacement.get(propName) != undefined ? replacement.get(propName) : match;
	});
}

function RunCmd(cmd: string, commandString: string, runner: RunnerMain) {
	let preCmd = Commands.find(cmdEl => cmdEl.name == cmd)?.preCmd ;
	if (preCmd != undefined)
		Function('vscode', 'runner', preCmd)(vscode, runner);

	let task = new vscode.Task(
		{ type: 'shell', task: cmd },
		// vscode.workspace.workspaceFolders[0],
		vscode.TaskScope.Workspace,
		cmd,
		'shell',
		new vscode.ShellExecution(commandString)
	);
	vscode.tasks.executeTask(task);

	let postCmd = Commands.find(cmdEl => cmdEl.name == cmd)?.postCmd ;
	if (postCmd != undefined)
		Function('vscode', 'runner', postCmd)(vscode, runner);
}

function CompareMaps(map1: any, map2: any) {
	var testVal;
	if (map1.size !== map2.size) {
		return false;
	}
	for (var [key, val] of map1) {
		testVal = map2.get(key);
		if (JSON.stringify(testVal) !== JSON.stringify(val) || (testVal === undefined && !map2.has(key))) {
			return false;
		}
	}
	return true;
}
