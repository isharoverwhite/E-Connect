# E-Connect Extension Development Guide

[Tiếng Việt](#tiếng-việt) | [English](#english)

---

## Tiếng Việt

Tài liệu này Hướng dẫn chi tiết cách tự xây dựng và đóng gói Extension (Tiện ích mở rộng) cho E-Connect.

E-Connect sử dụng hệ thống Extension viết bằng Python, được upload dưới dạng file nén `.zip`. Sau khi upload, backend phân tích `manifest.json`, giải nén và gọi động (dynamic import) các hàm hook mà bạn khai báo.

### 1. Yêu cầu & Ràng buộc chuẩn

Để Extension hoạt động hợp lệ:
- Extension đóng gói thành file `.zip` (Tối đa 5MB).
- Chứa file `manifest.json` nằm ở thư mục gốc của file zip hoặc nằm ngay trong 1 thư mục con cấp 1.
- Logic được viết bằng Python (hiện tại hỗ trợ `runtime`: "python").
- Cấu trúc thư mục tương tự như sau:
  ```text
  my-extension/
  ├── manifest.json
  ├── main.py
  └── requirements.txt (nếu có các module bổ trợ) 
  ```

### 2. Cách viết `manifest.json`

File `manifest.json` là định nghĩa bắt buộc phải có cho mọi extension.

```json
{
  "manifest_version": "1.0",
  "extension_id": "my_smart_light",
  "name": "My Smart Light Integration",
  "version": "1.0.0",
  "description": "Kết nối và điều khiển đèn thông minh nội bộ",
  "author": "Your Name",
  "provider": {
    "key": "my_brand",
    "display_name": "My Brand Provider"
  },
  "package": {
    "runtime": "python",
    "entrypoint": "main.py",
    "hooks": {
      "validate_command": "on_validate_command",
      "execute_command": "on_execute_command",
      "probe_state": "on_probe_state"
    }
  },
  "device_schemas": [
    {
      "schema_id": "dimmer_light",
      "name": "Dimmer Light",
      "display": {
        "card_type": "light",
        "capabilities": ["power", "brightness"]
      },
      "config_schema": {
        "fields": [
          {
            "key": "ip_address",
            "label": "IP Address",
            "type": "string",
            "required": true
          }
        ]
      }
    }
  ]
}
```

*Lưu ý:*
- `extension_id`, `schema_id`, `config_schema.fields.key` cần viết đúng định dạng lowercase (vd: `a-z0-9_-`).
- `display.card_type` hiện tại hỗ trợ giá trị `light`.
- `capabilities` hỗ trợ: `power`, `brightness`, `rgb`, `color_temperature`.
- `config_schema.fields.type` hỗ trợ: `string`, `number`, `boolean`.
- Thuộc tính `hooks` trong `package` cho phép map tên hook nội bộ sang tên function Python của bạn trong `entrypoint`. Nếu để trống, server mặc định tìm 3 hàm: `validate_command`, `execute_command`, `probe_state`.

### 3. Cách khai báo Logic trong Code (Python)

Trong `main.py` khai báo trong trường `entrypoint`, bạn sẽ viết các hàm thao tác. Server sẽ import động các hàm này và truyền tham số thiết bị tương ứng vào logic của mình. 

```python
# main.py

def on_validate_command(command_context):
    """
    Hàm xác thực command trước khi thực thi
    """
    print(f"Validating command: {command_context}")
    return True

def on_execute_command(command_context):
    """
    Hàm thực thi câu lệnh điều khiển thiết bị
    """
    device_config = command_context.get("config", {})
    ip = device_config.get("ip_address")
    action = command_context.get("command")
    
    # Thực hiện thao tác với thiết bị thông qua requests hoặc api nội bộ 
    print(f"Sending {action} to {ip}...")
    return {"status": "success"}

def on_probe_state(device_context):
    """
    Hàm thăm dò lấy trạng thái hiện tại của thiết bị
    """
    device_config = device_context.get("config", {})
    ip = device_config.get("ip_address")
    
    # Gọi tới IP để lấy trạng thái thực tế
    return {
        "connected": True,
        "state": {
            "power": "on",
            "brightness": 100
        }
    }
```

### 4. Quá trình Backend (Server) nạp Extension

- **Upload & Cài đặt:** File ZIP được upload lên backend. Payload qua validation và extract vào `/data/extensions/extracted/`.
- **Dynamic Module Loading:** Trong quá trình runtime, E-Connect thiết lập `sys.path` ưu tiên để import biệt lập package Python bên trong entrypoint. Nó quét và ánh xạ chính xác hàm Hook mà Manifest đã định danh.
- **Thực thi:** Khi có sự kiện (validate, execute, read), request sẽ đi tới controller. Tại đây, backend đẩy object thiết bị và data JSON đã được schema validate chuẩn để truyền thành đối số gọi hàm. 

Bạn có thể test trực tiếp bằng cách nén (ZIP) file rồi upload qua màn Extension trong Admin WebUI. 

---

## English

This document provides a detailed guide on how to build and package your own Extensions for E-Connect.

E-Connect implements a Python-based Extension system packaged as `.zip` files. Once uploaded, the backend statically parses `manifest.json`, extracts resources, and performs a dynamic import to bind your specific lifecycle hooks. 

### 1. Requirements & Constraints
To build a valid Extension:
- Structure your workflow into a valid `.zip` archive (Max 5MB).
- Include `manifest.json` exactly at the root of the ZIP or directly within a single nested folder.
- Backend logic must be written in Python (we currently support `"runtime": "python"`).
- Recommended structure:
  ```text
  my-extension/
  ├── manifest.json
  ├── main.py
  └── requirements.txt (if necessary)
  ```

### 2. Writing `manifest.json`

The heart of every extension is `manifest.json`. It bridges your implementation with internal schemas.

```json
{
  "manifest_version": "1.0",
  "extension_id": "my_smart_light",
  "name": "My Smart Light Integration",
  "version": "1.0.0",
  "description": "Connect and control specialized smart lights",
  "author": "Your Name",
  "provider": {
    "key": "my_brand",
    "display_name": "My Brand Provider"
  },
  "package": {
    "runtime": "python",
    "entrypoint": "main.py",
    "hooks": {
      "validate_command": "on_validate_command",
      "execute_command": "on_execute_command",
      "probe_state": "on_probe_state"
    }
  },
  "device_schemas": [
    {
      "schema_id": "dimmer_light",
      "name": "Dimmer Light",
      "display": {
        "card_type": "light",
        "capabilities": ["power", "brightness"]
      },
      "config_schema": {
        "fields": [
          {
            "key": "ip_address",
            "label": "IP Address",
            "type": "string",
            "required": true
          }
        ]
      }
    }
  ]
}
```

*Key Schema Details:*
- Identifiers (`extension_id`, `schema_id`, `fields.key`) must perfectly match the `a-z0-9_-` lowercase pattern.
- `display.card_type` currently supports `light`.
- Sub `capabilities` strictly support: `power`, `brightness`, `rgb`, `color_temperature`.
- Provided `config_schema.fields.type` bindings are `string`, `number`, `boolean`.
- Inside `package.hooks`, you assign internal hooks mapped directly to your actual Python functions in your `entrypoint` file. If omitted, the default assumed hook names are strictly: `validate_command`, `execute_command`, and `probe_state`.

### 3. Hook Declaration inside Python

In `main.py` (your `entrypoint`), implement the bound hooks. The server actively invokes these references, dynamically passing evaluated device parameters according to definitions in your device scheme.

```python
# main.py

def on_validate_command(command_context):
    """
    Invoked prior to command dispatch. Check input safety here.
    """
    print(f"Validating command: {command_context}")
    return True

def on_execute_command(command_context):
    """
    Invoked to apply settings onto target devices.
    """
    device_config = command_context.get("config", {})
    ip = device_config.get("ip_address")
    action = command_context.get("command")
    
    # Process actions (like HTTP requests / LAN pushes)
    print(f"Sending {action} to {ip}...")
    return {"status": "success"}

def on_probe_state(device_context):
    """
    Invoked periodically by the background tasks to reflect live state loops.
    """
    device_config = device_context.get("config", {})
    ip = device_config.get("ip_address")
    
    # Run fetch commands across your network to check component liveness
    return {
        "connected": True,
        "state": {
            "power": "on",
            "brightness": 100
        }
    }
```

### 4. How the Server Consumes an Extension

- **Upload & Extract:** The ZIP passes preliminary validation checks. Size, contents, and JSON schemas are deeply validated. If successful, resources extract to `/data/extensions/extracted/`.
- **Dynamic Module Loader:** E-Connect injects isolated `importlib` sys.paths to explicitly target the `package_root`. We iterate over bound `hooks` parsing exactly which functions are callable.
- **Event Invocation:** Once instantiated throughout your device definitions, each API trigger provides the respective schema-validated dictionary straight to your functions seamlessly!

Simply compress (ZIP) your folder, head to the extensions menu on the dashboard, upload the package, and test out your functions.
