# vsrunner README

## Install

To install VSCode extension locally (not recommended) you need to build **"vsrunner-X.X.X.vsix"** file and click "Install from VSIX" in VSCode Extensions menu. The commands to do so:

```shell
npm install
npm install -g typescript
npm install -g @vscode/vsce
vsce package --baseContentUrl https://none --baseImagesUrl https://none
```

![alt text](install.png)

## Usage

Select **vsrunner** extension in left activity bar. The extension is disabled by default and enables by options in "settings.json":

```json
    "vsrunner.enabled": true,
    "vsrunner.optionsFilePath": "builds\\vsrunner\\vsrunner-options.json",
    "vsrunner.optionsFilePath": "builds\\vsrunner\\vsrunner-commands.json",
    "vsrunner.historyFilePath": "builds\\vsrunner\\vsrunner-history.json",
```

There are two buttons to use the **vsrunner** - **build** and **clean** the project. If **build** configuration was changed and new **build** was executed without **clean** command, it would be detected by comparing to history file and **clean** command would be executed before **build**.

![alt text](using.png)
