// routes/reportes.routes.js - Proceso 9: Reportes Gerenciales con Gráficos y Filtro Mensual
const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const ExcelJS = require('exceljs');
const { permitirRoles } = require('../middleware/auth');

router.get('/', permitirRoles('Administrador'), async (req, res) => {
    // Filtro por mes (formato YYYY-MM). Por defecto: mes actual
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const mes = req.query.mes || mesActual;

    const [anio, mesNum] = mes.split('-').map(Number);
    const desde = `${mes}-01`;
    const ultimoDia = new Date(anio, mesNum, 0).getDate();
    const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    try {
        // 1. KPIs generales del mes
        const totalMiembrosRes = await pool.query('SELECT COUNT(*) FROM miembros WHERE activo = TRUE');
        const nuevosMesRes = await pool.query(
            'SELECT COUNT(*) FROM miembros WHERE fecha_registro BETWEEN $1 AND $2',
            [desde, hasta]
        );

        // 2. Pagos del mes (D6)
        const pagosRes = await pool.query(`
            SELECT p.codigo_recibo, p.fecha_pago, p.monto_pagado, p.metodo_pago,
                   m.nombre_completo AS miembro, pl.nombre_plan
            FROM pagos_membresia p
            JOIN miembros m ON p.id_miembro = m.id_miembro
            JOIN planes_membresia pl ON p.id_plan = pl.id_plan
            WHERE p.anulado = FALSE
              AND DATE(p.fecha_pago) BETWEEN $1 AND $2
            ORDER BY p.fecha_pago DESC
        `, [desde, hasta]);

        const totalIngresos = pagosRes.rows.reduce((acc, r) => acc + parseFloat(r.monto_pagado), 0);

        // 3. Gráfico de Barras: Ingresos por Plan en el mes
        const ingresosPlanRes = await pool.query(`
            SELECT pl.nombre_plan, COALESCE(SUM(p.monto_pagado), 0) AS total
            FROM pagos_membresia p
            JOIN planes_membresia pl ON p.id_plan = pl.id_plan
            WHERE p.anulado = FALSE
              AND DATE(p.fecha_pago) BETWEEN $1 AND $2
            GROUP BY pl.nombre_plan
            ORDER BY total DESC
        `, [desde, hasta]);

        // 4. Gráfico de Pastel: Métodos de Pago en el mes
        const metodosPagoRes = await pool.query(`
            SELECT metodo_pago, COUNT(*) AS cantidad
            FROM pagos_membresia
            WHERE anulado = FALSE
              AND DATE(fecha_pago) BETWEEN $1 AND $2
            GROUP BY metodo_pago
        `, [desde, hasta]);

        // 5. Gráfico de Pastel: Asistencias por Jornada (Día vs Noche - Hora Honduras)
        const jornadaRes = await pool.query(`
            SELECT
                CASE
                    WHEN EXTRACT(HOUR FROM (fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Tegucigalpa')) BETWEEN 5 AND 11 THEN 'Mañana (5am - 12pm)'
                    WHEN EXTRACT(HOUR FROM (fecha_hora AT TIME ZONE 'UTC' AT TIME ZONE 'America/Tegucigalpa')) BETWEEN 12 AND 17 THEN 'Tarde (12pm - 6pm)'
                    ELSE 'Noche (6pm - 11pm)'
                END AS jornada,
                COUNT(*) AS total
            FROM asistencias_checkin
            WHERE acceso_permitido = TRUE
              AND DATE(fecha_hora) BETWEEN $1 AND $2
            GROUP BY jornada
        `, [desde, hasta]);

        // 6. Gráfico de Barras: Edades que más asisten en el mes
        const edadesRes = await pool.query(`
            SELECT
                CASE
                    WHEN m.fecha_nacimiento IS NULL THEN 'Sin edad'
                    WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, m.fecha_nacimiento)) < 18 THEN 'Menores de 18'
                    WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, m.fecha_nacimiento)) BETWEEN 18 AND 25 THEN '18 - 25 años'
                    WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, m.fecha_nacimiento)) BETWEEN 26 AND 35 THEN '26 - 35 años'
                    WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, m.fecha_nacimiento)) BETWEEN 36 AND 45 THEN '36 - 45 años'
                    ELSE 'Mayores de 45'
                END AS rango_edad,
                COUNT(*) AS visitas
            FROM asistencias_checkin a
            JOIN miembros m ON a.id_miembro = m.id_miembro
            WHERE a.acceso_permitido = TRUE
              AND DATE(a.fecha_hora) BETWEEN $1 AND $2
            GROUP BY rango_edad
            ORDER BY visitas DESC
        `, [desde, hasta]);

        // 7. Total de check-ins permitidos en el mes
        const checkinsMesRes = await pool.query(`
            SELECT COUNT(*) FROM asistencias_checkin
            WHERE acceso_permitido = TRUE AND DATE(fecha_hora) BETWEEN $1 AND $2
        `, [desde, hasta]);

        // 8. Membresías vencidas o por vencer en 7 días
        const vencimientosRes = await pool.query(`
            SELECT m.dni, m.nombre_completo, m.telefono,
                   MAX(p.fecha_vencimiento) AS ultima_fecha_vencimiento
            FROM miembros m
            JOIN pagos_membresia p ON m.id_miembro = p.id_miembro
            WHERE m.activo = TRUE AND p.anulado = FALSE
            GROUP BY m.id_miembro, m.dni, m.nombre_completo, m.telefono
            HAVING MAX(p.fecha_vencimiento) <= CURRENT_DATE + INTERVAL '7 days'
            ORDER BY ultima_fecha_vencimiento ASC
        `);

        // Empaquetamos los datos para Chart.js
        const graficos = {
            jornada: {
                labels: jornadaRes.rows.map(r => r.jornada),
                data: jornadaRes.rows.map(r => parseInt(r.total))
            },
            edades: {
                labels: edadesRes.rows.map(r => r.rango_edad),
                data: edadesRes.rows.map(r => parseInt(r.visitas))
            },
            ingresosPlan: {
                labels: ingresosPlanRes.rows.map(r => r.nombre_plan),
                data: ingresosPlanRes.rows.map(r => parseFloat(r.total))
            },
            metodosPago: {
                labels: metodosPagoRes.rows.map(r => r.metodo_pago),
                data: metodosPagoRes.rows.map(r => parseInt(r.cantidad))
            }
        };

        res.render('reportes', {
            mes,
            desde,
            hasta,
            kpis: {
                totalMiembros: totalMiembrosRes.rows[0].count,
                nuevosMes: nuevosMesRes.rows[0].count,
                checkinsMes: checkinsMesRes.rows[0].count,
                totalIngresos: totalIngresos.toFixed(2)
            },
            graficos,
            pagos: pagosRes.rows,
            vencimientos: vencimientosRes.rows
        });
    } catch (error) {
        console.error('Error generando reportes:', error);
        res.status(500).send('Error al generar los reportes.');
    }
});

// Exportar Reporte Mensual a Excel (.xlsx)
router.get('/exportar-excel', permitirRoles('Administrador'), async (req, res) => {
    const hoy = new Date();
    const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const mes = req.query.mes || mesActual;

    const [anio, mesNum] = mes.split('-').map(Number);
    const desde = `${mes}-01`;
    const ultimoDia = new Date(anio, mesNum, 0).getDate();
    const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    try {
        const [pagosRes, vencimientosRes, asistenciasRes] = await Promise.all([
            pool.query(`
                SELECT p.codigo_recibo, p.fecha_pago, p.monto_pagado, p.metodo_pago,
                       m.nombre_completo AS miembro, m.dni, pl.nombre_plan
                FROM pagos_membresia p
                JOIN miembros m ON p.id_miembro = m.id_miembro
                JOIN planes_membresia pl ON p.id_plan = pl.id_plan
                WHERE p.anulado = FALSE AND DATE(p.fecha_pago) BETWEEN $1 AND $2
                ORDER BY p.fecha_pago DESC
            `, [desde, hasta]),
            pool.query(`
                SELECT m.dni, m.nombre_completo, m.telefono,
                       MAX(p.fecha_vencimiento) AS ultima_fecha_vencimiento
                FROM miembros m
                JOIN pagos_membresia p ON m.id_miembro = p.id_miembro
                WHERE m.activo = TRUE AND p.anulado = FALSE
                GROUP BY m.id_miembro, m.dni, m.nombre_completo, m.telefono
                HAVING MAX(p.fecha_vencimiento) <= CURRENT_DATE + INTERVAL '7 days'
                ORDER BY ultima_fecha_vencimiento ASC
            `),
            pool.query(`
                SELECT a.fecha_hora, m.dni, m.nombre_completo, a.acceso_permitido, a.detalle_estado
                FROM asistencias_checkin a
                JOIN miembros m ON a.id_miembro = m.id_miembro
                WHERE DATE(a.fecha_hora) BETWEEN $1 AND $2
                ORDER BY a.fecha_hora DESC
            `, [desde, hasta])
        ]);

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'GymControl';

        // Función auxiliar para estilizar encabezados
        const estilizarEncabezado = (sheet) => {
            sheet.getRow(1).eachCell((cell) => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF212529' } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
            sheet.views = [{ state: 'frozen', ySplit: 1 }];
        };

        // Hoja 1: Ingresos del Mes
        const hojaPagos = workbook.addWorksheet('Ingresos del Mes');
        hojaPagos.columns = [
            { header: 'Fecha', key: 'fecha', width: 15 },
            { header: 'Recibo', key: 'recibo', width: 18 },
            { header: 'DNI', key: 'dni', width: 18 },
            { header: 'Miembro', key: 'miembro', width: 28 },
            { header: 'Plan', key: 'plan', width: 20 },
            { header: 'Método', key: 'metodo', width: 15 },
            { header: 'Monto (L.)', key: 'monto', width: 15 }
        ];
        pagosRes.rows.forEach(p => {
            hojaPagos.addRow({
                fecha: new Date(p.fecha_pago).toLocaleDateString('es-HN'),
                recibo: p.codigo_recibo,
                dni: p.dni,
                miembro: p.miembro,
                plan: p.nombre_plan,
                metodo: p.metodo_pago,
                monto: parseFloat(p.monto_pagado)
            });
        });
        hojaPagos.getColumn('monto').numFmt = '"L. "#,##0.00';
        estilizarEncabezado(hojaPagos);

        // Hoja 2: Próximos a Vencer
        const hojaVence = workbook.addWorksheet('Por Vencer (7 dias)');
        hojaVence.columns = [
            { header: 'DNI', key: 'dni', width: 18 },
            { header: 'Miembro', key: 'miembro', width: 28 },
            { header: 'Teléfono', key: 'telefono', width: 16 },
            { header: 'Fecha Vencimiento', key: 'vencimiento', width: 20 }
        ];
        vencimientosRes.rows.forEach(v => {
            hojaVence.addRow({
                dni: v.dni,
                miembro: v.nombre_completo,
                telefono: v.telefono || '-',
                vencimiento: new Date(v.ultima_fecha_vencimiento).toLocaleDateString('es-HN')
            });
        });
        estilizarEncabezado(hojaVence);

        // Hoja 3: Asistencias del Mes
        const hojaAsist = workbook.addWorksheet('Asistencias');
        hojaAsist.columns = [
            { header: 'Fecha y Hora', key: 'fecha_hora', width: 22 },
            { header: 'DNI', key: 'dni', width: 18 },
            { header: 'Miembro', key: 'miembro', width: 28 },
            { header: 'Acceso', key: 'acceso', width: 14 },
            { header: 'Detalle', key: 'detalle', width: 35 }
        ];
        asistenciasRes.rows.forEach(a => {
            hojaAsist.addRow({
                fecha_hora: new Date(a.fecha_hora).toLocaleString('es-HN'),
                dni: a.dni,
                miembro: a.nombre_completo,
                acceso: a.acceso_permitido ? 'Permitido' : 'Denegado',
                detalle: a.detalle_estado
            });
        });
        estilizarEncabezado(hojaAsist);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Reporte_GymControl_${mes}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exportando reporte a Excel:', error);
        res.status(500).send('Error al generar el archivo Excel.');
    }
});

module.exports = router;