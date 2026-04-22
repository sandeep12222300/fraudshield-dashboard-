/* =========================================================
   FraudShield Dashboard — app.js
   Reads paysim_sample.csv locally via PapaParse, builds all charts
   ========================================================= */

'use strict';

// ── Global state ──────────────────────────────────────────
let ALL_DATA    = [];
let TX_PAGE     = 1;
const TX_PAGE_SIZE = 50;
let TX_FILTERED = [];
let charts      = {};
let csvParser   = null;
const MAX_ROWS  = 100000; // cap for fast initial render

// ── Colour palette ────────────────────────────────────────
const C = {
  indigo : '#6366f1', purple : '#8b5cf6', teal : '#14b8a6',
  cyan   : '#06b6d4', red    : '#ef4444', orange: '#f97316',
  amber  : '#f59e0b', green  : '#22c55e', blue  : '#3b82f6',
  grid   : 'rgba(255,255,255,.05)',
  text   : '#94a3c0',
};

const TYPE_COLORS = {
  PAYMENT : C.indigo, TRANSFER: C.purple, CASH_OUT: C.red,
  CASH_IN : C.teal,   DEBIT   : C.orange,
};

// ── Chart.js global defaults ──────────────────────────────
Chart.defaults.color           = C.text;
Chart.defaults.font.family     = 'Inter';
Chart.defaults.font.size       = 11;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.plugins.tooltip.backgroundColor = '#1a1f35';
Chart.defaults.plugins.tooltip.borderColor     = 'rgba(99,102,241,.3)';
Chart.defaults.plugins.tooltip.borderWidth     = 1;
Chart.defaults.plugins.tooltip.padding         = 10;
Chart.defaults.plugins.tooltip.titleColor      = '#f0f2ff';
Chart.defaults.plugins.tooltip.bodyColor       = '#94a3c0';

// ── Helpers ───────────────────────────────────────────────
const fmt   = n => new Intl.NumberFormat('en-US').format(n);
const fmtAmt= n => {
  if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};
const pct   = (a, b) => b ? ((a/b)*100).toFixed(2)+'%' : '0%';
const el    = id => document.getElementById(id);
const setText= (id, v) => { const e = el(id); if(e) e.textContent = v; };

function makeChart(id, cfg) {
  if (charts[id]) { charts[id].destroy(); }
  const ctx = el(id);
  if (!ctx) return;
  charts[id] = new Chart(ctx, cfg);
  return charts[id];
}

const axisOpts = () => ({
  x: { grid:{ color: C.grid }, ticks:{ color: C.text } },
  y: { grid:{ color: C.grid }, ticks:{ color: C.text } },
});

// ── Navigation ────────────────────────────────────────────
const TAB_TITLES = {
  overview:'Dashboard Overview', transactions:'All Transactions',
  fraud:'Fraud Analysis', patterns:'Transaction Patterns',
  accounts:'Top Accounts', timeline:'Fraud Timeline',
};

function switchTab(tab, link) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (link) link.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  const panel = el('tab-' + tab);
  if (panel) panel.classList.remove('hidden');
  setText('pageTitle', TAB_TITLES[tab] || tab);
  if (tab === 'transactions' && TX_FILTERED.length === 0) { TX_FILTERED = ALL_DATA; renderTxTable(); }
  return false;
}

function toggleSidebar() {
  const sb = el('sidebar');
  const mc = document.querySelector('.main-content');
  sb.classList.toggle('collapsed');
  mc.classList.toggle('full');
}

// ── CSV Loading ───────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setProgress(5, 'Locating paysim_sample.csv…');
  Papa.parse('paysim_sample.csv', {
    download      : true,
    header        : true,
    dynamicTyping : true,
    skipEmptyLines: true,
    chunkSize     : 1024 * 512, // 512 KB chunks
    chunk(results, parser) {
      csvParser = parser;
      ALL_DATA.push(...results.data);
      const p = Math.min(88, 5 + Math.floor((ALL_DATA.length / MAX_ROWS) * 83));
      setProgress(p, `Parsed ${fmt(ALL_DATA.length)} rows…`);
      // Stop after MAX_ROWS for fast initial render
      if (ALL_DATA.length >= MAX_ROWS) {
        parser.abort();
        setProgress(100, 'Building charts…');
        setTimeout(() => onDataReady(false), 200);
      }
    },
    complete() {
      // reached EOF naturally (file < MAX_ROWS)
      setProgress(100, 'Building charts…');
      setTimeout(() => onDataReady(true), 200);
    },
    error(err) {
      setText('loadingMsg', '⚠ Error: ' + err.message);
      el('statusPill').querySelector('.status-dot').className = 'status-dot error';
      setText('statusText', 'Error');
    }
  });
});

function setProgress(pct, msg) {
  const fill = el('progressFill');
  if (fill) fill.style.width = pct + '%';
  setText('loadingMsg', msg);
}

function onDataReady(fullFile) {
  buildKPIs();
  buildOverviewCharts();
  buildFraudTab();
  buildPatternsTab();
  buildAccountsTab();
  buildTimelineTab();

  // hide loading screen
  const ls = el('loadingScreen');
  ls.classList.add('hidden');
  setTimeout(() => ls.style.display = 'none', 500);

  // update status
  el('statusPill').querySelector('.status-dot').className = 'status-dot ready';
  const label = fullFile ? 'Full Dataset' : `${fmt(ALL_DATA.length)} rows (capped)`;
  setText('statusText', label);
  setText('datasetStatus', fmt(ALL_DATA.length) + ' rows loaded');
}

// ── KPI Cards ─────────────────────────────────────────────
function buildKPIs() {
  const total   = ALL_DATA.length;
  const frauds  = ALL_DATA.filter(r => r.isFraud === 1);
  const flagged = ALL_DATA.filter(r => r.isFlaggedFraud === 1);
  const totalAmt= ALL_DATA.reduce((s,r) => s + (r.amount||0), 0);
  const fraudAmt= frauds.reduce((s,r) => s + (r.amount||0), 0);

  setText('kpiTotal',    fmt(total));
  setText('kpiTotalSub', 'Across all transaction types');
  setText('kpiFraud',    fmt(frauds.length));
  setText('kpiFraudSub', pct(frauds.length, total) + ' of total');
  setText('kpiAmount',   fmtAmt(totalAmt));
  setText('kpiAmountSub','Avg ' + fmtAmt(totalAmt/total) + ' per tx');
  setText('kpiRate',     pct(frauds.length, total));
  setText('kpiRateSub',  'Fraud detection rate');
  setText('kpiFlagged',  fmt(flagged.length));
  setText('kpiFlaggedSub','System-flagged transactions');
  setText('kpiFraudAmt', fmtAmt(fraudAmt));
  setText('kpiFraudAmtSub', pct(fraudAmt, totalAmt) + ' of total volume');

  setText('fraudBadge', fmt(frauds.length));
  // fraud tab summary
  setText('fraudTotal2', fmt(frauds.length));
  const avgFA = frauds.length ? fraudAmt/frauds.length : 0;
  setText('fraudAvgAmt', fmtAmt(avgFA));
  const maxFA = frauds.reduce((m,r)=>Math.max(m, r.amount||0), 0);
  setText('fraudMaxAmt', fmtAmt(maxFA));
}

// ── Overview Charts ────────────────────────────────────────
function buildOverviewCharts() {
  buildVolumeChart();
  buildTypeChart();
  buildFraudTypeChart();
  buildAmountDistChart();
}

function buildVolumeChart() {
  // bucket steps into groups of 24
  const bucket = {};
  ALL_DATA.forEach(r => {
    const b = Math.floor((r.step||0)/24);
    if (!bucket[b]) bucket[b] = { legit:0, fraud:0 };
    r.isFraud===1 ? bucket[b].fraud++ : bucket[b].legit++;
  });
  const keys = Object.keys(bucket).sort((a,b)=>+a-+b);
  makeChart('volumeChart', {
    type:'line',
    data:{
      labels: keys.map(k => 'Day '+(+k+1)),
      datasets:[
        { label:'Legitimate', data: keys.map(k=>bucket[k].legit),
          borderColor: C.indigo, backgroundColor:'rgba(99,102,241,.08)',
          fill:true, tension:.4, pointRadius:0, borderWidth:2 },
        { label:'Fraud', data: keys.map(k=>bucket[k].fraud),
          borderColor: C.red, backgroundColor:'rgba(239,68,68,.08)',
          fill:true, tension:.4, pointRadius:2, borderWidth:2 },
      ]
    },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:true, labels:{ color:C.text, boxWidth:10, padding:16 } } },
      scales: axisOpts() }
  });
}

function buildTypeChart() {
  const counts = {};
  ALL_DATA.forEach(r => { counts[r.type] = (counts[r.type]||0)+1; });
  const labels = Object.keys(counts);
  makeChart('typeChart', {
    type:'doughnut',
    data:{
      labels,
      datasets:[{ data: labels.map(l=>counts[l]),
        backgroundColor: labels.map(l=>TYPE_COLORS[l]||C.indigo),
        borderColor:'transparent', hoverOffset:6 }]
    },
    options:{ responsive:true, maintainAspectRatio:false, cutout:'68%',
      plugins:{ legend:{ display:true, position:'bottom',
        labels:{ color:C.text, boxWidth:10, padding:10, font:{size:10} } } } }
  });
}

function buildFraudTypeChart() {
  const ft = {};
  ALL_DATA.filter(r=>r.isFraud===1).forEach(r=>{ ft[r.type]=(ft[r.type]||0)+1; });
  const labels = Object.keys(ft);
  makeChart('fraudTypeChart', {
    type:'bar',
    data:{
      labels,
      datasets:[{ label:'Fraud Count', data:labels.map(l=>ft[l]),
        backgroundColor: labels.map(l=>TYPE_COLORS[l]||C.indigo),
        borderRadius:6, borderSkipped:false }]
    },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} }, scales: axisOpts() }
  });
}

function buildAmountDistChart() {
  const buckets = [0,100,500,1000,5000,10000,50000,100000,500000,1000000,Infinity];
  const labels  = ['<100','100-500','500-1K','1K-5K','5K-10K','10K-50K','50K-100K','100K-500K','500K-1M','>1M'];
  const counts  = new Array(labels.length).fill(0);
  ALL_DATA.forEach(r => {
    const a = r.amount||0;
    for (let i=0; i<buckets.length-1; i++) {
      if (a >= buckets[i] && a < buckets[i+1]) { counts[i]++; break; }
    }
  });
  makeChart('amountDistChart', {
    type:'bar',
    data:{ labels, datasets:[{ label:'Transactions', data:counts,
      backgroundColor: 'rgba(99,102,241,.6)', borderColor: C.indigo,
      borderWidth:1, borderRadius:4 }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}}, scales: axisOpts() }
  });
}

// ── Fraud Tab ─────────────────────────────────────────────
function buildFraudTab() {
  const frauds = ALL_DATA.filter(r=>r.isFraud===1);
  setText('fraudTableCount', fmt(frauds.length) + ' records');

  // Fraud amount distribution
  const buckets=[0,100,1000,5000,10000,50000,100000,500000,Infinity];
  const labels=['<100','100-1K','1K-5K','5K-10K','10K-50K','50K-100K','100K-500K','>500K'];
  const counts=new Array(labels.length).fill(0);
  frauds.forEach(r=>{
    for(let i=0;i<buckets.length-1;i++){
      if((r.amount||0)>=buckets[i]&&(r.amount||0)<buckets[i+1]){counts[i]++;break;}
    }
  });
  makeChart('fraudAmtDistChart',{
    type:'bar',
    data:{labels,datasets:[{label:'Fraud Txns',data:counts,
      backgroundColor:'rgba(239,68,68,.5)',borderColor:C.red,
      borderWidth:1,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},scales:axisOpts()}
  });

  // Balance drain chart — scatter
  const sample = frauds.slice(0,200);
  makeChart('balanceDrainChart',{
    type:'scatter',
    data:{datasets:[{
      label:'Fraud TX',
      data:sample.map(r=>({x:r.oldbalanceOrg||0,y:r.newbalanceOrig||0})),
      backgroundColor:'rgba(239,68,68,.45)',pointRadius:4,
    }]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{
        x:{...axisOpts().x,title:{display:true,text:'Balance Before',color:C.text}},
        y:{...axisOpts().y,title:{display:true,text:'Balance After',color:C.text}}
      }}
  });

  // Fraud table
  const tbody = el('fraudBody');
  tbody.innerHTML = frauds.slice(0,500).map(r=>`
    <tr>
      <td>${r.step}</td>
      <td><span class="badge badge-type">${r.type}</span></td>
      <td>${fmtAmt(r.amount||0)}</td>
      <td class="mono">${r.nameOrig||''}</td>
      <td>${fmtAmt(r.oldbalanceOrg||0)}</td>
      <td>${fmtAmt(r.newbalanceOrig||0)}</td>
      <td class="mono">${r.nameDest||''}</td>
      <td>${fmtAmt(r.oldbalanceDest||0)}</td>
      <td>${fmtAmt(r.newbalanceDest||0)}</td>
      <td><span class="badge ${r.isFlaggedFraud===1?'badge-flagged':'badge-legit'}">${r.isFlaggedFraud===1?'Yes':'No'}</span></td>
    </tr>`).join('');
}

// ── Patterns Tab ──────────────────────────────────────────
function buildPatternsTab() {
  // Heatmap — step mod 24
  const hours={};
  ALL_DATA.forEach(r=>{const h=(r.step||0)%24;hours[h]=(hours[h]||0)+1;});
  const hLabels=Array.from({length:24},(_,i)=>i+'h');
  makeChart('heatmapChart',{
    type:'bar',
    data:{labels:hLabels,datasets:[{label:'Count',
      data:hLabels.map((_,i)=>hours[i]||0),
      backgroundColor:hLabels.map((_,i)=>{
        const v=hours[i]||0;
        const max=Math.max(...Object.values(hours));
        const a=0.15+0.75*(v/max);
        return `rgba(99,102,241,${a.toFixed(2)})`;
      }),
      borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},scales:axisOpts()}
  });

  // Fraud type share (doughnut)
  const typeTotal={},typeF={};
  ALL_DATA.forEach(r=>{
    typeTotal[r.type]=(typeTotal[r.type]||0)+1;
    if(r.isFraud===1)typeF[r.type]=(typeF[r.type]||0)+1;
  });
  const ftLabels=Object.keys(typeTotal);
  makeChart('fraudShareChart',{
    type:'doughnut',
    data:{labels:ftLabels,datasets:[{
      data:ftLabels.map(l=>+(((typeF[l]||0)/typeTotal[l])*100).toFixed(2)),
      backgroundColor:ftLabels.map(l=>TYPE_COLORS[l]||C.indigo),
      borderColor:'transparent',hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{display:true,position:'bottom',
        labels:{color:C.text,boxWidth:10,padding:10,font:{size:10}}}}}
  });

  // Avg amount by type
  const typeAmtSum={},typeAmtCnt={};
  ALL_DATA.forEach(r=>{
    typeAmtSum[r.type]=(typeAmtSum[r.type]||0)+(r.amount||0);
    typeAmtCnt[r.type]=(typeAmtCnt[r.type]||0)+1;
  });
  const atLabels=Object.keys(typeAmtSum);
  makeChart('avgAmtChart',{
    type:'bar',
    data:{labels:atLabels,datasets:[{
      label:'Avg Amount',
      data:atLabels.map(l=>+(typeAmtSum[l]/typeAmtCnt[l]).toFixed(2)),
      backgroundColor:atLabels.map(l=>TYPE_COLORS[l]||C.indigo),
      borderRadius:6,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},scales:axisOpts()}
  });

  // Balance delta
  const origDelta=[], destDelta=[];
  ['PAYMENT','TRANSFER','CASH_OUT','CASH_IN','DEBIT'].forEach(t=>{
    const rows=ALL_DATA.filter(r=>r.type===t);
    origDelta.push(rows.reduce((s,r)=>s+((r.newbalanceOrig||0)-(r.oldbalanceOrg||0)),0)/rows.length);
    destDelta.push(rows.reduce((s,r)=>s+((r.newbalanceDest||0)-(r.oldbalanceDest||0)),0)/rows.length);
  });
  const bdLabels=['PAYMENT','TRANSFER','CASH_OUT','CASH_IN','DEBIT'];
  makeChart('balanceDeltaChart',{
    type:'bar',
    data:{labels:bdLabels,datasets:[
      {label:'Orig Δ',data:origDelta,backgroundColor:'rgba(99,102,241,.6)',borderRadius:4},
      {label:'Dest Δ',data:destDelta,backgroundColor:'rgba(20,184,166,.6)',borderRadius:4},
    ]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:true,labels:{color:C.text,boxWidth:10}}},
      scales:axisOpts()}
  });
}

// ── Accounts Tab ──────────────────────────────────────────
function buildAccountsTab() {
  const origMap={}, destMap={};
  ALL_DATA.forEach(r=>{
    if(!origMap[r.nameOrig]) origMap[r.nameOrig]={cnt:0,amt:0,fraud:false};
    origMap[r.nameOrig].cnt++;
    origMap[r.nameOrig].amt+=r.amount||0;
    if(r.isFraud===1) origMap[r.nameOrig].fraud=true;

    if(!destMap[r.nameDest]) destMap[r.nameDest]={cnt:0,amt:0,fraud:false};
    destMap[r.nameDest].cnt++;
    destMap[r.nameDest].amt+=r.amount||0;
    if(r.isFraud===1) destMap[r.nameDest].fraud=true;
  });

  const topOrig=Object.entries(origMap).sort((a,b)=>b[1].amt-a[1].amt).slice(0,20);
  const topDest=Object.entries(destMap).sort((a,b)=>b[1].amt-a[1].amt).slice(0,20);

  el('topOrigBody').innerHTML=topOrig.map(([name,d])=>`
    <tr><td class="mono">${name}</td><td>${fmt(d.cnt)}</td><td>${fmtAmt(d.amt)}</td>
    <td><span class="badge ${d.fraud?'badge-fraud':'badge-legit'}">${d.fraud?'Yes':'No'}</span></td></tr>`).join('');

  el('topDestBody').innerHTML=topDest.map(([name,d])=>`
    <tr><td class="mono">${name}</td><td>${fmt(d.cnt)}</td><td>${fmtAmt(d.amt)}</td>
    <td><span class="badge ${d.fraud?'badge-fraud':'badge-legit'}">${d.fraud?'Yes':'No'}</span></td></tr>`).join('');

  const top15=topOrig.slice(0,15);
  makeChart('topAccountsChart',{
    type:'bar',
    data:{labels:top15.map(([n])=>n.slice(0,12)+'…'),
      datasets:[{label:'Total Sent',data:top15.map(([,d])=>d.amt),
        backgroundColor:'rgba(99,102,241,.55)',borderColor:C.indigo,
        borderWidth:1,borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,
      indexAxis:'y',
      plugins:{legend:{display:false}},scales:axisOpts()}
  });
}

// ── Timeline Tab ─────────────────────────────────────────
function buildTimelineTab() {
  const bucketSize=12;
  const buckets={};
  ALL_DATA.forEach(r=>{
    const b=Math.floor((r.step||0)/bucketSize);
    if(!buckets[b]) buckets[b]={fraud:0,amt:0};
    if(r.isFraud===1){buckets[b].fraud++;buckets[b].amt+=r.amount||0;}
  });
  const keys=Object.keys(buckets).sort((a,b)=>+a-+b);
  const labels=keys.map(k=>'Step '+(+k*bucketSize));

  // Cumulative
  let cumul=0;
  const cumulData=keys.map(k=>{cumul+=buckets[k].fraud;return cumul;});
  makeChart('cumulativeFraudChart',{
    type:'line',
    data:{labels,datasets:[{label:'Cumulative Fraud',data:cumulData,
      borderColor:C.red,backgroundColor:'rgba(239,68,68,.08)',
      fill:true,tension:.4,pointRadius:0,borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},scales:axisOpts()}
  });

  // Velocity
  makeChart('fraudVelocityChart',{
    type:'bar',
    data:{labels,datasets:[{label:'New Fraud Cases',
      data:keys.map(k=>buckets[k].fraud),
      backgroundColor:'rgba(239,68,68,.5)',borderColor:C.red,
      borderWidth:1,borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},scales:axisOpts()}
  });

  // Amount over time
  makeChart('fraudAmtTimeChart',{
    type:'line',
    data:{labels,datasets:[{label:'Fraud $',data:keys.map(k=>buckets[k].amt),
      borderColor:C.orange,backgroundColor:'rgba(249,115,22,.08)',
      fill:true,tension:.4,pointRadius:0,borderWidth:2}]},
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false}},scales:axisOpts()}
  });
}

// ── Transactions Table ────────────────────────────────────
function filterTransactions() {
  const q      = (el('txSearch').value||'').toLowerCase();
  const typeF  = el('typeFilter').value;
  const fraudF = el('fraudFilter').value;
  TX_FILTERED  = ALL_DATA.filter(r=>{
    if(typeF  && r.type !== typeF) return false;
    if(fraudF !== '' && String(r.isFraud) !== fraudF) return false;
    if(q && !(r.nameOrig||'').toLowerCase().includes(q) &&
           !(r.nameDest||'').toLowerCase().includes(q)  &&
           !(r.type||'').toLowerCase().includes(q)) return false;
    return true;
  });
  TX_PAGE=1;
  renderTxTable();
}

function renderTxTable() {
  const start=(TX_PAGE-1)*TX_PAGE_SIZE;
  const page =TX_FILTERED.slice(start, start+TX_PAGE_SIZE);
  el('txBody').innerHTML=page.map(r=>`
    <tr>
      <td>${r.step}</td>
      <td><span class="badge badge-type">${r.type}</span></td>
      <td>${fmtAmt(r.amount||0)}</td>
      <td class="mono" style="font-size:.72rem;color:#a5b4fc">${r.nameOrig||''}</td>
      <td>${fmtAmt(r.oldbalanceOrg||0)}</td>
      <td>${fmtAmt(r.newbalanceOrig||0)}</td>
      <td class="mono" style="font-size:.72rem">${r.nameDest||''}</td>
      <td>${fmtAmt(r.oldbalanceDest||0)}</td>
      <td>${fmtAmt(r.newbalanceDest||0)}</td>
      <td><span class="badge ${r.isFraud===1?'badge-fraud':'badge-legit'}">${r.isFraud===1?'⚠ Fraud':'✓ Legit'}</span></td>
      <td><span class="badge ${r.isFlaggedFraud===1?'badge-flagged':'badge-legit'}">${r.isFlaggedFraud===1?'Flagged':'—'}</span></td>
    </tr>`).join('');

  const total=TX_FILTERED.length;
  const pages=Math.ceil(total/TX_PAGE_SIZE);
  setText('txCount', `Showing ${fmt(start+1)}–${fmt(Math.min(start+TX_PAGE_SIZE,total))} of ${fmt(total)}`);

  // Pagination
  const pag=el('txPagination');
  let html='';
  const win=2;
  const show=p=>{html+=`<button class="page-btn ${p===TX_PAGE?'active':''}" onclick="goPage(${p})">${p}</button>`;};
  if(pages<=9){for(let i=1;i<=pages;i++)show(i);}
  else{
    show(1);
    if(TX_PAGE>win+2) html+='<span style="color:#4b5675;padding:0 4px">…</span>';
    for(let i=Math.max(2,TX_PAGE-win);i<=Math.min(pages-1,TX_PAGE+win);i++) show(i);
    if(TX_PAGE<pages-win-1) html+='<span style="color:#4b5675;padding:0 4px">…</span>';
    show(pages);
  }
  pag.innerHTML=html;
}

function goPage(p) { TX_PAGE=p; renderTxTable(); }
