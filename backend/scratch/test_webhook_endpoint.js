const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const token = process.env.PS_TOKEN;
  const url = 'https://api.dev.powersales.cloud/api/grupoascencio/webhooks/object-update';
  
  console.log('Testing GET on webhook URL...');
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log('GET Response:', res.status, res.data);
  } catch (err) {
    console.log('GET Error:', err.response?.status, err.response?.data || err.message);
  }

  console.log('\nTesting POST on webhook URL with empty payload...');
  try {
    const res = await axios.post(url, {}, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    console.log('POST Response:', res.status, res.data);
  } catch (err) {
    console.log('POST Error:', err.response?.status, err.response?.data || err.message);
  }
}

run();
