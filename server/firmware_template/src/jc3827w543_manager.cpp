#ifdef BOARD_JC3827W543

#include "jc3827w543_manager.h"
#include "display_ui/ui_manager.h"
#include <Arduino.h>
#include <PubSubClient.h>

namespace {

constexpr int kBuiltinBacklightPin = 1;

void appendBuiltinPinMetadata(JsonObject pin) {
    pin["function"] = "display_backlight";
    pin["label"] = "Display Backlight";
    pin["datatype"] = "number";

    JsonObject extraParams = pin.createNestedObject("extra_params");
    extraParams["min_value"] = 0;
    extraParams["max_value"] = 255;
}

}  // namespace

void jc3827w543_setup() {
    ui_manager_init();
    while (!ui_wifi_is_configured()) {
        ui_manager_loop();
        delay(5);
    }
}

void jc3827w543_loop() {
    ui_manager_loop();
}

bool jc3827w543_has_custom_wifi() {
    return ui_wifi_is_configured();
}

const char* jc3827w543_get_custom_ssid() {
    return ui_wifi_get_ssid();
}

const char* jc3827w543_get_custom_pass() {
    return ui_wifi_get_password();
}

bool jc3827w543_is_builtin_pin(int pin) {
    return pin == kBuiltinBacklightPin;
}

bool jc3827w543_apply_builtin_command(int pin, int value, int brightness) {
    if (!jc3827w543_is_builtin_pin(pin)) {
        return false;
    }
    return ui_backlight_apply_command(value, brightness);
}

void jc3827w543_append_builtin_pin_config(JsonArray pins) {
    JsonObject pin = pins.createNestedObject();
    pin["gpio_pin"] = kBuiltinBacklightPin;
    pin["mode"] = "PWM";
    appendBuiltinPinMetadata(pin);
}

void jc3827w543_append_builtin_pin_state(JsonArray pins) {
    JsonObject pin = pins.createNestedObject();
    pin["pin"] = kBuiltinBacklightPin;
    pin["mode"] = "PWM";
    pin["value"] = ui_backlight_get_logical_value();
    pin["brightness"] = ui_backlight_get_brightness();
    appendBuiltinPinMetadata(pin);
}

int jc3827w543_builtin_pin() {
    return kBuiltinBacklightPin;
}

int jc3827w543_builtin_value() {
    return ui_backlight_get_logical_value();
}

int jc3827w543_builtin_brightness() {
    return ui_backlight_get_brightness();
}

void jc3827w543_set_pairing_state(bool paired) {
    ui_set_pairing_state(paired);
}

void jc3827w543_on_mqtt_connected(PubSubClient& client) {
    ui_subscribe_dashboard_topics(client);
}

bool jc3827w543_handle_mqtt_message(const char* topic, JsonVariantConst payload) {
    return ui_handle_dashboard_mqtt(topic, payload);
}

bool jc3827w543_publish_pending_command(PubSubClient& client) {
    return ui_publish_pending_dashboard_command(client);
}

#endif // BOARD_JC3827W543
