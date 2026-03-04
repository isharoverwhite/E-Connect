import urllib.request
import json
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

data = b"username=admin&password=admin_password"
req = urllib.request.Request("http://127.0.0.1:8000/api/v1/auth/token", data=data)
req.add_header("Content-Type", "application/x-www-form-urlencoded")
try:
    with urllib.request.urlopen(req, context=ctx) as response:
        res = json.loads(response.read().decode())
        token = res.get("access_token")
        
        req2 = urllib.request.Request("http://127.0.0.1:8000/api/v1/device/d6eff742-db5a-4574-97cb-689e836ecca4/approve", data=b"{}")
        req2.add_header("Authorization", f"Bearer {token}")
        req2.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req2, context=ctx) as r2:
                print("Approve OK:", r2.read().decode())
        except urllib.error.HTTPError as e:
            print("HTTP Error (Approve):", e.code, e.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP Error (Login):", e.code, e.read().decode())
except Exception as e:
    print("Error:", e)
