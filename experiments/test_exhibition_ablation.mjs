import assert from 'node:assert/strict';
import {exFactor,removeEx} from './exhibition_ablation.mjs';
const lanes='123456'.split('');
// No exhibition -> factor 1 (② equals ①).
assert.ok(Object.values(exFactor({})).every(v=>v===1));
// Fastest everywhere gets the largest factor, clamped to [0.94, 1.06]; negative ST is ignored as in the engine.
{const ex=Object.fromEntries(lanes.map((l,i)=>[l,{exhibition_time:6.7+i*.03,start_timing:i===5?-0.02:.05+i*.02,lap_time:37+i*.2,turn_time:11+i*.1,straight_time:7+i*.05}]));
 const f=exFactor(ex);for(let i=1;i<6;i++)assert.ok(f[lanes[i-1]]>=f[lanes[i]]-1e-12);assert.ok(Object.values(f).every(v=>v>=.94&&v<=1.06));assert.ok(f['1']>1&&f['6']<1);
 const P=Object.fromEntries(lanes.map(l=>[l,[.2,.2,.2]])),P2=removeEx(P,f);for(const l of lanes)assert.ok(Math.abs(P2[l][0]*f[l]-.2)<1e-15);}
console.log('exhibition ablation OK: no exhibition -> factor 1, engine ordering and clamp, removal is exact division');
