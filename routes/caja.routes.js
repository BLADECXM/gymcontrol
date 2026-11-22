// routes/caja.routes.js - Proceso 8: Apertura, Caja Chica y Cierre de Caja
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');

// Mostrar pantalla de Caja con resumen del día
router.get('/', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    try {
        // 1. Movimientos de caja registrados hoy
        const movRes = await pool.query(`
            SELECT m.*, u.nombre_completo AS usuario_nombre
            FROM movimientos_caja m
            JOIN usuarios u ON m.id_usuario = u.id_usuario
            WHERE DATE(m.fecha_hora) = CURRENT_DATE
            ORDER BY m.id_movimiento DESC
        `);

        // 2. Total de cobros de membresía en EFECTIVO de hoy (no anulados)
        const efectivoPagosRes = await pool.query(`
            SELECT COALESCE(SUM(monto_pagado), 0) AS total
            FROM pagos_membresia
            WHERE DATE(fecha_pago) = CURRENT_DATE
              AND metodo_pago = 'Efectivo'
              AND anulado = FALSE
        `);

        const movimientos = movRes.rows;
        const cobrosEfectivo = parseFloat(efectivoPagosRes.rows[0].total);

        // 3. Calcular totales del día para el arqueo
        let apertura = 0;
        let ingresosExtras = 0;
        let egresos = 0;
        let ultimoCierre = null;

        movimientos.forEach(m => {
            const monto = parseFloat(m.monto);
            if (m.tipo_movimiento === 'APERTURA') apertura += monto;
            if (m.tipo_movimiento === 'INGRESO') ingresosExtras += monto;
            if (m.tipo_movimiento === 'EGRESO') egresos += monto;
            if (m.tipo_movimiento === 'CIERRE' && ultimoCierre === null) {
                ultimoCierre = monto;
            }
        });

        const saldoEsperado = apertura + cobrosEfectivo + ingresosExtras - egresos;

        res.render('caja', {
            movimientos,
            resumen: {
                apertura: apertura.toFixed(2),
                cobrosEfectivo: cobrosEfectivo.toFixed(2),
                ingresosExtras: ingresosExtras.toFixed(2),
                egresos: egresos.toFixed(2),
                saldoEsperado: saldoEsperado.toFixed(2),
                ultimoCierre: ultimoCierre !== null ? ultimoCierre.toFixed(2) : null
            },
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error cargando caja:', error);
        res.render('caja', {
            movimientos: [],
            resumen: {
                apertura: '0.00',
                cobrosEfectivo: '0.00',
                ingresosExtras: '0.00',
                egresos: '0.00',
                saldoEsperado: '0.00',
                ultimoCierre: null
            },
            mensaje: null,
            error: 'Error al cargar los movimientos de caja.'
        });
    }
});

// Registrar movimiento de caja (APERTURA, INGRESO, EGRESO o CIERRE)
router.post('/movimiento', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const { tipo_movimiento, monto, descripcion } = req.body;
    const idUsuario = req.session.usuario.id;

    try {
        const montoNum = parseFloat(monto);
        if (isNaN(montoNum) || montoNum < 0) {
            return res.redirect('/caja?err=El monto debe ser un número válido mayor o igual a cero.');
        }

        await pool.query(
            `INSERT INTO movimientos_caja (id_usuario, tipo_movimiento, monto, descripcion)
             VALUES ($1, $2, $3, $4)`,
            [idUsuario, tipo_movimiento, montoNum, descripcion.trim()]
        );

        res.redirect(`/caja?msg=Movimiento de ${tipo_movimiento} registrado correctamente.`);
    } catch (error) {
        console.error('Error registrando movimiento de caja:', error);
        res.redirect('/caja?err=No se pudo registrar el movimiento.');
    }
});

module.exports = router;