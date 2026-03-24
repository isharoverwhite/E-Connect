import serial
import time
import sys

try:
    with serial.Serial('/dev/cu.usbmodem21401', 115200, timeout=1) as ser:
        print("Connected to serial port")
        
        # Reset ESP32-C3 via DTR/RTS (USB JTAG/Serial)
        ser.setDTR(False)
        ser.setRTS(False)
        time.sleep(0.1)
        ser.setDTR(True)  # RST
        ser.setRTS(False) # EN
        time.sleep(0.1)
        ser.setDTR(False)
        ser.setRTS(False)
        print("Board reset sent, waiting for logs...")
        
        start_time = time.time()
        while time.time() - start_time < 30: # Read for 30 seconds
            line = ser.readline()
            if line:
                try:
                    print(line.decode('utf-8', errors='ignore').strip())
                except Exception as e:
                    print(line)
except Exception as e:
    print(f"Error: {e}")
