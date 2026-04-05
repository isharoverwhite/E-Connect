/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

#include "board_support.h"

#if !defined(ESP8266)
#include <esp_attr.h>
#include <WiFiClientSecure.h>

namespace {
constexpr uint32_t kRuntimeFlagsMagic = 0x45434E54;  // "ECNT"
constexpr uint32_t kRuntimeFlagsVersion = 1;

struct RuntimeFlags {
  uint32_t magic;
  uint32_t version;
  uint32_t pairingRejected;
  uint32_t crc32;
};

// Keep the reject lock in RTC slow memory so USB/reset-button reboots preserve
// it, while an actual power loss clears the state and allows pairing again.
RTC_NOINIT_ATTR RuntimeFlags rtcRuntimeFlags;

uint32_t calculateCRC32(const uint8_t *data, size_t length) {
  uint32_t crc = 0xFFFFFFFF;
  while (length--) {
    uint8_t current = *data++;
    for (uint32_t bit = 0x80; bit > 0; bit >>= 1) {
      const bool mix = (crc & 0x80000000) != 0;
      if ((current & bit) != 0) {
        crc ^= 0x80000000;
      }
      crc <<= 1;
      if (mix) {
        crc ^= 0x04C11DB7;
      }
    }
  }
  return crc;
}

RuntimeFlags buildRuntimeFlags(bool rejected) {
  RuntimeFlags flags = {
      kRuntimeFlagsMagic,
      kRuntimeFlagsVersion,
      rejected ? 1U : 0U,
      0U,
  };
  flags.crc32 =
      calculateCRC32(reinterpret_cast<const uint8_t *>(&flags), sizeof(flags) - sizeof(flags.crc32));
  return flags;
}

bool readRuntimeFlags(RuntimeFlags &flags) {
  flags = rtcRuntimeFlags;
  if (flags.magic != kRuntimeFlagsMagic || flags.version != kRuntimeFlagsVersion) {
    return false;
  }

  const uint32_t expectedCrc = calculateCRC32(
      reinterpret_cast<const uint8_t *>(&flags),
      sizeof(flags) - sizeof(flags.crc32));
  return expectedCrc == flags.crc32;
}

const char *resetReasonName(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:
      return "power_on";
    case ESP_RST_EXT:
      return "external_reset";
    case ESP_RST_SW:
      return "software_reset";
    case ESP_RST_PANIC:
      return "panic_reset";
    case ESP_RST_INT_WDT:
      return "interrupt_watchdog";
    case ESP_RST_TASK_WDT:
      return "task_watchdog";
    case ESP_RST_WDT:
      return "watchdog";
    case ESP_RST_DEEPSLEEP:
      return "deep_sleep";
    case ESP_RST_BROWNOUT:
      return "brownout";
    case ESP_RST_SDIO:
      return "sdio_reset";
    case ESP_RST_UNKNOWN:
    default:
      return "unknown";
  }
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
}  // namespace

void initializeBoardNetworking() {
  WiFi.onEvent(handleWiFiEvent);
  WiFi.setScanMethod(WIFI_ALL_CHANNEL_SCAN);
  WiFi.setAutoReconnect(true);
}

void prepareBoardForWifiConnection() {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  // Allow the driver to consider any 2.4 GHz AP security mode it supports.
  // The provisioning layer still controls what credentials the product accepts.
  WiFi.setMinSecurity(WIFI_AUTH_OPEN);
  WiFi.disconnect(false, true);
}

int32_t defaultBoardAuthMode() {
  return WIFI_AUTH_OPEN;
}

const char *boardAuthModeName(int32_t authMode) {
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

OtaUpdateResult runBoardOtaUpdate(const String &url, const String &expectedMd5) {
  const bool isHttps = url.startsWith("https://");
  httpUpdate.rebootOnUpdate(false);
  if (expectedMd5.length() > 0 && !Update.setMD5(expectedMd5.c_str())) {
    return {
        "failed",
        "INVALID_EXPECTED_MD5",
        false,
    };
  }
  t_httpUpdate_return ret;
  if (isHttps) {
    WiFiClientSecure client;
    // Dev and LAN OTA currently use a self-signed certificate.
    client.setInsecure();
    ret = httpUpdate.update(client, url);
  } else {
    WiFiClient client;
    ret = httpUpdate.update(client, url);
  }

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      return {
          "failed",
          httpUpdate.getLastErrorString(),
          false,
      };
    case HTTP_UPDATE_NO_UPDATES:
      return {
          "failed",
          "HTTP_UPDATE_NO_UPDATES",
          false,
      };
    case HTTP_UPDATE_OK:
      return {
          "success",
          "",
          true,
      };
  }

  return {
      "failed",
      "UNKNOWN_OTA_RESULT",
      false,
  };
}

bool restoreRejectedPairingLock() {
  RuntimeFlags flags = {};
  return readRuntimeFlags(flags) && flags.pairingRejected == 1U;
}

void persistRejectedPairingLock(bool rejected) {
  rtcRuntimeFlags = buildRuntimeFlags(rejected);
}

String boardResetReasonSummary() {
  return String(resetReasonName(esp_reset_reason()));
}

void shutdownBoardNetworkingAfterPairingReject() {
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);
}
#endif
