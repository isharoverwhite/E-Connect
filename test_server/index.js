import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Configuration
const DEVICE_ID = "123e4567-e89b-12d3-a456-426614174000"; // UUID v4
const MAC_ADDRESS = "AA:BB:CC:DD:EE:FF";
const SERIAL_NUMBER = "test-esp32-node-sim"; // Name
const SERVER_URL = "http://localhost:8000/api/v1";
const BOARD_TYPE = "ESP32";
const CURRENT_VERSION = "0.0.1";

// Mock Device Configuration (Handshake Payload)
const deviceRegisterPayload = {
    device_id: DEVICE_ID,
    mac_address: MAC_ADDRESS,
    name: SERIAL_NUMBER,
    mode: "library",
    firmware_version: CURRENT_VERSION,
    pins: [
        {
            gpio_pin: 2,
            mode: "OUTPUT",
            // type: "DIGITAL", // Removed from schema
            function: "LED",
            label: "Status LED",
            init: "LOW"
        }
    ]
};

async function registerDevice() {
    try {
        console.log(`\n[1] Registering Device: ${DEVICE_ID}...`);
        // Note: First run might fail if no admin is created yet on the server, 
        // strictly speaking the server requires at least one admin to assign the device to.
        const response = await axios.post(`${SERVER_URL}/config`, deviceRegisterPayload);
        console.log("✅ Registration Successful:", response.data.device_id);
        return true;
    } catch (error) {
        console.error("❌ Registration Failed:", error.message);
        if (error.response) console.error("   Status:", error.response.status, error.response.data);
        return false;
    }
}

async function checkFirmwareUpdate() {
    try {
        console.log(`\n[2] Checking for OTA updates for board: ${BOARD_TYPE}...`);
        const response = await axios.get(`${SERVER_URL}/ota/latest/${BOARD_TYPE}`);

        const latestVersion = response.data.version;
        const downloadUrl = response.data.filename;

        console.log(`   Current: ${CURRENT_VERSION}, Latest: ${latestVersion}`);

        if (latestVersion > CURRENT_VERSION) {
            console.log("🚀 New firmware found! Downloading...");
            await downloadFirmware(downloadUrl);
        } else {
            console.log("✅ Device is up to date.");
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log("ℹ️  No firmware updates available according to server.");
        } else {
            console.error("❌ Failed to check updates:", error.message);
        }
    }
}

async function downloadFirmware(filename) {
    try {
        const url = `${SERVER_URL}/ota/download/${filename}`;
        const writer = fs.createWriteStream(path.join(process.cwd(), `downloaded_${filename}`));

        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log("✅ Firmware downloaded successfully to:", `downloaded_${filename}`);
                resolve();
            });
            writer.on('error', reject);
        });
    } catch (error) {
        console.error("❌ Download failed:", error.message);
    }
}

async function startHeartbeat() {
    console.log(`\n[4] Sending Heartbeat...`);
    // NOTE: In the new schema we don't have a dedicated /heartbeat endpoint that isn't 'history' or 'config' update?
    // Wait, let's check api.py. Ah, we missed re-implementing /heartbeat relative to the previous version.
    // Ideally, devices push history event 'online' or just config update updates last_seen.
    // Let's assume sending history 'online'.

    try {
        const payload = {
            event_type: "online",
            payload: "bootup"
        };
        await axios.post(`${SERVER_URL}/device/${DEVICE_ID}/history`, payload);
        console.log("✅ Heartbeat sent.");
    } catch (error) {
        console.error("❌ Heartbeat failed:", error.message);
    }
}

async function main() {
    console.log("🚀 Starting ESP32 Simulator (Node.js)");
    console.log("Server URL:", SERVER_URL);

    // 1. Register
    const registered = await registerDevice();
    if (!registered) return;

    // 2. Heartbeat (History)
    await startHeartbeat();

    // 3. OTA Check
    await checkFirmwareUpdate();

    console.log("\n✨ Simulation finished.");
}

main();
