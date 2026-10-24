import { readdirSync } from "node:fs"
import { join } from "node:path"
import { store } from "@opencode-trace/core"
import entrypoint, { _getTestPlugin } from "@opencode-trace/plugin"

const TRACE_HANDLED = "__TRACE_HANDLED__"
const BEDROCK_USER_AGENT = "claude-cli/2.1.295 (external, claude-desktop-3p, agent-sdk/0.3.295)"

function maxSeqOnDisk(traceDir, sessionID) {
  try {
    return readdirSync(join(traceDir, sessionID))
      .filter((name) => /^\d+\.json$/.test(name))
      .reduce((max, name) => Math.max(max, Number.parseInt(name, 10)), 0)
  } catch {
    return 0
  }
}

function clientAdapter(ctx) {
  return {
    session: {
      prompt: async ({ path, body }) => {
        const text = (body?.parts ?? [])
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
        if (text) await ctx.session.synthetic({ sessionID: path.id, text })
      },
    },
  }
}

function translateEvent(event) {
  const info = (data) => ({
    id: data.sessionID,
    title: data.title,
    parentID: data.parentID,
    directory: data.location?.directory,
  })
  if (event.type === "session.created") {
    return { type: "session.created", properties: { info: info(event.data) } }
  }
  if (event.type === "session.renamed" || event.type === "session.metadata.updated") {
    return { type: "session.updated", properties: { info: info(event.data) } }
  }
  return undefined
}

export default {
  id: "opencode-trace",
  async setup(ctx) {
    const directory = ctx.location.directory

    const hooks = await entrypoint.server({
      directory,
      worktree: directory,
      project: ctx.location.project,
      client: clientAdapter(ctx),
    })

    const tracer = _getTestPlugin()
    // The upstream interceptor patches globalThis.fetch, which never sees v2
    // provider traffic, and it stacks one wrapper per location.
    tracer?.uninstallInterceptor()

    const pending = new WeakMap()
    const seeded = new Set()

    await ctx.session.hook("http.request", async (event) => {
      if (event.request.url.includes("bedrock-runtime")) {
        try {
          event.request.headers.set("user-agent", BEDROCK_USER_AGENT)
        } catch {}
      }
      if (!tracer) return
      const sessionID = event.sessionID
      if (!seeded.has(sessionID)) {
        const traceDir = tracer.resolveTraceDir(sessionID)
        try {
          const info = await ctx.session.get({ sessionID })
          store.writeSessionMetadata(
            sessionID,
            {
              title: info?.title,
              parentID: info?.parentID,
              createdAt: info?.time?.created,
              folderPath: directory,
            },
            traceDir,
          )
        } catch {}
        tracer.ids.set(sessionID, maxSeqOnDisk(traceDir, sessionID))
        seeded.add(sessionID)
      }
      const clone = event.request.clone()
      let rawBody
      try {
        rawBody = await clone.text()
      } catch {
        rawBody = undefined
      }
      const meta = await tracer.captureRequestMeta(event.request.clone())
      if (meta) {
        if (typeof rawBody === "string") meta.traceReq.rawBody = rawBody
        pending.set(event.request, meta)
      }
    })

    await ctx.session.hook("http.response", async (event) => {
      const meta = pending.get(event.request)
      if (!meta || !tracer) return
      try {
        let res = event.response
        let latencyMeta
        if (meta.isStream && res.body) {
          res = await tracer.wrapStreamResponse(
            res.clone(),
            meta.requestSentAt,
            meta.session,
            meta.seq,
            meta.traceDir,
          )
          latencyMeta = res.__latencyMeta
        }
        await tracer.recordResponse(
          meta.session,
          meta.seq,
          meta.purpose,
          meta.requestAt,
          meta.traceReq,
          res,
          latencyMeta,
          meta.traceDir,
        )
      } catch {
        // never break the live provider stream because a trace write failed
      }
    })

    if (!hooks) return

    await ctx.tool.transform((editor) => {
      for (const [name, definition] of Object.entries(hooks.tool ?? {})) {
        editor.add({
          name,
          description: definition.description,
          input: { type: "object", properties: {}, additionalProperties: false },
          execute: async (_input, context) => ({
            content: String(await definition.execute({}, { sessionID: context.sessionID })),
          }),
        })
      }
    })

    if (hooks["tool.execute.before"]) {
      await ctx.tool.hook("execute.before", async (event) => {
        await hooks["tool.execute.before"](
          { tool: event.tool, sessionID: event.sessionID, callID: event.id },
          { args: event.input },
        )
      })
    }

    if (hooks["tool.execute.after"]) {
      await ctx.tool.hook("execute.after", async (event) => {
        await hooks["tool.execute.after"](
          { tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
          {
            title: "",
            output: "",
            metadata: event.status === "completed" ? event.result?.metadata : event.error?.metadata,
          },
        )
      })
    }

    if (hooks["command.execute.before"]) {
      await ctx.command.transform((editor) => {
        editor.add({
          name: "trace",
          description: "Control trace recording: /trace <on|off|status> [-g] [-l] [-s] [-d global|local]",
          execute: async ({ sessionID, prompt }) => {
            try {
              await hooks["command.execute.before"](
                { command: "trace", sessionID, arguments: prompt?.text ?? "" },
                { parts: [] },
              )
            } catch (err) {
              if (err?.message !== TRACE_HANDLED) throw err
            }
          },
        })
      })
    }

    if (hooks.event) {
      const controller = new AbortController()
      void (async () => {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          const translated = translateEvent(event)
          if (!translated) continue
          await hooks.event({ event: translated }).catch(() => {})
        }
      })().catch(() => {})
      return () => controller.abort()
    }
  },
}
