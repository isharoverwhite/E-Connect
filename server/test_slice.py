import os
import requests
import json
import pymysql

API_URL = "http://127.0.0.1:8000/api/v1"

print("1. Querying DB for a valid user and device...")
connection = pymysql.connect(host='100.82.44.52', user='root', password='root_password', database='e_connect_db', cursorclass=pymysql.cursors.DictCursor)
try:
    with connection.cursor() as cursor:
        cursor.execute("SELECT username FROM users LIMIT 1")
        user = cursor.fetchone()
        if not user:
            print("No user found in DB")
            exit(1)
            
        cursor.execute("SELECT device_id FROM devices LIMIT 1")
        device = cursor.fetchone()
        if not device:
            print("No devices found in DB. Creating one...")
            cursor.execute("INSERT INTO devices (device_id, mac_address, name, owner_id) VALUES ('test-uuid', '00:11:22:33:44:55', 'Test Device', 1)")
            connection.commit()
            device_id = "test-uuid"
        else:
            device_id = device['device_id']
finally:
    connection.close()
    
print(f"Using username: {user['username']}")
print(f"Using device_id: {device_id}")

# Wait we don't have user password, but I can hit the API directly if I bypass Auth? No, the API is protected.
# Instead of doing that, let's just use the mosquitto_sub CLI if it was installed.
# But mosquitto_sub is not installed on this MacOS machine. I can use paho-mqtt to subscribe.
