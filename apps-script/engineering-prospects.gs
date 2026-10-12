/**
 * Scoutflo — Engineering Prospect Collation
 * Reads source sheets (never writes to them). Writes to one new spreadsheet.
 * Safe to re-run: checkpoints after every source and resumes where it left off.
 *
 * Progress is checkpointed to a JSON file in your Drive (Script Properties cap
 * each value at 9KB, far too small for the harvested rows). The file is trashed
 * automatically when the run finishes or when you call reset().
 */

const OUTPUT_NAME = 'Scoutflo — Engineering Prospects Master';
const STATE_NAME  = 'scoutflo-prospects-state.json';
const STATE_KEY   = 'STATE_FILE_ID';
const TIME_LIMIT_MS   = 4.5 * 60 * 1000;   // stop starting new tabs after this
const FINISH_START_MS = 3 * 60 * 1000;     // need a fresh run to build the output after this

const SOURCES = [
  ['1ZfaFMwdv2vPCGe9WDHx4pfqDlLU8Gqr4eHy8TQHiyJ8', 'All Apollo Data'],
  ['1hEVoQvc1IbmInnHvZopMA3Wz2GR6OB7SmhsmBgmPadw', 'Untitled (Feb 16 2026)'],
  ['1rA7bTX0JAUf8Qa0387gqJdgspWFrTyF8VflksWZZiro', 'Final Data Sheet - 2026'],
  ['1V7ba2C86aUQIaLNTogxqccLdg8RqcVMLa3z8tv7m7Jc', 'Warmly Export Oct 6'],
  ['1etpKH6JquLpZfGivwPbkf1QXjguZYVMDwqIQXj1SVJE', 'US Database Oct 2025'],
  ['1Z2CiBVZ5cac756fxIfwR1k8Av4Tx4k3aLiTL5eqFD1U', '2025 Database'],
  ['1IC0_sgqNoMeyuQW2lHgRiZv3VlsGP7_StE6_lEA_4HQ', 'Warmly Export Oct 28'],
  ['1qdo7SvBsEgxg-euhTBfQIPi3nd7DvHRbcnmOjFNoQxo', 'Cold Calling June List'],
  ['1u2IrOkbLBuvbspfvUXZ1RGsU0pvj7Nyg0eUgcv0d620', 'Kalpesh 2026 LinkedIn'],
  ['1GuAKcDXGpHO4szM1pB7TOBSAnvwQB_gjcE8mIzqf8wc', 'Connections'],
  ['1O4zaS40zpDQDVgchYNGhVk5OyF-AXjZ-f6j2JKdfRwE', 'Mumbai Leads'],
  ['1pCvOVsXUorQbxDxLUblha-K-S-xfrdz5aQMkiBdTfpk', 'New Cold Calling'],
  ['1rjhDuYzi_ZHFrUMKlf_jVQljFm3CUU1lF6-eDIKtiZE', 'Vedant 2026 LinkedIn'],
  ['13GW-a8fITyYt57voNv_hzSma1pUmCncjUgsRj_pzzEs', "Kalpesh's LinkedIn Apr 2025"],
  ['1Q8KqG_sTjf5tZvh1ZBx9oTFA8h4DdR7H1f2z6aFrrQo', 'Bangalore Visit Database'],
  ['1r7RuOicVrJcbwnHsS8i4y5Z9YDraDtHoec0TcgGRyaM', 'convertcsv (2)'],
  ['1V9DbZAH6tOR2Dih0EEb_AcsI8RNhyqe0Wm0J6httqKs', 'Clean Cold Calling Data'],
  ['1YF4hF0lYi7jyOuIp0g3JtfkXxs4rT30p6y99NDI7yBg', 'Untitled (Feb 7 2026)'],
  ['1mX76h-hvx0YRfD9EnuRzoSZdErHsFyzpoX_aUjo04Bw', 'Cold Calling Sept 2025'],
  ['16Wo101q8Ey5irZr5yOCUXXe6WcPRDo2FXOxzp_Ro_a0', 'LinkedIn Replies'],
  ['1C7HPf-Mgb9S_JP6X2mWjww7sNtybu4IF8eivrDmvArE', 'AI SRE Launch 2026'],
  ['1fijopb9ae96_l-hDtrwuqq3_iqs5MuWnxB8az70ykfA', 'Oct-Nov-Dec Leads'],
  ['1vhgYRzSOKaWmn_SdmCjy_xWZtHwvLDuX0lZKl6S0Aqk', 'Untitled (Feb 6 2026)'],
  ['1AlcVMKlTxDE4FRbSzCy7Dt-ReEUMih8UnhZsP0Qwp7w', 'All Database For Kal'],
  ['1KhBiAWHQ-Vx2j6-CUkOanKcNwxUi5sncQ8y3Ja8ewK4', "Scrut's ICP Data"],
  ['1M4_EbpUvhkg8y5OllPC_RmlMh3EnScqfmNqAKc4ogpw', 'June 2025 Outbound'],
  ['1_mVhcSUlp3dtrdTU4yBXlzDXzcgq-ZcuhZ2fYy8TYiI', 'New Leads Nov 17'],
  ['1A8S1sRKov7qEenG9gLe4DaCeDlv3vY_zglPu_OrOBD4', 'PH Old Leads'],
  ['1Bi3MS5uWnhCFgvPAz1-9KKeHHRSn-AHqSkG_C0yj6f8', 'PH List'],
  ['1xjmaPSnv8UwfJp05Kz8jEnlgOQKZOzPsE7VuK6XItM8', 'All Indian Leads'],
  ['12S7wdzxywn1-0X9J5YRyDtd3P3i0g9vBCNQtBxvHENY', 'Scoutflo Contacts Master'],
  ['180iHh81Qsq6zzuu4CMAAweCkeEXSrxdTBwBswbw1rXo', 'LinkedIn Cold Outbound'],
];

// Header aliases, most preferred first. When a sheet has several matching
// columns, the one earliest in this list wins (not the leftmost column).
const H = {
  first:   ['first name','firstname','fname','given name'],
  last:    ['last name','lastname','lname','surname','family name'],
  full:    ['contact full name','full name','name','person name','contact name','prospect name'],
  title:   ['title','job title','current title','position','designation','role','headline'],
  company: ['company name - cleaned','company name','company','organization','organisation',
            'account name','employer','current company','company name for emails'],
  li:      ['contact li profile url','person linkedin url','linkedin url','linkedin',
            'li url','linkedin profile','profile url','url'],
};
for(const k in H) H[k] = H[k].map(norm);   // so 'company name - cleaned' can actually match

function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim(); }

const EMAIL_HEADERS = ['email','email 1','email address','work email','business email','primary email',
                       'e mail','email 2','personal email','secondary email','email id'];

function isEmailish(n){ return /^e ?mail\b/.test(n) && !/status|valid|source|confidence|total|catch/.test(n); }

function mapHeaders(row){
  const idx = {}, rank = {};
  row.forEach((cell,i)=>{
    const n = norm(cell);
    if(!n) return;
    for(const k in H){
      const r = H[k].indexOf(n);
      if(r !== -1 && (idx[k] === undefined || r < rank[k])){ idx[k] = i; rank[k] = r; }
    }
  });
  return idx;
}

const LEADER = /\b(head|chief|vp|vice president|director|manager|lead|founder|owner|partner|president|evp|svp|avp|principal)\b/;
const IC     = /\b(software engineer|software developer|developer|programmer|full ?stack|back ?end|front ?end|web developer|android|ios|mobile developer|intern|trainee|student|fresher)\b/;

function classify(raw){
  const t = norm(raw);
  if(!t) return 'skip';
  if(/\b(cto|chief technology|chief technical|ceo|chief executive|co ?founder|founder)\b/.test(t)) return 'include';
  if(/\b(devops|dev ops|sre|site reliability)\b/.test(t)) return 'include';
  if(/engineering/.test(t)) return (IC.test(t) && !LEADER.test(t)) ? 'review' : 'include';
  if(/\b(platform|infrastructure|infra)\b/.test(t) && LEADER.test(t)) return 'include';
  if(/\b(technology|technical|tech|cloud|reliability|qa|quality|data|architect)\b/.test(t) && LEADER.test(t)) return 'review';
  return 'skip';
}

function run(){
  const start = Date.now();
  const state = loadState() ||
              {i:0, t:0, withEmail:[], noEmail:[], review:[], log:[], scanned:0};

  while(state.i < SOURCES.length){
    const pair = SOURCES[state.i];
    let done = true;
    try { done = harvest(pair[0], pair[1], state, start); }
    catch(e){ state.log.push([pair[1],'ERROR', String(e).slice(0,200)]); }
    if(!done){
      saveState(state);
      Logger.log('Paused in source %s of %s (tab %s) — run() again to continue.',
                 state.i+1, SOURCES.length, state.t+1);
      return;
    }
    state.i++; state.t = 0;
    saveState(state);   // checkpoint every source so a hard timeout never loses more than one
  }
  if(Date.now() - start > FINISH_START_MS){
    Logger.log('All sources read. Run run() once more to build the output spreadsheet.');
    return;
  }
  finish(state);
  clearState();
}

// Returns false if it ran out of time before finishing this source's tabs.
function harvest(id, label, state, start){
  const sheets = SpreadsheetApp.openById(id).getSheets();
  for(; state.t < sheets.length; state.t++){
    if(Date.now() - start > TIME_LIMIT_MS) return false;
    harvestTab(sheets[state.t], label, state);
  }
  return true;
}

function harvestTab(sh, label, state){
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if(lastRow < 2 || lastCol < 2) return;
  const vals = sh.getRange(1,1,lastRow,lastCol).getValues();
  const idx = mapHeaders(vals[0]);
  const hasName = idx.full!==undefined || idx.first!==undefined;
  if(!hasName || idx.title===undefined){
    state.log.push([label, sh.getName(), 'skipped — no name/title columns']);
    return;
  }
  const emailCols = emailColumns(vals[0]);
  let kept=0;
  for(let r=1;r<vals.length;r++){
    const row = vals[r];
    state.scanned++;
    const title = String(row[idx.title]||'').trim();
    const verdict = classify(title);
    if(verdict==='skip') continue;
    const name = (idx.full!==undefined && String(row[idx.full]||'').trim())
      || [row[idx.first], row[idx.last]].filter(Boolean).join(' ').trim();
    if(!name) continue;
    const rec = {
      name: name,
      title: title,
      company: idx.company!==undefined ? String(row[idx.company]||'').trim() : '',
      email: pickEmail(row, emailCols),
      li: idx.li!==undefined ? normLi(row[idx.li]) : '',
      file: label,
      src: label + ' / ' + sh.getName()
    };
    kept++;
    if(verdict==='review') state.review.push(rec);
    else if(rec.email) state.withEmail.push(rec);
    else state.noEmail.push(rec);
  }
  state.log.push([label, sh.getName(), (lastRow-1) + ' rows → ' + kept + ' matched']);
}

// [{c: column, personal: bool}] for every column that holds email addresses.
function emailColumns(headers){
  const cols = [];
  for(let c=0;c<headers.length;c++){
    const n = norm(headers[c]);
    if(isEmailish(n) || EMAIL_HEADERS.indexOf(n)!==-1) cols.push({c:c, personal:/personal/.test(n)});
  }
  return cols;
}

function pickEmail(row, cols){
  let best='', personal='';
  cols.forEach(function(col){
    const v = String(row[col.c]||'').trim().toLowerCase().replace(/^mailto:/,'');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return;
    if(col.personal){ if(!personal) personal=v; }
    else if(!best) best=v;
  });
  return best || personal;
}

function normLi(u){
  const s = String(u||'').trim().toLowerCase();
  if(!/linkedin\.com\/in\//.test(s)) return '';
  return s.replace(/^https?:\/\//,'').replace(/^[a-z]{2,3}\.linkedin/,'linkedin').replace(/^www\./,'')
          .split('?')[0].replace(/\/$/,'');
}

function personKey(r){
  if(r.li) return 'li:' + r.li;
  return r.company ? 'nc:' + norm(r.name) + '|' + norm(r.company) : '';
}

// Collapse duplicates by key, filling blanks from later copies and
// collecting the distinct source files each person appears in.
function dedupe(recs, keyFn){
  const byKey={}, out=[];
  recs.forEach(function(r){
    const k = keyFn(r);
    const hit = k && byKey[k];
    if(!hit){
      const c = Object.assign({}, r, {files:{}, srcs:[]});
      c.files[r.file]=1; c.srcs.push(r.src);
      if(k) byKey[k]=c;
      out.push(c);
      return;
    }
    ['company','title','li','email'].forEach(function(f){ if(!hit[f] && r[f]) hit[f]=r[f]; });
    if(!r.matched) hit.matched = hit.matched && r.matched;   // any direct sighting wins
    hit.files[r.file]=1;
    if(hit.srcs.indexOf(r.src)===-1) hit.srcs.push(r.src);
  });
  return out;
}

function finish(state){
  const byLi={}, byNc={};
  state.withEmail.forEach(function(r){
    if(r.li && !byLi[r.li]) byLi[r.li]=r.email;
    const k = norm(r.name)+'|'+norm(r.company);
    if(r.company && !byNc[k]) byNc[k]=r.email;
  });

  const stillNone=[];
  state.noEmail.forEach(function(r){
    const hit = (r.li && byLi[r.li]) || (r.company && byNc[norm(r.name)+'|'+norm(r.company)]);
    if(hit){ r.email=hit; r.matched='backfilled'; state.withEmail.push(r); }
    else stillNone.push(r);
  });

  const master = dedupe(state.withEmail, function(r){ return 'em:' + r.email; });
  const nobody = dedupe(stillNone, personKey);
  const review = dedupe(state.review, function(r){ return r.email ? 'em:'+r.email : personKey(r); });

  let dropped=0;
  const out = master.filter(function(r){ if(!r.company){dropped++;return false;} return true; })
    .map(function(r){ return [r.name,r.email,r.company,r.title,r.srcs.join('; '),
                              r.matched||'direct',Object.keys(r.files).length]; });

  const ss = SpreadsheetApp.create(OUTPUT_NAME);
  write(ss,'Master',['Name','Email','Company','Job Title','Source','Email Origin','Databases Seen In'],out,true);
  write(ss,'No Email Yet',['Name','Company','Job Title','LinkedIn','Source'],
        nobody.map(function(r){return [r.name,r.company,r.title,r.li,r.srcs.join('; ')];}),false);
  write(ss,'Needs Review',['Name','Email','Company','Job Title','Source'],
        review.map(function(r){return [r.name,r.email,r.company,r.title,r.srcs.join('; ')];}),false);
  write(ss,'Run Log',['Source','Tab','Result'],state.log.concat([
    ['TOTALS','rows scanned',state.scanned],
    ['TOTALS','unique prospects',out.length],
    ['TOTALS','dropped (no company)',dropped],
    ['TOTALS','no email yet',nobody.length],
    ['TOTALS','needs review',review.length]
  ]),false);
  Logger.log('DONE → %s', ss.getUrl());
}

// Leading = + - @ would be parsed as a formula by setValues; force plain text.
function safe(v){ return (typeof v==='string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }

function write(ss,name,head,rows,isFirst){
  const sh = isFirst ? ss.getSheets()[0].setName(name) : ss.insertSheet(name);
  sh.getRange(1,1,1,head.length).setValues([head]).setFontWeight('bold');
  sh.setFrozenRows(1);
  if(rows.length) sh.getRange(2,1,rows.length,head.length)
                    .setValues(rows.map(function(row){ return row.map(safe); }));
}

function loadState(){
  const id = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  if(!id) return null;
  try { return JSON.parse(DriveApp.getFileById(id).getBlob().getDataAsString()); }
  catch(e){ throw new Error('Could not read checkpoint file ' + id + ' (' + e + '). Run reset() to start over.'); }
}

function saveState(state){
  const P = PropertiesService.getScriptProperties();
  const old = P.getProperty(STATE_KEY);
  const f = DriveApp.createFile(Utilities.newBlob(JSON.stringify(state), 'application/json', STATE_NAME));
  P.setProperty(STATE_KEY, f.getId());
  if(old){ try { DriveApp.getFileById(old).setTrashed(true); } catch(e){} }
}

function clearState(){
  const P = PropertiesService.getScriptProperties();
  const id = P.getProperty(STATE_KEY);
  if(id){ try { DriveApp.getFileById(id).setTrashed(true); } catch(e){} }
  P.deleteProperty(STATE_KEY);
  P.deleteProperty('STATE');   // left behind by the earlier version of this script
}

function reset(){ clearState(); }
