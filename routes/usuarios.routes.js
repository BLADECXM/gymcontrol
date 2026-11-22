// routes/usuarios.routes.js - Proceso 1: Gestión de Usuarios y Roles
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

// Genera un código opaco tipo GC-7K9P (sin revelar rol ni secuencia)
function generarCodigoUsuario() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let codigo = 'GC-';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
        codigo += chars[bytes[i] % chars.length];
    }
    return codigo;
}

// Listar usuarios y roles
router.get('/', permitirRoles('Administrador'), async (req, res) => {
    try {
        const usuariosRes = await pool.query(`
    SELECT u.id_usuario, u.codigo_usuario, u.nombre_completo, u.correo, u.telefono, u.especialidad, u.activo, r.nombre_rol
    FROM usuarios u
    JOIN roles r ON u.id_rol = r.id_rol
    ORDER BY u.id_usuario ASC
        `);
        const rolesRes = await pool.query('SELECT * FROM roles ORDER BY id_rol ASC');

        res.render('usuarios', {
            usuarios: usuariosRes.rows,
            roles: rolesRes.rows,
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        res.render('usuarios', { usuarios: [], roles: [], mensaje: null, error: 'Error al cargar los usuarios.' });
    }
});

// Crear usuario con contraseña encriptada
router.post('/crear', permitirRoles('Administrador'), async (req, res) => {
    const { id_rol, nombre_completo, correo, clave, telefono, especialidad } = req.body;

    try {
        const claveHash = await bcrypt.hash(clave, 10);
        await pool.query(
            `INSERT INTO usuarios (id_rol, codigo_usuario, nombre_completo, correo, clave_hash, telefono, especialidad)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                id_rol,
                codigoUsuario,
                nombre_completo.trim(),
                correo.trim().toLowerCase(),
                claveHash,
                telefono ? telefono.trim() : null,
                especialidad ? especialidad.trim() : null
            ]
        );
        res.redirect('/usuarios?msg=Usuario creado correctamente.');
    } catch (error) {
        console.error('Error creando usuario:', error);
        const msg = error.code === '23505' ? 'Ese correo ya está registrado.' : 'No se pudo crear el usuario.';
        res.redirect(`/usuarios?err=${encodeURIComponent(msg)}`);
    }
});

// Activar / Desactivar usuario (evitando que el admin se desactive a sí mismo)
router.post('/estado/:id', permitirRoles('Administrador'), async (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.session.usuario.id) {
        return res.redirect('/usuarios?err=No puedes desactivar tu propio usuario.');
    }

    try {
        await pool.query('UPDATE usuarios SET activo = NOT activo WHERE id_usuario = $1', [id]);
        res.redirect('/usuarios?msg=Estado del usuario actualizado.');
    } catch (error) {
        console.error('Error cambiando estado de usuario:', error);
        res.redirect('/usuarios?err=No se pudo cambiar el estado.');
    }
});

// Exportar listado de usuarios a Excel (.xlsx)
router.get('/exportar-excel', permitirRoles('Administrador'), async (req, res) => {
    try {
        const resultado = await pool.query(`
            SELECT u.codigo_usuario, u.nombre_completo, u.correo, r.nombre_rol,
                   u.telefono, u.especialidad, u.activo
            FROM usuarios u
            JOIN roles r ON u.id_rol = r.id_rol
            ORDER BY u.id_usuario ASC
        `);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Usuarios');

        sheet.columns = [
            { header: 'Código', key: 'codigo', width: 15 },
            { header: 'Nombre Completo', key: 'nombre', width: 28 },
            { header: 'Correo', key: 'correo', width: 28 },
            { header: 'Rol', key: 'rol', width: 16 },
            { header: 'Teléfono', key: 'telefono', width: 16 },
            { header: 'Especialidad', key: 'especialidad', width: 20 },
            { header: 'Estado', key: 'estado', width: 12 }
        ];

        resultado.rows.forEach(u => {
            sheet.addRow({
                codigo: u.codigo_usuario || '-',
                nombre: u.nombre_completo,
                correo: u.correo,
                rol: u.nombre_rol,
                telefono: u.telefono || '-',
                especialidad: u.especialidad || '-',
                estado: u.activo ? 'Activo' : 'Inactivo'
            });
        });

        sheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212529' } };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="Usuarios_GymControl.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exportando usuarios:', error);
        res.redirect('/usuarios?err=No se pudo generar el archivo Excel.');
    }
});

module.exports = router;