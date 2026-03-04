import paho.mqtt.client as mqtt
import json
import os
import logging
from datetime import datetime
from dotenv import load_dotenv
from app.database import SessionLocal
from app.sql_models import Device, DeviceHistory, EventType, ConnStatus

load_dotenv()

import uuid

logger = logging.getLogger(__name__)

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_NAMESPACE = os.getenv("MQTT_NAMESPACE", "local")

# econnect/{namespace}/device/+/state
STATE_TOPIC_SUBSCRIPTION = f"econnect/{MQTT_NAMESPACE}/device/+/state"

class MQTTClientManager:
    def __init__(self):
        self.client_id = f"econnect_server_{MQTT_NAMESPACE}_{uuid.uuid4().hex[:8]}"
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=self.client_id)
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        self.connected = False

    def start(self):
        try:
            logger.info(f"Connecting to MQTT Broker at {MQTT_BROKER}:{MQTT_PORT} (Namespace: {MQTT_NAMESPACE})")
            self.client.connect(MQTT_BROKER, MQTT_PORT, 60)
            self.client.loop_start()
        except Exception as e:
            logger.error(f"Failed to connect to MQTT broker: {e}")

    def stop(self):
        if self.connected:
            self.client.loop_stop()
            self.client.disconnect()

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if not reason_code.is_failure:
            self.connected = True
            logger.info("Successfully connected to MQTT broker")
            client.subscribe(STATE_TOPIC_SUBSCRIPTION)
            logger.info(f"Subscribed to {STATE_TOPIC_SUBSCRIPTION}")
        else:
            logger.error(f"Failed to connect, return code {reason_code}")

    def on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties=None):
        self.connected = False
        if reason_code.is_failure:
            logger.warning(f"Unexpected MQTT disconnection (code {reason_code}). Will auto-reconnect.")
        else:
            logger.info("Disconnected from MQTT broker.")

    def on_message(self, client, userdata, msg):
        try:
            topic_parts = msg.topic.split("/")
            # topic shape: econnect/{namespace}/device/{device_id}/state
            if len(topic_parts) >= 5 and topic_parts[4] == "state":
                device_id = topic_parts[3]
                payload_str = msg.payload.decode("utf-8")
                
                # Insert state change into DeviceHistory
                db = SessionLocal()
                try:
                    device = db.query(Device).filter(Device.device_id == device_id).first()
                    if device:
                        device.conn_status = ConnStatus.online
                        device.last_seen = datetime.utcnow()

                    history = DeviceHistory(
                        device_id=device_id,
                        event_type=EventType.state_change,
                        payload=payload_str,
                        # changed_by=None (since it's from device state sync)
                    )
                    db.add(history)
                    db.commit()
                finally:
                    db.close()
        except Exception as e:
            logger.error(f"Error processing MQTT message: {e}")

    def publish_command(self, device_id: str, payload: dict) -> bool:
        """
        Publishes a structured command payload to the specific device.
        Returns True if publish request was sent.
        """
        if not self.connected:
            logger.error("Cannot publish: MQTT client is not connected.")
            return False
            
        topic = f"econnect/{MQTT_NAMESPACE}/device/{device_id}/command"
        try:
            payload_str = json.dumps(payload)
            info = self.client.publish(topic, payload_str, qos=1)
            # wait_for_publish can block, for MVP we just check if it was accepted by network buffer
            info.wait_for_publish(timeout=2.0)
            if info.is_published():
                return True
            else:
                logger.error(f"Publish timeout for topic {topic}")
                return False
        except Exception as e:
            logger.error(f"Exception publishing to {topic}: {e}")
            return False

# Global instance
mqtt_manager = MQTTClientManager()
