import requests
import sqlite3

def test_trigger():
    # 1. Start by getting a token
    print("Getting token for admin...")
    resp = requests.post("http://127.0.0.1:8000/api/v1/auth/token", data={"username": "admin", "password": "password"})
    if resp.status_code != 200:
        print("Could not get token. Make sure server is running and user admin/password exists.")
        return
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Create an automation
    print("Creating automations...")
    resp = requests.post("http://127.0.0.1:8000/api/v1/automation", headers=headers, json={
        "name": "Test Happy",
        "script_code": "print('This is a successful script')\nresult=100",
        "is_enabled": True
    })
    auto_happy = resp.json()
    
    resp = requests.post("http://127.0.0.1:8000/api/v1/automation", headers=headers, json={
        "name": "Test Fail",
        "script_code": "print('This script will fail')\n1/0",
        "is_enabled": True
    })
    auto_fail = resp.json()
    
    # 3. Trigger happy
    print(f"Triggering happy automation {auto_happy['id']}...")
    resp = requests.post(f"http://127.0.0.1:8000/api/v1/automation/{auto_happy['id']}/trigger", headers=headers)
    print("Happy Response:", resp.json())
    
    # 4. Trigger fail
    print(f"Triggering fail automation {auto_fail['id']}...")
    resp = requests.post(f"http://127.0.0.1:8000/api/v1/automation/{auto_fail['id']}/trigger", headers=headers)
    print("Fail Response:", resp.json())
    
    # 5. DB Verification
    print("DB Verification...")
    conn = sqlite3.connect("db.sqlite3")
    cursor = conn.cursor()
    cursor.execute("SELECT id, automation_id, status, log_output, error_message FROM automation_execution_logs WHERE automation_id IN (?, ?) ORDER BY id DESC LIMIT 2", (auto_happy['id'], auto_fail['id']))
    rows = cursor.fetchall()
    for row in rows:
        print(row)
        
if __name__ == "__main__":
    test_trigger()
