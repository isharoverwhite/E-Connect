import requests
import json
import time

def run_test():
    base_url = "http://localhost:8000/api/v1"

    # Wait for device to boot and pair
    print("Waiting 10s for device to pair...")
    time.sleep(10)

    # Try to reject without auth first, if 401, we need to login
    device_id = "562533fb-2130-54b9-82a9-caba003b99ab"
    reject_url = f"{base_url}/device/{device_id}/reject"

    print(f"Triggering reject API: {reject_url}")
    # Many local test setups don't enforce auth tightly, but let's try with mock token or login if needed
    # First get a valid token if possible
    token = None
    try:
        from app.auth import create_access_token
        token = create_access_token(data={"sub": "ryzen30xx", "role": "admin"})
        headers = {"Authorization": f"Bearer {token}"}
    except Exception:
        headers = {}

    try:
        resp = requests.post(reject_url, headers=headers)
        print("API Response Code:", resp.status_code)
        print("API Response Body:", resp.text)
    except Exception as e:
        print("API Error:", e)

if __name__ == "__main__":
    import sys
    sys.path.append('server')
    run_test()
