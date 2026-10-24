# opencode-plugins

Two OpenCode plugins, plus the small amount of glue needed to run them on V2.

**trace** writes every model request to `~/.opencode-trace`, so when a reply
comes back wrong you can look at what was actually sent. **contextmode** keeps
long command output out of the conversation and leaves it on disk where you can
search it later.

The upstream packages for both are written against the old V1 plugin API. Rather
than patch packages we do not own, each folder here wraps one and adapts it.

## Install

```bash
opencode plugin add 'github:transitan/opencode-plugins#main::path:trace'
opencode plugin add 'github:transitan/opencode-plugins#main::path:contextmode'
```

Those commands only add entries to `~/.config/opencode/opencode.json`. You can
edit it yourself instead:

```json
"plugins": [
  "github:transitan/opencode-plugins#main::path:trace",
  "github:transitan/opencode-plugins#main::path:contextmode"
]
```

For local development of these plugins, point the same array at the two folders:

```json
"plugins": [
  "/absolute/path/to/opencode-plugins/trace",
  "/absolute/path/to/opencode-plugins/contextmode"
]
```

Restart OpenCode afterwards. Each folder has its own README.
