import traceback
try:
    import app.main
    print("SUCCESS")
except Exception as e:
    print("ERROR:")
    traceback.print_exc()
