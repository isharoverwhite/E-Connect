import path from "node:path";
import { spawn } from "node:child_process";
import { ensureLocalTlsAssets, formatTlsHostSummary } from "./local-https.mjs";

const nextBinary = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "next.cmd" : "next",
);

const { keyPath, certPath, provider, hosts, httpsDir } = ensureLocalTlsAssets();
const forwardedArgs = process.argv.slice(2);

console.log(
  `[https] Frontend dev server is HTTPS-only. Using ${provider} TLS assets in ${httpsDir} for ${formatTlsHostSummary(hosts)}.`,
);

const child = spawn(
  nextBinary,
  [
    "dev",
    "--hostname",
    process.env.HOSTNAME ?? "0.0.0.0",
    "--port",
    process.env.PORT ?? "3000",
    "--experimental-https",
    "--experimental-https-key",
    keyPath,
    "--experimental-https-cert",
    certPath,
    ...forwardedArgs,
  ],
  {
    stdio: "inherit",
    env: process.env,
  },
);

["SIGINT", "SIGTERM"].forEach((signal) => {
  process.on(signal, () => {
    child.kill(signal);
  });
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
