import serial
import time

try:
    with serial.Serial('/dev/cu.usbserial-1130', 115200, timeout=1) as ser:
        print("Connected to ESP8266 on /dev/cu.usbserial-1130")

        # NodeMCU Reset sequence
        ser.setDTR(False)
        ser.setRTS(True)
        time.sleep(0.1)
        ser.setDTR(False)
        ser.setRTS(False)
        print("Board reset sent, waiting for logs...")

        start_time = time.time()
        while time.time() - start_time < 45: # Read for 45 seconds
            line = ser.readline()
            if line:
                try:
                    text = line.decode('utf-8', errors='ignore').strip()
                    if text:
                        print(f"[{time.strftime('%H:%M:%S')}] {text}", flush=True)
                except Exception:
                    pass
except Exception as e:
    print(f"Error: {e}")
