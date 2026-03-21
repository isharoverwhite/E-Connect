#include "board_support.h"

#if defined(ESP8266)
void initializeBoardNetworking() {
  WiFi.setAutoReconnect(true);
}

void prepareBoardForWifiConnection() {
  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.disconnect();
}

int32_t defaultBoardAuthMode() {
  return ENC_TYPE_NONE;
}

const char *boardAuthModeName(int32_t authMode) {
  if (authMode == ENC_TYPE_NONE) {
    return "OPEN";
  }
  return "SECURED";
}

OtaUpdateResult runBoardOtaUpdate(const String &url) {
  WiFiClient client;
  ESPhttpUpdate.rebootOnUpdate(false);
  const t_httpUpdate_return ret = ESPhttpUpdate.update(client, url);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      return {
          "failed",
          ESPhttpUpdate.getLastErrorString(),
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
