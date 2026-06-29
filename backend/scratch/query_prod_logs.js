const axios = require('axios');

async function run() {
  const prodUrl = 'https://endpoint.grupoascencio.com.mx/api/webhooks/logs';
  console.log('Fetching logs from production server:', prodUrl);
  
  try {
    const res = await axios.get(prodUrl, {
      params: { limit: 10 }
    });
    console.log('Production logs retrieved successfully:');
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.log('Failed to fetch production logs:', err.response?.status, err.response?.data || err.message);
  }
}

run();
