/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HTTPS_DIR = path.join(process.cwd(), ".local-https");
const KEY_PATH = path.join(HTTPS_DIR, "local-dev.key.pem");
const CERT_PATH = path.join(HTTPS_DIR, "local-dev.cert.pem");
const META_PATH = path.join(HTTPS_DIR, "meta.json");
const OPENSSL_CONFIG_PATH = path.join(HTTPS_DIR, "openssl.cnf");

function splitCsv(value) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeIpAddress(address) {
  return address.replace(/%.+$/, "").trim();
}

function readConfiguredEntries(...envNames) {
  return envNames.flatMap((envName) => splitCsv(process.env[envName]));
}

function collectDnsNames() {
  const dnsNames = ["localhost"];
  const hostname = os.hostname().trim();

  if (hostname) {
    dnsNames.push(hostname);
  }

  dnsNames.push(...readConfiguredEntries("HTTPS_HOSTS", "LOCAL_HTTPS_HOSTS"));

  return unique(dnsNames);
}

function collectIpAddresses() {
  const ipAddresses = ["127.0.0.1", "::1"];
  const networkInterfaces = os.networkInterfaces();

  for (const interfaceInfo of Object.values(networkInterfaces)) {
    for (const addressInfo of interfaceInfo ?? []) {
      if (addressInfo.internal) {
        continue;
      }

      if (addressInfo.family === "IPv4") {
        ipAddresses.push(normalizeIpAddress(addressInfo.address));
      }
    }
  }

  ipAddresses.push(
    ...readConfiguredEntries("HTTPS_IPS", "LOCAL_HTTPS_IPS").map(normalizeIpAddress),
  );

  return unique(ipAddresses);
}

function collectTlsHosts() {
  return {
    dnsNames: collectDnsNames(),
    ipAddresses: collectIpAddresses(),
  };
}

function hasCommand(binary) {
  const result = spawnSync("sh", ["-lc", `command -v ${binary}`], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function sameList(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function tlsAssetsAreCurrent(hosts) {
  const meta = readJsonFile(META_PATH);

  if (!meta || !existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    return false;
  }

  return (
    sameList(meta.dnsNames ?? [], hosts.dnsNames) &&
    sameList(meta.ipAddresses ?? [], hosts.ipAddresses)
  );
}

function buildOpenSslConfig(hosts) {
  const altNameLines = [];

  hosts.dnsNames.forEach((dnsName, index) => {
    altNameLines.push(`DNS.${index + 1} = ${dnsName}`);
  });

  hosts.ipAddresses.forEach((ipAddress, index) => {
    altNameLines.push(`IP.${index + 1} = ${ipAddress}`);
  });

  const commonName = hosts.dnsNames[0] ?? hosts.ipAddresses[0] ?? "localhost";

  return [
    "[req]",
    "default_bits = 2048",
    "prompt = no",
    "default_md = sha256",
    "distinguished_name = dn",
    "x509_extensions = v3_req",
    "",
    "[dn]",
    `CN = ${commonName}`,
    "",
    "[v3_req]",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature, keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[alt_names]",
    ...altNameLines,
    "",
  ].join("\n");
}

function generateWithMkcert(hosts) {
  if (process.env.LOCAL_HTTPS_DISABLE_MKCERT === "1" || !hasCommand("mkcert")) {
    return null;
  }

  const subjects = [...hosts.dnsNames, ...hosts.ipAddresses];
  const result = spawnSync(
    "mkcert",
    ["-cert-file", CERT_PATH, "-key-file", KEY_PATH, ...subjects],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    const stderr = result.stderr.trim();
    if (stderr) {
      console.warn(`[https] mkcert failed, falling back to openssl: ${stderr}`);
    }
    return null;
  }

  return "mkcert";
}

function generateWithOpenSsl(hosts) {
  if (!hasCommand("openssl")) {
    throw new Error(
      "Missing both mkcert and openssl. Install one of them so the frontend can generate local HTTPS credentials.",
    );
  }

  writeFileSync(OPENSSL_CONFIG_PATH, buildOpenSslConfig(hosts));

  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-nodes",
      "-newkey",
      "rsa:2048",
      "-keyout",
      KEY_PATH,
      "-out",
      CERT_PATH,
      "-days",
      "3650",
      "-config",
      OPENSSL_CONFIG_PATH,
      "-extensions",
      "v3_req",
    ],
    {
      encoding: "utf8",
      stdio: "pipe",
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "openssl failed to generate the local HTTPS certificate");
  }

  return "openssl";
}

function ensureTlsDirectory() {
  mkdirSync(HTTPS_DIR, { recursive: true });
}

function persistMetadata(hosts, provider) {
  writeJsonFile(META_PATH, {
    provider,
    dnsNames: hosts.dnsNames,
    ipAddresses: hosts.ipAddresses,
    generatedAt: new Date().toISOString(),
  });
}

export function ensureLocalTlsAssets() {
  ensureTlsDirectory();

  const hosts = collectTlsHosts();

  if (!tlsAssetsAreCurrent(hosts)) {
    const provider = generateWithMkcert(hosts) ?? generateWithOpenSsl(hosts);
    persistMetadata(hosts, provider);
  }

  const meta = readJsonFile(META_PATH) ?? { provider: "unknown" };

  return {
    httpsDir: HTTPS_DIR,
    keyPath: KEY_PATH,
    certPath: CERT_PATH,
    provider: meta.provider,
    hosts,
  };
}

export function formatTlsHostSummary(hosts) {
  return [...hosts.dnsNames, ...hosts.ipAddresses].join(", ");
}
