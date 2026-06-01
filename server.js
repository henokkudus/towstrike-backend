const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3001;

function get(url) {
          return new Promise((resolve, reject) => {
                      https.get(url, { headers: {'Accept':'application/json','User-Agent':'Mozilla/5.0'} }, res => {
                                    let d = '';
                                    res.on('data', c => d += c);
                                    res.on('end', () => {
                                                    console.log(res.statusCode, url.slice(0,80));
                                                    try { resolve({code:res.statusCode, json:JSON.parse(d)}); }
                                                    catch(e) { resolve({code:res.statusCode, text:d.slice(0,200)}); }
                                    });
                      }).on('error', reject).setTimeout(10000, function(){ this.destroy(); });
          });
}

async function fetchWazeFeed() {
          const feeds = [
                      'https://www.waze.com/live-map/api/georss?top=43.45&bottom=41.50&left=-85.20&right=-82.00&env=na&types=alerts,jams',
                      'https://na-georss.waze.com/rtserver/web/TGeoRSS?tk=community&format=JSON&types=traffic,alerts&left=-85.20&bottom=41.50&right=-82.00&top=43.45'
                    ];
          for (const url of feeds) {
                      try {
                                    const r = await get(url);
                                    console.log('Waze status:', r.code);
                                    if (r.code === 200 && r.json) {
                                                    const alerts = r.json.alerts || r.json.data?.alerts || [];
                                                    const jams = r.json.jams || r.json.data?.jams || [];
                                                    console.log('Waze alerts:', alerts.length, 'jams:', jams.length);
                                                    const incidents = [];
                                                    alerts.forEach((a,i) => {
                                                                      if (!a.location?.x && !a.location?.y) return;
                                                                      incidents.push({
                                                                                          id:'waze-a-'+i, source:'Waze',
                                                                                          type: a.type==='ACCIDENT'?'Accident':a.type==='HAZARD'?'Hazard':a.type==='JAM'?'Congestion':'Incident',
                                                                                          description: a.subtype || a.type || '',
                                                                                          lat: a.location?.y || 0, lon: a.location?.x || 0,
                                                                                          location: a.street || a.city || 'Michigan',
                                                                                          direction: '', reported: new Date(a.pubMillis||Date.now()).toISOString()
                                                                      });
                                                    });
                                                    return incidents;
                                    }
                      } catch(e) { console.log('Waze feed error:', e.message); }
          }
          return [];
}

async function fetch511() {
          const urls = [
                      'https://511mi.org/api/v2/incidents?format=json',
                      'https://mi.511.org/api/v2/incidents?format=json',
                      'https://tripcheck.com/roadconditions/api/v2/incidents?format=json'
                    ];
          for (const url of urls) {
                      try {
                                    const r = await get(url);
                                    console.log('511 status:', r.code, url);
                                    if (r.code===200 && r.json?.incidents?.length) {
                                                    console.log('511 incidents:', r.json.incidents.length);
                                                    return r.json.incidents.map((inc,i) => ({
                                                                      id:'511-'+(inc.id||i), source:'Michigan 511',
                                                                      type:inc.type||'Incident', description:inc.description||'',
                                                                      lat:parseFloat(inc.latitude||0), lon:parseFloat(inc.longitude||0),
                                                                      location:inc.location||'', direction:inc.direction||'',
                                                                      reported:inc.startTime||new Date().toISOString()
                                                    })).filter(i=>i.lat&&i.lon&&!isNaN(i.lat)&&Math.abs(i.lat)>1);
                                    }
                      } catch(e) { console.log('511 error:', e.message); }
          }
          return [];
}

async function fetchTomTom() {
          const key = process.env.TOMTOM_API_KEY;
          if (!key) return [];
          const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${key}&bbox=-85.20,41.50,-82.00,43.45&fields={incidents{type,geometry{type,coordinates},properties{id,iconCategory,startTime,from,to,roadNumbers,events{description}}}}&language=en-US&timeValidityFilter=present`;
          try {
                      const r = await get(url);
                      console.log('TomTom status:', r.code);
                      if (r.code!==200||!r.json?.incidents) { console.log('TomTom fail:', r.text); return []; }
                      console.log('TomTom incidents:', r.json.incidents.length);
                      const tm={0:'Incident',1:'Accident',2:'Weather Hazard',3:'Hazard',4:'Weather Hazard',5:'Hazard',6:'Congestion',7:'Lane Closure',8:'Road Closure',9:'Construction',10:'Weather Hazard',11:'Hazard',14:'Disabled Vehicle'};
                      return r.json.incidents.map((inc,i)=>{
                                    const p=inc.properties||{};
                                    const c=inc.geometry?.coordinates||[];
                                    let lat=0,lon=0;
                                    if(inc.geometry?.type==='Point'){lon=c[0];lat=c[1];}
                                    else if(inc.geometry?.type==='LineString'&&c.length){lon=c[0][0];lat=c[0][1];}
                                    return {id:'tt-'+(p.id||i),source:'TomTom',type:tm[p.iconCategory]||'Incident',
                                                    description:(p.events||[]).map(e=>e.description).filter(Boolean).join('. '),
                                                    lat,lon,location:[(p.roadNumbers||[]).join(', '),p.from,p.to].filter(Boolean).join(' to ')||'Michigan',
                                                    direction:'',reported:p.startTime||new Date().toISOString()};
                      }).filter(i=>i.lat&&i.lon&&i.lat!==0&&!isNaN(i.lat));
          } catch(e) { console.log('TomTom error:', e.message); return []; }
}

const server = http.createServer(async(req,res)=>{
          res.setHeader('Access-Control-Allow-Origin','*');
          res.setHeader('Content-Type','application/json');
          if(req.method==='OPTIONS'){res.writeHead(200);res.end();return;}
          if(req.url!=='/incidents'){res.writeHead(404);res.end('{"error":"not found"}');return;}
          const [r1,r2,r3] = await Promise.allSettled([fetch511(), fetchWazeFeed(), fetchTomTom()]);
          const s511 = r1.status==='fulfilled'?r1.value:[];
          const waze = r2.status==='fulfilled'?r2.value:[];
          const tt   = r3.status==='fulfilled'?r3.value:[];
          const all  = [...s511,...waze,...tt];
          console.log('TOTAL - 511:',s511.length,'Waze:',waze.length,'TomTom:',tt.length,'=',all.length);
          res.writeHead(200);
          res.end(JSON.stringify({
                      incidents:all,
                      sources:{mi511:s511.length,waze:waze.length,tomtom:tt.length,total:all.length,isLive:all.length>0},
                      fetchedAt:new Date().toISOString()
          }));
});

server.listen(PORT,()=>console.log('TowStrike port',PORT));
