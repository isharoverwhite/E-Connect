import pymysql

connection = pymysql.connect(host='100.82.44.52', user='root', password='root_password', database='e_connect_db')
try:
    with connection.cursor() as cursor:
        cursor.execute("ALTER TABLE device_history MODIFY COLUMN event_type ENUM('state_change', 'online', 'offline', 'error', 'command_requested', 'command_failed') NOT NULL")
        connection.commit()
        print("Enum updated successfully.")
finally:
    connection.close()
