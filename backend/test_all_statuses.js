const https = require('https');
require('dotenv').config();

const token = process.env.PS_TOKEN;
const baseUrl = process.env.PS_BASE_URL;

const urlObj = new URL(baseUrl);
const hostname = urlObj.hostname;
const basePath = urlObj.pathname + '/orders';

const testStatusIds = [3, 6, 8, 11, 35, 38, 43, 44]; // Probamos todos los estatus conocidos

function testStatus(statusId) {
  return new Promise((resolve) => {
    console.log(`\n--- Probando StatusId: ${statusId} ---`);
    const payload = {
      Id: 114,
      StatusId: statusId,
      StatusName: 'TEST_STATUS',
      OrderNumberIPAD: 'VIC00000102W',
      IDPedidoEnc: 114,
      Employee: 3,
      ExternalReference: 'VIC00000102W',
      ModifiedDate: new Date().toISOString().slice(0, 19).replace('T', ' '),
      OrdersDetails: [
        {
          "Id": 138,
          "ProductId": "1020625",
          "ProductCode": "1020625",
          "QtyOrdered": "2.00",
          "QtyDelivered": "0.00",
          "QtyPicked": "2.00",
          "Price": "79.64",
          "SubTotalAmount": "159.28",
          "TotalAmount": "159.28",
          "UniqueId": "11442332026-08-05 10:16:06",
          "WarehouseId": "1"
        },
        {
          "Id": 137,
          "ProductId": "1020632",
          "ProductCode": "1020632",
          "QtyOrdered": "1.00",
          "QtyDelivered": "0.00",
          "QtyPicked": "1.00",
          "Price": "99.16",
          "SubTotalAmount": "99.16",
          "TotalAmount": "99.16",
          "UniqueId": "11442332026-08-05 10:16:06",
          "WarehouseId": "1"
        }
      ]
    };

    const postData = JSON.stringify({ data: payload });
    
    const options = {
      hostname: hostname,
      path: basePath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`Resultado StatusId ${statusId}: HTTP ${res.statusCode}`);
          console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log(`Resultado StatusId ${statusId}: Raw: ${data.substring(0, 300)}`);
        }
        resolve();
      });
    });

    req.on('error', (e) => {
      console.log(`Error StatusId ${statusId}: ${e.message}`);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

(async () => {
  for (const statusId of testStatusIds) {
    await testStatus(statusId);
  }
  process.exit(0);
})();
