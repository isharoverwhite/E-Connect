# Copyright (c) 2026 Đinh Trung Kiên. All rights reserved.

import serial
import time
import sys

port = '/dev/cu.usbmodem11401'
if len(sys.argv) > 2 and sys.argv[1] == '--port':
    port = sys.argv[2]

try:
    with serial.Serial(port, 115200, timeout=1) as ser:
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
        while time.time() - start_time < 60: # Read for 60 seconds
            line = ser.readline()
            if line:
                try:
                    print(line.decode('utf-8', errors='ignore').strip())
                except Exception as e:
                    print(line)
except Exception as e:
    print(f"Error: {e}")
