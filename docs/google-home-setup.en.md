# Google Home Integration — Setup Guide

> **Reading time:** ~10 minutes  
> **Audience:** Server administrator  
> **Prerequisite:** E-Connect server is running and accessible from the internet (via port forwarding, Cloudflare Tunnel, ngrok, etc.)

---

## Overview

E-Connect integrates with Google Home as a **Smart Home Action**. Once configured, every user on your server can link their E-Connect account to Google Home and control devices with voice commands:

```
"Hey Google, turn on the living room light"
"Hey Google, set the bedroom fan to 50%"
"Hey Google, turn off all devices"
```

The integration works by:
1. **Your server** acting as an OAuth 2.0 authorization server (account linking)
2. **Google's servers** calling your fulfillment webhook to send SYNC / QUERY / EXECUTE intents
3. **Report State** pushing real-time state changes back to Google via the Home Graph API

---

## Architecture Diagram

```
Google Home App
      │
      │  Account Linking (OAuth2)
      ▼
E-Connect Server  ◄──────────────────────────────┐
   /api/v1/google/auth          │                │
   /api/v1/google/token         │                │
      │                         │                │
      │  Smart Home Fulfillment │                │
      ▼                         │                │
E-Connect Server                │                │
   /api/v1/google/fulfillment   │                │
      │  SYNC / QUERY / EXECUTE │                │
      ▼                         │                │
   MQTT → ESP32 Devices         │                │
      │                         │                │
      │  State Changes          │                │
      └─────► Report State ─────┘                │
              Home Graph API                     │
              (Google Cloud)                     │
                                                 │
              Service Account JWT ───────────────┘
```

---

## Step 1 — Create a Google Actions Project

1. Go to [Google Actions Console](https://console.actions.google.com/) and sign in with your Google account.
2. Click **New project**, give it a name (e.g. `E-Connect`), and click **Create project**.
3. On the "What kind of Action do you want to build?" screen, select **Smart Home** and click **Start Building**.
4. In the left sidebar, go to **Develop → Actions**.
5. Under **Fulfillment**, paste your server's fulfillment URL:
   ```
   https://<your-public-server-domain>/api/v1/google/fulfillment
   ```
   > Replace `<your-public-server-domain>` with your server's public hostname or IP.

---

## Step 2 — Configure Account Linking (OAuth 2.0)

Still in the Actions Console, go to **Develop → Account linking**.

Fill in the fields as follows:

| Field | Value |
|---|---|
| **Linking type** | OAuth |
| **Grant type** | Authorization code |
| **Client ID** | A secret string you generate (e.g. `econnect-ghome-client`) |
| **Client secret** | Another secret string you generate (e.g. a long random password) |
| **Authorization URL** | `https://<your-public-server-domain>/api/v1/google/auth` |
| **Token URL** | `https://<your-public-server-domain>/api/v1/google/token` |

> **Important:** Save the Client ID and Client Secret — you will enter them in E-Connect Settings in Step 4.

Click **Save**.

---

## Step 3 — Enable Home Graph API & Create a Service Account

The Home Graph API lets E-Connect proactively push device state changes to Google (Report State) so Google always has the latest state.

### 3a — Enable the API

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and select the same project used in Step 1.
2. Navigate to **APIs & Services → Library**.
3. Search for **HomeGraph API** and click **Enable**.

### 3b — Create a Service Account

1. Go to **IAM & Admin → Service Accounts**.
2. Click **Create Service Account**.
3. Give it a name (e.g. `econnect-homegraph`), click **Create and continue**.
4. Skip the optional role and user access steps — click **Done**.

### 3c — Download the JSON Key

1. Click on the service account you just created.
2. Go to the **Keys** tab.
3. Click **Add Key → Create new key → JSON** and click **Create**.
4. A `.json` file is downloaded — keep it safe, you will paste its contents into E-Connect Settings.

---

## Step 4 — Configure E-Connect

1. Open E-Connect in your browser and go to **Settings → Google Home**.
2. Scroll down to the **Google Cloud Credentials** section (visible to admins only).
3. Fill in the fields:

| Field | Value |
|---|---|
| **OAuth2 Client ID** | The Client ID you chose in Step 2 |
| **OAuth2 Client Secret** | The Client Secret you chose in Step 2 |
| **Google Cloud Project ID** | Your Google Cloud project ID (shown in the Cloud Console header) |
| **Service Account JSON Key** | Paste the entire contents of the `.json` file downloaded in Step 3c |

4. Click **Save Credentials**.

The status badges at the top of the section will turn green once all fields are configured.

---

## Step 5 — Test Account Linking

1. Open the **Google Home** app on your phone.
2. Tap **+** → **Set up device** → **Works with Google**.
3. Search for your action name (the name you gave in Step 1).
4. Tap it, then sign in with your E-Connect username and password.
5. After signing in, Google will redirect back and sync your devices automatically.

You should see all your E-Connect devices appear in the Google Home app within a few seconds.

---

## Step 6 — Voice Commands

Once linked, you can say:

| Command | Action |
|---|---|
| `"Hey Google, turn on [device name]"` | Turns the device on |
| `"Hey Google, turn off [device name]"` | Turns the device off |
| `"Hey Google, set [device name] to 50%"` | Sets brightness/fan speed to 50% |
| `"Hey Google, dim [device name]"` | Reduces brightness |
| `"Hey Google, sync my devices"` | Re-syncs device list |

> **Tip:** Device names in Google Home match the names you set in E-Connect. Rename devices in **E-Connect → Devices** for better voice recognition.

---

## Sync & Re-link

- **Adding a new device** — Go to **Settings → Google Home** and click **Sync Devices**, or say *"Hey Google, sync my devices"*.
- **Unlinking** — Go to **Settings → Google Home** and click **Unlink Account**. You can re-link at any time.
- **Credential rotation** — If you change the Client Secret, all linked users will need to re-link their accounts.

---

## Troubleshooting

### Google can't reach my server

Make sure your server is publicly accessible. Test by opening the following URL in a browser:

```
https://<your-public-server-domain>/api/v1/google/fulfillment
```

You should receive a `401 Missing authorization` response (not a connection error), which confirms the endpoint is reachable.

### "Service unavailable" during account linking

This means `GOOGLE_HOME_CLIENT_ID` and `GOOGLE_HOME_CLIENT_SECRET` are not set. Check the **Google Cloud Credentials** section in Settings.

### Devices not appearing in Google Home

After linking, click **Sync Devices** in Settings or say *"Hey Google, sync my devices"*. If devices still don't appear, check that your devices are **approved** (not pending) in E-Connect.

### State is stale in Google Home

State staleness means Report State is not working. Verify that:
- The **Google Cloud Project ID** is set correctly in Settings.
- The **Service Account JSON Key** is for a service account in the correct project.
- The **HomeGraph API** is enabled in your Google Cloud project.

---

## Environment Variables (alternative to UI)

Instead of using the Settings UI, you can also configure credentials via environment variables in your `docker-compose.yml` or `.env` file:

```env
GOOGLE_HOME_CLIENT_ID=your-client-id
GOOGLE_HOME_CLIENT_SECRET=your-client-secret
GOOGLE_HOME_PROJECT_ID=your-gcloud-project-id
GOOGLE_HOME_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

> **Note:** Settings saved via the UI take priority over environment variables.

---

## Security Notes

- The OAuth 2.0 Client Secret and Service Account JSON key are stored encrypted in the E-Connect database. Never share them publicly.
- The fulfillment endpoint only accepts requests bearing a valid E-Connect access token issued during the account-linking OAuth flow.
- The service account key is used server-side only — it is never exposed to users.

---

*Guide version: 1.0 — E-Connect 2026*
