#include <Arduino.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <Wire.h>

#if defined(ESP8266)
#include <ESP8266WiFi.h>
#else
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
constexpr unsigned long HANDSHAKE_ACK_TIMEOUT_MS = 5000;
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

struct WifiTarget {
  bool found;
  int32_t channel;
  int32_t rssi;
  wifi_auth_mode_t authMode;
  uint8_t bssid[6];
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
unsigned long lastReconnectAttemptAt = 0;

bool connectToWiFi();
bool performSecureHandshake();
void setupMQTT();
void reconnectMQTT();
void mqttCallback(char *topic, byte *payload, unsigned int length);
void publishState(bool applied);
String commandTopic();
String registerTopic();
String registerAckTopic();
void subscribeCommandTopic();
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
const char *authModeName(wifi_auth_mode_t authMode);
WifiTarget scanWifiTarget();
void logVisibleWifiTargets(const WifiTarget &target);
void formatBssid(const uint8_t *bssid, char *buffer, size_t bufferSize);
void handleWiFiEvent(arduino_event_id_t event, arduino_event_info_t info);

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println("\n--- Starting E-Connect Server-Built Firmware ---");
  WiFi.onEvent(handleWiFiEvent);
  WiFi.setAutoReconnect(true);
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);

  initializePinStates();
  initializeI2CBus();

  while (!connectToWiFi()) {
    Serial.println("Wi-Fi provisioning failed. Retrying...");
    delay(HANDSHAKE_RETRY_DELAY_MS);
  }

  setupMQTT();

  while (!performSecureHandshake()) {
    Serial.println("Secure handshake failed. Retrying...");
    delay(HANDSHAKE_RETRY_DELAY_MS);
  }
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

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);
  WiFi.disconnect(false, true);
  delay(250);

  const WifiTarget target = scanWifiTarget();
  logVisibleWifiTargets(target);

  Serial.printf("Connecting to Wi-Fi SSID: %s ", WIFI_SSID);
  if (target.found) {
    char bssidBuffer[18];
    formatBssid(target.bssid, bssidBuffer, sizeof(bssidBuffer));
    Serial.printf(
        "(locked channel=%d bssid=%s auth=%s rssi=%d) ",
        target.channel,
        bssidBuffer,
        authModeName(target.authMode),
        target.rssi);
    WiFi.begin(WIFI_SSID, WIFI_PASS, target.channel, target.bssid, true);
  } else {
    Serial.print("(broadcast lookup) ");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }

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
  Serial.printf("Wi-Fi status code: %d\n", static_cast<int>(WiFi.status()));
  return false;
}

const char *authModeName(wifi_auth_mode_t authMode) {
  switch (authMode) {
    case WIFI_AUTH_OPEN:
      return "OPEN";
    case WIFI_AUTH_WEP:
      return "WEP";
    case WIFI_AUTH_WPA_PSK:
      return "WPA_PSK";
    case WIFI_AUTH_WPA2_PSK:
      return "WPA2_PSK";
    case WIFI_AUTH_WPA_WPA2_PSK:
      return "WPA_WPA2_PSK";
    case WIFI_AUTH_WPA3_PSK:
      return "WPA3_PSK";
    case WIFI_AUTH_WPA2_WPA3_PSK:
      return "WPA2_WPA3_PSK";
    default:
      return "UNKNOWN";
  }
}

WifiTarget scanWifiTarget() {
  WifiTarget target = {
      false,
      0,
      -127,
      WIFI_AUTH_OPEN,
      {0, 0, 0, 0, 0, 0},
  };
  const int networkCount = WiFi.scanNetworks(false, true);
  if (networkCount <= 0) {
    Serial.printf("Visible Wi-Fi networks: %d\n", networkCount);
    return target;
  }

  for (int index = 0; index < networkCount; index++) {
    const String ssid = WiFi.SSID(index);
    if (!ssid.equals(WIFI_SSID)) {
      continue;
    }

    const int32_t rssi = WiFi.RSSI(index);
    if (target.found && rssi <= target.rssi) {
      continue;
    }

    target.found = true;
    target.channel = WiFi.channel(index);
    target.rssi = rssi;
    target.authMode = WiFi.encryptionType(index);
    memcpy(target.bssid, WiFi.BSSID(index), sizeof(target.bssid));
  }

  return target;
}

void logVisibleWifiTargets(const WifiTarget &target) {
  const int networkCount = WiFi.scanComplete();
  Serial.printf("Visible Wi-Fi networks: %d\n", networkCount);
  if (networkCount <= 0) {
    return;
  }

  if (!target.found) {
    return;
  }

  char bssidBuffer[18];
  formatBssid(target.bssid, bssidBuffer, sizeof(bssidBuffer));
  Serial.printf(
      "Matched AP: ssid=%s channel=%d rssi=%d auth=%s bssid=%s\n",
      WIFI_SSID,
      target.channel,
      target.rssi,
      authModeName(target.authMode),
      bssidBuffer);
}

void formatBssid(const uint8_t *bssid, char *buffer, size_t bufferSize) {
  snprintf(
      buffer,
      bufferSize,
      "%02X:%02X:%02X:%02X:%02X:%02X",
      bssid[0],
      bssid[1],
      bssid[2],
      bssid[3],
      bssid[4],
      bssid[5]);
}

void handleWiFiEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_CONNECTED) {
    Serial.println("Wi-Fi event: STA connected");
    return;
  }

  if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
    Serial.printf(
        "Wi-Fi event: got IP %s\n",
        IPAddress(info.got_ip.ip_info.ip.addr).toString().c_str());
    return;
  }

  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
    const wifi_err_reason_t reason =
        static_cast<wifi_err_reason_t>(info.wifi_sta_disconnected.reason);
    Serial.printf(
        "Wi-Fi disconnect reason: %u (%s)\n",
        info.wifi_sta_disconnected.reason,
        WiFi.disconnectReasonName(reason));
  }
}

bool performSecureHandshake() {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  if (strlen(MQTT_BROKER) == 0 || strlen(ECONNECT_PROJECT_ID) == 0 ||
      strlen(ECONNECT_SECRET_KEY) == 0) {
    Serial.println("BLOCKER: Missing secure pairing metadata in firmware.");
    return false;
  }

  if (!mqttClient.connected()) {
    reconnectMQTT();
  }

  if (!mqttClient.connected()) {
    return false;
  }

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
  const String topic = registerTopic();
  Serial.printf("Publishing secure handshake to MQTT topic: %s\n", topic.c_str());

  if (!mqttClient.publish(topic.c_str(), requestBody.c_str())) {
    Serial.println("Failed to publish secure handshake over MQTT.");
    return false;
  }

  const unsigned long startedAt = millis();
  while (!securePairingVerified &&
         millis() - startedAt < HANDSHAKE_ACK_TIMEOUT_MS) {
    mqttClient.loop();
    delay(10);
  }

  if (!securePairingVerified) {
    Serial.println("Timed out waiting for MQTT pairing acknowledgement.");
  }

  return securePairingVerified;
}

void setupMQTT() {
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(1024);
}

String commandTopic() {
  return String("econnect/") + MQTT_NAMESPACE + "/device/" + deviceId + "/command";
}

String registerTopic() {
  return String("econnect/") + MQTT_NAMESPACE + "/device/" + deviceId + "/register";
}

String registerAckTopic() {
  return String("econnect/") + MQTT_NAMESPACE + "/device/" + deviceId +
         "/register/ack";
}

void subscribeCommandTopic() {
  const String topic = commandTopic();
  mqttClient.subscribe(topic.c_str());
  Serial.printf("Subscribed to command topic: %s\n", topic.c_str());
}

void reconnectMQTT() {
  if (mqttClient.connected()) return;
  
  unsigned long now = millis();
  if (now - lastReconnectAttemptAt < HANDSHAKE_RETRY_DELAY_MS) return;
  
  lastReconnectAttemptAt = now;

  String clientId = "econnect-";
  clientId += deviceId;
  clientId += "-";
  clientId += String(random(0xffff), HEX);

  Serial.print("Attempting MQTT connection...");
  if (mqttClient.connect(clientId.c_str())) {
    Serial.println(" connected");
    const String ackTopic = registerAckTopic();
    mqttClient.subscribe(ackTopic.c_str());
    Serial.printf("Subscribed to pairing ack topic: %s\n", ackTopic.c_str());
    if (securePairingVerified) {
      subscribeCommandTopic();
      publishState(true);
      lastHeartbeatAt = millis();
    }
  } else {
    Serial.print(" failed, rc=");
    Serial.println(mqttClient.state());
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
    Serial.println("Failed to parse MQTT JSON.");
    return;
  }

  const String incomingTopic = String(topic);
  if (incomingTopic == registerAckTopic()) {
    const bool verified = doc["secret_verified"] | false;
    if (!verified || String(doc["status"] | "") != "ok") {
      Serial.printf(
          "Secure MQTT handshake rejected: %s\n",
          String(doc["message"] | "Unknown error").c_str());
      return;
    }

    const String assignedDeviceId = doc["device_id"] | deviceId;
    if (assignedDeviceId.length() > 0) {
      deviceId = assignedDeviceId;
    }

    securePairingVerified = true;
    subscribeCommandTopic();
    publishState(true);
    lastHeartbeatAt = millis();
    Serial.printf("Secure MQTT handshake complete. Device id: %s\n", deviceId.c_str());
    return;
  }

  if (!securePairingVerified) {
    Serial.println("Ignoring MQTT command before secure pairing completes.");
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
