# Whoosh Embedded Project Runner UI

A sidebar for picking a build configuration and running build, clean and custom
commands with it. Not tied to any project or toolchain: everything comes from
one JSON file in the workspace.

- **Configuration** view: every option with its current value; expand to pick,
  or use the pencil / `Cmd+Alt+C` for a quick pick. Options can depend on each
  other (the target list follows the platform).
- **Actions** view: every command with the result and duration of its last run;
  expand one to see the exact command line it will run.
- **Status bar**: current configuration and a Build button that turns into a
  spinner (click to stop) while a task runs.
- **Clean on change**: when an option that affects the build changed since the
  last build, a clean runs first.
- Config edits, regenerated configs and settings changes apply immediately, no
  window reload.
- Every command is also a VS Code task (`Terminal → Run Task → vsrunner`).

## Configuration

`.vscode/vsrunner.json` (another path: `vsrunner.configFile`). The editor
validates and completes it against the bundled JSON schema.

```jsonc
{
    "options": [
        {
            "id": "platform",
            "label": "Platform",
            "icon": "chip",
            "default": "m4",
            "onChange": { "command": "cpptools.setActiveConfigName", "args": ["${value}"] },
            "items": ["m3", "m4"]
        },
        {
            "id": "target",
            "dependsOn": "platform",
            "items": [
                { "label": "app", "value": "type=app variant=full", "description": "full feature set" },
                { "label": "preboot", "value": "type=preboot", "when": ["m4"] }
            ]
        },
        { "id": "tag", "items": ["prd", "dev"] },
        { "id": "verbose", "type": "toggle", "value": "V=1" },
        { "id": "extra", "type": "text", "placeholder": "key=value …" }
    ],
    "commands": [
        {
            "id": "build",
            "cmd": "make platform={platform} {target} tag={tag} {verbose} {extra}",
            "problemMatcher": "$gcc",
            "warning": { "message": "Not a production build: {tag}", "when": { "tag": ["dev"] } }
        },
        { "id": "clean", "cmd": "make clean" },
        { "id": "flash", "icon": "flash", "confirm": "Flash {target.label}?", "cmd": "./flash.sh {platform}" }
    ]
}
```

### Options

| Field | |
| --- | --- |
| `id` | Placeholder name in commands: `{id}` is the value, `{id.label}` the label |
| `type` | `pick` (default), `text` or `toggle` |
| `items` | `pick`: strings, or `{ label, value?, description?, when? }` |
| `dependsOn` | Id of an earlier pick option; an item is offered when the parent's label is in its `when` |
| `default` | Label (pick), text, or `true`/`false` (toggle) |
| `value` | `toggle`: what `{id}` expands to when on (empty when off) |
| `affectsBuild` | A change forces a clean before the next build. Default: `true` for pick options |
| `onChange` | VS Code command(s) to run after a change; `${value}` expands in string args |
| `icon` | Bundled icon (`chip`, `target`, `tag`, `board`, `flash`, …) or a codicon `$(name)` |

### Commands

| Field | |
| --- | --- |
| `id`, `cmd` | Required. `cmd` is a shell command line run from the workspace folder; `${workspaceFolder}` expands too |
| `kind` | `build` / `clean` / `other`; defaults from the id. Build and clean drive the toolbar and clean-on-change |
| `confirm` | Modal question before running |
| `warning` | Non-blocking warning when every option in `when` has one of the listed values |
| `problemMatcher` | e.g. `$gcc`, so compiler errors land in Problems |

### Settings

| Setting | Default | |
| --- | --- | --- |
| `vsrunner.enabled` | `true` | |
| `vsrunner.configFile` | `.vscode/vsrunner.json` | |
| `vsrunner.setupCommand` | | Command that generates a missing config, see below |
| `vsrunner.cleanBeforeBuild` | `onChange` | `onChange`, `always`, `never` |
| `vsrunner.saveBeforeRun` | `true` | Save all files before running |
| `vsrunner.revealTerminal` | `always` | `always`, `silent`, `never` |
| `vsrunner.clearTerminal` | `true` | |
| `vsrunner.notifyOnFinish` | `onFailure` | `always`, `onFailure`, `never` |
| `vsrunner.showStatusBar` | `true` | |

### Legacy format

The original `vsrunner-options.json` + `vsrunner-commands.json` pair still
loads when `vsrunner.optionsFilePath` and `vsrunner.commandsFilePath` are set
and no `vsrunner.json` exists. **VS Runner: Migrate Legacy Config** converts it.
Their `preCmd`/`postCmd` JavaScript only runs in a trusted workspace; use
`onChange` and `warning` instead. `vsrunner.historyFilePath` is ignored: the
selection lives in the workspace state.

## Generated configs

A project can render `vsrunner.json` from its own build catalogue and keep it
out of git, so new targets show up without editing the file by hand. Point
`vsrunner.setupCommand` at the generator in the committed workspace settings:

```jsonc
// .vscode/settings.json
"vsrunner.setupCommand": "sh ./tools/gen-vsrunner.sh"
```

On a fresh clone the sidebar then offers **Generate config** instead of a
sample, and picks the result up as soon as it is written.

## Development

See [docs/development.md](docs/development.md).
