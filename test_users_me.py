import sys
import json
import urllib.request
sys.path.append('server')
from app.database import SessionLocal
from app.sql_models import User
from app.auth import create_access_token

db = SessionLocal()
user = db.query(User).first()
if user:
    token = create_access_token(data={"sub": user.username, "account_type": user.account_type.value, "household_id": None, "household_role": None})
    req = urllib.request.Request('http://localhost:8000/api/v1/users/me', headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read()
            print("Status Code:", response.status)
            res_json = json.loads(res_body)
            print("UI layout shape in response:", type(res_json.get('ui_layout')))
            if type(res_json.get('ui_layout')) == list:
                print("First item keys: ", res_json.get('ui_layout')[0].keys() if len(res_json.get('ui_layout'))>0 else "empty")
    except Exception as e:
        print("Error:", e)
else:
    print("No user found")
