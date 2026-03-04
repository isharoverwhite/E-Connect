import paho.mqtt.client as mqtt
import uuid
import time

def on_connect(client, userdata, flags, rc, properties=None):
    print(f"Connected with result code {rc}")
    
def on_disconnect(client, userdata, disconnect_flags, rc, properties=None):
    print(f"Disconnected with result code {rc}")

print("Starting...")
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"test_{uuid.uuid4().hex}")
client.on_connect = on_connect
client.on_disconnect = on_disconnect

client.connect("test.mosquitto.org", 1883, 60)
client.loop_start()

time.sleep(3)
client.loop_stop()
print("Done.")
