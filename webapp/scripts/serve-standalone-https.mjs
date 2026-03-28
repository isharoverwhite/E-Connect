import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureLocalTlsAssets, formatTlsHostSummary } from "./local-https.mjs";

const publicPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const publicHost = process.env.HOSTNAME ?? "0.0.0.0";
const internalPort = Number.parseInt(process.env.INTERNAL_HTTP_PORT ?? "3001", 10);

if (!Number.isFinite(publicPort) || publicPort <= 0) {
  throw new Error(`Invalid PORT=${process.env.PORT}`);
}

if (!Number.isFinite(internalPort) || internalPort <= 0 || internalPort === publicPort) {
  throw new Error(`Invalid INTERNAL_HTTP_PORT=${process.env.INTERNAL_HTTP_PORT ?? "3001"}`);
}

const standaloneServerPath = [
  path.join(process.cwd(), "server.js"),
  path.join(process.cwd(), ".next", "standalone", "server.js"),
].find((candidate) => existsSync(candidate));

if (!standaloneServerPath) {
  throw new Error("Could not find the Next standalone server entrypoint. Run `npm run build` first.");
}

const { keyPath, certPath, provider, hosts, httpsDir } = ensureLocalTlsAssets();

console.log(
  `[https] Frontend runtime is HTTPS-only. Using ${provider} TLS assets in ${httpsDir} for ${formatTlsHostSummary(hosts)}.`,
);

const child = spawn(process.execPath, [standaloneServerPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(internalPort),
    HOSTNAME: "127.0.0.1",
  },
});

let shuttingDown = false;

function forwardedHeaders(request) {
  const headers = { ...request.headers };
  const remoteAddress = request.socket.remoteAddress ?? "";
  const existingForwardedFor = request.headers["x-forwarded-for"];
  const forwardedFor = [existingForwardedFor, remoteAddress].filter(Boolean).join(", ");

  headers.host = request.headers.host ?? `${publicHost}:${publicPort}`;
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-port"] = String(publicPort);
  headers["x-forwarded-host"] = request.headers.host ?? `${publicHost}:${publicPort}`;
  if (forwardedFor) {
    headers["x-forwarded-for"] = forwardedFor;
  }

  return headers;
}

function proxyHttpRequest(request, response) {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: internalPort,
      method: request.method,
      path: request.url,
      headers: forwardedHeaders(request),
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.statusMessage,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Next.js upstream is unavailable.");
  });

  request.on("aborted", () => {
    upstream.destroy();
  });

  request.pipe(upstream);
}

function serializeUpgradeHeaders(request) {
  const headerLines = [];
  const headers = forwardedHeaders(request);

  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      headerLines.push(`${name}: ${value.join(", ")}`);
      continue;
    }

    if (typeof value === "string") {
      headerLines.push(`${name}: ${value}`);
    }
  }

  return `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headerLines.join("\r\n")}\r\n\r\n`;
}

const secureServer = https.createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  proxyHttpRequest,
);

secureServer.on("upgrade", (request, socket, head) => {
  const upstreamSocket = net.connect(internalPort, "127.0.0.1");

  upstreamSocket.on("connect", () => {
    upstreamSocket.write(serializeUpgradeHeaders(request));
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    socket.pipe(upstreamSocket).pipe(socket);
  });

  upstreamSocket.on("error", () => {
    socket.destroy();
  });

  socket.on("error", () => {
    upstreamSocket.destroy();
  });
});

secureServer.listen(publicPort, publicHost, () => {
  console.log(`[https] Listening on https://${publicHost}:${publicPort} with internal Next upstream on 127.0.0.1:${internalPort}.`);
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  secureServer.close(() => {
    child.kill(signal);
  });

  setTimeout(() => {
    child.kill(signal);
  }, 5000).unref();
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

child.on("exit", (code, signal) => {
  if (!shuttingDown) {
    secureServer.close();
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
