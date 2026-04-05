/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

import type { NextConfig } from "next";
import os from "node:os";

const backendInternalUrl = (process.env.BACKEND_INTERNAL_URL ?? "http://server:8000").replace(/\/$/, "");

function splitCsv(value?: string) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeIpAddress(address: string) {
  return address.replace(/%.+$/, "").trim();
}

function unique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function collectDetectedLanIps() {
  const ipAddresses: string[] = [];

  for (const interfaceInfo of Object.values(os.networkInterfaces())) {
    for (const addressInfo of interfaceInfo ?? []) {
      if (addressInfo.internal || addressInfo.family !== "IPv4") {
        continue;
      }

      ipAddresses.push(normalizeIpAddress(addressInfo.address));
    }
  }

  return ipAddresses;
}

function collectAllowedDevOrigins() {
  const networkHosts = ["localhost", "127.0.0.1", "::1"];
  const hostname = os.hostname().trim();
  if (hostname) {
    networkHosts.push(hostname);
  }

  networkHosts.push(
    ...collectDetectedLanIps(),
    ...splitCsv(process.env.HTTPS_HOSTS),
    ...splitCsv(process.env.LOCAL_HTTPS_HOSTS),
    ...splitCsv(process.env.HTTPS_IPS).map(normalizeIpAddress),
    ...splitCsv(process.env.LOCAL_HTTPS_IPS).map(normalizeIpAddress),
  );

  return unique(networkHosts);
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: collectAllowedDevOrigins(),
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendInternalUrl}/api/v1/:path*`,
      },
      {
        source: "/health",
        destination: `${backendInternalUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
