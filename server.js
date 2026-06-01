const https = require('https');
const http = require('http');

const TOMTOM_KEY = process.env.TOMTOM_API_KEY || '';
const PORT = process.env.PORT || 3001;

function fetchURL(url) {
    return new Promise((resolve, reject) => {
          const client = url.startsWith('https') ? https : http;
          const req = client.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'TowStrike/1.0' } }, (res) => {
                  let data = '';
                  res.on('data', chunk => data += chunk);
                  res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
          });
          req.on('error', reject);
          req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function fetchMI511() {
    try {
          const data = await fetchURL('https://www.mi511.org/api/v2/incidents?format=json');
          if (!data?.incidents?.length) return [];
          return data.incidents.map((inc, i) => ({ id: `mi511-${inc.id||i}`, source:'Michigan 511', type:inc.type||'Incident', description:inc.description||inc.headline||'', lat:parseFloat(inc.latitude||inc.lat||0), lon:parseFloat(inc.longitude||inc.lon||0), location:inc.location||inc.roadway||'', direction:inc.direction||'', reported:inc.startTime||inc.created||new Date().toISOString() })).filter(i => i.lat && i.lon && !isNaN(i.lat) && Math.abs(i.lat) > 1);
    } catch(e) { console.log('MI511 error:', e.message); return []; }
}

async function fetchTomTom() {
    if (!TOMTOM_KEY) return [];
    try {
          const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_KEY}&bbox=-85.20,41.50,-82.00,43.45&fields={incidents{type,geometry{type,coordinates},properties{id,iconCategory,startTime,from,to,roadNumbers,events{description,iconCategory}}}}&language=en-US&categoryFilter=0,1,2,3,4,5,6,7,8,9,10,11,14&timeValidityFilter=present`;
          const data = await fetchURL(url);
          if (!data?.incidents?.length) return [];
          const typeMap = {0:'Incident',1:'Accident',2:'Weather Hazard',3:'Hazard',4:'Weather Hazard',5:'Hazard',6:'Congestion',7:'Lane Closure',8:'Road Closure',9:'Construction',10:'Weather Hazard',11:'Hazard',14:'Disabled Vehicle'};
          return data.incidents.map((inc,i) => { const p=inc.properties||{}; const coords=inc.geometry?.coordinates||[]; let lat=0,lon=0; if(inc.geometry?.type==='Point'){lon=coords[0];lat=coords[1];}else if(inc.geometry?.type==='LineString'&&coords.length){lon=coords[0][0];lat=coords[0][1];} const desc=(p.events||[]).map(e=>e.description).filter(Boolean).join('. '); const loc=[(p.roadNumbers||[]).join(', '),p.from,p.to].filter(Boolean).join(' → ')||'Michigan'; return {id:`tomtom-${p.id||i}`,source:'TomTom',type:typeMap[p.iconCategory]||'Incident',description:desc,lat,lon,location:loc,direction:'',reported:p.startTime||new Date().toISOString()}; }).filter(i=>i.lat&&i.lon&&i.lat!==0&&!isNaN(i.lat));
    } catch(e) { console.log('TomTom error:', e.message); return []; }
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    if (req.url !== '/incidents') { res.writeHead(404); res.end('{"error":"Not found"}'); return; }
    try {
          const [mi511, tomtom] = await Promise.allSettled([fetchMI511(), fetchTomTom()]);
          const live511 = mi511.status==='fulfilled' ? mi511.value : [];
          const liveTT = tomtom.status==='fulfilled' ? tomtom.value : [];
          const incidents = [...live511, ...liveTT];
          console.log(`Served: MI511=${live511.length}, TomTom=${liveTT.length}`);
          res.writeHead(200);
          res.end(JSON.stringify({ incidents, sources:{ mi511:live511.length, tomtom:liveTT.length, total:incidents.length, isLive:incidents.length>0 }, fetchedAt:new Date().toISOString() }));
    } catch(e) { res.writeHead(500); res.end(JSON.stringify({ error:e.message, incidents:[], sources:{isLive:false} })); }
});

server.listen(PORT, () => console.log(`TowStrike backend on port ${PORT}`));
