const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'Accretion.jsx'), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const BALANCE'), source.indexOf('/* ---------- number formatting')) +
  source.slice(source.indexOf('const newGame'), source.indexOf('const ago')) +
  ';globalThis.api={newGame,normalize,prod,genMax,genCost,applyOffline,autoPlan,autoPick};', context);
const a = context.api;
assert.throws(() => a.normalize({mass:1,gens:[10000]}), /numeric limits/);
assert.throws(() => a.normalize({mass:1e308,gens:[]}), /numeric limits/);
const normal = a.normalize({mass:1.5e53,gens:[1300],dens:8});
assert.ok(Number.isFinite(a.prod(normal)), 'late-game progress remains supported');
for (let i=0;i<19;i++) for (const count of [0,4,25,100,500,1000]) {
  for (const n of [1,10,25]) {
    const mass=a.genCost(i,count,n);
    assert.equal(a.genMax(i,count,mass),n);
    const less=mass*(1-1e-10);
    assert.ok(a.genCost(i,count,a.genMax(i,count,less))<=less);
  }
}
const now=1800000000000;
const bank=a.newGame();bank.mass=1e-20;bank.best=1e-20;bank.gens[0]=100;bank.lastSave=now-3600000;
const spent=JSON.parse(JSON.stringify(bank));spent.mass=0;
assert.equal(a.applyOffline(bank,now).gain,a.applyOffline(spent,now).gain,'spending cannot reduce the cap');
const planState=a.newGame();planState.gens[0]=1;
const before=JSON.stringify(planState), plan=a.autoPlan(planState);
assert.ok(plan && plan.c>planState.mass,'planner exposes a future purchase');
assert.equal(a.autoPick(planState),null,'planner does not buy before affordability');
assert.equal(JSON.stringify(planState),before,'planning does not mutate progress');

// Exercise the actual startup callback against missing, damaged and inaccessible storage.
async function loadCase(mode) {
  let stored=mode==='damaged' ? '{broken json' : null;
  let writes=0, recovery=null;
  const G={current:a.newGame()},ready={current:false};
  const ctx={G,ready,SAVE_KEY:'save',location:{search:''},normalize:a.normalize,applyOffline:a.applyOffline,
    SFX:{setOn(){}},setSavedAt(){},setWelcome(){},render(){},setStorageOk(){},setRecovery(v){recovery=v;},
    window:{storage:{async get(){
      if(mode==='unavailable')throw new Error('storage denied');
      if(stored===null){const e=new Error('missing');e.code='SAVE_NOT_FOUND';throw e;}
      return {value:stored};
    },async set(k,v){writes++;stored=v;}}}};
  vm.createContext(ctx);
  const start=source.indexOf('(async () => {',source.indexOf('export default function Accretion'));
  await vm.runInContext(source.slice(start,source.indexOf('})();',start)+5),ctx);
  const ss=source.indexOf('async () => {',source.indexOf('const save = useCallback'));
  await vm.runInContext('('+source.slice(ss,source.indexOf('\n  }, []);',ss)+4)+')()',ctx);
  return {stored,writes,recovery,ready:ready.current};
}
(async()=>{
  const missing=await loadCase('missing');assert.equal(missing.ready,true);assert.equal(missing.recovery,null);
  const damaged=await loadCase('damaged');assert.equal(damaged.ready,false);assert.equal(damaged.writes,0);assert.equal(damaged.stored,'{broken json');assert.equal(damaged.recovery.raw,'{broken json');
  const denied=await loadCase('unavailable');assert.equal(denied.ready,false);assert.equal(denied.writes,0);assert.equal(denied.recovery.raw,null);
  // Starting fresh must preserve the original first; a failed backup must block replacement.
  for (const failBackup of [false,true]) {
    const writes=[],ready={current:false},G={current:a.newGame()};
    let recovery={raw:'{broken json'};
    const ctx={recovery,G,ready,SAVE_KEY:'save',newGame:a.newGame(),render(){},setRecovery(v){recovery=v;},
      window:{storage:{async set(k,v){ if(failBackup && k!=='save')throw new Error('full');writes.push([k,v]); }}}};
    ctx.newGame=a.newGame; vm.createContext(ctx);
    const start=source.indexOf('async () => {',source.indexOf('const recoverFresh'));
    await vm.runInContext('('+source.slice(start,source.indexOf('\n  };',start)+4)+')()',ctx);
    if(failBackup){assert.equal(writes.length,0);assert.equal(ready.current,false);}
    else {assert.equal(writes.length,2);assert.ok(writes[0][0].startsWith('save_recovery_'));assert.equal(writes[0][1],'{broken json');assert.equal(writes[1][0],'save');assert.equal(ready.current,true);}
  }
  console.log('Review regressions passed: numeric limits, purchase boundaries, peak-based cap, planner, and save recovery.');
})().catch(e=>{console.error(e);process.exitCode=1;});
