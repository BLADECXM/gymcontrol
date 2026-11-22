// routes/checkin.routes.js - Proceso 6: Check-in diario y validación de acceso por DNI
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');

// Función auxiliar para traer los check-ins del día
async function obtenerCheckinsHoy() {
    const res = await pool.query(`
        SELECT a.*, m.nombre_completo, m.dni, u.nombre_completo AS recepcionista
        FROM asistencias_checkin a
        JOIN miembros m ON a.id_miembro = m.id_miembro
        JOIN usuarios u ON a.id_usuario = u.id_usuario
        WHERE DATE(a.fecha_hora) = CURRENT_DATE
        ORDER BY a.id_checkin DESC
    `);
    return res.rows;
}

// Mostrar pantalla de Check-in
router.get('/', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    try {
        const checkinsHoy = await obtenerCheckinsHoy();
        res.render('checkin', {
            resultado: null,
            error: null,
            checkinsHoy
        });
    } catch (error) {
        console.error('Error cargando check-in:', error);
        res.render('checkin', {
            resultado: null,
            error: 'Error al cargar el historial de asistencias.',
            checkinsHoy: []
        });
    }
});

// Validar DNI y registrar Check-in
router.post('/validar', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const dni = req.body.dni ? req.body.dni.trim() : '';
    const idUsuario = req.session.usuario.id;

    try {
        // 1. Buscar al miembro por DNI
        const miembroRes = await pool.query('SELECT * FROM miembros WHERE dni = $1', [dni]);

        if (miembroRes.rows.length === 0) {
            const checkinsHoy = await obtenerCheckinsHoy();
            return res.render('checkin', {
                resultado: null,
                error: `No se encontró ningún miembro registrado con el DNI "${dni}".`,
                checkinsHoy
            });
        }

        const miembro = miembroRes.rows[0];

        // 2. Buscar su último pago válido (no anulado)
        const pagoRes = await pool.query(`
            SELECT p.fecha_vencimiento, pl.nombre_plan
            FROM pagos_membresia p
            JOIN planes_membresia pl ON p.id_plan = pl.id_plan
            WHERE p.id_miembro = $1 AND p.anulado = FALSE
            ORDER BY p.fecha_vencimiento DESC
            LIMIT 1
        `, [miembro.id_miembro]);

        let accesoPermitido = false;
        let detalleEstado = '';
        let diasRestantes = 0;
        let nombrePlan = 'Sin plan';

        if (!miembro.activo) {
            accesoPermitido = false;
            detalleEstado = 'Miembro inactivo en el sistema';
        } else if (pagoRes.rows.length === 0) {
            accesoPermitido = false;
            detalleEstado = 'Sin membresía registrada';
        } else {
            const pago = pagoRes.rows[0];
            nombrePlan = pago.nombre_plan;

            // Comparar fechas sin horas para evitar desfases
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const vence = new Date(pago.fecha_vencimiento);
            vence.setHours(0, 0, 0, 0);

            const diffMs = vence - hoy;
            diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            const venceStr = vence.toLocaleDateString('es-HN');

            if (diasRestantes >= 0) {
                accesoPermitido = true;
                detalleEstado = `Vigente hasta ${venceStr} (${diasRestantes} días restantes)`;
            } else {
                accesoPermitido = false;
                detalleEstado = `Membresía vencida el ${venceStr}`;
            }
        }

        // 3. Registrar el intento de check-in en D4 (asistencias_checkin)
        await pool.query(
            `INSERT INTO asistencias_checkin (id_miembro, id_usuario, acceso_permitido, detalle_estado)
             VALUES ($1, $2, $3, $4)`,
            [miembro.id_miembro, idUsuario, accesoPermitido, detalleEstado]
        );

        const checkinsHoy = await obtenerCheckinsHoy();

        res.render('checkin', {
            resultado: {
                miembro,
                nombrePlan,
                accesoPermitido,
                detalleEstado,
                diasRestantes
            },
            error: null,
            checkinsHoy
        });

    } catch (error) {
        console.error('Error validando check-in:', error);
        res.render('checkin', {
            resultado: null,
            error: 'Ocurrió un error al validar el acceso.',
            checkinsHoy: []
        });
    }
});

module.exports = router;