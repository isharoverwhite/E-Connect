/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { spawn } from "node:child_process";
import { ensureLocalTlsAssets, formatTlsHostSummary } from "./local-https.mjs";

function parsePort(rawValue, envName) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envName}=${rawValue}`);
  }
  return parsed;
}

const publicHttpPort = parsePort(process.env.PORT ?? "3000", "PORT");
const publicHttpsPort = parsePort(process.env.HTTPS_PORT ?? "3443", "HTTPS_PORT");
const publicHost = process.env.HOSTNAME ?? "0.0.0.0";
const internalPort = parsePort(process.env.INTERNAL_HTTP_PORT ?? "3001", "INTERNAL_HTTP_PORT");
const backendInternalUrl = new URL(process.env.BACKEND_INTERNAL_URL ?? "http://server:8000");
const forwardedArgs = process.argv.slice(2);

if (publicHttpPort === publicHttpsPort) {
  throw new Error(`PORT=${publicHttpPort} and HTTPS_PORT=${publicHttpsPort} must not be the same.`);
}

if (internalPort === publicHttpPort || internalPort === publicHttpsPort) {
  throw new Error(`INTERNAL_HTTP_PORT=${internalPort} must differ from the public listener ports.`);
}

const nextBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);

const { keyPath, certPath, provider, hosts, httpsDir } = ensureLocalTlsAssets();

console.log(
  `[dev] Dual-origin dev runtime with hot reload is enabled. Using ${provider} TLS assets in ${httpsDir} for ${formatTlsHostSummary(hosts)}.`,
);

const child = spawn(
  nextBinary,
  [
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(internalPort),
    ...forwardedArgs,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(internalPort),
    },
  },
);

let shuttingDown = false;

function forwardedHeaders(request, { externalPort, isSecure }) {
  const headers = { ...request.headers };
  const remoteAddress = request.socket.remoteAddress ?? "";
  const existingForwardedFor = request.headers["x-forwarded-for"];
  const forwardedFor = [existingForwardedFor, remoteAddress].filter(Boolean).join(", ");

  headers.host = request.headers.host ?? `${publicHost}:${externalPort}`;
  headers["x-forwarded-proto"] = isSecure ? "https" : "http";
  headers["x-forwarded-port"] = String(externalPort);
  headers["x-forwarded-host"] = request.headers.host ?? `${publicHost}:${externalPort}`;
  if (forwardedFor) {
    headers["x-forwarded-for"] = forwardedFor;
  }

  return headers;
}

function isBackendRuntimePath(requestUrl = "/") {
  try {
    const parsedUrl = new URL(requestUrl, "http://127.0.0.1");
    return parsedUrl.pathname === "/health" || parsedUrl.pathname === "/api/v1" || parsedUrl.pathname.startsWith("/api/v1/");
  } catch {
    return false;
  }
}

function resolveUpstreamRequest(request) {
  if (!isBackendRuntimePath(request.url)) {
    return {
      protocol: "http:",
      host: "127.0.0.1",
      port: internalPort,
      path: request.url,
    };
  }

  const upstreamUrl = new URL(request.url ?? "/", backendInternalUrl);
  return {
    protocol: upstreamUrl.protocol,
    host: upstreamUrl.hostname,
    port: Number(upstreamUrl.port || (upstreamUrl.protocol === "https:" ? "443" : "80")),
    path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
  };
}

function proxyHttpRequest(request, response, options) {
  const upstreamRequest = resolveUpstreamRequest(request);
  const upstreamClient = upstreamRequest.protocol === "https:" ? https : http;
  const upstream = upstreamClient.request(
    {
      host: upstreamRequest.host,
      port: upstreamRequest.port,
      method: request.method,
      path: upstreamRequest.path,
      headers: forwardedHeaders(request, options),
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
    response.end("Next.js dev upstream is unavailable.");
  });

  request.on("aborted", () => {
    upstream.destroy();
  });

  request.pipe(upstream);
}

function serializeUpgradeHeaders(request, options) {
  const headerLines = [];
  const headers = forwardedHeaders(request, options);

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

function attachUpgradeProxy(server, options) {
  server.on("upgrade", (request, socket, head) => {
    const upstreamRequest = resolveUpstreamRequest(request);
    const upstreamSocket =
      upstreamRequest.protocol === "https:"
        ? tls.connect(upstreamRequest.port, upstreamRequest.host, { servername: upstreamRequest.host })
        : net.connect(upstreamRequest.port, upstreamRequest.host);

    upstreamSocket.on("connect", () => {
      upstreamSocket.write(serializeUpgradeHeaders(request, options));
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
}

const httpServer = http.createServer((request, response) => {
  proxyHttpRequest(request, response, { externalPort: publicHttpPort, isSecure: false });
});

const httpsServer = https.createServer(
  {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
  },
  (request, response) => {
    proxyHttpRequest(request, response, { externalPort: publicHttpsPort, isSecure: true });
  },
);

attachUpgradeProxy(httpServer, { externalPort: publicHttpPort, isSecure: false });
attachUpgradeProxy(httpsServer, { externalPort: publicHttpsPort, isSecure: true });

httpServer.listen(publicHttpPort, publicHost, () => {
  console.log(`[http] Dev proxy listening on http://${publicHost}:${publicHttpPort}.`);
});

httpsServer.listen(publicHttpsPort, publicHost, () => {
  console.log(
    `[https] Dev proxy listening on https://${publicHost}:${publicHttpsPort} with Next dev upstream on 127.0.0.1:${internalPort}.`,
  );
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  let closedServers = 0;
  const handleClose = () => {
    closedServers += 1;
    if (closedServers === 2) {
      child.kill(signal);
    }
  };

  httpServer.close(handleClose);
  httpsServer.close(handleClose);

  setTimeout(() => {
    child.kill(signal);
  }, 5000).unref();
}

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

child.on("exit", (code, signal) => {
  if (!shuttingDown) {
    httpServer.close();
    httpsServer.close();
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
