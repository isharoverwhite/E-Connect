#include "board_support.h"

#if defined(ESP8266)
#include <user_interface.h>

namespace {
constexpr uint32_t kRuntimeFlagsMagic = 0x45434E54;  // "ECNT"
constexpr uint32_t kRuntimeFlagsVersion = 1;
constexpr uint32_t kRuntimeFlagsRtcOffset = 32;

struct RuntimeFlags {
  uint32_t magic;
  uint32_t version;
  uint32_t pairingRejected;
  uint32_t crc32;
};

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
  if (!ESP.rtcUserMemoryRead(
          kRuntimeFlagsRtcOffset,
          reinterpret_cast<uint32_t *>(&flags),
          sizeof(flags))) {
    return false;
  }

  if (flags.magic != kRuntimeFlagsMagic || flags.version != kRuntimeFlagsVersion) {
    return false;
  }

  const uint32_t expectedCrc = calculateCRC32(
      reinterpret_cast<const uint8_t *>(&flags),
      sizeof(flags) - sizeof(flags.crc32));
  return expectedCrc == flags.crc32;
}
}  // namespace

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

bool restoreRejectedPairingLock() {
  RuntimeFlags flags = {};
  return readRuntimeFlags(flags) && flags.pairingRejected == 1U;
}

void persistRejectedPairingLock(bool rejected) {
  RuntimeFlags flags = buildRuntimeFlags(rejected);
  ESP.rtcUserMemoryWrite(
      kRuntimeFlagsRtcOffset,
      reinterpret_cast<uint32_t *>(&flags),
      sizeof(flags));
}

String boardResetReasonSummary() { return ESP.getResetReason(); }

void shutdownBoardNetworkingAfterPairingReject() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}
#endif
