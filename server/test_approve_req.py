import requests

# Login
login_url = 'http://127.0.0.1:8000/api/v1/auth/token'
login_data = {'username': 'admin', 'password': 'admin_password'}
res = requests.post(login_url, data=login_data)
if res.status_code != 200:
    print("Login err:", res.text)
    exit(1)

token = res.json().get('access_token')

# Approve
approve_url = 'http://127.0.0.1:8000/api/v1/device/d6eff742-db5a-4574-97cb-689e836ecca4/approve'
headers = {'Authorization': f'Bearer {token}'}
res2 = requests.post(approve_url, headers=headers)
print("Approve:", res2.status_code, res2.text)
