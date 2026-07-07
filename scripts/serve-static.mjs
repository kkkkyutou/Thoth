#!/usr/bin/env node
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? "packages/app/dist");
const requestedPort = Number(process.env.PORT ?? process.argv[3] ?? "4173");
const requestedHost = process.env.HOST ?? process.argv[4] ?? "127.0.0.1";
const relayHealthProxyPath = "/__thoth/relay-health";
const relayHealthUrl = "https://relay.test.thoth.seeles.ai/health";
const daemonProxyTarget = process.env.THOTH_DAEMON_PROXY_TARGET?.trim() ?? "";
const daemonProxyEnabled = daemonProxyTarget.length > 0;

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

function parseDaemonProxyTarget(target) {
  const normalized = target.replace(/^tcp:\/\//, "").trim();
  const match = normalized.match(/^(.+):(\d{1,5})$/);
  if (!match) {
    throw new Error(`Invalid THOTH_DAEMON_PROXY_TARGET: ${target}`);
  }
  const host = match[1].trim();
  const port = Number(match[2]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid THOTH_DAEMON_PROXY_TARGET: ${target}`);
  }
  return { host, port };
}

function injectDaemonConnectionHint(html) {
  if (!daemonProxyEnabled) {
    return html;
  }
  const script = `<script>
(() => {
  const listen = window.location.host;
  if (!listen) return;
  window.__THOTH_INITIAL_DAEMON_CONNECTION__ = {
    listen,
    useTls: window.location.protocol === "https:"
  };
})();
</script>`;
  return html.includes("</head>")
    ? html.replace("</head>", `${script}\n  </head>`)
    : `${script}\n${html}`;
}

function isRelayHealthPayload(value) {
  return (
    value &&
    typeof value === "object" &&
    value.status === "ok" &&
    value.protocol === "3" &&
    value.service === "thoth-relay"
  );
}

async function serveRelayHealth(res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(relayHealthUrl, {
      method: "GET",
      signal: controller.signal,
    });
    const payload = response.ok ? await response.json() : null;
    if (!isRelayHealthPayload(payload)) {
      res.writeHead(502, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ status: "unavailable", service: "thoth-relay" }));
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        status: payload.status,
        protocol: payload.protocol,
        service: payload.service,
        endpoint: "relay.test.thoth.seeles.ai",
      }),
    );
  } catch {
    res.writeHead(502, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ status: "unavailable", service: "thoth-relay" }));
  } finally {
    clearTimeout(timeout);
  }
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = (req.url ?? "/").split("?")[0] || "/";
    if (urlPath === relayHealthProxyPath) {
      await serveRelayHealth(res);
      return;
    }
    const filePath = resolveStaticPath(req.url ?? "/");
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const contentType = mimeTypes.get(extname(filePath)) ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    if (daemonProxyEnabled && filePath === join(root, "index.html")) {
      res.end(injectDaemonConnectionHint(readFileSync(filePath, "utf8")));
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : String(error));
  }
});

server.on("upgrade", (req, socket, head) => {
  const urlPath = (req.url ?? "/").split("?")[0] || "/";
  if (!daemonProxyEnabled || urlPath !== "/ws") {
    socket.destroy();
    return;
  }

  let target;
  try {
    target = parseDaemonProxyTarget(daemonProxyTarget);
  } catch (error) {
    socket.destroy(error instanceof Error ? error : undefined);
    return;
  }

  const upstream = createConnection(target.port, target.host, () => {
    const headers = { ...req.headers, host: `${target.host}:${target.port}` };
    const requestLines = [`${req.method ?? "GET"} ${req.url ?? "/ws"} HTTP/${req.httpVersion}`];
    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          requestLines.push(`${name}: ${item}`);
        }
      } else {
        requestLines.push(`${name}: ${value}`);
      }
    }
    upstream.write(`${requestLines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) {
      upstream.write(head);
    }
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
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
