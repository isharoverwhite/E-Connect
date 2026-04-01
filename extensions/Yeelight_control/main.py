from yeelight_control import YeelightBulb

# Initialize the bulb with your IP
yeelight = YeelightBulb("192.168.2.111")
connect = yeelight.connect()
# Connect to the bulb
try:
    if connect:
        # Toggle the bulb
        data = yeelight.get_props()
        print("connect: " + str(connect))
        print(data[2].strip("-"))
    else:
        print("Failed to connect to the bulb.")
except TypeError as e:
    print(f"An error occurred: {e}")
finally:
    yeelight.close()