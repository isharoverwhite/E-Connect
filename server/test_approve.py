import subprocess
import json

# Login
cmd = ['curl', '-s', '-X', 'POST', '-d', 'username=admin&password=admin_password', 'http://127.0.0.1:8000/api/v1/auth/token']
result = subprocess.run(cmd, capture_output=True, text=True)
token_data = json.loads(result.stdout)
token = token_data.get('access_token')
if not token:
    print("Failed to get token:", result.stdout)
    exit(1)

# Approve
approve_cmd = [
    'curl', '-s', '-X', 'POST', 
    '-H', 'Content-Type: application/json',
    '-H', f'Authorization: Bearer {token}',
    'http://127.0.0.1:8000/api/v1/device/d6eff742-db5a-4574-97cb-689e836ecca4/approve'
]
res2 = subprocess.run(approve_cmd, capture_output=True, text=True)
print("Approve Result:", res2.stdout)
