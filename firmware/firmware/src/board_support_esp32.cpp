#include "board_support.h"

#if !defined(ESP8266)
namespace {
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
  WiFi.setMinSecurity(WIFI_AUTH_WPA_PSK);
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

OtaUpdateResult runBoardOtaUpdate(const String &url) {
  WiFiClient client;
  httpUpdate.rebootOnUpdate(false);
  const t_httpUpdate_return ret = httpUpdate.update(client, url);

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
#endif
