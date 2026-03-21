from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime
from typing import Any

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

import asyncio
from app.database import SessionLocal
from app.models import DeviceRegister
from app.services.device_registration import (
    build_pairing_request_event_payload,
    build_registration_ack_payload,
    register_device_payload,
)
from app.sql_models import AuthStatus, ConnStatus, Device, DeviceHistory, EventType
from app.ws_manager import manager as ws_manager

load_dotenv()

logger = logging.getLogger(__name__)

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_NAMESPACE = os.getenv("MQTT_NAMESPACE", "local")

STATE_TOPIC_SUBSCRIPTION = f"econnect/{MQTT_NAMESPACE}/device/+/state"
REGISTER_TOPIC_SUBSCRIPTION = f"econnect/{MQTT_NAMESPACE}/device/+/register"


def _reconcile_ota_jobs(db: Session, device: Device, reported_version: str) -> None:
    if not device.provisioning_project_id or not reported_version:
        return
        
    from app.sql_models import BuildJob, JobStatus
    
    flashing_jobs = db.query(BuildJob).filter(
        BuildJob.project_id == device.provisioning_project_id,
        BuildJob.status == JobStatus.flashing
    ).all()
    
    if not flashing_jobs:
        return

    now = datetime.utcnow()
    matched_job = None
    for job in flashing_jobs:
        expected_version = f"build-{job.id[:8]}"
        if reported_version == expected_version:
            matched_job = job
            break

    if matched_job:
        matched_job.status = JobStatus.flashed
        matched_job.finished_at = now
        logger.info("Reconciled OTA job %s to flashed via firmware_version match.", matched_job.id)
        return

    if len(flashing_jobs) > 1:
        logger.warning(
            "Skipping OTA mismatch reconciliation for device %s because %s flashing jobs are active.",
            device.device_id,
            len(flashing_jobs),
        )
        return

    job = flashing_jobs[0]
    delta = now - (job.updated_at or job.created_at or now)
    # Only fail if it's been active for > 60 seconds to avoid race conditions with pre-OTA buffered messages
    if delta.total_seconds() > 60:
        expected_version = f"build-{job.id[:8]}"
        job.status = JobStatus.flash_failed
        job.error_message = (
            f"OTA timeout/reconciliation: device reported version '{reported_version}' "
            f"after reboot, expected '{expected_version}'"
        )
        job.finished_at = now
        logger.warning("Reconciled OTA job %s to flash_failed (version mismatch).", job.id)


class MQTTClientManager:
    def __init__(self):
        self.client_id = f"econnect_server_{MQTT_NAMESPACE}_{uuid.uuid4().hex[:8]}"
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.client_id,
        )
        self.client.on_connect = self.on_connect
        self.client.on_message = self.on_message
        self.client.on_disconnect = self.on_disconnect
        self.connected = False

    def start(self):
        try:
            logger.info(
                "Connecting to MQTT Broker at %s:%s (Namespace: %s)",
                MQTT_BROKER,
                MQTT_PORT,
                MQTT_NAMESPACE,
            )
            self.client.connect(MQTT_BROKER, MQTT_PORT, 60)
            self.client.loop_start()
        except Exception as exc:
            logger.error("Failed to connect to MQTT broker: %s", exc)

    def stop(self):
        if self.connected:
            self.client.loop_stop()
            self.client.disconnect()

    def registration_ack_topic(self, device_id: str) -> str:
        return f"econnect/{MQTT_NAMESPACE}/device/{device_id}/register/ack"

    def command_topic(self, device_id: str) -> str:
        return f"econnect/{MQTT_NAMESPACE}/device/{device_id}/command"

    def state_ack_topic(self, device_id: str) -> str:
        return f"econnect/{MQTT_NAMESPACE}/device/{device_id}/state/ack"

    def on_connect(self, client, userdata, flags, reason_code, properties=None):
        if reason_code.is_failure:
            logger.error("Failed to connect, return code %s", reason_code)
            return

        self.connected = True
        logger.info("Successfully connected to MQTT broker")
        client.subscribe(STATE_TOPIC_SUBSCRIPTION)
        client.subscribe(REGISTER_TOPIC_SUBSCRIPTION)
        logger.info("Subscribed to %s", STATE_TOPIC_SUBSCRIPTION)
        logger.info("Subscribed to %s", REGISTER_TOPIC_SUBSCRIPTION)

    def on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties=None):
        self.connected = False
        if reason_code.is_failure:
            logger.warning(
                "Unexpected MQTT disconnection (code %s). Will auto-reconnect.",
                reason_code,
            )
        else:
            logger.info("Disconnected from MQTT broker.")

    def on_message(self, client, userdata, msg):
        try:
            topic_parts = msg.topic.split("/")
            if len(topic_parts) < 5 or topic_parts[0] != "econnect":
                return

            device_id = topic_parts[3]
            topic_kind = topic_parts[4]
            payload_str = msg.payload.decode("utf-8")

            if topic_kind == "state":
                self.process_state_message(device_id, payload_str)
                return

            if topic_kind == "register":
                self.process_registration_message(device_id, payload_str)
        except Exception as exc:
            logger.error("Error processing MQTT message: %s", exc)

    def process_state_message(self, device_id: str, payload_str: str) -> None:
        payload_json: dict[str, Any] | None = None
        try:
            decoded = json.loads(payload_str)
            if isinstance(decoded, dict):
                payload_json = decoded
        except json.JSONDecodeError:
            payload_json = None

        db = SessionLocal()
        try:
            device = db.query(Device).filter(Device.device_id == device_id).first()
            if not device:
                logger.warning(
                    "Ignoring MQTT state for unknown device %s",
                    device_id,
                )
                self.publish_json(
                    self.state_ack_topic(device_id),
                    {
                        "status": "re_pair_required",
                        "device_id": device_id,
                        "reason": "unknown_device",
                        "message": "Device UUID is not registered on the server.",
                    },
                    wait_for_publish=False,
                )
                return

            auth_status = (
                device.auth_status.value if hasattr(device.auth_status, "value") else str(device.auth_status)
            )
            if device.auth_status != AuthStatus.approved:
                logger.info(
                    "Requesting re-pair for device %s because auth_status=%s",
                    device_id,
                    auth_status,
                )
                self.publish_json(
                    self.state_ack_topic(device_id),
                    {
                        "status": "re_pair_required",
                        "device_id": device_id,
                        "reason": "not_approved",
                        "auth_status": auth_status,
                        "message": "Device is no longer approved and must pair again.",
                    },
                    wait_for_publish=False,
                )
                return

            observed_at = datetime.utcnow()
            was_offline = device.conn_status != ConnStatus.online
            device.conn_status = ConnStatus.online
            device.last_seen = observed_at
            if isinstance(payload_json, dict):
                reported_ip = payload_json.get("ip_address")
                if isinstance(reported_ip, str) and reported_ip.strip():
                    device.ip_address = reported_ip.strip()
                    
                reported_fw = payload_json.get("firmware_version")
                if isinstance(reported_fw, str) and reported_fw.strip():
                    device.firmware_version = reported_fw.strip()
                    _reconcile_ota_jobs(db, device, device.firmware_version)

            if was_offline:
                db.add(
                    DeviceHistory(
                        device_id=device_id,
                        event_type=EventType.online,
                        payload=json.dumps(
                            {
                                "reason": "mqtt_state",
                                "reported_at": observed_at.isoformat(),
                            }
                        ),
                    )
                )

                try:
                    ws_manager.broadcast_device_event_sync(
                        "device_online",
                        device_id,
                        device.room_id,
                        {"reason": "mqtt_state"}
                    )
                except Exception:
                    pass

            db.add(
                DeviceHistory(
                    device_id=device_id,
                    event_type=EventType.state_change,
                    payload=payload_str,
                )
            )

            try:
                ws_manager.broadcast_device_event_sync(
                    "device_state",
                    device_id,
                    device.room_id,
                    payload_json or {}
                )
            except Exception:
                pass

            # Check if this is an OTA status report from the device
            if isinstance(payload_json, dict) and payload_json.get("event") == "ota_status":
                from app.sql_models import BuildJob, JobStatus
                job_id = payload_json.get("job_id")
                ota_status = payload_json.get("status")
                
                if job_id and ota_status:
                    job = db.query(BuildJob).filter(BuildJob.id == job_id).first()
                    if job:
                        if ota_status == "success":
                            job.status = JobStatus.flashed
                        elif ota_status == "failed":
                            job.status = JobStatus.flash_failed
                            job.error_message = payload_json.get("message")
                        
                        job.finished_at = datetime.utcnow()
                        db.commit()

            db.commit()
        finally:
            db.close()

    def process_registration_message(self, device_id: str, payload_str: str) -> dict[str, Any]:
        ack_topic = self.registration_ack_topic(device_id)

        try:
            raw_payload = json.loads(payload_str)
            if not isinstance(raw_payload, dict):
                raise ValueError("Registration payload must be a JSON object.")
            raw_payload.setdefault("device_id", device_id)
            if raw_payload.get("device_id") != device_id:
                raise ValueError("Device id in payload does not match MQTT topic.")
            payload = DeviceRegister.model_validate(raw_payload)
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            ack_payload = build_registration_ack_payload(
                status="error",
                device_id=device_id,
                secret_verified=False,
                error="validation",
                message=str(exc),
            )
            self.publish_json(ack_topic, ack_payload, wait_for_publish=False)
            return ack_payload

        db = SessionLocal()
        try:
            result = register_device_payload(db, payload)
            db.commit()
            db.refresh(result.device)

            if result.pairing_requested:
                ws_manager.broadcast_device_event_sync(
                    "pairing_requested",
                    result.device.device_id,
                    None,
                    build_pairing_request_event_payload(result.device),
                )
            
            if result.device.firmware_version:
                _reconcile_ota_jobs(db, result.device, result.device.firmware_version)
                db.commit()

            ack_payload = build_registration_ack_payload(
                status="ok",
                device_id=result.device.device_id,
                secret_verified=result.secret_verified,
                project_id=result.project_id,
                auth_status=(
                    result.device.auth_status.value
                    if hasattr(result.device.auth_status, "value")
                    else str(result.device.auth_status)
                ),
                topic_pub=result.device.topic_pub,
                topic_sub=result.device.topic_sub,
            )
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            ack_payload = build_registration_ack_payload(
                status="error",
                device_id=device_id,
                secret_verified=False,
                error=detail.get("error", "server"),
                message=detail.get("message", str(exc.detail)),
            )
        except Exception:
            db.rollback()
            logger.exception("Unhandled MQTT registration error for device %s", device_id)
            ack_payload = build_registration_ack_payload(
                status="error",
                device_id=device_id,
                secret_verified=False,
                error="server",
                message="Server failed to process MQTT registration.",
            )
        finally:
            db.close()

        self.publish_json(ack_topic, ack_payload, wait_for_publish=False)
        return ack_payload

    def publish_json(
        self,
        topic: str,
        payload: dict[str, Any],
        *,
        qos: int = 1,
        wait_for_publish: bool = True,
    ) -> bool:
        if not self.connected:
            logger.error("Cannot publish to %s: MQTT client is not connected.", topic)
            return False

        try:
            payload_str = json.dumps(payload)
            info = self.client.publish(topic, payload_str, qos=qos)
            if not wait_for_publish:
                return info.rc == mqtt.MQTT_ERR_SUCCESS

            info.wait_for_publish(timeout=2.0)
            if info.is_published():
                return True

            logger.error("Publish timeout for topic %s", topic)
            return False
        except Exception as exc:
            logger.error("Exception publishing to %s: %s", topic, exc)
            return False

    def publish_command(self, device_id: str, payload: dict[str, Any]) -> bool:
        return self.publish_json(self.command_topic(device_id), payload)


mqtt_manager = MQTTClientManager()
