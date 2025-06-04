require('dotenv').config();
const { Pool } = require('pg');

// Configuración de la conexión a la base de datos PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Usar una variable de entorno para la URL de conexión
  ssl: {
    rejectUnauthorized: false // Puede ser necesario para Clever Cloud si usan SSL autofirmado
  }
});

pool.on('connect', () => {
  console.log('Conectado a la base de datos PostgreSQL');
});

pool.on('error', (err) => {
  console.error('Error de conexión a la base de datos PostgreSQL:', err);
  process.exit(-1); // Salir de la aplicación si hay un error fatal en la conexión
});

module.exports = pool; 