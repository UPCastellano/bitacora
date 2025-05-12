require('dotenv').config();
const mysql = require('mysql2/promise');

// Configuración de la conexión a la base de datos
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'b9bifbbpdpxex5rtkjba-mysql.services.clever-cloud.com',
  user: process.env.DB_USER || 'u10vawhkeqpflq8e',
  password: process.env.DB_PASSWORD || 'dLrHAL9rvCnHjuHLGhIW',
  database: process.env.DB_NAME || 'b9bifbbpdpxex5rtkjba',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool; 