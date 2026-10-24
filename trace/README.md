# trace

Every model call OpenCode makes gets written to `~/.opencode-trace`, one
numbered set of files per request.

When a reply comes back wrong, or a model feels slower than it should, this is
the quickest way to see why: the exact prompt, the raw streamed response, the
token counts, and when each token arrived.

Each request gets three files under `~/.opencode-trace/<session>/`:

- `N.json` holds the request URL, method, headers and body, the response status,
  headers and body, any error, and the timestamps for the request, the first
  token and the last token.
- `N.sse` is the raw stream as it arrived.
- `N.parsed` is the normalized conversation plus token usage: input, cached
  input and output.

Authorization headers are stripped by default. Export
`OPENCODE_TRACE_REDACT=false` before starting OpenCode if you need them kept.

Recording is on by default. `trace_off` stops it, `trace_status` shows whether
it is on and where the files go. The same is available as `/trace off` and
`/trace status`.

Nothing prunes this directory, so a long session can reach hundreds of
megabytes. Delete old session folders when you no longer need them.

The viewer lists sessions and shows each request with its response and timings:

```bash
npx -y @opencode-trace/viewer@0.0.7
```

It opens on port 3210.

## Install

```bash
opencode plugin add 'github:transitan/opencode-plugins#main::path:trace'
```

That command only writes an entry to `~/.config/opencode/opencode.json`. To do it
by hand, add the same string to its `plugins` array:

```json
"plugins": [
  "github:transitan/opencode-plugins#main::path:trace"
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

Upstream `@opencode-trace/plugin` exports the V1 `{ id, server }` shape. OpenCode
V2 wants `setup()` plus explicit hooks, so `index.js` keeps the upstream
recorder and connects it to `http.request`, `http.response`, `tool.transform`
and `command.transform`. It also removes the upstream fetch interceptor, which
never sees V2 traffic.

The adapter uses a few upstream internals (`_getTestPlugin`, `store`), which is
why the dependency is pinned to 0.0.7 rather than a range.
