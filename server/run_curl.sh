#!/bin/bash
TOKEN_JSON=$(curl -s -X POST -d "username=admin&password=admin_password" http://127.0.0.1:8000/api/v1/auth/token)
TOKEN=$(python -c "import sys, json; print(json.loads(sys.argv[1]).get('access_token'))" "$TOKEN_JSON")
echo "Token: $TOKEN"
if [ "$TOKEN" != "None" ] && [ -n "$TOKEN" ]; then
    curl -s -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/v1/device/d6eff742-db5a-4574-97cb-689e836ecca4/approve
else
    echo "Login failed."
fi
