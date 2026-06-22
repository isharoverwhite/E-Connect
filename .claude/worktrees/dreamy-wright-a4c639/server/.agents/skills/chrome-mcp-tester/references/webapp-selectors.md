# WebApp UI Selectors for Yeelight Testing

## Page Structure

The eConnect webapp is a Next.js app (likely running at `http://localhost:3000`).

## Key Elements to Target

### Device Card
Each device (including Yeelight) is rendered inside a DeviceCard component.

```
File: webapp/src/components/DeviceCard.tsx (line 943+ for Yeelight-specific logic)
```

### Likely CSS Selectors / ARIA Labels

Based on the code structure, these are the elements to target:

```
// Device card container
[data-testid="device-card"] or .device-card

// Device name
[data-testid="device-name"] or .device-name

// Power toggle (switch)
[data-testid="power-toggle"] or .power-switch or button[aria-label*="power"]

// Brightness slider
[data-testid="brightness-slider"] or input[type="range"] or .brightness-slider

// Brightness value display
[data-testid="brightness-value"] or .brightness-value

// Color temperature control
[data-testid="color-temp"] or .color-temp-slider

// RGB color picker
[data-testid="color-picker"] or .color-picker
```

### Discovery Strategy

Since exact selectors may vary, use this strategy with Chrome MCP:

1. **Take snapshot** → find elements by text content ("Yeelight", lamp name)
2. **Evaluate script** to find interactive elements:
```javascript
// Find all Yeelight device cards
document.querySelectorAll('[class*="device" i]').forEach(el => {
  if (el.textContent.toLowerCase().includes('yeelight')) {
    console.log('Found Yeelight card:', el);
  }
});

// Find brightness slider
document.querySelectorAll('input[type="range"]');

// Find power toggles
document.querySelectorAll('button, [role="switch"], [role="checkbox"]');
```

### WebSocket Monitoring

```javascript
// Monitor WebSocket messages
const origWS = window.WebSocket;
window.WebSocket = function(...args) {
  const ws = new origWS(...args);
  const origOnMsg = ws.onmessage;
  ws.addEventListener('message', (e) => {
    const now = performance.now();
    try {
      const data = JSON.parse(e.data);
      if (data.type?.includes('device') || data.device_id) {
        console.log('[WS Device]', now.toFixed(0), data);
      }
    } catch {}
  });
  return ws;
};
```

### Network Request Monitoring

Key API calls to monitor:
- `GET /api/device/{device_id}` — Device state query
- `POST /api/device/{device_id}/command` — Command dispatch
- WebSocket messages with device state updates
