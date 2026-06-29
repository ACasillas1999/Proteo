const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const token = process.env.PS_TOKEN;
  const baseUrl = process.env.PS_BASE_URL; // e.g., https://api.dev.powersales.cloud/api/grupoascencio
  
  console.log('Base URL:', baseUrl);
  
  const endpoints = [
    '/webhooks',
    '/webhook',
    '/webhooks/config',
    '/webhooks/settings',
    '/webhooks/object-update'
  ];

  for (const ep of endpoints) {
    const url = `${baseUrl}${ep}`;
    console.log(`\nTesting GET on ${url}...`);
    try {
      const res = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      console.log(`GET ${ep} success:`, res.status, JSON.stringify(res.data, null, 2).substring(0, 1000));
    } catch (err) {
      console.log(`GET ${ep} failed:`, err.response?.status, err.response?.data || err.message);
    }
  }
}

run();
