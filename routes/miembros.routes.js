// routes/miembros.routes.js - Proceso 5: Alta y mantenimiento de miembros
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');
const ExcelJS = require('exceljs');

// Listar y buscar miembros (Admin y Recepcionista)
router.get('/', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const busqueda = req.query.q ? req.query.q.trim() : '';

    try {
        let query = 'SELECT * FROM miembros ORDER BY id_miembro DESC';
        let params = [];

        if (busqueda) {
            query = `SELECT * FROM miembros 
                     WHERE dni ILIKE $1 OR nombre_completo ILIKE $1 
                     ORDER BY id_miembro DESC`;
            params = [`%${busqueda}%`];
        }

        const resultado = await pool.query(query, params);
        res.render('miembros', {
            miembros: resultado.rows,
            busqueda,
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error listando miembros:', error);
        res.render('miembros', { miembros: [], busqueda, mensaje: null, error: 'Error al cargar los miembros.' });
    }
});

// Registrar nuevo miembro
router.post('/crear', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const { dni, nombre_completo, telefono, correo } = req.body;

    try {
        await pool.query(
            `INSERT INTO miembros (dni, nombre_completo, telefono, correo)
             VALUES ($1, $2, $3, $4)`,
            [dni.trim(), nombre_completo.trim(), telefono.trim(), correo.trim().toLowerCase()]
        );
        res.redirect('/miembros?msg=Miembro registrado correctamente');
    } catch (error) {
        console.error('Error creando miembro:', error);
        const msgError = error.code === '23505'
            ? 'Ya existe un miembro registrado con ese DNI.'
            : 'No se pudo registrar el miembro.';
        res.redirect(`/miembros?err=${encodeURIComponent(msgError)}`);
    }
});

// Editar miembro existente
router.post('/editar/:id', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const { id } = req.params;
    const { dni, nombre_completo, telefono, correo } = req.body;

    try {
        await pool.query(
            `UPDATE miembros 
             SET dni = $1, nombre_completo = $2, telefono = $3, correo = $4
             WHERE id_miembro = $5`,
            [dni.trim(), nombre_completo.trim(), telefono.trim(), correo.trim().toLowerCase(), id]
        );
        res.redirect('/miembros?msg=Datos actualizados correctamente');
    } catch (error) {
        console.error('Error editando miembro:', error);
        res.redirect('/miembros?err=Error al actualizar los datos');
    }
});

// Activar / Desactivar miembro (baja lógica)
router.post('/estado/:id', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE miembros SET activo = NOT activo WHERE id_miembro = $1', [id]);
        res.redirect('/miembros?msg=Estado del miembro actualizado');
    } catch (error) {
        console.error('Error cambiando estado:', error);
        res.redirect('/miembros?err=No se pudo cambiar el estado');
    }
});

// Exportar directorio de miembros a Excel (.xlsx)
router.get('/exportar-excel', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT dni, nombre_completo, telefono, correo, fecha_nacimiento, activo
            FROM miembros
            ORDER BY nombre_completo ASC
        `);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Miembros');

        sheet.columns = [
            { header: 'DNI', key: 'dni', width: 18 },
            { header: 'Nombre Completo', key: 'nombre', width: 28 },
            { header: 'Teléfono', key: 'telefono', width: 16 },
            { header: 'Correo', key: 'correo', width: 28 },
            { header: 'Fecha Nacimiento', key: 'nacimiento', width: 18 },
            { header: 'Estado', key: 'estado', width: 12 }
        ];

        resultado.rows.forEach(m => {
            sheet.addRow({
                dni: m.dni,
                nombre: m.nombre_completo,
                telefono: m.telefono || '-',
                correo: m.correo || '-',
                nacimiento: m.fecha_nacimiento ? new Date(m.fecha_nacimiento).toLocaleDateString('es-HN') : '-',
                estado: m.activo ? 'Activo' : 'Inactivo'
            });
        });

        sheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212529' } };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Miembros_GymControl.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exportando miembros:', error);
        res.redirect('/miembros?err=No se pudo generar el archivo Excel.');
    }
});

module.exports = router;