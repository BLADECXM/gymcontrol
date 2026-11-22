// routes/planes.routes.js - Proceso 2: Mantenimiento de Planes y Tarifas
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');

// Listar planes
router.get('/', permitirRoles('Administrador'), async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM planes_membresia ORDER BY id_plan ASC');
        res.render('planes', {
            planes: resultado.rows,
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error cargando planes:', error);
        res.render('planes', { planes: [], mensaje: null, error: 'Error al cargar los planes.' });
    }
});

// Crear plan
router.post('/crear', permitirRoles('Administrador'), async (req, res) => {
    const { nombre_plan, precio_lempiras, duracion_dias } = req.body;
    try {
        await pool.query(
            `INSERT INTO planes_membresia (nombre_plan, precio_lempiras, duracion_dias)
             VALUES ($1, $2, $3)`,
            [nombre_plan.trim(), parseFloat(precio_lempiras), parseInt(duracion_dias)]
        );
        res.redirect('/planes?msg=Plan creado correctamente.');
    } catch (error) {
        console.error('Error creando plan:', error);
        const msg = error.code === '23505' ? 'Ya existe un plan con ese nombre.' : 'No se pudo crear el plan.';
        res.redirect(`/planes?err=${encodeURIComponent(msg)}`);
    }
});

// Editar plan
router.post('/editar/:id', permitirRoles('Administrador'), async (req, res) => {
    const { id } = req.params;
    const { nombre_plan, precio_lempiras, duracion_dias } = req.body;
    try {
        await pool.query(
            `UPDATE planes_membresia
             SET nombre_plan = $1, precio_lempiras = $2, duracion_dias = $3
             WHERE id_plan = $4`,
            [nombre_plan.trim(), parseFloat(precio_lempiras), parseInt(duracion_dias), id]
        );
        res.redirect('/planes?msg=Plan actualizado correctamente.');
    } catch (error) {
        console.error('Error editando plan:', error);
        res.redirect('/planes?err=No se pudo actualizar el plan.');
    }
});

// Activar / Desactivar plan
router.post('/estado/:id', permitirRoles('Administrador'), async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE planes_membresia SET activo = NOT activo WHERE id_plan = $1', [id]);
        res.redirect('/planes?msg=Estado del plan actualizado.');
    } catch (error) {
        console.error('Error cambiando estado del plan:', error);
        res.redirect('/planes?err=No se pudo cambiar el estado.');
    }
});

module.exports = router;