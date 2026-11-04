import assert from 'node:assert/strict';
import {bootstrapRoiBelow1} from './forward_review.mjs';
const win=[...Array(50)].map((_,i)=>({date:`d${i%5}`,investment:100,payout:300}));assert.equal(bootstrapRoiBelow1(win,'race',{resamples:200,seed:1}).share_roi_below_1,0);
const lose=[...Array(50)].map((_,i)=>({date:`d${i%5}`,investment:100,payout:0}));assert.equal(bootstrapRoiBelow1(lose,'date',{resamples:200,seed:1}).share_roi_below_1,1);
assert.equal(bootstrapRoiBelow1(win,'date',{resamples:10,seed:1}).groups,5);
const a=bootstrapRoiBelow1([...win.slice(0,10),...lose],'race',{resamples:500,seed:7}),b=bootstrapRoiBelow1([...win.slice(0,10),...lose],'race',{resamples:500,seed:7});assert.deepEqual(a,b);
console.log('forward review OK: bootstrap extremes, date grouping, fixed seed reproducible');
