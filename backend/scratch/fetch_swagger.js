const https = require('https');
https.get('https://apidev.ventaruta.net/docs/api-docs.json', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log(Object.keys(json.paths).filter(p => p.toLowerCase().includes('product')));
      const postProduct = json.paths['/api/v1/product']?.post;
      if (postProduct) {
        console.log(JSON.stringify(postProduct.parameters, null, 2));
      }
    } catch(e) { console.error('Parse error or not JSON'); }
  });
}).on('error', err => console.error(err));
