// config/db.js - Conexión centralizada a Supabase (PostgreSQL Cloud)
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Necesario para conexiones en la nube con Supabase
    }
});

// Prueba rapida de conexión al arrancar
pool.connect()
    .then(() => console.log('Conectado exitosamente a Supabase (PostgreSQL)'))
    .catch((err) => console.error('Error al conectar con Supabase:', err.message));

module.exports = pool;