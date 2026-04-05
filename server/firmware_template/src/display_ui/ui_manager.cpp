/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

#ifdef BOARD_JC3827W543

#include <Arduino.h>
#include <ArduinoJson.h>
#include <LovyanGFX.hpp>
#include <PubSubClient.h>
#include <TAMC_GT911.h>
#include <WiFi.h>
#include <algorithm>
#include <esp32-hal-ledc.h>
#if __has_include(<esp_arduino_version.h>)
#include <esp_arduino_version.h>
#endif

#include "ui_manager.h"

#if __has_include("generated_firmware_config.h")
#include "generated_firmware_config.h"
#endif

#include <lgfx/v1/panel/Panel_NV3041A.hpp>

#ifndef ECONNECT_PORTABLE_DASHBOARD_JSON
#define ECONNECT_PORTABLE_DASHBOARD_JSON "{}"
#endif

#ifndef MQTT_NAMESPACE
#define MQTT_NAMESPACE "local"
#endif

namespace {

constexpr int kBacklightPin = 1;
constexpr uint32_t kBacklightFrequencyHz = 5000;
constexpr uint8_t kBacklightResolutionBits = 8;
constexpr uint8_t kBacklightPwmChannel = 7;
constexpr uint8_t kDefaultBacklightBrightness = 255;
constexpr int kTouchInterruptPin = 3;
constexpr int kTouchResetPin = 38;
constexpr int kTouchSclPin = 4;
constexpr int kTouchSdaPin = 8;

constexpr int kScreenWidth = 480;
constexpr int kScreenHeight = 272;
constexpr int kSidebarWidth = 72;
constexpr int kWifiListTop = 72;
constexpr int kWifiListRowHeight = 30;
constexpr int kWifiListVisibleRows = 6;
constexpr int kMaxWifiNetworks = 10;
constexpr int kMaxDashboardCards = 8;
constexpr int kMaxDashboardPins = 8;
constexpr unsigned long kOfflineTimeoutMs = 30000;
constexpr unsigned long kWifiScanKickoffDelayMs = 120;

constexpr uint16_t rgb565(uint8_t red, uint8_t green, uint8_t blue) {
  return static_cast<uint16_t>(((red & 0xF8) << 8) | ((green & 0xFC) << 3) |
                               (blue >> 3));
}

constexpr uint16_t kColorCanvasBg = rgb565(12, 32, 48);
constexpr uint16_t kColorDashboardBg = rgb565(13, 16, 22);
constexpr uint16_t kColorSidebarBg = rgb565(17, 19, 26);
constexpr uint16_t kColorSidebarAccent = rgb565(34, 211, 238);
constexpr uint16_t kColorSurface = rgb565(23, 49, 63);
constexpr uint16_t kColorSurfaceAlt = rgb565(17, 37, 54);
constexpr uint16_t kColorSurfaceMuted = rgb565(30, 41, 59);
constexpr uint16_t kColorAccent = rgb565(34, 211, 238);
constexpr uint16_t kColorAccentSoft = rgb565(103, 232, 249);
constexpr uint16_t kColorAccentMuted = rgb565(21, 94, 117);
constexpr uint16_t kColorDanger = rgb565(251, 113, 133);
constexpr uint16_t kColorSuccess = rgb565(52, 211, 153);
constexpr uint16_t kColorOutline = rgb565(71, 85, 105);
constexpr uint16_t kColorTextSecondary = rgb565(203, 213, 225);
constexpr uint16_t kColorTextMuted = rgb565(148, 163, 184);
constexpr uint16_t kColorTextFaint = rgb565(100, 116, 139);

const lgfx::IFont *const kFontTitle = &fonts::DejaVu18;
const lgfx::IFont *const kFontBody = &fonts::DejaVu12;
const lgfx::IFont *const kFontCaption = &fonts::DejaVu9;

enum class ScreenId {
  WifiScan,
  Keyboard,
  Pairing,
  Dashboard,
};

struct WifiNetworkEntry {
  String ssid;
  int32_t rssi = -127;
  bool secure = true;
};

struct DashboardPinState {
  bool used = false;
  int gpio = -1;
  String mode;
  String functionName;
  String label;
  int value = 0;
  int brightness = 0;
  int pwmMin = 0;
  int pwmMax = 255;
};

struct DashboardCardState {
  bool used = false;
  String deviceId;
  String name;
  String roomName;
  String mode;
  String provider;
  int x = 0;
  int y = 0;
  int w = 160;
  int h = 100;
  size_t pinCount = 0;
  DashboardPinState pins[kMaxDashboardPins];
  bool online = false;
  unsigned long lastSeenAt = 0;
};

struct PendingDashboardCommand {
  bool active = false;
  String deviceId;
  int pin = -1;
  int value = 0;
  int brightness = -1;
};

struct TouchReleaseEvent {
  bool available = false;
  uint16_t x = 0;
  uint16_t y = 0;
};

class LGFX : public lgfx::LGFX_Device {
  lgfx::Panel_NV3041A _panel_instance;
  lgfx::Bus_SPI _bus_instance;

public:
  LGFX() {
    {
      auto cfg = _bus_instance.config();
      cfg.spi_host = SPI3_HOST;
      cfg.spi_mode = 1;
      cfg.freq_write = 20000000UL;
      cfg.freq_read = 10000000UL;
      cfg.spi_3wire = true;
      cfg.use_lock = true;
      cfg.dma_channel = SPI_DMA_CH_AUTO;
      cfg.pin_sclk = GPIO_NUM_47;
      cfg.pin_io0 = GPIO_NUM_21;
      cfg.pin_io1 = GPIO_NUM_48;
      cfg.pin_io2 = GPIO_NUM_40;
      cfg.pin_io3 = GPIO_NUM_39;
      _bus_instance.config(cfg);
      _panel_instance.setBus(&_bus_instance);
    }

    {
      auto cfg = _panel_instance.config();
      cfg.pin_cs = GPIO_NUM_45;
      cfg.pin_rst = -1;
      cfg.pin_busy = -1;
      cfg.panel_width = kScreenWidth;
      cfg.panel_height = kScreenHeight;
      cfg.memory_width = kScreenWidth;
      cfg.memory_height = kScreenHeight;
      cfg.offset_x = 0;
      cfg.offset_y = 0;
      cfg.offset_rotation = 0;
      cfg.dummy_read_pixel = 8;
      cfg.dummy_read_bits = 1;
      cfg.readable = false;
      cfg.invert = true;
      cfg.rgb_order = true;
      cfg.dlen_16bit = false;
      cfg.bus_shared = true;
      _panel_instance.config(cfg);
    }

    setPanel(&_panel_instance);
  }
};

static LGFX lcd;
static TAMC_GT911 touch(kTouchSdaPin, kTouchSclPin, kTouchInterruptPin,
                        kTouchResetPin, kScreenWidth, kScreenHeight);

bool g_backlightInitialized = false;
bool g_backlightPwmAttached = false;
uint8_t g_backlightBrightness = kDefaultBacklightBrightness;
uint8_t g_lastNonZeroBacklightBrightness = kDefaultBacklightBrightness;

ScreenId g_screen = ScreenId::WifiScan;
bool g_screenDirty = true;
bool g_wifiConfigured = false;
bool g_pairingComplete = false;
bool g_touchHeld = false;
bool g_touchInitialized = false;
uint16_t g_lastTouchX = 0;
uint16_t g_lastTouchY = 0;
unsigned long g_lastPairingAnimationAt = 0;
uint8_t g_pairingDots = 0;

String g_wifiSsid;
String g_wifiPassword;
String g_keyboardTargetSsid;
String g_keyboardInput;
bool g_keyboardUppercase = false;
bool g_keyboardSymbols = false;

WifiNetworkEntry g_wifiNetworks[kMaxWifiNetworks];
size_t g_wifiNetworkCount = 0;
bool g_wifiScanRequested = false;
bool g_wifiScanInProgress = false;
unsigned long g_wifiScanRequestedAt = 0;

DashboardCardState g_cards[kMaxDashboardCards];
size_t g_cardCount = 0;
PendingDashboardCommand g_pendingCommand;

void initBacklightPwm() {
  if (g_backlightInitialized) {
    return;
  }

  pinMode(kBacklightPin, OUTPUT);
  digitalWrite(kBacklightPin, HIGH);

#if defined(ESP_ARDUINO_VERSION) &&                                            \
    ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  g_backlightPwmAttached = ledcAttach(kBacklightPin, kBacklightFrequencyHz,
                                      kBacklightResolutionBits);
#else
  ledcSetup(kBacklightPwmChannel, kBacklightFrequencyHz,
            kBacklightResolutionBits);
  ledcAttachPin(kBacklightPin, kBacklightPwmChannel);
  g_backlightPwmAttached = true;
#endif

  g_backlightInitialized = true;
}

void writeBacklightPwm(uint8_t brightness) {
  initBacklightPwm();

  if (!g_backlightPwmAttached) {
    digitalWrite(kBacklightPin, brightness > 0 ? HIGH : LOW);
    return;
  }

#if defined(ESP_ARDUINO_VERSION) &&                                            \
    ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  ledcWrite(kBacklightPin, brightness);
#else
  ledcWrite(kBacklightPwmChannel, brightness);
#endif
}

void setBacklightBrightness(uint8_t brightness) {
  g_backlightBrightness = brightness;
  if (brightness > 0) {
    g_lastNonZeroBacklightBrightness = brightness;
  }
  writeBacklightPwm(brightness);
}

void initTouchController() {
  if (g_touchInitialized) {
    return;
  }

  touch.begin();
  touch.setRotation(ROTATION_NORMAL);
  g_touchInitialized = true;
}

bool isInside(int x, int y, int left, int top, int width, int height) {
  return x >= left && x < left + width && y >= top && y < top + height;
}

struct Utf8Replacement {
  const char *source;
  const char *target;
};

constexpr Utf8Replacement kDisplayTextReplacements[] = {
    {"\xC4\x90", "D"},      {"\xC4\x91", "d"},      {"\xC3\x80", "A"},
    {"\xC3\x81", "A"},      {"\xE1\xBA\xA2", "A"},  {"\xC3\x83", "A"},
    {"\xE1\xBA\xA0", "A"},  {"\xC3\x82", "A"},      {"\xE1\xBA\xA6", "A"},
    {"\xE1\xBA\xA4", "A"},  {"\xE1\xBA\xA8", "A"},  {"\xE1\xBA\xAA", "A"},
    {"\xE1\xBA\xAC", "A"},  {"\xC4\x82", "A"},      {"\xE1\xBA\xB0", "A"},
    {"\xE1\xBA\xAE", "A"},  {"\xE1\xBA\xB2", "A"},  {"\xE1\xBA\xB4", "A"},
    {"\xE1\xBA\xB6", "A"},  {"\xC3\xA0", "a"},      {"\xC3\xA1", "a"},
    {"\xE1\xBA\xA3", "a"},  {"\xC3\xA3", "a"},      {"\xE1\xBA\xA1", "a"},
    {"\xC3\xA2", "a"},      {"\xE1\xBA\xA7", "a"},  {"\xE1\xBA\xA5", "a"},
    {"\xE1\xBA\xA9", "a"},  {"\xE1\xBA\xAB", "a"},  {"\xE1\xBA\xAD", "a"},
    {"\xC4\x83", "a"},      {"\xE1\xBA\xB1", "a"},  {"\xE1\xBA\xAF", "a"},
    {"\xE1\xBA\xB3", "a"},  {"\xE1\xBA\xB5", "a"},  {"\xE1\xBA\xB7", "a"},
    {"\xC3\x88", "E"},      {"\xC3\x89", "E"},      {"\xE1\xBA\xBA", "E"},
    {"\xE1\xBA\xBC", "E"},  {"\xE1\xBA\xB8", "E"},  {"\xC3\x8A", "E"},
    {"\xE1\xBB\x80", "E"},  {"\xE1\xBA\xBE", "E"},  {"\xE1\xBB\x82", "E"},
    {"\xE1\xBB\x84", "E"},  {"\xE1\xBB\x86", "E"},  {"\xC3\xA8", "e"},
    {"\xC3\xA9", "e"},      {"\xE1\xBA\xBB", "e"},  {"\xE1\xBA\xBD", "e"},
    {"\xE1\xBA\xB9", "e"},  {"\xC3\xAA", "e"},      {"\xE1\xBB\x81", "e"},
    {"\xE1\xBA\xBF", "e"},  {"\xE1\xBB\x83", "e"},  {"\xE1\xBB\x85", "e"},
    {"\xE1\xBB\x87", "e"},  {"\xC3\x8C", "I"},      {"\xC3\x8D", "I"},
    {"\xE1\xBB\x88", "I"},  {"\xC4\xA8", "I"},      {"\xE1\xBB\x8A", "I"},
    {"\xC3\xAC", "i"},      {"\xC3\xAD", "i"},      {"\xE1\xBB\x89", "i"},
    {"\xC4\xA9", "i"},      {"\xE1\xBB\x8B", "i"},  {"\xC3\x92", "O"},
    {"\xC3\x93", "O"},      {"\xE1\xBB\x8E", "O"},  {"\xC3\x95", "O"},
    {"\xE1\xBB\x8C", "O"},  {"\xC3\x94", "O"},      {"\xE1\xBB\x92", "O"},
    {"\xE1\xBB\x90", "O"},  {"\xE1\xBB\x94", "O"},  {"\xE1\xBB\x96", "O"},
    {"\xE1\xBB\x98", "O"},  {"\xC6\xA0", "O"},      {"\xE1\xBB\x9C", "O"},
    {"\xE1\xBB\x9A", "O"},  {"\xE1\xBB\x9E", "O"},  {"\xE1\xBB\xA0", "O"},
    {"\xE1\xBB\xA2", "O"},  {"\xC3\xB2", "o"},      {"\xC3\xB3", "o"},
    {"\xE1\xBB\x8F", "o"},  {"\xC3\xB5", "o"},      {"\xE1\xBB\x8D", "o"},
    {"\xC3\xB4", "o"},      {"\xE1\xBB\x93", "o"},  {"\xE1\xBB\x91", "o"},
    {"\xE1\xBB\x95", "o"},  {"\xE1\xBB\x97", "o"},  {"\xE1\xBB\x99", "o"},
    {"\xC6\xA1", "o"},      {"\xE1\xBB\x9D", "o"},  {"\xE1\xBB\x9B", "o"},
    {"\xE1\xBB\x9F", "o"},  {"\xE1\xBB\xA1", "o"},  {"\xE1\xBB\xA3", "o"},
    {"\xC3\x99", "U"},      {"\xC3\x9A", "U"},      {"\xE1\xBB\xA6", "U"},
    {"\xC5\xA8", "U"},      {"\xE1\xBB\xA4", "U"},  {"\xC6\xAF", "U"},
    {"\xE1\xBB\xAA", "U"},  {"\xE1\xBB\xA8", "U"},  {"\xE1\xBB\xAC", "U"},
    {"\xE1\xBB\xAE", "U"},  {"\xE1\xBB\xB0", "U"},  {"\xC3\xB9", "u"},
    {"\xC3\xBA", "u"},      {"\xE1\xBB\xA7", "u"},  {"\xC5\xA9", "u"},
    {"\xE1\xBB\xA5", "u"},  {"\xC6\xB0", "u"},      {"\xE1\xBB\xAB", "u"},
    {"\xE1\xBB\xA9", "u"},  {"\xE1\xBB\xAD", "u"},  {"\xE1\xBB\xAF", "u"},
    {"\xE1\xBB\xB1", "u"},  {"\xE1\xBB\xB2", "Y"},  {"\xC3\x9D", "Y"},
    {"\xE1\xBB\xB6", "Y"},  {"\xE1\xBB\xB8", "Y"},  {"\xE1\xBB\xB4", "Y"},
    {"\xE1\xBB\xB3", "y"},  {"\xC3\xBD", "y"},      {"\xE1\xBB\xB7", "y"},
    {"\xE1\xBB\xB9", "y"},  {"\xE1\xBB\xB5", "y"},  {"\xE2\x80\x93", "-"},
    {"\xE2\x80\x94", "-"},  {"\xE2\x80\x98", "'"},  {"\xE2\x80\x99", "'"},
    {"\xE2\x80\x9C", "\""}, {"\xE2\x80\x9D", "\""},
};

String sanitizeDisplayText(const String &rawValue) {
  String value = rawValue;
  for (const Utf8Replacement &replacement : kDisplayTextReplacements) {
    value.replace(replacement.source, replacement.target);
  }

  String ascii;
  ascii.reserve(value.length());
  bool previousWasSpace = false;

  for (size_t index = 0; index < value.length(); index++) {
    const uint8_t ch = static_cast<uint8_t>(value[index]);
    const bool isAsciiVisible = ch >= 32 && ch <= 126;
    const bool isWhitespace =
        ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';

    if (!isAsciiVisible && !isWhitespace) {
      continue;
    }

    if (isWhitespace) {
      if (ascii.length() > 0 && !previousWasSpace) {
        ascii += ' ';
      }
      previousWasSpace = true;
      continue;
    }

    ascii += static_cast<char>(ch);
    previousWasSpace = false;
  }

  ascii.trim();
  return ascii;
}

String truncateLabel(const String &value, size_t maxLength) {
  String sanitized = sanitizeDisplayText(value);
  if (sanitized.length() <= maxLength) {
    return sanitized;
  }
  return sanitized.substring(0, maxLength - 1) + ".";
}

void drawText(const String &text, int x, int y, uint16_t color,
              const lgfx::IFont *font = kFontBody,
              textdatum_t datum = textdatum_t::top_left) {
  lcd.setTextColor(color);
  lcd.setTextDatum(datum);
  lcd.drawString(sanitizeDisplayText(text), x, y, font);
  lcd.setTextDatum(textdatum_t::top_left);
}

void drawPill(int left, int top, int width, int height, uint16_t fill,
              uint16_t color, const String &label,
              const lgfx::IFont *font = kFontBody, int radius = 10) {
  lcd.fillRoundRect(left, top, width, height, radius, fill);
  drawText(label, left + (width / 2), top + (height / 2), color, font,
           textdatum_t::middle_center);
}

TouchReleaseEvent pollTouchRelease() {
  bool touched = false;
  uint16_t x = 0;
  uint16_t y = 0;

  if (g_touchInitialized) {
    touch.read();
    touched = touch.isTouched && touch.touches > 0;
    if (touched) {
      x = touch.points[0].x;
      y = touch.points[0].y;
    }
  }

  if (touched) {
    g_touchHeld = true;
    g_lastTouchX = x;
    g_lastTouchY = y;
    return {};
  }

  if (!g_touchHeld) {
    return {};
  }

  g_touchHeld = false;
  TouchReleaseEvent event;
  event.available = true;
  event.x = g_lastTouchX;
  event.y = g_lastTouchY;
  return event;
}

void clearWifiNetworks() {
  g_wifiNetworkCount = 0;
  for (size_t index = 0; index < kMaxWifiNetworks; index++) {
    g_wifiNetworks[index] = {};
  }
}

void sortWifiNetworks() {
  for (size_t left = 0; left < g_wifiNetworkCount; left++) {
    for (size_t right = left + 1; right < g_wifiNetworkCount; right++) {
      if (g_wifiNetworks[right].rssi > g_wifiNetworks[left].rssi) {
        const WifiNetworkEntry temp = g_wifiNetworks[left];
        g_wifiNetworks[left] = g_wifiNetworks[right];
        g_wifiNetworks[right] = temp;
      }
    }
  }
}

void completeWifiScan(int networkCount) {
  g_wifiScanInProgress = false;
  clearWifiNetworks();
  if (networkCount <= 0) {
    WiFi.scanDelete();
    g_screenDirty = true;
    return;
  }

  for (int index = 0;
       index < networkCount && g_wifiNetworkCount < kMaxWifiNetworks; index++) {
    const String ssid = WiFi.SSID(index);
    if (ssid.length() == 0) {
      continue;
    }

    bool duplicate = false;
    for (size_t existing = 0; existing < g_wifiNetworkCount; existing++) {
      if (g_wifiNetworks[existing].ssid == ssid) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      continue;
    }

    g_wifiNetworks[g_wifiNetworkCount].ssid = ssid;
    g_wifiNetworks[g_wifiNetworkCount].rssi = WiFi.RSSI(index);
    g_wifiNetworks[g_wifiNetworkCount].secure =
        WiFi.encryptionType(index) != WIFI_AUTH_OPEN;
    g_wifiNetworkCount++;
  }

  sortWifiNetworks();
  WiFi.scanDelete();
  g_screenDirty = true;
}

void requestWifiScan() {
  clearWifiNetworks();
  WiFi.scanDelete();
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(false, true);
  g_wifiScanRequested = true;
  g_wifiScanInProgress = false;
  g_wifiScanRequestedAt = millis();
  Serial.println("Portable dashboard Wi-Fi scan queued.");
  g_screenDirty = true;
}

void driveWifiScan() {
  if (g_wifiScanInProgress) {
    const int networkCount = WiFi.scanComplete();
    if (networkCount == WIFI_SCAN_RUNNING) {
      return;
    }

    if (networkCount == WIFI_SCAN_FAILED) {
      Serial.println("Portable dashboard Wi-Fi scan failed.");
      g_wifiScanInProgress = false;
      WiFi.scanDelete();
      g_screenDirty = true;
      return;
    }

    Serial.printf("Portable dashboard Wi-Fi scan complete: %d network(s)\n",
                  networkCount);
    completeWifiScan(networkCount);
    return;
  }

  if (!g_wifiScanRequested ||
      millis() - g_wifiScanRequestedAt < kWifiScanKickoffDelayMs) {
    return;
  }

  g_wifiScanRequested = false;
  const int startResult = WiFi.scanNetworks(true, true);
  if (startResult == WIFI_SCAN_FAILED) {
    Serial.println("Portable dashboard Wi-Fi scan could not start.");
    WiFi.scanDelete();
    g_screenDirty = true;
    return;
  }

  g_wifiScanInProgress = true;
  Serial.println("Portable dashboard Wi-Fi scan started.");
}

int asInt(JsonVariantConst value, int fallback) {
  if (value.is<int>()) {
    return value.as<int>();
  }
  if (value.is<long>()) {
    return static_cast<int>(value.as<long>());
  }
  if (value.is<bool>()) {
    return value.as<bool>() ? 1 : 0;
  }
  return fallback;
}

void clearDashboardCards() {
  g_cardCount = 0;
  for (size_t index = 0; index < kMaxDashboardCards; index++) {
    g_cards[index] = {};
  }
}

DashboardPinState *findCardPin(DashboardCardState &card, int gpio) {
  for (size_t index = 0; index < card.pinCount; index++) {
    if (card.pins[index].used && card.pins[index].gpio == gpio) {
      return &card.pins[index];
    }
  }
  return nullptr;
}

void loadDashboardConfig() {
  clearDashboardCards();
  if (strlen(ECONNECT_PORTABLE_DASHBOARD_JSON) == 0) {
    return;
  }

  DynamicJsonDocument doc(12288);
  const DeserializationError error =
      deserializeJson(doc, ECONNECT_PORTABLE_DASHBOARD_JSON);
  if (error) {
    Serial.printf("Portable dashboard JSON parse failed: %s\n", error.c_str());
    return;
  }

  const JsonArrayConst cards = doc["cards"].as<JsonArrayConst>();
  if (cards.isNull()) {
    return;
  }

  for (JsonObjectConst rawCard : cards) {
    if (g_cardCount >= kMaxDashboardCards) {
      break;
    }

    const String deviceId = String(rawCard["device_id"] | "");
    if (deviceId.length() == 0) {
      continue;
    }

    DashboardCardState &card = g_cards[g_cardCount];
    card.used = true;
    card.deviceId = deviceId;
    card.name = String(rawCard["name"] | deviceId);
    card.roomName = String(rawCard["room_name"] | "");
    card.mode = String(rawCard["mode"] | "");
    card.provider = String(rawCard["provider"] | "");

    const JsonObjectConst layout = rawCard["layout"].as<JsonObjectConst>();
    card.x = std::max(0, asInt(layout["x"], 12));
    card.y = std::max(0, asInt(layout["y"], 12));
    card.w = std::min(kScreenWidth - kSidebarWidth - 8,
                      std::max(116, asInt(layout["w"], 168)));
    card.h = std::min(kScreenHeight - 8, std::max(84, asInt(layout["h"], 108)));

    const JsonArrayConst pins = rawCard["pins"].as<JsonArrayConst>();
    for (JsonObjectConst rawPin : pins) {
      if (card.pinCount >= kMaxDashboardPins) {
        break;
      }

      DashboardPinState &pin = card.pins[card.pinCount];
      pin.used = true;
      pin.gpio = asInt(rawPin["gpio_pin"], asInt(rawPin["gpio"], -1));
      pin.mode = String(rawPin["mode"] | "OUTPUT");
      pin.functionName = String(rawPin["function"] | "");
      pin.label = String(rawPin["label"] | pin.functionName);
      pin.value = 0;
      pin.brightness = 0;

      const JsonObjectConst extra =
          rawPin["extra_params"].as<JsonObjectConst>();
      pin.pwmMin = asInt(extra["min_value"], 0);
      pin.pwmMax = asInt(extra["max_value"], 255);
      if (pin.pwmMax <= pin.pwmMin) {
        pin.pwmMin = 0;
        pin.pwmMax = 255;
      }

      if (pin.gpio >= 0) {
        card.pinCount++;
      }
    }

    g_cardCount++;
  }
}

void drawWifiScanScreen() {
  lcd.fillScreen(kColorCanvasBg);
  drawText("PortableControl Wi-Fi", 18, 16, TFT_WHITE, kFontTitle);
  drawText("Tap a network on the board to continue.", 18, 46,
           kColorTextSecondary, kFontCaption);

  drawPill(352, 14, 112, 32, kColorAccent, kColorDashboardBg, "Rescan",
           kFontBody, 12);

  if (g_wifiNetworkCount == 0) {
    lcd.fillRoundRect(16, 76, 448, 110, 18, kColorSurface);
    lcd.drawRoundRect(16, 76, 448, 110, 18, kColorOutline);
    if (g_wifiScanRequested || g_wifiScanInProgress) {
      drawText("Scanning nearby SSIDs...", 34, 108, TFT_WHITE, kFontBody);
      drawText("Results will appear automatically.", 34, 132,
               kColorTextMuted, kFontCaption);
    } else {
      drawText("No visible SSID found yet.", 34, 108, TFT_WHITE, kFontBody);
      drawText("Tap Rescan and stay near the board.", 34, 132,
               kColorTextMuted, kFontCaption);
    }
    return;
  }

  for (size_t index = 0;
       index <
       std::min(g_wifiNetworkCount, static_cast<size_t>(kWifiListVisibleRows));
       index++) {
    const int top =
        kWifiListTop + static_cast<int>(index) * (kWifiListRowHeight + 6);
    const uint16_t rowFill = index == 0 ? kColorAccentMuted : kColorSurface;
    lcd.fillRoundRect(16, top, 448, kWifiListRowHeight, 12, rowFill);
    drawText(truncateLabel(g_wifiNetworks[index].ssid, 28), 28, top + 7,
             TFT_WHITE, kFontBody);

    String signal = String(g_wifiNetworks[index].rssi) + " dBm";
    if (g_wifiNetworks[index].secure) {
      signal += " / lock";
    }
    drawText(signal, 446, top + 15, kColorTextMuted, kFontCaption,
             textdatum_t::middle_right);
  }
}

String keyboardRow(size_t index) {
  if (g_keyboardSymbols) {
    switch (index) {
    case 0:
      return "1234567890";
    case 1:
      return "@#$_&-+()";
    case 2:
      return "/*\":;!?";
    default:
      return ".,=[]{}";
    }
  }

  switch (index) {
  case 0:
    return "1234567890";
  case 1:
    return g_keyboardUppercase ? "QWERTYUIOP" : "qwertyuiop";
  case 2:
    return g_keyboardUppercase ? "ASDFGHJKL" : "asdfghjkl";
  default:
    return g_keyboardUppercase ? "ZXCVBNM" : "zxcvbnm";
  }
}

void drawKeyboardScreen() {
  lcd.fillScreen(kColorCanvasBg);
  drawText("Enter Wi-Fi Password", 16, 14, TFT_WHITE, kFontTitle);
  drawText(truncateLabel(g_keyboardTargetSsid, 28), 16, 44, kColorAccentSoft,
           kFontCaption);

  drawPill(352, 14, 112, 32, kColorSurface, TFT_WHITE, "Back", kFontBody, 12);

  lcd.fillRoundRect(16, 58, 448, 32, 12, kColorSurface);
  lcd.drawRoundRect(16, 58, 448, 32, 12, kColorOutline);
  String masked;
  for (size_t index = 0; index < g_keyboardInput.length(); index++) {
    masked += "*";
  }
  if (masked.length() == 0) {
    masked = "Tap keys below";
  }
  drawText(masked, 26, 68, TFT_WHITE, kFontBody);

  const int rowTops[4] = {102, 136, 170, 204};
  for (size_t row = 0; row < 4; row++) {
    const String keys = keyboardRow(row);
    const int availableWidth = 448;
    const int gap = 6;
    const int keyWidth =
        (availableWidth - static_cast<int>(keys.length() - 1) * gap) /
        static_cast<int>(keys.length());
    int cursorX = 16;

    for (size_t index = 0; index < keys.length(); index++) {
      lcd.fillRoundRect(cursorX, rowTops[row], keyWidth, 24, 7,
                        kColorSurfaceMuted);
      drawText(String(keys[index]), cursorX + (keyWidth / 2), rowTops[row] + 12,
               TFT_WHITE, kFontCaption, textdatum_t::middle_center);
      cursorX += keyWidth + gap;
    }
  }

  drawPill(16, 238, 56, 24, kColorSurfaceMuted, TFT_WHITE,
           g_keyboardSymbols ? "ABC" : "#+=", kFontCaption, 8);
  drawPill(80, 238, 62, 24, kColorSurfaceMuted, TFT_WHITE, "Shift",
           kFontCaption, 8);
  drawPill(150, 238, 110, 24, kColorSurfaceAlt, TFT_WHITE, "Space",
           kFontCaption, 8);
  drawPill(268, 238, 76, 24, kColorDanger, TFT_WHITE, "Delete", kFontCaption,
           8);
  drawPill(352, 238, 112, 24, kColorAccent, kColorDashboardBg, "Connect",
           kFontCaption, 8);
}

void drawPairingScreen() {
  lcd.fillScreen(kColorCanvasBg);
  drawText("Pairing PortableControl", 240, 78, TFT_WHITE, kFontTitle,
           textdatum_t::top_center);
  drawText("Connecting to Wi-Fi and server", 240, 116, kColorTextSecondary,
           kFontBody, textdatum_t::top_center);

  String dots;
  for (uint8_t index = 0; index < g_pairingDots; index++) {
    dots += ".";
  }
  drawText(dots, 240, 148, kColorAccentSoft, kFontTitle,
           textdatum_t::top_center);

  drawPill(352, 14, 112, 32, kColorSurface, TFT_WHITE, "Back", kFontBody, 12);

  lcd.fillRoundRect(70, 180, 340, 46, 16, kColorSurface);
  lcd.drawRoundRect(70, 180, 340, 46, 16, kColorOutline);
  drawText("The board switches to the touch dashboard after secure pairing.",
           240, 195, kColorTextMuted, kFontCaption, textdatum_t::top_center);
}

String pinValueLabel(const DashboardPinState &pin) {
  if (pin.mode == "PWM") {
    return String(pin.brightness);
  }
  return String(pin.value);
}

void drawSidebar() {
  lcd.fillRect(0, 0, kSidebarWidth, kScreenHeight, kColorSidebarBg);
  lcd.drawFastVLine(kSidebarWidth - 1, 0, kScreenHeight, kColorOutline);
  lcd.fillRoundRect(16, 18, 40, 40, 12, kColorSurfaceAlt);
  drawText("CTL", 36, 38, kColorSidebarAccent, kFontBody,
           textdatum_t::middle_center);
  drawText("AUTO", 36, 84, kColorTextFaint, kFontCaption,
           textdatum_t::top_center);
  drawText("SET", 36, 108, kColorTextFaint, kFontCaption,
           textdatum_t::top_center);
  drawPill(12, 226, 48, 24, kColorSurfaceAlt, kColorSuccess, "LAN",
           kFontCaption, 8);
}

void drawDashboardCard(const DashboardCardState &card) {
  const int left = kSidebarWidth + card.x;
  const int top = card.y;
  const uint16_t border = card.online ? kColorAccentSoft : kColorOutline;

  lcd.fillRoundRect(left, top, card.w, card.h, 16, kColorSurface);
  lcd.drawRoundRect(left, top, card.w, card.h, 16, border);

  drawText(truncateLabel(card.name, 18), left + 12, top + 10, TFT_WHITE,
           kFontBody);
  if (card.roomName.length() > 0) {
    drawText(truncateLabel(card.roomName, 18), left + 12, top + 26,
             kColorTextFaint, kFontCaption);
  }

  drawPill(left + card.w - 68, top + 8, 56, 20,
           card.online ? kColorSurfaceAlt : kColorSurfaceMuted,
           card.online ? kColorSuccess : kColorTextMuted,
           card.online ? "online" : "offline", kFontCaption, 10);

  const int rowsTop = card.roomName.length() > 0 ? top + 52 : top + 42;
  const int visibleRows = std::max(0, (card.h - (rowsTop - top) - 8) / 28);
  for (size_t index = 0;
       index < card.pinCount && static_cast<int>(index) < visibleRows;
       index++) {
    const DashboardPinState &pin = card.pins[index];
    const int rowTop = rowsTop + static_cast<int>(index) * 28;
    lcd.drawFastHLine(left + 10, rowTop - 4, card.w - 20, kColorOutline);
    drawText(truncateLabel(pin.label.length() > 0 ? pin.label : pin.mode, 16),
             left + 12, rowTop + 3, TFT_WHITE, kFontCaption);

    if (pin.mode == "OUTPUT") {
      drawPill(left + card.w - 66, rowTop + 1, 54, 18,
               pin.value != 0 ? kColorAccentMuted : kColorSurfaceMuted,
               pin.value != 0 ? TFT_WHITE : kColorTextSecondary,
               pin.value != 0 ? "ON" : "OFF", kFontCaption, 9);
      continue;
    }

    if (pin.mode == "PWM") {
      drawPill(left + card.w - 70, rowTop + 1, 18, 18, kColorSurfaceMuted,
               TFT_WHITE, "-", kFontCaption, 6);
      drawPill(left + card.w - 24, rowTop + 1, 18, 18, kColorSurfaceMuted,
               TFT_WHITE, "+", kFontCaption, 6);
      drawText(pinValueLabel(pin), left + card.w - 40, rowTop + 4,
               kColorAccentSoft, kFontCaption, textdatum_t::top_center);
      continue;
    }

    drawText(pinValueLabel(pin), left + card.w - 40, rowTop + 4,
             kColorTextSecondary, kFontCaption, textdatum_t::top_center);
  }
}

void drawDashboardScreen() {
  lcd.fillScreen(kColorDashboardBg);
  drawSidebar();
  drawText("PortableControl", 86, 10, TFT_WHITE, kFontTitle);
  drawText("Touch the card controls to publish MQTT commands.", 86, 38,
           kColorTextSecondary, kFontCaption);

  drawPill(352, 14, 112, 32, kColorSurface, TFT_WHITE, "Wi-Fi", kFontBody, 12);

  if (g_cardCount == 0) {
    lcd.fillRoundRect(96, 88, 330, 84, 20, kColorSurface);
    lcd.drawRoundRect(96, 88, 330, 84, 20, kColorOutline);
    drawText("PortableControl Ready", 262, 108, kColorAccentSoft, kFontBody,
             textdatum_t::top_center);
    drawText("Add server devices in the DIY canvas first.", 262, 134,
             kColorTextSecondary, kFontCaption, textdatum_t::top_center);
    return;
  }

  for (size_t index = 0; index < g_cardCount; index++) {
    if (g_cards[index].used) {
      drawDashboardCard(g_cards[index]);
    }
  }
}

void queueDashboardCommand(DashboardCardState &card, DashboardPinState &pin,
                           int value, int brightness) {
  g_pendingCommand.active = true;
  g_pendingCommand.deviceId = card.deviceId;
  g_pendingCommand.pin = pin.gpio;
  g_pendingCommand.value = value;
  g_pendingCommand.brightness = brightness;

  pin.value = value;
  if (brightness >= 0) {
    pin.brightness = brightness;
  } else if (value == 0) {
    pin.brightness = pin.pwmMin;
  }
  g_screenDirty = true;
}

void handleWifiScanTouch(int x, int y) {
  if (isInside(x, y, 360, 16, 104, 28)) {
    requestWifiScan();
    return;
  }

  for (size_t index = 0;
       index <
       std::min(g_wifiNetworkCount, static_cast<size_t>(kWifiListVisibleRows));
       index++) {
    const int top =
        kWifiListTop + static_cast<int>(index) * (kWifiListRowHeight + 6);
    if (!isInside(x, y, 16, top, 448, kWifiListRowHeight)) {
      continue;
    }

    g_keyboardTargetSsid = g_wifiNetworks[index].ssid;
    g_keyboardInput = "";
    g_keyboardUppercase = false;
    g_keyboardSymbols = false;
    ui_show_keyboard(g_keyboardTargetSsid.c_str());
    return;
  }
}

bool handleKeyboardCharacterTouch(int x, int y) {
  const int rowTops[4] = {102, 136, 170, 204};
  for (size_t row = 0; row < 4; row++) {
    const String keys = keyboardRow(row);
    const int gap = 6;
    const int keyWidth = (448 - static_cast<int>(keys.length() - 1) * gap) /
                         static_cast<int>(keys.length());
    int cursorX = 16;
    for (size_t index = 0; index < keys.length(); index++) {
      if (isInside(x, y, cursorX, rowTops[row], keyWidth, 24)) {
        if (g_keyboardInput.length() < 63) {
          g_keyboardInput += keys[index];
        }
        g_screenDirty = true;
        return true;
      }
      cursorX += keyWidth + gap;
    }
  }
  return false;
}

void handleKeyboardTouch(int x, int y) {
  if (isInside(x, y, 352, 14, 112, 32)) {
    g_screen = ScreenId::WifiScan;
    g_screenDirty = true;
    return;
  }

  if (handleKeyboardCharacterTouch(x, y)) {
    return;
  }

  if (isInside(x, y, 16, 238, 56, 24)) {
    g_keyboardSymbols = !g_keyboardSymbols;
    g_screenDirty = true;
    return;
  }

  if (isInside(x, y, 80, 238, 62, 24)) {
    g_keyboardUppercase = !g_keyboardUppercase;
    g_screenDirty = true;
    return;
  }

  if (isInside(x, y, 150, 238, 110, 24)) {
    if (g_keyboardInput.length() < 63) {
      g_keyboardInput += " ";
    }
    g_screenDirty = true;
    return;
  }

  if (isInside(x, y, 268, 238, 76, 24)) {
    if (g_keyboardInput.length() > 0) {
      g_keyboardInput.remove(g_keyboardInput.length() - 1);
      g_screenDirty = true;
    }
    return;
  }

  if (isInside(x, y, 352, 238, 112, 24) && g_keyboardTargetSsid.length() > 0) {
    g_wifiSsid = g_keyboardTargetSsid;
    g_wifiPassword = g_keyboardInput;
    g_wifiConfigured = true;
    g_pairingComplete = false;
    g_pairingDots = 0;
    g_lastPairingAnimationAt = millis();
    g_screen = ScreenId::Pairing;
    g_screenDirty = true;
  }
}

void handlePairingTouch(int x, int y) {
  if (isInside(x, y, 352, 14, 112, 32)) {
    g_wifiConfigured = false;
    g_pairingComplete = false;
    g_screen = ScreenId::WifiScan;
    g_screenDirty = true;
  }
}

void handleDashboardTouch(int x, int y) {
  if (isInside(x, y, 352, 14, 112, 32)) {
    g_wifiConfigured = false;
    g_screen = ScreenId::WifiScan;
    g_screenDirty = true;
    requestWifiScan();
    return;
  }

  if (x < kSidebarWidth) {
    return;
  }

  for (int cardIndex = static_cast<int>(g_cardCount) - 1; cardIndex >= 0;
       cardIndex--) {
    DashboardCardState &card = g_cards[cardIndex];
    if (!card.used) {
      continue;
    }

    const int left = kSidebarWidth + card.x;
    const int top = card.y;
    if (!isInside(x, y, left, top, card.w, card.h)) {
      continue;
    }

    const int visibleRows = std::max(0, (card.h - 46) / 28);
    for (size_t index = 0;
         index < card.pinCount && static_cast<int>(index) < visibleRows;
         index++) {
      DashboardPinState &pin = card.pins[index];
      const int rowTop = top + 38 + static_cast<int>(index) * 28;
      if (!isInside(x, y, left + 6, rowTop, card.w - 12, 24)) {
        continue;
      }

      if (pin.mode == "OUTPUT") {
        const int nextValue = pin.value == 0 ? 1 : 0;
        queueDashboardCommand(card, pin, nextValue, -1);
        return;
      }

      if (pin.mode == "PWM") {
        const int minusLeft = left + card.w - 68;
        const int plusLeft = left + card.w - 22;
        int brightness =
            pin.brightness > pin.pwmMin ? pin.brightness : pin.pwmMax;

        if (isInside(x, y, minusLeft, rowTop + 1, 18, 18)) {
          brightness = std::max(pin.pwmMin, brightness - 25);
          queueDashboardCommand(card, pin, brightness > pin.pwmMin ? 1 : 0,
                                brightness);
          return;
        }

        if (isInside(x, y, plusLeft, rowTop + 1, 18, 18)) {
          brightness = std::min(pin.pwmMax, brightness + 25);
          queueDashboardCommand(card, pin, 1, brightness);
          return;
        }

        if (pin.value == 0 || pin.brightness <= pin.pwmMin) {
          queueDashboardCommand(card, pin, 1, pin.pwmMax);
        } else {
          queueDashboardCommand(card, pin, 0, pin.pwmMin);
        }
        return;
      }

      return;
    }
  }
}

void updateCardStateFromPayload(DashboardCardState &card,
                                JsonVariantConst payload) {
  card.online = true;
  card.lastSeenAt = millis();

  const JsonArrayConst statePins = payload["pins"].as<JsonArrayConst>();
  if (!statePins.isNull()) {
    for (JsonObjectConst statePin : statePins) {
      const int gpio = asInt(statePin["pin"], asInt(statePin["gpio_pin"], -1));
      DashboardPinState *target = findCardPin(card, gpio);
      if (target == nullptr) {
        continue;
      }

      target->value = asInt(statePin["value"], target->value);
      if (!statePin["brightness"].isNull()) {
        target->brightness = asInt(statePin["brightness"], target->brightness);
      }
    }
    return;
  }

  const int gpio = asInt(payload["pin"], -1);
  DashboardPinState *target = findCardPin(card, gpio);
  if (target == nullptr) {
    return;
  }

  target->value = asInt(payload["value"], target->value);
  if (!payload["brightness"].isNull()) {
    target->brightness = asInt(payload["brightness"], target->brightness);
  }
}

String cardStateTopic(const DashboardCardState &card) {
  return String("econnect/") + MQTT_NAMESPACE + "/device/" + card.deviceId +
         "/state";
}

String cardCommandTopic(const DashboardCardState &card) {
  return String("econnect/") + MQTT_NAMESPACE + "/device/" + card.deviceId +
         "/command";
}

void redrawIfNeeded() {
  if (!g_screenDirty) {
    return;
  }

  switch (g_screen) {
  case ScreenId::WifiScan:
    drawWifiScanScreen();
    break;
  case ScreenId::Keyboard:
    drawKeyboardScreen();
    break;
  case ScreenId::Pairing:
    drawPairingScreen();
    break;
  case ScreenId::Dashboard:
    drawDashboardScreen();
    break;
  }

  g_screenDirty = false;
}

} // namespace

namespace lgfx {
inline namespace v1 {
constexpr const uint8_t Panel_NV3041A::init_cmds[];
}
} // namespace lgfx

void ui_manager_init() {
  Serial.println("JC3827 UI init: starting display and touch setup.");
  Serial.println("JC3827 UI init: preparing backlight PWM.");
  initBacklightPwm();
  delay(1);
  Serial.println("JC3827 UI init: calling lcd.init().");
  lcd.init();
  Serial.println("JC3827 UI init: configuring LCD runtime state.");
  lcd.invertDisplay(false);
  lcd.setRotation(0);
  lcd.setTextWrap(false, false);
  lcd.setAttribute(UTF8_SWITCH, 1);
  setBacklightBrightness(kDefaultBacklightBrightness);
  lcd.fillScreen(TFT_BLACK);
  delay(1);
  Serial.println("JC3827 UI init: initializing touch controller.");
  initTouchController();
  Serial.println("JC3827 UI init: loading dashboard config.");
  loadDashboardConfig();
  Serial.println("JC3827 UI init: showing Wi-Fi scan screen.");
  ui_show_wifi_scan();
  Serial.println("JC3827 UI init: complete.");
}

void ui_manager_loop() {
  driveWifiScan();

  const unsigned long now = millis();
  if (g_screen == ScreenId::Pairing && now - g_lastPairingAnimationAt >= 500) {
    g_lastPairingAnimationAt = now;
    g_pairingDots = static_cast<uint8_t>((g_pairingDots + 1) % 4);
    g_screenDirty = true;
  }

  for (size_t index = 0; index < g_cardCount; index++) {
    if (g_cards[index].used && g_cards[index].online &&
        now - g_cards[index].lastSeenAt >= kOfflineTimeoutMs) {
      g_cards[index].online = false;
      g_screenDirty = true;
    }
  }

  const TouchReleaseEvent touch = pollTouchRelease();
  if (touch.available) {
    switch (g_screen) {
    case ScreenId::WifiScan:
      handleWifiScanTouch(touch.x, touch.y);
      break;
    case ScreenId::Keyboard:
      handleKeyboardTouch(touch.x, touch.y);
      break;
    case ScreenId::Dashboard:
      handleDashboardTouch(touch.x, touch.y);
      break;
    case ScreenId::Pairing:
      handlePairingTouch(touch.x, touch.y);
      break;
    }
  }

  redrawIfNeeded();
}

bool ui_wifi_is_configured() { return g_wifiConfigured; }

const char *ui_wifi_get_ssid() { return g_wifiSsid.c_str(); }

const char *ui_wifi_get_password() { return g_wifiPassword.c_str(); }

bool ui_backlight_apply_command(int value, int brightness) {
  int nextBrightness = brightness;
  if (value == 0) {
    nextBrightness = 0;
  } else if (nextBrightness < 0 && value != -1) {
    nextBrightness = g_backlightBrightness > 0
                         ? g_backlightBrightness
                         : g_lastNonZeroBacklightBrightness;
  }

  if (nextBrightness < 0) {
    return false;
  }

  setBacklightBrightness(
      static_cast<uint8_t>(constrain(nextBrightness, 0, 255)));
  g_screenDirty = true;
  return true;
}

int ui_backlight_get_brightness() { return g_backlightBrightness; }

int ui_backlight_get_logical_value() {
  return g_backlightBrightness > 0 ? 1 : 0;
}

void ui_show_wifi_scan() {
  g_screen = ScreenId::WifiScan;
  g_screenDirty = true;
  requestWifiScan();
}

void ui_show_keyboard(const char *target_ssid) {
  g_keyboardTargetSsid = target_ssid == nullptr ? "" : String(target_ssid);
  g_screen = ScreenId::Keyboard;
  g_screenDirty = true;
}

void ui_show_dashboard() {
  g_screen = ScreenId::Dashboard;
  g_screenDirty = true;
}

void ui_set_pairing_state(bool paired) {
  g_pairingComplete = paired;
  if (paired) {
    loadDashboardConfig();
    ui_show_dashboard();
    return;
  }

  if (g_wifiConfigured) {
    g_screen = ScreenId::Pairing;
    g_screenDirty = true;
    return;
  }

  ui_show_wifi_scan();
}

void ui_subscribe_dashboard_topics(PubSubClient &client) {
  for (size_t index = 0; index < g_cardCount; index++) {
    if (!g_cards[index].used || g_cards[index].deviceId.length() == 0) {
      continue;
    }
    const String topic = cardStateTopic(g_cards[index]);
    client.subscribe(topic.c_str());
    Serial.printf("Subscribed to portable dashboard state topic: %s\n",
                  topic.c_str());
  }
}

bool ui_handle_dashboard_mqtt(const char *topic, JsonVariantConst payload) {
  const String incomingTopic(topic == nullptr ? "" : topic);
  if (incomingTopic.length() == 0) {
    return false;
  }

  for (size_t index = 0; index < g_cardCount; index++) {
    DashboardCardState &card = g_cards[index];
    if (!card.used || incomingTopic != cardStateTopic(card)) {
      continue;
    }

    updateCardStateFromPayload(card, payload);
    g_screenDirty = true;
    return true;
  }

  return false;
}

bool ui_publish_pending_dashboard_command(PubSubClient &client) {
  if (!g_pendingCommand.active || !client.connected()) {
    return false;
  }

  DashboardCardState *targetCard = nullptr;
  for (size_t index = 0; index < g_cardCount; index++) {
    if (g_cards[index].used &&
        g_cards[index].deviceId == g_pendingCommand.deviceId) {
      targetCard = &g_cards[index];
      break;
    }
  }
  if (targetCard == nullptr) {
    g_pendingCommand.active = false;
    return false;
  }

  StaticJsonDocument<192> doc;
  doc["kind"] = "action";
  doc["pin"] = g_pendingCommand.pin;
  doc["value"] = g_pendingCommand.value;
  if (g_pendingCommand.brightness >= 0) {
    doc["brightness"] = g_pendingCommand.brightness;
  }

  String payload;
  serializeJson(doc, payload);
  const String topic = cardCommandTopic(*targetCard);

  if (!client.publish(topic.c_str(), payload.c_str())) {
    return false;
  }

  Serial.printf("Portable dashboard command -> %s : %s\n", topic.c_str(),
                payload.c_str());
  g_pendingCommand.active = false;
  return true;
}

#endif
