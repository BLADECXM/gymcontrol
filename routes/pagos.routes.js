// routes/pagos.routes.js - Proceso 7: Cobro, renovación, anulación y Voucher PDF
const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const pool = require('../config/db');
const { permitirRoles } = require('../middleware/auth');

// Mostrar pantalla de pagos y listado reciente
router.get('/', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    try {
        const miembros = await pool.query(
            'SELECT id_miembro, dni, nombre_completo FROM miembros WHERE activo = TRUE ORDER BY nombre_completo ASC'
        );
        const planes = await pool.query(
            'SELECT * FROM planes_membresia WHERE activo = TRUE ORDER BY precio_lempiras ASC'
        );
        const pagos = await pool.query(`
            SELECT p.*, m.nombre_completo AS miembro_nombre, m.dni, pl.nombre_plan, u.nombre_completo AS cajero
            FROM pagos_membresia p
            JOIN miembros m ON p.id_miembro = m.id_miembro
            JOIN planes_membresia pl ON p.id_plan = pl.id_plan
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            ORDER BY p.id_pago DESC
            LIMIT 50
        `);

        res.render('pagos', {
            miembros: miembros.rows,
            planes: planes.rows,
            pagos: pagos.rows,
            mensaje: req.query.msg || null,
            error: req.query.err || null
        });
    } catch (error) {
        console.error('Error cargando pagos:', error);
        res.render('pagos', {
            miembros: [],
            planes: [],
            pagos: [],
            mensaje: null,
            error: 'Error al cargar el módulo de pagos.'
        });
    }
});

// Registrar nuevo cobro o renovación
router.post('/crear', permitirRoles('Administrador', 'Recepcionista'), async (req, res) => {
    const { id_miembro, id_plan, metodo_pago } = req.body;
    const id_usuario = req.session.usuario.id;

    try {
        // 1. Obtener datos del plan seleccionado
        const planRes = await pool.query('SELECT * FROM planes_membresia WHERE id_plan = $1', [id_plan]);
        if (planRes.rows.length === 0) {
            return res.redirect('/pagos?err=Plan no encontrado');
        }
        const plan = planRes.rows[0];

        // 2. Revisar si el miembro ya tiene una membresía vigente para extenderla
        const ultimoPago = await pool.query(
            `SELECT fecha_vencimiento FROM pagos_membresia
             WHERE id_miembro = $1 AND anulado = FALSE AND fecha_vencimiento >= CURRENT_DATE
             ORDER BY fecha_vencimiento DESC LIMIT 1`,
            [id_miembro]
        );

        let fechaInicio = new Date();
        if (ultimoPago.rows.length > 0) {
            // Si aún está vigente, inicia el día siguiente a su vencimiento actual
            fechaInicio = new Date(ultimoPago.rows[0].fecha_vencimiento);
            fechaInicio.setDate(fechaInicio.getDate() + 1);
        }

        const fechaVencimiento = new Date(fechaInicio);
        fechaVencimiento.setDate(fechaVencimiento.getDate() + plan.duracion_dias);

        // Formato YYYY-MM-DD para PostgreSQL
        const inicioSQL = fechaInicio.toISOString().split('T')[0];
        const vencimientoSQL = fechaVencimiento.toISOString().split('T')[0];

        // 3. Generar código de recibo único (Ej: GC-2026-0001)
        const anio = new Date().getFullYear();
        const conteo = await pool.query('SELECT COUNT(*) FROM pagos_membresia');
        const correlativo = String(parseInt(conteo.rows[0].count) + 1).padStart(4, '0');
        const codigoRecibo = `GC-${anio}-${correlativo}`;

        // 4. Guardar el pago en la base de datos
        await pool.query(
            `INSERT INTO pagos_membresia
             (codigo_recibo, id_miembro, id_plan, id_usuario, monto_pagado, metodo_pago, fecha_inicio, fecha_vencimiento)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [codigoRecibo, id_miembro, id_plan, id_usuario, plan.precio_lempiras, metodo_pago, inicioSQL, vencimientoSQL]
        );

        res.redirect(`/pagos?msg=Cobro registrado con éxito (Recibo ${codigoRecibo})`);
    } catch (error) {
        console.error('Error registrando pago:', error);
        res.redirect('/pagos?err=No se pudo registrar el cobro.');
    }
});

// Anular cobro (Solo Administrador)
router.post('/anular/:id', permitirRoles('Administrador'), async (req, res) => {
    const { id } = req.params;
    const { motivo_anulacion } = req.body;

    try {
        await pool.query(
            `UPDATE pagos_membresia
             SET anulado = TRUE, motivo_anulacion = $1
             WHERE id_pago = $2`,
            [motivo_anulacion.trim() || 'Anulado por administrador', id]
        );
        res.redirect('/pagos?msg=El cobro fue anulado correctamente.');
    } catch (error) {
        console.error('Error anulando pago:', error);
        res.redirect('/pagos?err=No se pudo anular el cobro.');
    }
});

// Generar y descargar Voucher en PDF
router.get('/voucher/:id', permitirRoles('Administrador', 'Recepcionista', 'Cliente'), async (req, res) => {
    const { id } = req.params;

    try {
        const resultado = await pool.query(`
            SELECT p.*, m.nombre_completo AS miembro_nombre, m.dni, pl.nombre_plan, u.nombre_completo AS cajero
            FROM pagos_membresia p
            JOIN miembros m ON p.id_miembro = m.id_miembro
            JOIN planes_membresia pl ON p.id_plan = pl.id_plan
            JOIN usuarios u ON p.id_usuario = u.id_usuario
            WHERE p.id_pago = $1
        `, [id]);

        if (resultado.rows.length === 0) {
            return res.status(404).send('Recibo no encontrado.');
        }

        const pago = resultado.rows[0];
        const doc = new PDFDocument({ size: 'A5', margin: 40 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Voucher_${pago.codigo_recibo}.pdf`);
        doc.pipe(res);

        // Encabezado del Voucher
        doc.fontSize(20).font('Helvetica-Bold').text('GYMCONTROL', { align: 'center' });
        doc.fontSize(10).font('Helvetica').text('Comprobante Oficial de Pago de Membresía', { align: 'center' });
        doc.moveDown(0.5);
        doc.moveTo(40, doc.y).lineTo(380, doc.y).stroke();
        doc.moveDown(1);

        if (pago.anulado) {
            doc.fontSize(14).fillColor('red').font('Helvetica-Bold').text('*** RECIBO ANULADO ***', { align: 'center' });
            doc.fillColor('black').moveDown(0.5);
        }

        // Detalles de la transacción
        const fechaPagoStr = new Date(pago.fecha_pago).toLocaleString('es-HN');
        const inicioStr = new Date(pago.fecha_inicio).toLocaleDateString('es-HN');
        const venceStr = new Date(pago.fecha_vencimiento).toLocaleDateString('es-HN');

        doc.fontSize(11).font('Helvetica-Bold').text(`No. Recibo: `, { continued: true }).font('Helvetica').text(pago.codigo_recibo);
        doc.font('Helvetica-Bold').text(`Fecha de pago: `, { continued: true }).font('Helvetica').text(fechaPagoStr);
        doc.font('Helvetica-Bold').text(`Atendido por: `, { continued: true }).font('Helvetica').text(pago.cajero);
        doc.moveDown(0.8);

        doc.font('Helvetica-Bold').text(`Miembro: `, { continued: true }).font('Helvetica').text(pago.miembro_nombre);
        doc.font('Helvetica-Bold').text(`DNI: `, { continued: true }).font('Helvetica').text(pago.dni);
        doc.moveDown(0.8);

        doc.font('Helvetica-Bold').text(`Plan adquirido: `, { continued: true }).font('Helvetica').text(pago.nombre_plan);
        doc.font('Helvetica-Bold').text(`Método de pago: `, { continued: true }).font('Helvetica').text(pago.metodo_pago);
        doc.font('Helvetica-Bold').text(`Vigencia: `, { continued: true }).font('Helvetica').text(`Del ${inicioStr} al ${venceStr}`);
        doc.moveDown(1);

        doc.moveTo(40, doc.y).lineTo(380, doc.y).stroke();
        doc.moveDown(0.8);
        doc.fontSize(15).font('Helvetica-Bold').text(`TOTAL PAGADO: L. ${parseFloat(pago.monto_pagado).toFixed(2)}`, { align: 'right' });
        doc.moveDown(2);

        doc.fontSize(9).font('Helvetica-Oblique').fillColor('gray')
           .text('Gracias por entrenar con nosotros. Presente su DNI en recepción para su check-in diario.', { align: 'center' });

        doc.end();
    } catch (error) {
        console.error('Error generando PDF:', error);
        res.status(500).send('Error al generar el comprobante PDF.');
    }
});

module.exports = router;