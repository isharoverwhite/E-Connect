#ifndef SECRETS_H
#define SECRETS_H

#ifndef ECONNECT_BUILTIN_LED_PIN
#ifdef LED_BUILTIN
#define ECONNECT_BUILTIN_LED_PIN LED_BUILTIN
#else
#define ECONNECT_BUILTIN_LED_PIN 2
#endif
#endif

#ifndef WIFI_SSID
#define WIFI_SSID "YOUR_WIFI_SSID"
#endif

#ifndef WIFI_PASS
#define WIFI_PASS "YOUR_WIFI_PASSWORD"
#endif

#ifndef MQTT_BROKER
#define MQTT_BROKER ""
#endif

#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif

#ifndef MQTT_NAMESPACE
#define MQTT_NAMESPACE "local"
#endif

#ifndef API_BASE_URL
#define API_BASE_URL "http://your-server-ip:8000/api/v1"
#endif

#ifndef ECONNECT_PROJECT_ID
#define ECONNECT_PROJECT_ID ""
#endif

#ifndef ECONNECT_DEVICE_ID
#define ECONNECT_DEVICE_ID "legacy-device"
#endif

#ifndef ECONNECT_SECRET_KEY
#define ECONNECT_SECRET_KEY ""
#endif

#ifndef ECONNECT_DEVICE_NAME
#define ECONNECT_DEVICE_NAME "E-Connect Node"
#endif

#ifndef ECONNECT_FIRMWARE_VERSION
#define ECONNECT_FIRMWARE_VERSION "dev"
#endif

#ifndef ECONNECT_BOARD_PROFILE
#define ECONNECT_BOARD_PROFILE "esp32"
#endif

#endif // SECRETS_H
