import sqlite3

conn = sqlite3.connect("study.db")
conn.row_factory = sqlite3.Row

# Contar registros
total = conn.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
print(f"Total de registros en la base de datos: {total}\n")

# Mostrar los últimos 20
rows = conn.execute("SELECT * FROM sessions ORDER BY ts DESC LIMIT 20").fetchall()

if rows:
    print(f"{'ID':>4} | {'Fecha':>10} | {'Hora':>5} | {'Min':>4} | {'Tipo':<20} | {'Modo':<10}")
    print("-" * 70)
    for r in rows:
        print(f"{r['id']:>4} | {r['date']:>10} | {r['time']:>5} | {r['minutes']:>4} | {r['type']:<20} | {r['mode']:<10}")
else:
    print("La base de datos está vacía.")

conn.close()
