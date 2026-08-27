# Archivo WSGI para PythonAnywhere
# Este archivo importa tu app Flask para que el servidor la pueda ejecutar.

import os

# PythonAnywhere sirve siempre por HTTPS, así que la cookie de sesión puede
# llevar el atributo Secure. Se usa setdefault para poder desactivarlo con
# FOCUSDATA_HTTPS=0 si algún día se despliega detrás de HTTP plano.
os.environ.setdefault("FOCUSDATA_HTTPS", "1")

from app import app, init_db

# Inicializar la base de datos al arrancar
init_db()

# PythonAnywhere busca una variable llamada "application"
application = app
