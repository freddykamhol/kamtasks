async function bootstrap() {
  const http = await import("node:http");
  const { parse } = await import("node:url");
  const nextModule = await import("next");

  const next = nextModule.default;
  const dev = process.env.NODE_ENV !== "production";
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const port = Number.parseInt(process.env.PORT || "3000", 10);

  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();

  http
    .createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url || "/", true);
        await handle(req, res, parsedUrl);
      } catch (error) {
        console.error("Request handling failed", error);
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    })
    .listen(port, hostname, () => {
      console.log(`KAMTasks läuft auf http://${hostname}:${port}`);
    });
}

bootstrap().catch((error) => {
  console.error("Server bootstrap failed", error);
  process.exit(1);
});
