// server.js - Punto de entrada del Sistema Transaccional GymControl
const express = require('express');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;


//Vercel App
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Configuración del motor de vistas EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middlewares para leer formularios y archivos estáticos (CSS/JS)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de sesiones para manejo de roles
app.use(session({
    secret: process.env.SESSION_SECRET || 'gymcontrol_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 horas de sesión
}));

// Variable global para usar el usuario logueado en todas las vistas EJS
app.use((req, res, next) => {
    res.locals.usuario = req.session.usuario || null;
    next();
});

const authRoutes = require('./routes/auth.routes');
app.use('/', authRoutes)

const miembrosRoutes = require('./routes/miembros.routes');
app.use('/miembros', miembrosRoutes);

const pagosRoutes = require('./routes/pagos.routes');
app.use('/pagos', pagosRoutes);

const checkinRoutes = require('./routes/checkin.routes');
app.use('/checkin', checkinRoutes);

const cajaRoutes = require('./routes/caja.routes');
app.use('/caja', cajaRoutes);

const clasesRoutes = require('./routes/clases.routes');
app.use('/clases', clasesRoutes);

const planesRoutes = require('./routes/planes.routes');
app.use('/planes', planesRoutes);

const usuariosRoutes = require('./routes/usuarios.routes');
app.use('/usuarios', usuariosRoutes);

const reportesRoutes = require('./routes/reportes.routes');
app.use('/reportes', reportesRoutes);

const portalRoutes = require('./routes/portal.routes');
app.use('/mi-portal', portalRoutes);

// Ruta inicial de prueba
app.get('/', (req, res) => {
    if (!req.session.usuario) {
        return res.redirect('/login');
    }
    res.redirect('/dashboard');
});

// Solo escuchar en puerto local; Vercel maneja el servidor automáticamente
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;