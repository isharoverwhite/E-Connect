import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
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

if (publicHttpPort === publicHttpsPort) {
  throw new Error(`PORT=${publicHttpPort} and HTTPS_PORT=${publicHttpsPort} must not be the same.`);
}

if (internalPort === publicHttpPort || internalPort === publicHttpsPort) {
  throw new Error(`INTERNAL_HTTP_PORT=${internalPort} must differ from the public listener ports.`);
}

const standaloneServerPath = [
  path.join(process.cwd(), "server.js"),
  path.join(process.cwd(), ".next", "standalone", "server.js"),
].find((candidate) => existsSync(candidate));

if (!standaloneServerPath) {
  throw new Error("Could not find the Next standalone server entrypoint. Run `npm run build` first.");
}

function prepareStandaloneRuntime(serverPath) {
  const rootStandaloneServer = path.join(process.cwd(), "server.js");
  if (serverPath === rootStandaloneServer) {
    return {
      runtimeDir: process.cwd(),
      runtimeServerPath: serverPath,
    };
  }

  const standaloneDir = path.dirname(serverPath);
  const runtimeDir = path.join(process.cwd(), ".next", "local-standalone-runtime");
  const rootStaticDir = path.join(process.cwd(), ".next", "static");
  const runtimeStaticDir = path.join(runtimeDir, ".next", "static");
  const publicDir = path.join(process.cwd(), "public");
  const runtimePublicDir = path.join(runtimeDir, "public");

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  cpSync(standaloneDir, runtimeDir, { recursive: true });

  if (existsSync(rootStaticDir)) {
    mkdirSync(path.dirname(runtimeStaticDir), { recursive: true });
    cpSync(rootStaticDir, runtimeStaticDir, { recursive: true });
  }

  if (existsSync(publicDir)) {
    cpSync(publicDir, runtimePublicDir, { recursive: true });
  }

  return {
    runtimeDir,
    runtimeServerPath: path.join(runtimeDir, "server.js"),
  };
}

const { runtimeDir, runtimeServerPath } = prepareStandaloneRuntime(standaloneServerPath);

const { keyPath, certPath, provider, hosts, httpsDir } = ensureLocalTlsAssets();

console.log(
  `[https] HTTPS companion is enabled on port ${publicHttpsPort}. Using ${provider} TLS assets in ${httpsDir} for ${formatTlsHostSummary(hosts)}.`,
);

const child = spawn(process.execPath, [runtimeServerPath], {
  cwd: runtimeDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(internalPort),
    HOSTNAME: "127.0.0.1",
  },
});

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

function proxyHttpRequest(request, response, options) {
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: internalPort,
      method: request.method,
      path: request.url,
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
    response.end("Next.js upstream is unavailable.");
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
    const upstreamSocket = net.connect(internalPort, "127.0.0.1");

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
  console.log(`[http] Listening on http://${publicHost}:${publicHttpPort}.`);
});

httpsServer.listen(publicHttpsPort, publicHost, () => {
  console.log(
    `[https] Listening on https://${publicHost}:${publicHttpsPort} with internal Next upstream on 127.0.0.1:${internalPort}.`,
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
