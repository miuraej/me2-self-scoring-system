import{validatePublicData}from'./core.js';
export const $=s=>document.querySelector(s);
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function loadExamList(){return fetch(`data/exams.json?v=${Date.now()}`,{cache:'no-store'}).then(check).then(r=>r.json())}
export async function loadBase(examId){if(!examId){const list=await loadExamList();examId=list.find(x=>x.isPublished)?.examId||list[0]?.examId}if(!examId)throw Error('利用できる試験がありません');const base=`data/exams/${encodeURIComponent(examId)}`,[exam,questions]=await Promise.all([fetch(`${base}/exam.json`,{cache:'no-store'}).then(check).then(r=>r.json()),fetch(`${base}/questions.json`,{cache:'no-store'}).then(check).then(r=>r.json())]);const errors=validatePublicData(exam,questions);if(errors.length)throw Error(errors.join('、'));return{exam,questions}}
function check(response){if(!response.ok)throw Error(`データ取得失敗 (${response.status})`);return response}
export function readJson(file){return file.text().then(JSON.parse)}
export function download(name,content,type='application/json'){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),0)}
export function show(target,text,type='success'){target.className=`message ${type}`;target.textContent=text}
export const percent=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'—';
