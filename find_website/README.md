# Find Website

Public-facing E-Connect helper site used to scan a user's local network for reachable E-Connect servers. The app probes `http://<candidate-ip>:8000/health` and opens the main E-Connect UI at `http://<server-ip>:3000/` when a server is found.

## Local development

```bash
npm ci
npm run dev
```

The development server runs on [http://localhost:9123](http://localhost:9123).

## Production Docker image

The project is configured with Next.js standalone output so it can run as a small production container.

Build the image:

```bash
docker build -t econnect-find-website ./find_website
```

Run it directly:

```bash
docker run --rm -p 9123:9123 econnect-find-website
```

Run it behind a reverse proxy on port 80/443:

```bash
docker run -d \
  --name econnect-find-website \
  -p 80:9123 \
  --restart unless-stopped \
  econnect-find-website
```

## Notes

- The container listens on `0.0.0.0:9123`.
- No extra runtime environment variables are required for the current scanner flow.
- Users must open this site from a device that is on the same LAN as the E-Connect server they want to find.
