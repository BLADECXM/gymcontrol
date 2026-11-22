const express = require('express');
const router = express.Router();
const pool = require('../config/db'); // Ajusta a '../db' si así lo usas en tus otras rutas

// Middleware local para permitir solo Entrenador y Administrador
function soloEntrenadorOAdmin(req, res, next) {
    const user = req.session.user || req.session.usuario;
    if (!user) return res.redirect('/login');
    if (user.rol !== 'Entrenador' && user.rol !== 'Administrador') {
        return res.redirect(user.rol === 'Cliente' ? '/mi-portal' : '/');
    }
    req.currentUser = user;
    next();
}

// Vista principal de Seguimiento y Rutinas
router.get('/', soloEntrenadorOAdmin, async (req, res) => {
    try {
        const idMiembroSeleccionado = req.query.miembro ? parseInt(req.query.miembro, 10) : null;

        // Listado de miembros disponibles para seguimiento
        const miembrosRes = await pool.query(
            `SELECT id_miembro, dni, nombre_completo, correo
             FROM miembros
             ORDER BY nombre_completo ASC`
        );

        let miembroActual = null;
        let evaluaciones = [];
        let rutinaActiva = null;
        let historialRutinas = [];
        let resumenProgreso = null;

        if (idMiembroSeleccionado) {
            miembroActual = miembrosRes.rows.find(m => m.id_miembro === idMiembroSeleccionado) || null;

            if (miembroActual) {
                const evalRes = await pool.query(
                    `SELECT e.*, u.nombre_completo AS entrenador_nombre
                     FROM evaluaciones_fisicas e
                     JOIN usuarios u ON u.id_usuario = e.id_entrenador
                     WHERE e.id_miembro = $1
                     ORDER BY e.fecha_evaluacion DESC, e.id_evaluacion DESC`,
                    [idMiembroSeleccionado]
                );
                evaluaciones = evalRes.rows;

                const rutinasRes = await pool.query(
                    `SELECT r.*, u.nombre_completo AS entrenador_nombre
                     FROM rutinas_miembros r
                     JOIN usuarios u ON u.id_usuario = r.id_entrenador
                     WHERE r.id_miembro = $1
                     ORDER BY r.activa DESC, r.fecha_asignacion DESC, r.id_rutina DESC`,
                    [idMiembroSeleccionado]
                );
                historialRutinas = rutinasRes.rows;
                rutinaActiva = historialRutinas.find(r => r.activa) || null;

                // Cálculo automático de cambio de peso (última evaluación vs primera)
                if (evaluaciones.length > 0) {
                    const ultima = evaluaciones[0];
                    const primera = evaluaciones[evaluaciones.length - 1];
                    const diferenciaPeso = evaluaciones.length > 1
                        ? (parseFloat(ultima.peso_kg) - parseFloat(primera.peso_kg)).toFixed(2)
                        : null;

                    resumenProgreso = {
                        pesoActual: parseFloat(ultima.peso_kg).toFixed(2),
                        imcActual: ultima.imc ? parseFloat(ultima.imc).toFixed(1) : '-',
                        grasaActual: ultima.porcentaje_grasa ? `${parseFloat(ultima.porcentaje_grasa).toFixed(1)}%` : '-',
                        diferenciaPeso,
                        totalEvaluaciones: evaluaciones.length
                    };
                }
            }
        }

        res.render('seguimiento', {
            user: req.currentUser,
            miembros: miembrosRes.rows,
            miembroActual,
            evaluaciones,
            rutinaActiva,
            historialRutinas,
            resumenProgreso,
            mensaje: req.query.ok || null,
            error: req.query.err || null
        });
    } catch (err) {
        console.error('Error cargando módulo de seguimiento:', err);
        res.status(500).send('Error al cargar el módulo de seguimiento.');
    }
});

// Registrar nueva evaluación física
router.post('/evaluacion', soloEntrenadorOAdmin, async (req, res) => {
    const {
        id_miembro,
        fecha_evaluacion,
        peso_kg,
        estatura_cm,
        porcentaje_grasa,
        cintura_cm,
        observaciones_tecnica,
        lesiones_alertas
    } = req.body;

    try {
        const peso = parseFloat(peso_kg);
        const estatura = estatura_cm ? parseFloat(estatura_cm) : null;
        let imc = null;

        if (peso > 0 && estatura && estatura > 0) {
            const estaturaM = estatura / 100;
            imc = parseFloat((peso / (estaturaM * estaturaM)).toFixed(2));
        }

        const idEntrenador = req.currentUser.id_usuario || req.currentUser.id;

        await pool.query(
            `INSERT INTO evaluaciones_fisicas
             (id_miembro, id_entrenador, fecha_evaluacion, peso_kg, estatura_cm, imc, porcentaje_grasa, cintura_cm, observaciones_tecnica, lesiones_alertas)
             VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10)`,
            [
                id_miembro,
                idEntrenador,
                fecha_evaluacion || null,
                peso,
                estatura,
                imc,
                porcentaje_grasa ? parseFloat(porcentaje_grasa) : null,
                cintura_cm ? parseFloat(cintura_cm) : null,
                observaciones_tecnica ? observaciones_tecnica.trim() : null,
                lesiones_alertas ? lesiones_alertas.trim() : null
            ]
        );

        res.redirect(`/seguimiento?miembro=${id_miembro}&ok=Evaluación+física+registrada+correctamente`);
    } catch (err) {
        console.error('Error guardando evaluación física:', err);
        res.redirect(`/seguimiento?miembro=${id_miembro}&err=No+se+pudo+guardar+la+evaluación`);
    }
});

// Asignar o actualizar rutina del miembro
router.post('/rutina', soloEntrenadorOAdmin, async (req, res) => {
    const { id_miembro, objetivo, nivel, detalle_rutina } = req.body;

    try {
        const idEntrenador = req.currentUser.id_usuario || req.currentUser.id;

        // Desactivar rutinas previas de este miembro para mantener historial limpio
        await pool.query(
            'UPDATE rutinas_miembros SET activa = FALSE WHERE id_miembro = $1',
            [id_miembro]
        );

        await pool.query(
            `INSERT INTO rutinas_miembros (id_miembro, id_entrenador, objetivo, nivel, detalle_rutina, activa)
             VALUES ($1, $2, $3, $4, $5, TRUE)`,
            [
                id_miembro,
                idEntrenador,
                objetivo.trim(),
                nivel || 'Intermedio',
                detalle_rutina.trim()
            ]
        );

        res.redirect(`/seguimiento?miembro=${id_miembro}&ok=Rutina+actualizada+correctamente`);
    } catch (err) {
        console.error('Error guardando rutina:', err);
        res.redirect(`/seguimiento?miembro=${id_miembro}&err=No+se+pudo+guardar+la+rutina`);
    }
});

module.exports = router;