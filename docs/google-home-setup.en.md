# Google Home Integration — Setup Guide

> **Time:** ~15 minutes  
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

The integration works as follows:
1. **Your server** acts as an OAuth 2.0 authorization server — users sign in to E-Connect to link their Google account.
2. **Google's servers** call your fulfillment webhook to send SYNC / QUERY / EXECUTE intents.
3. **Report State** pushes real-time device state back to Google via the Home Graph API.

You need to collect **4 values** from Google to fill into E-Connect:

| Field in E-Connect | Where to get it |
|---|---|
| **OAuth2 Client ID** | A string you choose when configuring Account Linking in Google Home Developer Console |
| **OAuth2 Client Secret** | A string you choose when configuring Account Linking in Google Home Developer Console |
| **Google Cloud Project ID** | The project Settings page in Google Home Developer Console |
| **Service Account JSON Key** | Google Cloud Console — downloaded from a Service Account |

---

## Step 1 — Open E-Connect Settings → Google Home

Sign in to E-Connect with an **admin** account, go to **Settings**, and scroll down to the **Google Home** section.

You will see the **Google Cloud Credentials** form with 4 empty fields. This is your destination — the steps below guide you through collecting all 4 values.

> The Google Cloud Credentials section is only visible to admin accounts.

---

## Step 2 — Create a Project in Google Home Developer Console

Go to: **https://console.home.google.com/projects**

1. Click **Create a project**.
2. Enter a project name (e.g. `E-Connect`) and click **Create project**.
3. After the project is created, **note down the Project ID** — this is the **Google Cloud Project ID** you will fill in at Step 7.
   > The Project ID looks like `my-project-abc123` and appears in the URL or in the project's Settings page.

---

## Step 3 — Configure Smart Home Fulfillment

Inside the project, go to **Develop → Actions** in the left sidebar.

Under **Fulfillment URL**, enter:

```
https://<your-public-server-domain>/api/v1/google/fulfillment
```

> Replace `<your-public-server-domain>` with the public hostname or IP of your E-Connect server.  
> Example: `https://myhome.duckdns.org/api/v1/google/fulfillment`

Click **Save**.

---

## Step 4 — Configure Account Linking (OAuth 2.0)

Still in the same project, go to **Develop → Account linking**.

Fill in the fields as follows:

| Field | Value |
|---|---|
| **Linking type** | OAuth |
| **Grant type** | Authorization code |
| **Client ID** | A secret string you choose — save it, this is your **OAuth2 Client ID** |
| **Client secret** | Another secret string you choose — save it, this is your **OAuth2 Client Secret** |
| **Authorization URL** | `https://<your-public-server-domain>/api/v1/google/auth` |
| **Token URL** | `https://<your-public-server-domain>/api/v1/google/token` |

> **Generate random Client ID / Secret:**
> ```bash
> python3 -c "import uuid; print(uuid.uuid4())"
> ```
> Run this command twice — once for the Client ID, once for the Client Secret.

Click **Save**.

---

## Step 5 — Enable the Home Graph API

The Home Graph API allows E-Connect to push real-time device state changes to Google.

Go to the Google Cloud Console — make sure you are in the same project created in Step 2:

**https://console.cloud.google.com/apis/library/homegraph.googleapis.com**

Click **Enable**.

> If the wrong project is selected, click the project name in the top-left corner and switch to your Google Home project.

---

## Step 6 — Create a Service Account and Download the JSON Key

A Service Account lets the E-Connect server authenticate with the Home Graph API to send Report State.

### 6a — Create the Service Account

Go to: **https://console.cloud.google.com/iam-admin/serviceaccounts**

1. Click **+ Create service account**.
2. Give it a name (e.g. `econnect-homegraph`) and click **Create and continue**.
3. Skip the Permissions and Grant access steps — click **Done**.

### 6b — Download the JSON Key

1. Click on the **email address** of the service account you just created.
2. Switch to the **Keys** tab.
3. Click **Add Key → Create new key → JSON → Create**.
4. A `.json` file is downloaded automatically — this is the **Service Account JSON Key**.

The file looks like this:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...",
  "client_email": "econnect-homegraph@your-project.iam.gserviceaccount.com",
  ...
}
```

> Keep this file safe — it grants access to your Home Graph API.

---

## Step 7 — Fill Credentials into E-Connect

Return to E-Connect → **Settings → Google Home**, and fill in the 4 fields in the **Google Cloud Credentials** section:

| Field | Value |
|---|---|
| **OAuth2 Client ID** | The Client ID you chose in Step 4 |
| **OAuth2 Client Secret** | The Client Secret you chose in Step 4 |
| **Google Cloud Project ID** | The Project ID noted in Step 2 |
| **Service Account JSON Key** | Paste the entire contents of the `.json` file from Step 6b |

Click **Save Credentials**.

The status badges at the top of the section will turn green once all fields are saved correctly.

---

## Step 8 — Link in the Google Home App

Each user on the server performs this step on their phone:

1. Open the **Google Home** app.
2. Tap **+** → **Set up device** → **Works with Google**.
3. Search for your action name (the name you set in Step 2).
4. Tap it, then sign in with an E-Connect username and password.
5. After signing in, Google automatically syncs devices.

All E-Connect devices will appear in the Google Home app within a few seconds.

---

## Voice Commands

Once linked, you can say:

| Command | Action |
|---|---|
| `"Hey Google, turn on [device name]"` | Turns the device on |
| `"Hey Google, turn off [device name]"` | Turns the device off |
| `"Hey Google, set [device name] to 50%"` | Sets brightness / fan speed to 50% |
| `"Hey Google, dim [device name]"` | Reduces brightness |
| `"Hey Google, sync my devices"` | Re-syncs the device list |

> Device names in Google Home match the names set in E-Connect. Rename devices in **E-Connect → Devices** for better voice recognition.

---

## Sync & Unlink

- **Adding a new device** — Go to **Settings → Google Home** and click **Sync Devices**, or say _"Hey Google, sync my devices"_.
- **Unlinking** — Go to **Settings → Google Home** and click **Unlink Account**. You can re-link at any time.
- **Rotating the Client Secret** — If you change the Client Secret, all linked users must re-link their accounts.

---

## Troubleshooting

### Google can't reach my server

Verify your server is publicly accessible by opening the following URL in a browser:

```
https://<your-public-server-domain>/api/v1/google/fulfillment
```

You should receive a `401 Missing authorization` response — not a connection error. This confirms the endpoint is reachable.

### "Service unavailable" during account linking

The OAuth Client ID or Client Secret has not been saved. Check the **Google Cloud Credentials** section in Settings and click **Save Credentials**.

### Devices not appearing after linking

Click **Sync Devices** in Settings or say _"Hey Google, sync my devices"_. If devices still don't appear, check that your devices are **approved** (not pending) in E-Connect.

### State is stale / out of sync in Google Home

Report State is not working. Verify:
- The **Google Cloud Project ID** is filled in correctly in Settings.
- The **Service Account JSON Key** belongs to a service account in the correct Google Cloud project.
- The **Home Graph API** is enabled in your Google Cloud project (Step 5).

### E-Connect not found in "Works with Google"

The Action must be in **Test** mode before it appears in the list. In the Google Home Developer Console, go to **Test** and enable the testing mode.

---

*Guide version: 2.0 — E-Connect 2026*
