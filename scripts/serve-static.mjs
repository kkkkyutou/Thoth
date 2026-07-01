#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "packages/app/dist");
const requestedPort = Number(process.env.PORT ?? process.argv[3] ?? "4173");
const requestedHost = process.env.HOST ?? process.argv[4] ?? "127.0.0.1";

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Static root does not exist: ${root}`);
  process.exit(1);
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function resolveStaticPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const normalized = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(join(root, normalized));
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  const indexPath = join(root, "index.html");
  return existsSync(indexPath) ? indexPath : null;
}

const server = createServer((req, res) => {
  try {
    const filePath = resolveStaticPath(req.url ?? "/");
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : String(error));
  }
});

server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.listen(requestedPort, requestedHost, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : requestedPort;
  console.log(`Serving ${root}`);
  console.log(`http://${requestedHost}:${port}`);
});
