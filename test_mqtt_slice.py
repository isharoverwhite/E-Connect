import requests
import json
import time
import os
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

load_dotenv("server/.env")

API_URL = "http://127.0.0.1:8000/api/v1"
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_NAMESPACE = os.getenv("MQTT_NAMESPACE", "local")
DEVICE_ID = "test-device-id"

print(f"Testing against Broker: {MQTT_BROKER} | Namespace: {MQTT_NAMESPACE}")

test_passed = False

def on_connect(client, userdata, flags, reason_code, properties=None):
    if not reason_code.is_failure:
        topic = f"econnect/{MQTT_NAMESPACE}/device/{DEVICE_ID}/command"
        print(f"Connected to broker. Subscribing to: {topic}")
        client.subscribe(topic)
    else:
        print("Failed to connect to broker")

def on_message(client, userdata, msg):
    global test_passed
    payload = msg.payload.decode()
    print(f"\n[MQTT] Received message on topic {msg.topic}: {payload}")
    if '"kind": "action"' in payload and '"pin": 4' in payload:
        test_passed = True

print("0. Seeding device in Database...")
import pymysql
try:
    connection = pymysql.connect(host='100.82.44.52', user='root', password='root_password', database='e_connect_db')
    with connection.cursor() as cursor:
        cursor.execute(f"INSERT IGNORE INTO devices (device_id, mac_address, name, owner_id) VALUES ('{DEVICE_ID}', '00:11:22:33:44:55', 'Test Device', 1)")
        connection.commit()
    connection.close()
    print("Device seeded.")
except Exception as e:
    print(f"Failed to seed device: {e}")

print("1. Logging in via API...")
r = requests.post(f"{API_URL}/auth/token", data={"username": "admin", "password": "password123"})
if r.status_code != 200:
    print("Login failed:", r.text)
    exit(1)

token = r.json()["access_token"]
print("Login successful.")

print("2. Starting MQTT test subscriber...")
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="test_subscriber_client")
client.on_connect = on_connect
client.on_message = on_message
client.connect(MQTT_BROKER, MQTT_PORT, 60)
client.loop_start()

time.sleep(2)  # Give time to connect & subscribe

print("3. Sending API command request...")
headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
payload = {"kind": "action", "pin": 4, "value": 1}

r = requests.post(f"{API_URL}/device/{DEVICE_ID}/command", headers=headers, json=payload)
print(f"API Response Code: {r.status_code}")
print(f"API Response Body: {r.text}")

print("4. Waiting for MQTT message to arrive...")
time.sleep(3)
client.loop_stop()

if test_passed:
    print("\nSUCCESS: End-to-end MQTT transport vertical slice works!")
    open("test_result.txt", "w").write("PASS")
else:
    print("\nFAILURE: Did not receive expected MQTT message.")
    open("test_result.txt", "w").write("FAIL")
