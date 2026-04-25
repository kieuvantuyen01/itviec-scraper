import mysql.connector
from mysql.connector import Error
from .constants import db_config

def save_to_db(companies):
    if not companies:
        print("No companies found to save.")
        return

    try:
        connection = mysql.connector.connect(
            host=db_config['host'],
            user=db_config['user'],
            password=db_config['password'],
            database=db_config['database']
        )

        if connection.is_connected():
            cursor = connection.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS companies (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    city VARCHAR(255),
                    type VARCHAR(255),
                    description TEXT,
                    general_info TEXT,
                    overview TEXT,
                    key_skills TEXT,
                    location TEXT,
                    love_working_here TEXT
                )
            """)

            insert_query = """
                INSERT INTO companies (name, city, type, description, general_info, overview, key_skills, location, love_working_here)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """

            for company in companies:
                cursor.execute(insert_query, (
                    company.get('Name'),
                    company.get('City'),
                    company.get('Type'),
                    company.get('Description'),
                    company.get('General Information'),
                    company.get('Company Overview'),
                    company.get('Our Key Skills'),
                    company.get('Location'),
                    company.get('Why You\'ll Love Working Here')
                ))

            connection.commit()
            print("Data saved to MySQL database successfully.")

    except Error as e:
        print(f"Error: {e}")
    finally:
        if connection.is_connected():
            cursor.close()
            connection.close()
