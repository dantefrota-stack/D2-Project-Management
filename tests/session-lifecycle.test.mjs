import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionLifecycle} from '../session-lifecycle.mjs';

function harness() {
  let now=1000, expired=0, data=[], stops=0, timer;
  const scope=createSessionLifecycle({clearData:()=>{data=[];},onExpired:()=>expired++,now:()=>now,setTimer:fn=>{timer=fn;return fn;},clearTimer:()=>{timer=null;}});
  const listen=()=>{let emit,fail;scope.listen((next,error)=>{emit=next;fail=error;return ()=>stops++;},value=>data.push(value),()=>scope.reset());return {emit,fail};};
  return {scope,listen,advance:value=>{now=value;timer?.();},get data(){return data;},get stops(){return stops;},get expired(){return expired;}};
}
test('logout and identity changes cancel queries and reject queued old snapshots',()=>{
  const h=harness(),old=h.scope.reset(),listener=h.listen();listener.emit('Smart');
  h.scope.reset();assert.equal(h.stops,1);assert.deepEqual(h.data,[]);assert.equal(h.scope.current(old),false);
  listener.emit('queued Smart');h.listen().emit('HVAC');assert.deepEqual(h.data,['HVAC']);
});
test('renewal replaces the deadline; an expired lease clears data and stops queries',()=>{
  const h=harness(),listener=h.listen();h.scope.lease(2000);h.scope.lease(3000);
  h.advance(2000);listener.emit('current');assert.deepEqual(h.data,['current']);
  h.advance(3000);assert.equal(h.expired,1);assert.equal(h.stops,1);assert.deepEqual(h.data,[]);
  listener.emit('late');assert.deepEqual(h.data,[]);
});
test('a listener error clears cached records, and already expired tokens never expose data',()=>{
  const h=harness(),listener=h.listen();listener.emit('old');listener.fail();assert.deepEqual(h.data,[]);
  h.scope.lease(999);assert.equal(h.expired,1);
});
