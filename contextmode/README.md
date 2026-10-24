# contextmode

`npm test` on a bad day prints a few thousand lines. All of that lands in the
conversation, costs tokens, and pushes your earlier instructions out of the
model's attention.

This plugin moves it to disk. `ctx_execute` runs the command and gives you the
first six thousand characters or so, the last two thousand, and the path to the
full file. `ctx_search` looks through the rest later, scoped to the project.
`ctx_index` adds any other file or folder to the same index.

The built-in `shell` tool is covered as well: output over 20,000 characters is
saved, indexed, and replaced in the conversation with the head and tail.

A typical run looks like this. `ctx_execute` with `npm test` comes back with the
failing assertion and a path to the log. Then `ctx_search` with `TimeoutError`
pulls the matching lines out of that log.

A few things to know. Commands run in your shell, which is `$SHELL` on macOS and
Linux and `cmd.exe` on Windows, so POSIX commands will not work in cmd. The
context-mode CLI is a Node script, so `node` has to be on `PATH`. And nothing
cleans `~/.cache/context-mode-v2` for you, so old logs pile up until you delete
them.

## Install

```bash
opencode plugin add 'github:transitan/opencode-plugins#main::path:contextmode'
```

That command only writes an entry to `~/.config/opencode/opencode.json`. To do it
by hand, add the same string to its `plugins` array:

```json
"plugins": [
  "github:transitan/opencode-plugins#main::path:contextmode"
]
```

For local development, put the absolute path to this folder in that array
instead.

## Check

```bash
npm install
npm run check
```

## Why the wrapper

Upstream ships a V1 `server()` adapter. `index.js` keeps its CLI and exposes it
through `tool.transform` and `execute.after` instead.
