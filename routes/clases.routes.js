// routes/clases.routes.js - Procesos 3 y 4: Clases, Horarios, Inscripciones y Asistencia
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');

// Listar clases con cupos ocupados, entrenadores y miembros activos
router.get('/', permitirRoles('Administrador', 'Recepcionista', 'Entrenador'), async (req, res) => {
    try {
        const clasesRes = await pool.query(`
            SELECT c.*, 
                   COALESCE(u.nombre_completo, 'Sin asignar') AS entrenador_nombre,
                   COUNT(i.id_inscripcion) AS inscritos
            FROM clases_horarios c
            LEFT JOIN usuarios u ON c.id_entrenador = u.id_usuario
            LEFT JOIN inscripciones_clase i ON c.id_clase = i.id_clase
            WHERE c.activo = TRUE
            GROUP BY c.id_clase, u.nombre_completo
            ORDER BY c.id_clase DESC
        `);

        // Entrenadores disponibles (incluye Admin por si imparte clases)
        const entrenadoresRes = await pool.query(`
            SELECT u.id_usuario, u.nombre_completo
            FROM usuarios u
            JOIN roles r ON u.id_rol = r.id_rol
            WHERE r.nombre_rol IN ('Entrenador', 'Administrador') AND u.activo = TRUE
            ORDER BY u.nombre_completo ASC
        `);

        // Miembros activos para el modal de inscripción
        const miembrosRes = await pool.query(`
            SELECT id_miembro, dni, nombre_completo
            FROM miembros
            WHERE activo = TRUE
            ORDER BY nombre_completo ASC
        `);

        res.render('clases', {
            clases: clasesRes.rows,
            entrenadores: entrenadoresRes.rows,
            miembros: miembrosRes.rows,
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error cargando clases:', error);
        res.render('clases', {
            clases: [],
            entrenadores: [],
            miembros: [],
            mensaje: null,
            error: 'Error al cargar el catálogo de clases.'
        });
    }
});

// Crear nueva clase y horario (Solo Administrador)
router.post('/crear', permitirRoles('Administrador'), async (req, res) => {
    const { nombre_clase, id_entrenador, dia_semana, hora_inicio, hora_fin, cupo_maximo } = req.body;

    try {
        await pool.query(
            `INSERT INTO clases_horarios (nombre_clase, id_entrenador, dia_semana, hora_inicio, hora_fin, cupo_maximo)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [nombre_clase.trim(), id_entrenador || null, dia_semana, hora_inicio, hora_fin, parseInt(cupo_maximo)]
        );
        res.redirect('/clases?msg=Clase creada correctamente.');
    } catch (error) {
        console.error('Error creando clase:', error);
        res.redirect('/clases?err=No se pudo crear la clase.');
    }
});

// Inscribir un miembro a una clase (validando cupo disponible)
router.post('/inscribir', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const { id_clase, id_miembro } = req.body;

    try {
        // 1. Verificar cupo disponible
        const cupoRes = await pool.query(`
            SELECT c.cupo_maximo, COUNT(i.id_inscripcion) AS inscritos
            FROM clases_horarios c
            LEFT JOIN inscripciones_clase i ON c.id_clase = i.id_clase
            WHERE c.id_clase = $1
            GROUP BY c.cupo_maximo
        `, [id_clase]);

        if (cupoRes.rows.length === 0) {
            return res.redirect('/clases?err=La clase seleccionada no existe.');
        }

        const { cupo_maximo, inscritos } = cupoRes.rows[0];
        if (parseInt(inscritos) >= parseInt(cupo_maximo)) {
            return res.redirect('/clases?err=Cupo lleno. No hay espacios disponibles en esta clase.');
        }

        // 2. Registrar inscripción
        await pool.query(
            `INSERT INTO inscripciones_clase (id_clase, id_miembro)
             VALUES ($1, $2)`,
            [id_clase, id_miembro]
        );

        res.redirect('/clases?msg=Miembro inscrito exitosamente en la clase.');
    } catch (error) {
        console.error('Error inscribiendo miembro:', error);
        const msgError = error.code === '23505'
            ? 'Este miembro ya está inscrito en esa clase.'
            : 'No se pudo completar la inscripción.';
        res.redirect(`/clases?err=${encodeURIComponent(msgError)}`);
    }
});

// Ver inscritos de una clase y tomar asistencia de hoy (Proceso 4)
router.get('/:id/asistencia', permitirRoles('Administrador', 'Entrenador', 'Recepcionista'), async (req, res) => {
    const { id } = req.params;

    try {
        const claseRes = await pool.query(`
            SELECT c.*, COALESCE(u.nombre_completo, 'Sin asignar') AS entrenador_nombre
            FROM clases_horarios c
            LEFT JOIN usuarios u ON c.id_entrenador = u.id_usuario
            WHERE c.id_clase = $1
        `, [id]);

        if (claseRes.rows.length === 0) {
            return res.redirect('/clases?err=Clase no encontrada.');
        }

        // Traer inscritos junto con su estado de asistencia de HOY (si ya se pasó lista)
        const inscritosRes = await pool.query(`
            SELECT m.id_miembro, m.dni, m.nombre_completo, m.telefono,
                   a.asistio AS asistio_hoy
            FROM inscripciones_clase i
            JOIN miembros m ON i.id_miembro = m.id_miembro
            LEFT JOIN asistencias_clase a
              ON a.id_clase = i.id_clase
             AND a.id_miembro = i.id_miembro
             AND a.fecha_clase = CURRENT_DATE
            WHERE i.id_clase = $1
            ORDER BY m.nombre_completo ASC
        `, [id]);

        res.render('clase_asistencia', {
            clase: claseRes.rows[0],
            inscritos: inscritosRes.rows,
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error cargando asistencia de clase:', error);
        res.redirect('/clases?err=Error al cargar la lista de la clase.');
    }
});

// Guardar asistencia del día (Entrenador / Administrador)
router.post('/:id/asistencia', permitirRoles('Administrador', 'Entrenador'), async (req, res) => {
    const { id } = req.params;
    const idEntrenador = req.session.usuario.id;

    // Los checkboxes marcados llegan como array o string único
    let presentes = req.body.presentes || [];
    if (!Array.isArray(presentes)) {
        presentes = [presentes];
    }

    try {
        // Obtener todos los inscritos de la clase para marcar presentes y ausentes
        const inscritosRes = await pool.query(
            'SELECT id_miembro FROM inscripciones_clase WHERE id_clase = $1',
            [id]
        );

        for (const row of inscritosRes.rows) {
            const asistio = presentes.includes(String(row.id_miembro));
            await pool.query(`
                INSERT INTO asistencias_clase (id_clase, id_miembro, id_entrenador, fecha_clase, asistio)
                VALUES ($1, $2, $3, CURRENT_DATE, $4)
                ON CONFLICT (id_clase, id_miembro, fecha_clase)
                DO UPDATE SET asistio = EXCLUDED.asistio, id_entrenador = EXCLUDED.id_entrenador
            `, [id, row.id_miembro, idEntrenador, asistio]);
        }

        res.redirect(`/clases/${id}/asistencia?msg=Asistencia de hoy guardada correctamente.`);
    } catch (error) {
        console.error('Error guardando asistencia:', error);
        res.redirect(`/clases/${id}/asistencia?err=No se pudo guardar la asistencia.`);
    }
});

module.exports = router;