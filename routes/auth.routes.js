// routes/auth.routes.js - Proceso 1: Autenticación y Dashboard inicial
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const rateLimit = require('express-rate-limit');
const { verificarSesion } = require('../middleware/auth');
const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    handler: (req, res) => {
        res.status(429).render('login', {
            error: 'Demasiados intentos fallidos. Intenta nuevamente en 10 minutos.'
        });
    }
});

// Mostrar pantalla de Login
router.get('/login', (req, res) => {
    if (req.session.usuario) {
        return res.redirect('/dashboard');
    }
    res.render('login', { error: null });
});


// Procesar inicio de sesión por Código de Usuario
router.post('/login', loginLimiter, async (req, res) => {
    const { codigo_usuario, clave } = req.body;

    if (!codigo_usuario || !clave) {
        return res.render('login', { error: 'Debes ingresar tu código de usuario y contraseña.' });
    }

    try {
        const resultado = await pool.query(
            `SELECT u.id_usuario, u.codigo_usuario, u.nombre_completo, u.correo, u.clave_hash, u.activo, r.nombre_rol
             FROM usuarios u
             JOIN roles r ON u.id_rol = r.id_rol
             WHERE UPPER(u.codigo_usuario) = UPPER($1)`,
            [codigo_usuario.trim()]
        );

        if (resultado.rows.length === 0) {
            return res.render('login', { error: 'Código de usuario o contraseña incorrectos.' });
        }

        const user = resultado.rows[0];

        if (!user.activo) {
            return res.render('login', { error: 'Tu usuario está inactivo. Contacta al administrador.' });
        }

        const claveValida = await bcrypt.compare(clave, user.clave_hash);
        if (!claveValida) {
            return res.render('login', { error: 'Código de usuario o contraseña incorrectos.' });
        }

        req.session.usuario = {
            id: user.id_usuario,
            codigo: user.codigo_usuario,
            nombre: user.nombre_completo,
            correo: user.correo,
            rol: user.nombre_rol
        };

        if (user.nombre_rol === 'Cliente') {
            return res.redirect('/mi-portal');
        }
        res.redirect('/dashboard');

    } catch (error) {
        console.error('Error en login:', error);
        res.render('login', { error: 'Ocurrió un error al conectar con el servidor.' });
    }
});

// Dashboard principal con indicadores rápidos del día
router.get('/dashboard', verificarSesion, async (req, res) => {
    try {
        const miembrosActivos = await pool.query('SELECT COUNT(*) FROM miembros WHERE activo = TRUE');
        const checkinsHoy = await pool.query(
            'SELECT COUNT(*) FROM asistencias_checkin WHERE DATE(fecha_hora) = CURRENT_DATE'
        );
        const ingresosHoy = await pool.query(
            'SELECT COALESCE(SUM(monto_pagado), 0) AS total FROM pagos_membresia WHERE DATE(fecha_pago) = CURRENT_DATE AND anulado = FALSE'
        );

        res.render('dashboard', {
            stats: {
                miembros: miembrosActivos.rows[0].count,
                checkins: checkinsHoy.rows[0].count,
                ingresos: parseFloat(ingresosHoy.rows[0].total).toFixed(2)
            }
        });
    } catch (error) {
        console.error('Error cargando dashboard:', error);
        res.render('dashboard', { stats: { miembros: 0, checkins: 0, ingresos: '0.00' } });
    }
});

// Cerrar sesión
router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
});

module.exports = router;