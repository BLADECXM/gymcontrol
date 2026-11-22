// middleware/auth.js - Protección de rutas por sesión y rol

// Verifica si el usuario inició sesión
function verificarSesion(req, res, next) {
    if (!req.session.usuario) {
        return res.redirect('/login');
    }
    next();
}

// Verifica si el usuario tiene alguno de los roles permitidos
function permitirRoles(...rolesPermitidos) {
    return (req, res, next) => {
        if (!req.session.usuario) {
            return res.redirect('/login');
        }
        if (!rolesPermitidos.includes(req.session.usuario.rol)) {
            return res.status(403).send('Acceso denegado: no tienes permisos para esta sección.');
        }
        next();
    };
}

module.exports = { verificarSesion, permitirRoles };