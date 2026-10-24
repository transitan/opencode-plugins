import { execFile } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const CLI = fileURLToPath(import.meta.resolve("context-mode/cli"))
const STORE = join(homedir(), ".cache", "context-mode-v2")
const THRESHOLD = 20_000
const SHELL = process.env.SHELL || (process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "/bin/sh")
const SHELL_ARGS = /cmd\.exe$/i.test(SHELL) ? ["/d", "/s", "/c"] : ["-c"]

function cli(args, cwd) {
  return new Promise((resolve) => {
    execFile("node", [CLI, ...args], { cwd, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, stdout: stdout || "", stderr: stderr || "" })
    })
  })
}

function textOf(result) {
  const content = result?.content
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.filter((c) => c.type === "text").map((c) => c.text).join("")
  return ""
}

function truncate(text) {
  const LIMIT = 8000
  if (text.length <= LIMIT) return text
  const lines = text.split("\n")
  const head = []
  let chars = 0
  for (const line of lines) {
    if (chars + line.length > 6000) break
    head.push(line)
    chars += line.length + 1
  }
  const tail = []
  chars = 0
  for (let i = lines.length - 1; i >= head.length; i--) {
    const line = lines[i]
    if (chars + line.length > 2000) break
    tail.unshift(line)
    chars += line.length + 1
  }
  const omitted = lines.length - head.length - tail.length
  return `${head.join("\n")}\n\n... ${omitted} lines omitted ...\n\n${tail.join("\n")}`
}

async function store(text, directory, source) {
  mkdirSync(STORE, { recursive: true })
  const file = join(STORE, `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
  writeFileSync(file, text)
  const indexed = await cli(["index", file, "--project", directory, "--source", source], directory)
  return { file, indexed: indexed.ok }
}

export default {
  id: "context-mode-v2",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "ctx_execute",
        description:
          "Run a shell command and keep its full output out of the context. The complete output is saved and indexed; only the head and tail come back, with a pointer and a ctx_search hint. Use for commands that may produce large output.",
        input: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to run" },
            timeout: { type: "number", description: "Timeout in seconds", minimum: 1, maximum: 600 },
          },
          required: ["command"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          const directory = ctx.location.directory
          const seconds = input.timeout ?? 120
          const output = await new Promise((resolve) => {
            execFile(
              SHELL,
              [...SHELL_ARGS, input.command],
              { cwd: directory, timeout: seconds * 1000, maxBuffer: 64 * 1024 * 1024, signal: context.signal },
              (error, stdout, stderr) => resolve({ error, stdout: stdout || "", stderr: stderr || "" }),
            )
          })
          const text = [output.stdout, output.stderr].filter(Boolean).join("\n")
          const stored = await store(text, directory, "exec")
          const body = truncate(text) || "(no output)"
          const size = Buffer.byteLength(text)
          const lines = text ? text.split("\n").length : 0
          return {
            content:
              `${body}\n\n[full output: ${size} bytes, ${lines} lines, saved to ${stored.file}` +
              `${stored.indexed ? ", indexed" : ", index failed"}. Use ctx_search to query it.]` +
              (output.error ? `\n[exit: ${output.error.code ?? "error"}]` : ""),
            metadata: { bytes: size, file: stored.file },
          }
        },
      })

      editor.add({
        name: "ctx_search",
        description: "Search the indexed output of earlier ctx_execute calls and captured shell results in this project.",
        input: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", description: "Maximum hits", minimum: 1, maximum: 20 },
          },
          required: ["query"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const directory = ctx.location.directory
          const result = await cli(["search", input.query, "--project", directory, "--limit", String(input.limit ?? 3)], directory)
          return { content: result.stdout || result.stderr || "no results" }
        },
      })

      editor.add({
        name: "ctx_index",
        description: "Index a file or directory into the project's searchable store so ctx_search can find it later.",
        input: {
          type: "object",
          properties: {
            path: { type: "string", description: "File or directory to index" },
            source: { type: "string", description: "Label for these entries" },
          },
          required: ["path"],
          additionalProperties: false,
        },
        execute: async (input) => {
          const directory = ctx.location.directory
          const args = ["index", input.path, "--project", directory]
          if (input.source) args.push("--source", input.source)
          const result = await cli(args, directory)
          return { content: result.stdout || result.stderr || "indexed" }
        },
      })
    })

    await ctx.tool.hook("execute.after", async (event) => {
      if (event.tool !== "shell" || event.status !== "completed") return
      const text = textOf(event.result)
      if (text.length <= THRESHOLD) return
      const directory = ctx.location.directory
      const stored = await store(text, directory, "shell")
      if (!stored.indexed) return
      event.result = {
        ...event.result,
        content:
          `${truncate(text)}\n\n[full output: ${Buffer.byteLength(text)} bytes saved to ${stored.file} and indexed. Use ctx_search to query it.]`,
      }
    })
  },
}
