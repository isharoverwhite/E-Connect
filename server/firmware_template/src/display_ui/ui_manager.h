/* Copyright (c) 2026 Đinh Trung Kiên. All rights reserved. */

#pragma once

#ifdef BOARD_JC3827W543

#include <ArduinoJson.h>

class PubSubClient;

void ui_manager_init();
void ui_manager_loop();
bool ui_wifi_is_configured();
const char* ui_wifi_get_ssid();
const char* ui_wifi_get_password();
bool ui_backlight_apply_command(int value, int brightness);
int ui_backlight_get_brightness();
int ui_backlight_get_logical_value();

// Screen initialization triggers
void ui_show_wifi_scan();
void ui_show_keyboard(const char* target_ssid);
void ui_show_dashboard();
void ui_set_pairing_state(bool paired);
void ui_subscribe_dashboard_topics(PubSubClient& client);
bool ui_handle_dashboard_mqtt(const char* topic, JsonVariantConst payload);
bool ui_publish_pending_dashboard_command(PubSubClient& client);

#endif
