require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT      || 3000;
const API_BASE = process.env.API_BASE  || 'http://localhost:8080';

app.use(express.static(path.join(__dirname, 'public')));

// Proxy transparente: /api/* → Flask backend
app.use('/api', async (req, res) => {
  const target = `${API_BASE}/api${req.url}`;
  try {
    const upstream = await fetch(target, {
      method:  req.method,
      headers: { 'Content-Type': 'application/json' },
      body:    ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error(`Proxy error → ${target}:`, err.message);
    res.status(502).json({ erro: 'Backend indisponível', detalhe: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AirWatch Dashboard: http://localhost:${PORT}`);
  console.log(`Proxying API to: ${API_BASE}`);
});
