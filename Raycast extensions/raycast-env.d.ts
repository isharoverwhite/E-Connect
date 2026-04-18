/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Server IP:Port - Direct E-Connect backend endpoint for API keys. Use IP:Port like 192.168.1.25:8000 or paste the full URL from docs/API_KEYS.md. */
  "serverAddress": string,
  /** API Key - Server-side bearer API key created in WebUI -> Settings -> API Keys for that same server. */
  "apiKey": string,
  /** TLS - Allow locally issued or self-signed certificates when using HTTPS. */
  "allowInsecureTls": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `dashboard` command */
  export type Dashboard = ExtensionPreferences & {}
  /** Preferences accessible in the `devices` command */
  export type Devices = ExtensionPreferences & {}
  /** Preferences accessible in the `automations` command */
  export type Automations = ExtensionPreferences & {}
  /** Preferences accessible in the `open-web-ui` command */
  export type OpenWebUi = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `dashboard` command */
  export type Dashboard = {}
  /** Arguments passed to the `devices` command */
  export type Devices = {}
  /** Arguments passed to the `automations` command */
  export type Automations = {}
  /** Arguments passed to the `open-web-ui` command */
  export type OpenWebUi = {}
}

