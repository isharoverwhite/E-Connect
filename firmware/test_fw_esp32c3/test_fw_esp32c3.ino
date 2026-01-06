#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Update.h>
#include <WiFi.h>

// --- Configuration ---
const char *ssid = "YOUR_WIFI_SSID";
const char *password = "YOUR_WIFI_PASSWORD";
String serverUrl =
    "http://YOUR_SERVER_IP:8000/api/v1"; // Replace YOUR_SERVER_IP

// Device Identity
const char *device_id = "123e4567-e89b-12d3-a456-426614174000"; // UUID v4
const char *mac_address = "AA:BB:CC:DD:EE:FF";
const char *device_name = "Laboratory ESP32-C3";
const char *firmware_version = "0.0.1";

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- ESP32-C3 Firmware ---");

  // 1. Connect to Wi-Fi
  connectToWiFi();

  // 2. Register/Update Config with Server (Handshake)
  registerDevice();

  // 3. Check for OTA Updates
  checkForUpdates();
}

void loop() {}

void connectToWiFi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
  } else {
    Serial.println("\nFailed to connect to WiFi.");
  }
}

void registerDevice() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;
  String url = serverUrl + "/config";

  // Construct JSON Payload compatible with 'DeviceRegister' schema
  StaticJsonDocument<512> doc;

  doc["device_id"] = device_id;
  doc["mac_address"] = mac_address;
  doc["name"] = device_name;
  doc["mode"] = "library";
  doc["firmware_version"] = firmware_version;

  // Pins
  JsonArray pins = doc.createNestedArray("pins");
  JsonObject pin1 = pins.createNestedObject();
  pin1["gpio_pin"] = 2;
  pin1["mode"] = "OUTPUT";
  pin1["function"] = "LED";
  pin1["label"] = "Status LED";

  String requestBody;
  serializeJson(doc, requestBody);

  Serial.println("Sending Handshake...");

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(requestBody);

  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.println("Response: " + response);
  } else {
    Serial.println("Error on POST: " + String(httpResponseCode));
  }

  http.end();
}

void checkForUpdates() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  // Endpoint depends on board type filter in server
  String url = serverUrl + "/ota/latest/ESP32";

  http.begin(url);
  int httpCode = http.GET();

  if (httpCode == 200) {
    String payload = http.getString();
    StaticJsonDocument<200> doc;
    deserializeJson(doc, payload);

    const char *new_ver = doc["version"];
    String filename = doc["filename"];

    if (String(new_ver) != String(firmware_version)) {
      Serial.println("New version: " + String(new_ver));
      // performOTA(filename); // Implement OTA download logic same as before
    }
  }
  http.end();
}
