#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "secrets.h"

// Hardware configuration
#ifndef ECONNECT_BUILTIN_LED_PIN
#ifdef LED_BUILTIN
#define ECONNECT_BUILTIN_LED_PIN LED_BUILTIN
#else
#define ECONNECT_BUILTIN_LED_PIN 2
#endif
#endif

#ifndef ECONNECT_LED_ACTIVE_HIGH
#define ECONNECT_LED_ACTIVE_HIGH 1
#endif

constexpr unsigned long HEARTBEAT_INTERVAL_MS = 30000;

// Global objects
Preferences preferences;
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Device state
String deviceId = "";

// State variables
bool pinState = false;
unsigned long lastHeartbeatAt = 0;

// Function prototypes
void setupWiFi();
void apiHandshake();
void setupMQTT();
void mqttCallback(char *topic, byte *payload, unsigned int length);
void reconnectMQTT();
void publishState(bool applied);
void setupBuiltinLed();
void applyBuiltinLed(bool nextState);
bool isBuiltinLedCommand(int pin);

void setup() {
  Serial.begin(115200);
  delay(2000); // Give serial monitor time to connect

  Serial.println("\n--- Starting EConnect ESP32-C3 Firmware ---");

  // Setup hardware pin
  setupBuiltinLed();
  applyBuiltinLed(pinState);

  // Setup Wi-Fi
  setupWiFi();

  // Load preferences
  preferences.begin("econnect", false);
  deviceId = preferences.getString("device_id", "");

  if (deviceId == "") {
    Serial.println("No device_id found in NVS. Handshaking for a new one...");
  } else {
    Serial.printf("Found existing device_id in NVS: %s\n", deviceId.c_str());
  }

  // Perform HTTP handshake
  apiHandshake();

  // Setup MQTT
  setupMQTT();
}

void loop() {
  if (!mqttClient.connected()) {
    reconnectMQTT();
  }
  mqttClient.loop();

  if (millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    publishState(false);
    lastHeartbeatAt = millis();
  }

  // Small delay to prevent tight looping
  delay(10);
}

void setupBuiltinLed() {
#if defined(RGB_BUILTIN)
  neopixelWrite(RGB_BUILTIN, 0, 0, 0);
#else
  pinMode(ECONNECT_BUILTIN_LED_PIN, OUTPUT);
#endif
}

void applyBuiltinLed(bool nextState) {
#if defined(RGB_BUILTIN)
  if (nextState) {
    neopixelWrite(RGB_BUILTIN, 0, 32, 0);
  } else {
    neopixelWrite(RGB_BUILTIN, 0, 0, 0);
  }
#else
  const int activeLevel = ECONNECT_LED_ACTIVE_HIGH ? HIGH : LOW;
  const int inactiveLevel = ECONNECT_LED_ACTIVE_HIGH ? LOW : HIGH;
  digitalWrite(ECONNECT_BUILTIN_LED_PIN, nextState ? activeLevel : inactiveLevel);
#endif
}

bool isBuiltinLedCommand(int pin) {
  return pin == ECONNECT_BUILTIN_LED_PIN;
}

void setupWiFi() {
  Serial.printf("Connecting to Wi-Fi SSID: %s ", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" SUCCEEDED!");
    Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(" FAILED!");
    Serial.println("BLOCKER: Could not connect to Wi-Fi. Halting.");
    while (true) {
      delay(1000);
    }
  }
}

void apiHandshake() {
  if (WiFi.status() != WL_CONNECTED)
    return;

  HTTPClient http;
  String url = String(API_BASE_URL) + "/config";

  Serial.printf("Starting API handshake at: %s\n", url.c_str());

  // Ensure server is reachable first
  http.begin(url);
  http.setTimeout(5000); // 5 seconds timeout

  // Prepare JSON payload
  StaticJsonDocument<512> doc;
  if (deviceId != "") {
    doc["device_id"] = deviceId;
  }
  doc["mac_address"] = WiFi.macAddress();
  doc["name"] = "ESP32 Built-in LED";
  doc["mode"] = "library";
  doc["firmware_version"] = "1.0.0";

  // Capability advertisement for dashboard auto-provisioning
  JsonArray pins = doc.createNestedArray("pins");
  JsonObject pinObj = pins.createNestedObject();
  pinObj["gpio_pin"] = ECONNECT_BUILTIN_LED_PIN;
  pinObj["mode"] = "OUTPUT";
  pinObj["function"] = "builtin_led";
  pinObj["label"] = "Built-in LED";

  String requestBody;
  serializeJson(doc, requestBody);

  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(requestBody);

  if (httpCode > 0) {
    Serial.printf("API Handshake HTTP Code: %d\n", httpCode);

    if (httpCode == 200) {
      String responseBody = http.getString();
      Serial.println("Response: " + responseBody);

      DynamicJsonDocument responseDoc(1024);
      DeserializationError error = deserializeJson(responseDoc, responseBody);

      if (!error) {
        String newDeviceId = responseDoc["device_id"].as<String>();
        if (newDeviceId != "" && newDeviceId != deviceId) {
          deviceId = newDeviceId;
          preferences.putString("device_id", deviceId);
          Serial.printf("Saved new device_id to NVS: %s\n", deviceId.c_str());
        }
        Serial.println("API Handshake completed successfully.");
      } else {
        Serial.println("Failed to parse JSON response");
      }
    } else {
      String responseBody = http.getString();
      Serial.printf("API Error Response: %s\n", responseBody.c_str());
      Serial.println(
          "BLOCKER: API Handshake failed due to HTTP status. Halting.");
      while (true) {
        delay(1000);
      }
    }
  } else {
    Serial.printf("API Handshake Failed, error: %s\n",
                  http.errorToString(httpCode).c_str());
    Serial.println(
        "BLOCKER: API host unreachable. Check API_BASE_URL. Halting.");
    while (true) {
      delay(1000);
    }
  }

  http.end();
}

void setupMQTT() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
}

void reconnectMQTT() {
  // Loop until we're reconnected
  while (!mqttClient.connected()) {
    Serial.print("Attempting MQTT connection...");

    // Create a random client ID
    String clientId = "ESP32C3Client-";
    clientId += String(random(0xffff), HEX);

    // Attempt to connect
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println("connected");

      // Subscribe to command topic
      String commandTopic = String("econnect/") + MQTT_NAMESPACE + "/device/" +
                            deviceId + "/command";
      mqttClient.subscribe(commandTopic.c_str());
      Serial.printf("Subscribed to: %s\n", commandTopic.c_str());

      // Publish initial state
      publishState(true);
      lastHeartbeatAt = millis();

    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" try again in 5 seconds");

      delay(5000);
    }
  }
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  Serial.print("MQTT message received on topic: ");
  Serial.println(topic);

  // Convert payload to String
  String message = "";
  for (int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print("Payload: ");
  Serial.println(message);

  // Parse command JSON
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, message);

  if (error) {
    Serial.println("Failed to parse command JSON");
    return;
  }

  String kind = doc["kind"] | "";

  if (kind == "action") {
    int pin = doc["pin"] | -1;
    int value = doc["value"] | -1;

    if (isBuiltinLedCommand(pin) && value != -1) {
      Serial.printf("Applying command to GPIO %d: value %d\n", pin, value);

      pinState = (value == 1);
      applyBuiltinLed(pinState);

      // Publish state back
      publishState(true);
    } else {
      Serial.println("Command pin does not match the built-in LED pin, ignoring hardware change.");
    }
  }
}

void publishState(bool applied) {
  String stateTopic =
      String("econnect/") + MQTT_NAMESPACE + "/device/" + deviceId + "/state";

  StaticJsonDocument<128> doc;
  doc["kind"] = "state";
  doc["pin"] = ECONNECT_BUILTIN_LED_PIN;
  doc["value"] = pinState ? 1 : 0;
  doc["applied"] = applied;

  String payload;
  serializeJson(doc, payload);

  if (mqttClient.publish(stateTopic.c_str(), payload.c_str())) {
    Serial.println("Successfully published state: " + payload);
    Serial.println("Topic: " + stateTopic);
  } else {
    Serial.println("Failed to publish state");
  }
}
