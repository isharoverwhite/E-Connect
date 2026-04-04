#ifndef JC3827W543_MANAGER_H
#define JC3827W543_MANAGER_H

#ifdef BOARD_JC3827W543

#include <ArduinoJson.h>

class PubSubClient;

void jc3827w543_setup();
void jc3827w543_loop();
bool jc3827w543_has_custom_wifi();
const char* jc3827w543_get_custom_ssid();
const char* jc3827w543_get_custom_pass();
bool jc3827w543_is_builtin_pin(int pin);
bool jc3827w543_apply_builtin_command(int pin, int value, int brightness);
void jc3827w543_append_builtin_pin_config(JsonArray pins);
void jc3827w543_append_builtin_pin_state(JsonArray pins);
int jc3827w543_builtin_pin();
int jc3827w543_builtin_value();
int jc3827w543_builtin_brightness();
void jc3827w543_set_pairing_state(bool paired);
void jc3827w543_on_mqtt_connected(PubSubClient& client);
bool jc3827w543_handle_mqtt_message(const char* topic, JsonVariantConst payload);
bool jc3827w543_publish_pending_command(PubSubClient& client);

#endif // BOARD_JC3827W543
#endif // JC3827W543_MANAGER_H
