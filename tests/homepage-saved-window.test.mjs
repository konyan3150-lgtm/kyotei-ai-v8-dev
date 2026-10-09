import test from 'node:test';
import assert from 'node:assert/strict';
import {savedSampleWindow} from './homepage-saved-window.cjs';
test('midnight with known future closes is a valid unsaved state',()=>assert.equal(savedSampleWindow(0,[1000,2000],500),'no-saved-records-before-first-close'));
test('missing samples at or after first close fail',()=>{for(const now of [1000,1500])assert.throws(()=>savedSampleWindow(0,[1000,2000],now),/after first close/)});
test('unknown close times cannot justify skipping saved-record verification',()=>{for(const closes of [[],[NaN],[1000,NaN]])assert.throws(()=>savedSampleWindow(0,closes,500),/known race close times/)});
test('available saved samples retain authoritative-record verification',()=>assert.equal(savedSampleWindow(3,[1000],1500),'saved-records-checked'));
