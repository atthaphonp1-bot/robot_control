import sqlite3
import requests 
import os 

class DB:
    def __init__(self, db_path=None):
        self.db_path = db_path

    def execute_db(self, db_name: str, query: str) -> tuple:
        """
        Execute a database query and return the result.

        Args:
            db_name (str): The name of the database to execute the query on.
            query (str): The SQL query to execute.

        Returns:
            tuple: A tuple containing a boolean value indicating whether the query
                was executed successfully, the query result (if any), and an error
                message (if an error occurred).
        """

        # Construct the path to the database file
        db_path = os.path.join(self.db_path, db_name)

        # Connect to the database
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        try:
            # Execute the query
            if self.debug_db:
                print(db_name,query)
            cursor.execute(query)

        except Exception as e:
            # If an error occurs, close the database connection and return an error message
            conn.commit()
            conn.close()
            return False, None, str(e)

        # If the query executed successfully, commit the changes and close the database connection
        conn.commit()
        conn.close()

        # Return a success flag and the query result
        return True, None, None


    def query_db(self, db_name, query):
        """
        Connects to the specified SQLite database and executes the given query.

        Args:
            db_name (str): The name of the database file (e.g. "mydatabase.db").
            query (str): The SQL query to execute.

        Returns:
            A list of dictionaries, where each dictionary represents a row in the result set, with the keys being the column names.
        """
        db_path = os.path.join(self.db_path, db_name)
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        try:
            cursor.execute(query)

        except Exception as e:
            conn.commit()
            conn.close()
            return False,None,e
        
        result_set = cursor.fetchall()
        

        # Get the column names from the cursor description
        column_names = [desc[0] for desc in cursor.description]

        # Convert the result set to a list of dictionaries
        # result_list = []
        for row in result_set:
            row_dict = {}
            for i in range(len(row)):
                row_dict[column_names[i]] = row[i]
            # result_list.append(row_dict)

        # Close the connection and return the result list        
        conn.commit()
        conn.close()
        
        return True,row_dict,'Done'
    
    def get_motor_settings(self, motor_axis_no, database='static_robot.db'):
        """
        Retrieves the robot settings from the database.

        Returns:
        * ret (bool): True if the query was successful, False otherwise.
        * dat (list): A list of dictionaries, where each dictionary represents a setting in the database.
                    Each dictionary has the following keys: 'id', 'name', and 'data'.
        * msg (str): A message describing the status of the query.
        """
        query = f"""
            SELECT no, code, axis_no, home_direction, encoder_ratio, encoder_slip, current_run, current_hold, stealth_mode, torque_watch
            FROM motor 
            WHERE axis_no = {motor_axis_no};
        """
        print(query)
        ret, dat, msg = self.query_db(database, query)
        print(ret, dat, msg)
        return ret, dat, msg

    def get_all_motors(self, database='static_robot.db'):
        """
        Retrieve every motor row from a robot_static database.

        Unlike query_db (which only returns the last row), this returns the full
        result set as a list of dicts so the control UI can render all axes.

        Returns:
            (ret, rows, msg): ret is True on success, rows is a list of dicts.
        """
        db_path = os.path.join(self.db_path, database)
        query = """
            SELECT no, code, axis_no, home_direction, encoder_ratio, encoder_slip,
                   current_run, current_hold, stealth_mode, torque_watch,
                   stroke_min, stroke_max, default_position, default_speed,
                   default_acc, step, origin_pos
            FROM motor
            ORDER BY axis_no;
        """
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            cursor.execute(query)
            columns = [desc[0] for desc in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            conn.close()
            return True, rows, 'Done'
        except Exception as e:
            return False, [], str(e)

    def get_active_robot_static_db(self, ems_config_filename='ems_config.db'):
        """
        Resolve which robot_static database to use by reading ems_config.db.

        Looks up the active unit (config_name.active = 1) and returns the value of
        its 'robot_static_db' entry in config_data. Returns None on any error or
        if the config / value is missing, so callers can fall back to env.json.
        """
        db_path = os.path.join(self.db_path, ems_config_filename)
        if not os.path.exists(db_path):
            return None
        try:
            conn = sqlite3.connect(db_path)
            cursor = conn.cursor()
            row = cursor.execute(
                "SELECT id FROM config_name WHERE active = 1 LIMIT 1;"
            ).fetchone()
            if not row:
                conn.close()
                return None
            config_id = row[0]
            row = cursor.execute(
                "SELECT config_value FROM config_data "
                "WHERE config_id = ? AND config_key = 'robot_static_db' LIMIT 1;",
                (config_id,),
            ).fetchone()
            conn.close()
            return row[0] if row else None
        except Exception:
            return None