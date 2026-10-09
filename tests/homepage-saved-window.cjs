const assert=require('node:assert/strict');
function savedSampleWindow(sampleCount,closingTimes,now=Date.now()) {
  if(sampleCount>0)return 'saved-records-checked';
  assert.ok(closingTimes.length>0&&closingTimes.every(Number.isFinite),'Need known race close times to verify pre-race empty state');
  assert.ok(now<Math.min(...closingTimes),'Need a real saved race present in today program after first close');
  return 'no-saved-records-before-first-close';
}
module.exports={savedSampleWindow};
