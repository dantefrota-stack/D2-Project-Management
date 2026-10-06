import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {recentMemberActivity,activityDate} from '../team-activity.mjs';

test('member activity matches the actor email and returns only the newest five actions',()=>{
    const own=Array.from({length:8},(_,index)=>({id:String(index),user:index%2?' MEMBER@example.test ':'member@example.test',timestampIso:`2026-10-0${index+1}T12:00:00Z`,action:'Action '+index}));
    const logs=[...own,{user:'admin@example.test',managedUserEmail:'member@example.test',action:'Edited member'},{user:'different@example.test',name:'Member',action:'Member'}];
    assert.deepEqual(recentMemberActivity(logs,{email:'member@example.test'},'Ambas').map(log=>log.id),['7','6','5','4','3']);
    assert.deepEqual(logs.slice(0,8),own);
    assert.deepEqual(recentMemberActivity(logs,{email:''},'Ambas'),[]);
});

test('company-scoped activity includes account events and excludes actions for other companies',()=>{
    const logs=[
        {id:'hvac',user:'member@example.test',company:'HVAC'},
        {id:'smart',user:'member@example.test',company:'smart'},
        {id:'project',user:'member@example.test',projectId:'smart-project'},
        {id:'account',user:'member@example.test',action:'Signed in'}
    ];
    const projects=[{id:'smart-project',empresa:'Smart Home'}];
    assert.deepEqual(recentMemberActivity(logs,{email:'member@example.test'},'HVAC',projects).map(log=>log.id),['hvac','account']);
    assert.equal(recentMemberActivity(logs,{email:'member@example.test'},'Ambas',projects).length,4);
});

test('audit dates support Firestore and legacy records with a safe fallback',()=>{
    const date=new Date('2026-10-06T12:00:00Z');
    assert.equal(activityDate({createdAt:{toDate:()=>date}}).getTime(),date.getTime());
    assert.equal(activityDate({timestampIso:'invalid',createdAt:{seconds:date.getTime()/1000}}).getTime(),date.getTime());
    assert.equal(activityDate({timestamp:'invalid'}).getTime(),0);
});

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const from=source.indexOf('    let teamEditorBodyOverflow = null;');
const to=source.indexOf('    window.deleteTeam =',from);
assert.ok(from>=0&&to>from);
function fixture() {
    const classes=new Set();let focused=0,reset=0;
    const body={scrollTop:500};
    const modal={classList:{add:key=>classes.add(key),remove:key=>classes.delete(key),contains:key=>classes.has(key)},querySelector:()=>body,addEventListener:(name,handler)=>{modal.onKey=handler;}};
    const elements={'team-editor-modal':modal,'team-back-button':{focus:()=>focused++}};
    const state={isSuperAdmin:true,teamActivityMember:{id:'member',email:'member@example.test'},logsSearchQuery:'old search'};
    const row={dataset:{teamMemberId:'member'},focus:()=>focused++};
    const document={body:{style:{overflow:'auto'}},getElementById:id=>elements[id],querySelectorAll:()=>[row],querySelector:()=>null};
    const window={resetTeamForm:()=>{reset++;state.teamActivityMember=null;},showView:view=>{state.currentView=view;}};
    const context=vm.createContext({document,window,state,lucide:{createIcons:()=>{}}});
    vm.runInContext(source.slice(from,to),context);
    return {context,document,window,state,modal,body,classes,get focused(){return focused;},get reset(){return reset;}};
}
test('opening resets profile scroll; closing restores the team and background scrolling',()=>{
    const f=fixture();vm.runInContext('openTeamEditor()',f.context);
    assert.equal(f.body.scrollTop,0);assert.equal(f.document.body.style.overflow,'hidden');assert.ok(f.classes.has('active'));
    f.body.scrollTop=700;f.window.closeTeamEditor();
    assert.equal(f.document.body.style.overflow,'auto');assert.ok(!f.classes.has('active'));assert.equal(f.state.teamActivityMember,null);assert.equal(f.focused,2);
});
test('Escape closes the profile and viewing all logs selects only its actor without an old search',()=>{
    const f=fixture();vm.runInContext('openTeamEditor()',f.context);
    let prevented=false;f.modal.onKey({key:'Escape',preventDefault:()=>{prevented=true;}});
    assert.ok(prevented);assert.ok(!f.classes.has('active'));
    f.state.teamActivityMember={id:'member',email:' Member@example.test '};
    f.window.openTeamMemberLogs();
    assert.equal(f.state.logsUserFilter,'member@example.test');assert.equal(f.state.logsSearchQuery,'');assert.equal(f.state.currentView,'logs');
    f.state.isSuperAdmin=false;f.state.currentView='users';f.window.openTeamMemberLogs();assert.equal(f.state.currentView,'users');
});
test('the team dialog is outside animated views and its save control still submits the team form',()=>{
    assert.ok(source.indexOf('id="team-editor-modal"')>source.indexOf('</main>'));
    assert.match(source,/role="dialog" aria-modal="true" aria-labelledby="team-editor-title"/);
    assert.match(source,/type="submit" form="team-form" id="btn-save-team"/);
});
