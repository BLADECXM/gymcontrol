// crearAdmin.js - Ejecutar una sola vez con: node crearAdmin.js
const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function crearAdmin() {
    try {
        const nombre = 'Ostin Crisanto';
        const correo = 'admin@gymcontrol.com';
        const clavePlana = 'Admin123*'; // Puedes cambiarla luego
        const claveHash = await bcrypt.hash(clavePlana, 10);

        // Buscamos el id del rol Administrador
        const rolRes = await pool.query("SELECT id_rol FROM roles WHERE nombre_rol = 'Administrador'");
        const idRol = rolRes.rows[0].id_rol;

        await pool.query(
            `INSERT INTO usuarios (id_rol, nombre_completo, correo, clave_hash)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (correo) DO NOTHING`,
            [idRol, nombre, correo, claveHash]
        );

        console.log('✅ Usuario Administrador listo:', correo, '| Clave:', clavePlana);
    } catch (error) {
        console.error('❌ Error creando admin:', error.message);
    } finally {
        pool.end();
    }
}

crearAdmin();