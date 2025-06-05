const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.MYSQL_ADDON_HOST,
  user: process.env.MYSQL_ADDON_USER,
  password: process.env.MYSQL_ADDON_PASSWORD,
  database: process.env.MYSQL_ADDON_DB,
  port: process.env.MYSQL_ADDON_PORT,
  waitForConnections: true,
  connectionLimit: 10, // Puedes ajustar este valor si es necesario
  queueLimit: 0
});

pool.getConnection()
  .then(connection => {
    console.log('Conectado a la base de datos MySQL');
    connection.release(); // Liberar la conexión inmediatamente después de la prueba
  })
  .catch(err => {
    console.error('Error de conexión a la base de datos MySQL:', err);
    process.exit(-1);
  });

module.exports = pool; 