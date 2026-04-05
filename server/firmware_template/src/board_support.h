/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

#pragma once

#include <Arduino.h>

#if defined(ESP8266)
#include <ESP8266WiFi.h>
#include <ESP8266httpUpdate.h>
#else
#include <HTTPUpdate.h>
#include <WiFi.h>
#endif

struct WifiTarget {
  bool found;
  int32_t candidateCount;
  int32_t channel;
  int32_t rssi;
  int32_t authMode;
  uint8_t bssid[6];
};

struct OtaUpdateResult {
  const char *status;
  String message;
  bool shouldRestart;
};

void initializeBoardNetworking();
void prepareBoardForWifiConnection();
int32_t defaultBoardAuthMode();
const char *boardAuthModeName(int32_t authMode);
OtaUpdateResult runBoardOtaUpdate(const String &url, const String &expectedMd5);
bool restoreRejectedPairingLock();
void persistRejectedPairingLock(bool rejected);
String boardResetReasonSummary();
void shutdownBoardNetworkingAfterPairingReject();
