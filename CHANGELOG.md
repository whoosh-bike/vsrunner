# Changelog

## 0.2.1

- `vsrunner.setupCommand`: for projects that generate their config, a missing
  config offers **Generate config** instead of creating a sample.
- Renamed to *Whoosh Embedded Project Runner UI* (`whoosh-embedded.we-project-runner-ui`).
- README no longer describes internal projects.

## 0.2.0

Rewrite.

- Single `.vscode/vsrunner.json` config with a JSON schema; the two-file format
  still loads and can be migrated with a command.
- Config and settings changes apply without reloading the window.
- New UI: Configuration view with the current value of every option and quick
  picks, Actions view with last result and duration, status bar with the
  configuration and a Build/Stop button, branded icon set.
- Option types `text` and `toggle`; `onChange` VS Code commands, `warning` and
  `confirm` on commands, `problemMatcher`, codicons as icons.
- Rebuild and Stop commands, keybindings, task provider (`vsrunner` task type).
- Settings: clean-before-build policy, save before run, terminal reveal/clear,
  finish notifications, status bar.
- Fixed: Clean crashed the result view; a clean started elsewhere could trigger
  a pending build; post-commands ran before the task finished; a broken config
  failed activation silently; icon paths in the toolbar.
- The selection is kept in the workspace state instead of a history file.
- Requires VS Code 1.140.

## 0.1.4

- Windows path fixes.
