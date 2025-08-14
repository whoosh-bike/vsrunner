import * as vscode from 'vscode';

export class RunnerResult {
	resultDataProvider: ResultTreeDataProvider;

	constructor(context: vscode.ExtensionContext) {
		this.resultDataProvider = new ResultTreeDataProvider();

		const view = vscode.window.createTreeView('runner-result', { treeDataProvider: this.resultDataProvider, showCollapseAll: true });
		context.subscriptions.push(view);
		// this.context = context;

        vscode.commands.registerCommand('runner-result.refresh', async (opts: Map<string, string>) => {
			ResultItems = [];
			opts.forEach((value, key) => {
				ResultItems.push(new ResultItem(key.toUpperCase() + ': ' + value));
			});

			this.resultDataProvider.refresh();
		});
	}
}

class ResultItem extends vscode.TreeItem {
	parentLabel: string|undefined;
	child: ResultItem[]|undefined;

	constructor(label: string, child?: ResultItem[]) {
		super(label,
			child === undefined ? vscode.TreeItemCollapsibleState.None :
								vscode.TreeItemCollapsibleState.Expanded);
		this.child = child;
		// this.iconPath = new vscode.ThemeIcon('debug-start');
	}

	contextValue = 'dependency';
}

class ResultTreeDataProvider implements vscode.TreeDataProvider<ResultItem> {

	public _onDidChangeTreeData: vscode.EventEmitter<ResultItem | undefined | void> = new vscode.EventEmitter<ResultItem | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<ResultItem | undefined | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ResultItem): vscode.TreeItem|Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: ResultItem|undefined): vscode.ProviderResult<ResultItem[]> {
		if (element === undefined) {
			return ResultItems;
		}
		return element.child;
	}

	getParent(element?: ResultItem|undefined): vscode.ProviderResult<ResultItem> {
		if (element === undefined) {
			return undefined;
		}
		for (var idx in ResultItems) {
			if (ResultItems[idx].label === element.parentLabel)
				return ResultItems[idx];
		}
		return undefined;
	}
}

var ResultItems: ResultItem[] = [];
