const UA = "claude-cli/2.1.138 (external, sdk-cli)"

export default {
  id: "bedrock-headers",
  async setup(ctx) {
    await ctx.session.hook("http.request", async (event) => {
      if (event.model?.providerID !== "amazon-bedrock") return
      try {
        event.request.headers.set("user-agent", UA)
      } catch {}
    })
  },
}
