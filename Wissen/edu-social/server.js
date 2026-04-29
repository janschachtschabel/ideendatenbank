const express = require('express');
const path = require('path');
const app = express();

const ENVIRONMENTS = {
  staging: 'https://repository.staging.openeduhub.net/edu-sharing/rest',
  prod: 'https://redaktion.openeduhub.net/edu-sharing/rest'
};

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy endpoint to avoid CORS issues
app.post('/api/proxy', async (req, res) => {
  const { method, endpoint, username, password, body, env } = req.body;

  const baseUrl = ENVIRONMENTS[env] || ENVIRONMENTS.staging;
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (username && password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  }

  try {
    const fetchOpts = { method, headers };
    if (body !== undefined && method !== 'GET' && method !== 'DELETE') {
      fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOpts);
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    res.json({ status: response.status, statusText: response.statusText, data });
  } catch (err) {
    res.json({ status: 0, statusText: 'Network Error', data: err.message });
  }
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`edu-social laeuft auf http://localhost:${PORT}`);
});
