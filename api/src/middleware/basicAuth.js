function basicAuth({ username, password }) {
  return function(req, res, next) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="admin"');
      return res.status(401).send('Auth required');
    }

    const b64 = header.slice('Basic '.length).trim();
    let decoded = '';
    try {
      decoded = Buffer.from(b64, 'base64').toString('utf8');
    } catch {
      res.setHeader('WWW-Authenticate', 'Basic realm="admin"');
      return res.status(401).send('Invalid auth');
    }

    const idx = decoded.indexOf(':');
    if (idx < 0) {
      res.setHeader('WWW-Authenticate', 'Basic realm="admin"');
      return res.status(401).send('Invalid auth');
    }

    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);

    if (user !== username || pass !== password) {
      res.setHeader('WWW-Authenticate', 'Basic realm="admin"');
      return res.status(401).send('Unauthorized');
    }

    return next();
  };
}

module.exports = { basicAuth };
