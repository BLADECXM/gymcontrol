// routes/portal.routes.js - Portal de Autoservicio para Clientes (/mi-portal)
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');

router.get('/', permitirRoles('Cliente'), async (req, res) => {
    const correoUsuario = req.session.usuario.correo;

    try {
        // 1. Buscar el perfil de miembro vinculado por correo
        const miembroRes = await pool.query(
            'SELECT * FROM miembros WHERE LOWER(correo) = LOWER($1) LIMIT 1',
            [correoUsuario]
        );

        if (miembroRes.rows.length === 0) {
            return res.render('mi_portal', {
                miembro: null,
                estadoMembresia: null,
                pagos: [],
                clases: [],
                checkins: [],
                error: 'Tu cuenta aún no está vinculada a un perfil de miembro. Verifica en recepción que tu correo coincida.'
            });
        }

        const miembro = miembroRes.rows[0];

        // 2. Consultar en paralelo: pagos, clases inscritas y últimos check-ins
        const [pagosRes, clasesRes, checkinsRes] = await Promise.all([
            pool.query(`
                SELECT p.*, pl.nombre_plan
                FROM pagos_membresia p
                JOIN planes_membresia pl ON p.id_plan = pl.id_plan
                WHERE p.id_miembro = $1 AND p.anulado = FALSE
                ORDER BY p.fecha_vencimiento DESC
            `, [miembro.id_miembro]),

            pool.query(`
                SELECT c.nombre_clase, c.dia_semana, c.hora_inicio, c.hora_fin,
                       COALESCE(u.nombre_completo, 'Por asignar') AS entrenador
                FROM inscripciones_clase i
                JOIN clases_horarios c ON i.id_clase = c.id_clase
                LEFT JOIN usuarios u ON c.id_entrenador = u.id_usuario
                WHERE i.id_miembro = $1 AND c.activo = TRUE
                ORDER BY c.dia_semana ASC
            `, [miembro.id_miembro]),

            pool.query(`
                SELECT fecha_hora, acceso_permitido, detalle_estado
                FROM asistencias_checkin
                WHERE id_miembro = $1
                ORDER BY fecha_hora DESC
                LIMIT 10
            `, [miembro.id_miembro])
        ]);

        // 3. Calcular estado de membresía actual
        let estadoMembresia = {
            vigente: false,
            plan: 'Sin membresía activa',
            vence: null,
            diasRestantes: 0
        };

        if (pagosRes.rows.length > 0) {
            const ultimo = pagosRes.rows[0];
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const vence = new Date(ultimo.fecha_vencimiento);
            vence.setHours(0, 0, 0, 0);

            const diasRestantes = Math.ceil((vence - hoy) / (1000 * 60 * 60 * 24));

            estadoMembresia = {
                vigente: diasRestantes >= 0,
                plan: ultimo.nombre_plan,
                vence: vence.toLocaleDateString('es-HN'),
                diasRestantes
            };
        }

        res.render('mi_portal', {
            miembro,
            estadoMembresia,
            pagos: pagosRes.rows,
            clases: clasesRes.rows,
            checkins: checkinsRes.rows,
            error: null
        });

    } catch (error) {
        console.error('Error cargando portal del cliente:', error);
        res.render('mi_portal', {
            miembro: null,
            estadoMembresia: null,
            pagos: [],
            clases: [],
            checkins: [],
            error: 'Ocurrió un error al cargar tu información.'
        });
    }
});

module.exports = router;