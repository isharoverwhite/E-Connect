#include <Arduino.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <Wire.h>

#if defined(ESP8266)
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#else
#include <HTTPClient.h>
#include <WiFi.h>
#endif

#if __has_include("generated_firmware_config.h")
#include "generated_firmware_config.h"
#endif
#include "secrets.h"

#ifndef ECONNECT_HAS_PIN_CONFIGS
struct EConnectPinConfig {
  int gpio;
  const char *mode;
  const char *function_name;
  const char *label;
  int active_level;
};

static const EConnectPinConfig ECONNECT_PIN_CONFIGS[] = {
    {ECONNECT_BUILTIN_LED_PIN, "OUTPUT", "builtin_led", "Built-in LED", 1},
};
#endif

constexpr unsigned long HEARTBEAT_INTERVAL_MS = 30000;
constexpr unsigned long HANDSHAKE_RETRY_DELAY_MS = 5000;
constexpr int WIFI_RETRY_LIMIT = 40;

struct PinRuntimeState {
  int gpio;
  const char *mode;
  const char *functionName;
  const char *label;
  int activeLevel;
  int value;
  int brightness;
};

constexpr size_t PIN_CONFIG_COUNT =
    sizeof(ECONNECT_PIN_CONFIGS) / sizeof(ECONNECT_PIN_CONFIGS[0]);
constexpr size_t PIN_STATE_CAPACITY = PIN_CONFIG_COUNT > 0 ? PIN_CONFIG_COUNT : 1;

WiFiClient espClient;
PubSubClient mqttClient(espClient);
PinRuntimeState pinStates[PIN_STATE_CAPACITY];

String deviceId = ECONNECT_DEVICE_ID;
unsigned long lastHeartbeatAt = 0;
bool securePairingVerified = false;

bool connectToWiFi();
bool performSecureHandshake();
void setupMQTT();
void reconnectMQTT();
void mqttCallback(char *topic, byte *payload, unsigned int length);
void publishState(bool applied);
void initializePinStates();
void initializeI2CBus();
int findPinIndex(int gpio);
bool modeEquals(const char *left, const char *right);
bool isOutputMode(const char *mode);
bool isPwmMode(const char *mode);
bool isReadableMode(const char *mode);
int readRuntimeValue(PinRuntimeState &pinState);
int readRuntimeBrightness(PinRuntimeState &pinState);
bool applyCommandToPin(PinRuntimeState &pinState, int value, int brightness);
int resolvePhysicalLevel(const PinRuntimeState &pinState, int logicalValue);

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n--- Starting E-Connect Server-Built Firmware ---");

  initializePinStates();
  initializeI2CBus();

  while (!connectToWiFi()) {
    Serial.println("Wi-Fi provisioning failed. Retrying...");
    delay(HANDSHAKE_RETRY_DELAY_MS);
  }

  while (!performSecureHandshake()) {
    Serial.println("Secure handshake failed. Retrying...");
    delay(HANDSHAKE_RETRY_DELAY_MS);
  }

  setupMQTT();
}

void loop() {
  if (!securePairingVerified) {
    securePairingVerified = performSecureHandshake();
    delay(HANDSHAKE_RETRY_DELAY_MS);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (!connectToWiFi()) {
      delay(HANDSHAKE_RETRY_DELAY_MS);
      return;
    }
  }

  if (!mqttClient.connected()) {
    reconnectMQTT();
  }

  mqttClient.loop();

  if (millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    publishState(false);
    lastHeartbeatAt = millis();
  }

  delay(10);
}

bool connectToWiFi() {
  if (strlen(WIFI_SSID) == 0) {
    Serial.println("BLOCKER: WIFI_SSID is empty. Build firmware from the server before flashing.");
    return false;
  }

  Serial.printf("Connecting to Wi-Fi SSID: %s ", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < WIFI_RETRY_LIMIT) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println(" connected");
    Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
    return true;
  }

  Serial.println(" failed");
  return false;
}

bool performSecureHandshake() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  if (strlen(API_BASE_URL) == 0 || strlen(ECONNECT_PROJECT_ID) == 0 ||
      strlen(ECONNECT_SECRET_KEY) == 0) {
    Serial.println("BLOCKER: Missing secure pairing metadata in firmware.");
    return false;
  }

  HTTPClient http;
  String url = String(API_BASE_URL) + "/config";
  WiFiClient httpTransport;

  Serial.printf("Starting secure handshake at: %s\n", url.c_str());

#if defined(ESP8266)
  http.begin(httpTransport, url);
#else
  http.begin(url);
#endif
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<3072> doc;
  doc["device_id"] = deviceId;
  doc["project_id"] = ECONNECT_PROJECT_ID;
  doc["secret_key"] = ECONNECT_SECRET_KEY;
  doc["mac_address"] = WiFi.macAddress();
  doc["ip_address"] = WiFi.localIP().toString();
  doc["name"] = ECONNECT_DEVICE_NAME;
  doc["mode"] = "library";
  doc["firmware_version"] = ECONNECT_FIRMWARE_VERSION;

  JsonArray pins = doc.createNestedArray("pins");
  for (size_t index = 0; index < PIN_CONFIG_COUNT; index++) {
    JsonObject pin = pins.createNestedObject();
    pin["gpio_pin"] = ECONNECT_PIN_CONFIGS[index].gpio;
    pin["mode"] = ECONNECT_PIN_CONFIGS[index].mode;
    pin["function"] = ECONNECT_PIN_CONFIGS[index].function_name;
    pin["label"] = ECONNECT_PIN_CONFIGS[index].label;
    if (modeEquals(ECONNECT_PIN_CONFIGS[index].mode, "OUTPUT")) {
      JsonObject extraParams = pin.createNestedObject("extra_params");
      extraParams["active_level"] = ECONNECT_PIN_CONFIGS[index].active_level;
    }
  }

  String requestBody;
  serializeJson(doc, requestBody);

  const int httpCode = http.POST(requestBody);
  if (httpCode <= 0) {
    Serial.printf("Secure handshake failed: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }

  Serial.printf("Secure handshake HTTP code: %d\n", httpCode);
  if (httpCode != 200) {
    Serial.println(http.getString());
    http.end();
    return false;
  }

  DynamicJsonDocument responseDoc(2048);
  const String responseBody = http.getString();
  const DeserializationError error = deserializeJson(responseDoc, responseBody);
  http.end();

  if (error) {
    Serial.println("Failed to parse secure handshake response.");
    return false;
  }

  const bool verified = responseDoc["secret_verified"] | false;
  if (!verified) {
    Serial.println("Server rejected secure handshake: secret mismatch.");
    return false;
  }

  const String assignedDeviceId = responseDoc["device_id"] | deviceId;
  if (assignedDeviceId.length() > 0) {
    deviceId = assignedDeviceId;
  }

  securePairingVerified = true;
  Serial.printf("Secure handshake complete. Device id: %s\n", deviceId.c_str());
  return true;
}

void setupMQTT() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
}

void reconnectMQTT() {
  while (!mqttClient.connected()) {
    String clientId = "econnect-";
    clientId += deviceId;
    clientId += "-";
    clientId += String(random(0xffff), HEX);

    Serial.print("Attempting MQTT connection...");
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println(" connected");
      const String commandTopic = String("econnect/") + MQTT_NAMESPACE + "/device/" +
                                  deviceId + "/command";
      mqttClient.subscribe(commandTopic.c_str());
      Serial.printf("Subscribed to: %s\n", commandTopic.c_str());
      publishState(true);
      lastHeartbeatAt = millis();
      return;
    }

    Serial.print(" failed, rc=");
    Serial.println(mqttClient.state());
    delay(HANDSHAKE_RETRY_DELAY_MS);
  }
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  Serial.print("MQTT message received on topic: ");
  Serial.println(topic);

  String message = "";
  for (unsigned int index = 0; index < length; index++) {
    message += static_cast<char>(payload[index]);
  }

  StaticJsonDocument<512> doc;
  const DeserializationError error = deserializeJson(doc, message);
  if (error) {
    Serial.println("Failed to parse command JSON.");
    return;
  }

  if (String(doc["kind"] | "") != "action") {
    return;
  }

  const int targetPin = doc["pin"] | -1;
  const int value = doc["value"] | -1;
  const int brightness = doc["brightness"] | -1;

  const int pinIndex = findPinIndex(targetPin);
  if (pinIndex < 0) {
    Serial.printf("Ignoring command for unmapped GPIO %d\n", targetPin);
    publishState(false);
    return;
  }

  const bool applied = applyCommandToPin(pinStates[pinIndex], value, brightness);
  publishState(applied);
}

void initializePinStates() {
  for (size_t index = 0; index < PIN_CONFIG_COUNT; index++) {
    pinStates[index].gpio = ECONNECT_PIN_CONFIGS[index].gpio;
    pinStates[index].mode = ECONNECT_PIN_CONFIGS[index].mode;
    pinStates[index].functionName = ECONNECT_PIN_CONFIGS[index].function_name;
    pinStates[index].label = ECONNECT_PIN_CONFIGS[index].label;
    pinStates[index].activeLevel = ECONNECT_PIN_CONFIGS[index].active_level == 0 ? 0 : 1;
    pinStates[index].value = 0;
    pinStates[index].brightness = 0;

    if (isOutputMode(pinStates[index].mode) || isPwmMode(pinStates[index].mode)) {
      pinMode(pinStates[index].gpio, OUTPUT);
      digitalWrite(
          pinStates[index].gpio,
          resolvePhysicalLevel(pinStates[index], 0) == 1 ? HIGH : LOW);
    } else if (isReadableMode(pinStates[index].mode)) {
      pinMode(pinStates[index].gpio, INPUT);
    }
  }
}

void initializeI2CBus() {
  int sdaPin = -1;
  int sclPin = -1;

  for (size_t index = 0; index < PIN_CONFIG_COUNT; index++) {
    if (!modeEquals(pinStates[index].mode, "I2C")) {
      continue;
    }

    if (sdaPin < 0) {
      sdaPin = pinStates[index].gpio;
    } else if (sclPin < 0) {
      sclPin = pinStates[index].gpio;
      break;
    }
  }

  if (sdaPin >= 0 && sclPin >= 0) {
    Wire.begin(sdaPin, sclPin);
    Serial.printf("Initialized I2C bus on SDA=%d SCL=%d\n", sdaPin, sclPin);
  }
}

int findPinIndex(int gpio) {
  for (size_t index = 0; index < PIN_CONFIG_COUNT; index++) {
    if (pinStates[index].gpio == gpio) {
      return static_cast<int>(index);
    }
  }

  return -1;
}

bool modeEquals(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

bool isOutputMode(const char *mode) {
  return modeEquals(mode, "OUTPUT");
}

bool isPwmMode(const char *mode) {
  return modeEquals(mode, "PWM");
}

bool isReadableMode(const char *mode) {
  return modeEquals(mode, "INPUT") || modeEquals(mode, "ADC") ||
         modeEquals(mode, "I2C");
}

int readRuntimeValue(PinRuntimeState &pinState) {
  if (isPwmMode(pinState.mode)) {
    pinState.value = pinState.brightness > 0 ? 1 : 0;
    return pinState.value;
  }

  if (isOutputMode(pinState.mode)) {
    return pinState.value;
  }

  if (modeEquals(pinState.mode, "ADC")) {
    pinState.value = analogRead(pinState.gpio);
    return pinState.value;
  }

  if (modeEquals(pinState.mode, "INPUT") || modeEquals(pinState.mode, "I2C")) {
    pinState.value = digitalRead(pinState.gpio);
    return pinState.value;
  }

  return pinState.value;
}

int readRuntimeBrightness(PinRuntimeState &pinState) {
  return isPwmMode(pinState.mode) ? pinState.brightness : 0;
}

bool applyCommandToPin(PinRuntimeState &pinState, int value, int brightness) {
  if (isOutputMode(pinState.mode) && value != -1) {
    pinState.value = value == 0 ? 0 : 1;
    digitalWrite(
        pinState.gpio,
        resolvePhysicalLevel(pinState, pinState.value) == 1 ? HIGH : LOW);
    return true;
  }

  if (isPwmMode(pinState.mode)) {
    int nextBrightness = brightness;
    if (nextBrightness < 0 && value != -1) {
      nextBrightness = value == 0 ? 0 : 100;
    }

    if (nextBrightness < 0) {
      return false;
    }

    nextBrightness = constrain(nextBrightness, 0, 100);
    pinState.brightness = nextBrightness;
    pinState.value = nextBrightness > 0 ? 1 : 0;
    analogWrite(pinState.gpio, map(nextBrightness, 0, 100, 0, 255));
    return true;
  }

  return false;
}

int resolvePhysicalLevel(const PinRuntimeState &pinState, int logicalValue) {
  const int normalizedLogical = logicalValue == 0 ? 0 : 1;
  const int activeLevel = pinState.activeLevel == 0 ? 0 : 1;
  return normalizedLogical == 1 ? activeLevel : (activeLevel == 1 ? 0 : 1);
}

void publishState(bool applied) {
  if (!mqttClient.connected()) {
    return;
  }

  const String stateTopic =
      String("econnect/") + MQTT_NAMESPACE + "/device/" + deviceId + "/state";

  StaticJsonDocument<3072> doc;
  doc["kind"] = "state";
  doc["device_id"] = deviceId;
  doc["applied"] = applied;
  doc["firmware_version"] = ECONNECT_FIRMWARE_VERSION;
  doc["ip_address"] = WiFi.localIP().toString();

  JsonArray pins = doc.createNestedArray("pins");
  for (size_t index = 0; index < PIN_CONFIG_COUNT; index++) {
    PinRuntimeState &pinState = pinStates[index];
    JsonObject pin = pins.createNestedObject();
    pin["pin"] = pinState.gpio;
    pin["mode"] = pinState.mode;
    pin["label"] = pinState.label;
    pin["value"] = readRuntimeValue(pinState);
    if (isOutputMode(pinState.mode)) {
      pin["active_level"] = pinState.activeLevel;
    }

    const int brightness = readRuntimeBrightness(pinState);
    if (brightness > 0 || isPwmMode(pinState.mode)) {
      pin["brightness"] = brightness;
    }
  }

  if (PIN_CONFIG_COUNT == 1) {
    PinRuntimeState &pinState = pinStates[0];
    doc["pin"] = pinState.gpio;
    doc["value"] = readRuntimeValue(pinState);
    if (isPwmMode(pinState.mode)) {
      doc["brightness"] = readRuntimeBrightness(pinState);
    }
  }

  String payload;
  serializeJson(doc, payload);

  if (mqttClient.publish(stateTopic.c_str(), payload.c_str())) {
    Serial.println("Published state payload:");
    Serial.println(payload);
  } else {
    Serial.println("Failed to publish state payload.");
  }
}
