const https = require('https');
const http = require('http');

const TOMTOM_KEY = process.env.TOMTOM_API_KEY || '';
const PORT = process.env.PORT || 3001;

function fetchURL(url) {
        return new Promise((resolve, reject) => {
                  const req = https.get(url, {
                              headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 TowStrike/1.0' }
                  }, (res) => {
                              let data = '';
                              res.on('data', chunk => data += chunk);
                              res.on('end', () => {
                                            console.log('Status:', res.statusCode, url.substring(0, 100));
                                            try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                                            catch(e) { resolve({ status: res.statusCode, data: null, raw: data.substring(0, 300) }); }
                              });
                  });
                  req.on('error', reject);
                  req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        });
}

async function fetchTomTom() {
        if (!TOMTOM_KEY) { console.log('No TomTom key found'); return []; }
        console.log('Fetching TomTom with key:', TOMTOM_KEY.substring(0,8) + '...');
        try {
                  const url = 'https://api.tomtom.com/traffic/services/5/incidentDetails?key=' + TOMTOM_KEY + '&bbox=-85.20,41.50,-82.00,43.45&fields={incidents{type,geometry{type,coordinates},properties{id,iconCategory,startTime,from,to,roadNumbers,events{description}}}}&language=en-US&timeValidityFilter=present';
                  const result = await fetchURL(url);
                  console.log('TomTom response status:', result.status);
                  if (result.status !== 200) {
                              console.log('TomTom error raw:', result.raw);
                              return [];
                  }
                  if (!result.data) { console.log('TomTom no data'); return []; }
                  const incidents = result.data.incidents || [];
                  console.log('TomTom incidents found:', incidents.length);
                  const typeMap = {0:'Incident',1:'Accident',2:'Weather Hazard',3:'Hazard',4:'Weather Hazard',5:'Hazard',6:'Congestion',7:'Lane Closure',8:'Road Closure',9:'Construction',10:'Weather Hazard',11:'Hazard',14:'Disabled Vehicle'};
                  return incidents.map((inc,i) => {
                              const p = inc.properties || {};
                              const coords = inc.geometry?.coordinates || [];
                              let lat=0, lon=0;
                              if(inc.geometry?.type==='Point'){lon=coords[0];lat=coords[1];}
                              else if(inc.geometry?.type==='LineString'&&coords.length){lon=coords[0][0];lat=coords[0][1];}
                              const desc=(p.events||[]).map(e=>e.description).filter(Boolean).join('. ');
                              const loc=[(p.roadNumbers||[]).join(', '),p.from,p.to].filter(Boolean).join(' to ')||'Michigan';
                              return {id:'tt-'+(p.id||i),source:'TomTom',type:typeMap[p.iconCategory]||'Incident',description:desc,lat,lon,location:loc,direction:'',reported:p.startTime||new Date().toISOString()};
                  }).filter(i=>i.lat&&i.lon&&i.lat!==0&&!isNaN(i.lat));
        } catch(e) { console.log('TomTom exception:', e.message); return []; }
}

async function fetch511() {
        try {
                  const url = 'https://511mi.org/api/v2/incidents?format=json';
                  const result = await fetchURL(url);
                  console.log('511 status:', result.status);
                  if (!result.data?.incidents?.length) return [];
                  console.log('511 incidents:', result.data.incidents.length);
                  return result.data.incidents.map((inc,i) => ({
                              id:'511-'+(inc.id||i), source:'Michigan 511',
                              type:inc.type||'Incident', description:inc.description||'',
                              lat:parseFloat(inc.latitude||0), lon:parseFloat(inc.longitude||0),
                              location:inc.location||'', direction:inc.direction||'',
                              reported:inc.startTime||new Date().toISOString()
                  })).filter(i=>i.lat&&i.lon&&!isNaN(i.lat)&&Math.abs(i.lat)>1);
        } catch(e) { console.log('511 error:', e.message); return []; }
}

const server = http.createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
        if (req.url !== '/incidents') { res.writeHead(404); res.end('{"error":"not found"}'); return; }
        const [r511, tomtom] = await Promise.allSettled([fetch511(), fetchTomTom()]);
        const live511 = r511.status==='fulfilled' ? r511.value : [];
        const liveTT = tomtom.status==='fulfilled' ? tomtom.value : [];
        const incidents = [...live511, ...liveTT];
        console.log('FINAL - 511:', live511.length, 'TomTom:', liveTT.length, 'Total:', incidents.length);
        res.writeHead(200);
        res.end(JSON.stringify({
                  incidents,
                  sources:{mi511:live511.length,tomtom:liveTT.length,total:incidents.length,isLive:incidents.length>0},
                  fetchedAt:new Date().toISOString()
        }));
});

server.listen(PORT, () => console.log('TowStrike backend port', PORT, 'TomTom key present:', !!TOMTOM_KEY));
