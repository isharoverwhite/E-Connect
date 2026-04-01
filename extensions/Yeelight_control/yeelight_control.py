import socket
import json
import time

class YeelightBulb:
    def __init__(self, ip, port=55443):
        self.ip = ip
        self.port = port
        self.sock = None
        self.cmd_id = 1

    def connect(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(5)
            self.sock.connect((self.ip, self.port))
            print(f"[INFO] Connected to {self.ip}:{self.port}")
            return True
        except Exception as e:
            print(f"[ERROR] Connection failed: {e}")
            return False

    def send_command(self, method, params):
        if not self.sock:
            print("[ERROR] Not connected.")
            return None

        command = {
            "id": self.cmd_id,
            "method": method,
            "params": params
        }

        try:
            cmd_str = json.dumps(command) + "\r\n"
            self.sock.send(cmd_str.encode())
            self.cmd_id += 1

            data = self.sock.recv(1024)
            response = json.loads(data.decode().strip())
            # print(f"[RESPONSE] {response}")
            return response
        except Exception as e:
            print(f"[ERROR] Failed to send/receive: {e}")
            self.close()
            return None

    # Toggle the bulb (on/off)
    def toggle(self):
        self.send_command("toggle", [])

    # Set brightness of the bulb
    def set_brightness(self, brightness):
        self.send_command("set_bright", [int(brightness), "smooth", 500])

    # Set color of the bulb
    def set_rgb(self, r, g, b):
        # Convert RGB to integer: R*65536 + G*256 + B
        rgb_value = (int(r) * 65536) + (int(g) * 256) + int(b)
        self.send_command("set_rgb", [rgb_value, "smooth", 500])

    # Get properties of the bulb
    def get_props(self):
        response = self.send_command("get_prop", ["power", "bright", "rgb", "model", "hue", "sat", "color_mode"])
        if response and "result" in response:
            result = response["result"]
            try:
                # Format RGB value (index 2) from int to R-G-B
                rgb_val = int(result[2])
                r = (rgb_val >> 16) & 0xFF
                g = (rgb_val >> 8) & 0xFF
                b = rgb_val & 0xFF
                result[2] = f"{r}-{g}-{b}"
            except Exception:
                pass
            return result
        return None

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except:
                pass
            self.sock = None
            print("[INFO] Connection closed.")