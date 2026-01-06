## Run server
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

## Run with Docker
# Build
docker build -t e-connect-server ./server

# Run
docker run -p 8000:8000 e-connect-server

# Build for specific platform (e.g., if forcing x64 on M1 Mac)
docker build --platform linux/amd64 -t e-connect-server-amd64 ./server