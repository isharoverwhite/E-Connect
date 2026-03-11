import requests
import json
import time
import os

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000/api/v1")

def run_test():
    # 1. Start setup
    print("Initializing server...")
    setup_resp = requests.post(f"{BASE_URL}/auth/initialserver", json={
        "fullname": "Test User",
        "username": "admin",
        "password": "password123",
        "account_type": "admin",
        "ui_layout": {}
    })
    if setup_resp.status_code not in (200, 403):
        raise AssertionError(f"Unexpected setup response: {setup_resp.status_code} {setup_resp.text}")
    
    # It might already be set up, so we login
    print("Logging in...")
    login_resp = requests.post(f"{BASE_URL}/auth/token", data={
        "username": "admin",
        "password": "password123"
    })
    
    if login_resp.status_code != 200:
        print("Login failed!", login_resp.text)
        return
        
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. Test Serial Locks
    print("Testing Serial Locks...")
    lock_resp = requests.post(f"{BASE_URL}/serial/lock?device_id=test_dev&port=COM_TEST", headers=headers)
    assert lock_resp.status_code == 200, "Should lock"
    
    status_resp = requests.get(f"{BASE_URL}/serial/status?port=COM_TEST", headers=headers)
    assert status_resp.json()["locked"] == True, "Status should be locked"
    
    unlock_resp = requests.post(f"{BASE_URL}/serial/unlock?port=COM_TEST", headers=headers)
    assert unlock_resp.status_code == 200, "Should unlock"
    
    # 3. Test DIY Project Creation
    print("Testing DIY Project creation...")
    project_payload = {
        "name": "My DIY Blinker",
        "board_profile": "esp32",
        "config": {
            "pins": [{"gpio": 2, "mode": "OUTPUT", "function": "led"}]
        }
    }
    proj_resp = requests.post(f"{BASE_URL}/diy/projects", json=project_payload, headers=headers)
    assert proj_resp.status_code == 200, f"Project creation failed: {proj_resp.text}"
    proj_id = proj_resp.json()["id"]
    
    # 4. Trigger Build
    print(f"Triggering build for project {proj_id}...")
    build_resp = requests.post(f"{BASE_URL}/diy/build?project_id={proj_id}", headers=headers)
    assert build_resp.status_code == 200, f"Build trigger failed: {build_resp.text}"
    job_id = build_resp.json()["id"]
    
    # 5. Poll Build Status
    print(f"Polling build status for job {job_id}...")
    for _ in range(30):
        time.sleep(2)
        job_poll = requests.get(f"{BASE_URL}/diy/build/{job_id}", headers=headers)
        status = job_poll.json()["status"]
        print(f"Current Status: {status}")
        if status in ["artifact_ready", "build_failed"]:
            break
            
    # 6. Check logs / artifact
    logs_resp = requests.get(f"{BASE_URL}/diy/build/{job_id}/logs", headers=headers)
    print("Build Logs snippet:")
    print(logs_resp.json().get("logs", "")[:500])
    
    if status == "artifact_ready":
        print("Build Success! Attempting to download artifact...")
        artifact_resp = requests.get(f"{BASE_URL}/diy/build/{job_id}/artifact", headers=headers)
        assert artifact_resp.status_code == 200
        print(f"Downloaded artifact size: {len(artifact_resp.content)} bytes")
    else:
        print("Build Failed.")
        
if __name__ == "__main__":
    run_test()
