# Archivo WSGI para PythonAnywhere
# Este archivo importa tu app Flask para que el servidor la pueda ejecutar.

from app import app, init_db

# Inicializar la base de datos al arrancar
init_db()

# PythonAnywhere busca una variable llamada "application"
application = app
