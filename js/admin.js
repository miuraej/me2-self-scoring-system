import { SCORING, validateAnswerData, toCsv } from './core.js';
import { $, esc, loadBase, loadExamList, download, show } from './shared.js';

document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="admin.css?v=7"><style>.admin-data.section-break{border-top:18px solid var(--paper)}.exam-manager{background:#fff;border:1px solid var(--line);border-radius:13px;padding:18px;margin:0 0 22px}.manager-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:end}.exam-manager details{margin-top:16px}.exam-manager summary{font-weight:900;cursor:pointer}.publish-check{display:flex;align-items:center;gap:8px;padding:10px}.publish-check input{width:auto;margin:0}@media(max-width:800px){.manager-grid{grid-template-columns:1fr 1fr}}</style>');

let exam;
let questions;
let lastRegistered;
const labels = { normal: '通常正答', multiple: '複数正答候補', all_correct: '全員正解', excluded: '採点除外' };
const categories = ['基礎医学', '基礎工学', '基礎ME', '原理構造', '操作運用', '保守安全'];
const typeDefaults = { ME2: [60, 60], NATIONAL: [90, 90], UNIFIED: [90, 90], OTHER: [1, 1] };
const normalizeCorrect = value => value.normalize('NFKC').replace(/[、，]/g, ',').split(',').map(v => v.trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(',');

function render() {
  $('#categoryAverages').innerHTML = `<div class="average-head"><span>分野</span><span>学内平均得点率（%）</span><span>全国平均得点率（%）</span></div>${exam.categories.map(category => `<div class="average-data"><b>${esc(category)}</b><input aria-label="${esc(category)}の学内平均得点率" placeholder="未登録" type="number" min="0" max="100" step="0.1" data-school-category="${esc(category)}"><input aria-label="${esc(category)}の全国平均得点率" placeholder="未登録" type="number" min="0" max="100" step="0.1" data-national-category="${esc(category)}"></div>`).join('')}`;
  const header = '<div class="admin-head"><span>問題・分野</span><span>採点方式</span><span>正答番号</span></div>';
  const rows = questions.map((q, index) => `<div class="admin-data${index > 0 && questions[index - 1].section !== q.section ? ' section-break' : ''}">
    <div class="field question-cell"><b>${esc(exam.sections.find(s => s.id === q.section)?.name)} 問${q.number}</b><label><span>分野</span><select aria-label="${q.section}問${q.number}の分野" data-category="${q.id}">${exam.categories.map(category => `<option value="${esc(category)}" ${category === q.category ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></label></div>
    <label class="field"><span>採点方式</span><select aria-label="問${q.number}の採点方式" data-scoring="${q.id}">${SCORING.map(v => `<option value="${v}">${labels[v]}</option>`).join('')}</select></label>
    <label class="field"><span>正答番号</span><input aria-label="問${q.number}の正答番号" placeholder="例 1,4" data-correct="${q.id}"></label>
  </div>`).join('');
  $('#adminRows').innerHTML = `<div class="admin-table">${header}${rows}</div>`;
  document.querySelectorAll('[data-scoring]').forEach(select => select.addEventListener('change', () => syncCorrect(select)));
  document.querySelectorAll('[data-correct]').forEach(input => input.addEventListener('change', () => { input.value = normalizeCorrect(input.value); }));
}

function syncCorrect(select) {
  const input = $(`[data-correct="${select.dataset.scoring}"]`);
  const unused = ['all_correct', 'excluded'].includes(select.value);
  if (unused) input.value = '';
  input.disabled = unused;
  input.placeholder = unused ? '正答番号なし' : '例 1,4';
}

function syncAllCorrect() { document.querySelectorAll('[data-scoring]').forEach(syncCorrect); }
async function unpublishAnswers() { if (!confirm('正答の登録を解除します。受験者は採点できなくなります。')) return; const response = await fetch(`/api/answers/${encodeURIComponent(exam.examId)}`, { method: 'DELETE' }); if (!response.ok) throw Error(`正答登録の解除に失敗しました (${response.status})`); lastRegistered = undefined; document.querySelectorAll('[data-correct]').forEach(input => { input.value = ''; }); show($('#message'), '正答を未登録状態に戻しました。受験者が採点すると未登録と表示されます。'); }
const optionalNumber = id => $(id).value === '' ? null : Number($(id).value);

async function register() {
  const nationalCategories = {}, schoolCategories = {};
  const answers = questions.map(q => {
    const scoring = $(`[data-scoring="${q.id}"]`).value;
    const input = $(`[data-correct="${q.id}"]`); input.value = normalizeCorrect(input.value);
    const correctAnswers = ['all_correct', 'excluded'].includes(scoring) ? [] : input.value.split(',').map(v => Number(v.trim())).filter(Number.isInteger);
    return { questionId: q.id, scoring, correctAnswers, points: q.points };
  });
  for (const category of exam.categories) { const national = $(`[data-national-category="${category}"]`).value, school = $(`[data-school-category="${category}"]`).value; if (national !== '') nationalCategories[category] = Number(national); if (school !== '') schoolCategories[category] = Number(school); }
  const output = { schemaVersion: exam.schemaVersion, examId: exam.examId, version: $('#answerVersion').value.trim(), updatedAt: new Date().toISOString(), answerStatus: 'published', answers, nationalAverage: { total: optionalNumber('#nationalTotal'), categories: nationalCategories } };
  const errors = validateAnswerData(output, exam, questions);
  if (errors.length) return show($('#message'), errors.join('、'), 'error');
  const answerResponse = await fetch(`/api/answers/${encodeURIComponent(exam.examId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(output) });
  if (!answerResponse.ok) throw Error(`正答の登録に失敗しました (${answerResponse.status})`);
  const schoolTotal = optionalNumber('#schoolTotal'), hasSchool = schoolTotal !== null || Object.keys(schoolCategories).length;
  if (hasSchool) {
    const school = { examId: exam.examId, updatedAt: new Date().toISOString(), studentCount: null, total: schoolTotal, categories: schoolCategories };
    const response = await fetch(`/api/school-averages/${encodeURIComponent(exam.examId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(school) });
    if (!response.ok) throw Error(`学内平均の登録に失敗しました (${response.status})`);
  }
  lastRegistered = output;
  show($('#message'), `正答 v${output.version}${hasSchool ? 'と学内平均' : ''}を登録しました。`);
}

async function restore() {
  lastRegistered = undefined;
  const [answerResponse, schoolResponse] = await Promise.all([fetch(`/api/answers/${encodeURIComponent(exam.examId)}`), fetch(`/api/school-averages/${encodeURIComponent(exam.examId)}`)]);
  if (answerResponse.ok) {
    lastRegistered = await answerResponse.json(); $('#answerVersion').value = lastRegistered.version; $('#nationalTotal').value = lastRegistered.nationalAverage?.total ?? '';
    for (const q of questions) { const a = lastRegistered.answers.find(x => x.questionId === q.id); if (a) { $(`[data-scoring="${q.id}"]`).value = a.scoring; $(`[data-correct="${q.id}"]`).value = a.correctAnswers.join(','); } }
    for (const category of exam.categories) $(`[data-national-category="${category}"]`).value = lastRegistered.nationalAverage?.categories?.[category] ?? '';
  }
  if (schoolResponse.ok) { const school = await schoolResponse.json(); $('#schoolTotal').value = school.total ?? ''; for (const category of exam.categories) $(`[data-school-category="${category}"]`).value = school.categories?.[category] ?? ''; }
  syncAllCorrect();
  return answerResponse.ok;
}

function exportCsv() {
  const rows = questions.map(q => ({ question_id: q.id, category: $(`[data-category="${q.id}"]`).value, scoring: $(`[data-scoring="${q.id}"]`).value, correct_answers: $(`[data-correct="${q.id}"]`).value.replaceAll(',', '|'), school_average: $(`[data-school-category="${$(`[data-category="${q.id}"]`).value}"]`).value, national_average: $(`[data-national-category="${$(`[data-category="${q.id}"]`).value}"]`).value }));
  download(`${exam.examId}_answers.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

async function importCsv(file) {
  const text = (await file.text()).replace(/^\uFEFF/, ''), lines = text.split(/\r?\n/).filter(Boolean), header = lines.shift()?.split(',');
  const required = ['question_id', 'category', 'scoring', 'correct_answers', 'school_average', 'national_average'];
  if (!header || required.some(x => !header.includes(x))) throw Error(`CSVには ${required.join(', ')} が必要です`);
  for (const line of lines) { const values = line.split(','), row = Object.fromEntries(header.map((h, i) => [h, values[i] ?? ''])), q = questions.find(x => x.id === row.question_id); if (!q) throw Error(`未知の問題IDです: ${row.question_id}`); if (!exam.categories.includes(row.category)) throw Error(`${row.question_id}: 分野が不正です`); if (!SCORING.includes(row.scoring)) throw Error(`${row.question_id}: 採点方式が不正です`); $(`[data-category="${q.id}"]`).value = row.category; $(`[data-scoring="${q.id}"]`).value = row.scoring; $(`[data-correct="${q.id}"]`).value = row.correct_answers.replaceAll('|', ','); $(`[data-school-category="${row.category}"]`).value = row.school_average; $(`[data-national-category="${row.category}"]`).value = row.national_average; }
  syncAllCorrect(); show($('#message'), `${lines.length}問をCSVから入力しました。内容を確認して「検証して登録」を押してください。`);
}

async function registerExamName() { const examName = $('#examName').value.trim(); if (!examName) throw Error('試験名を入力してください'); exam.examName=examName;exam.examType=$('#examType').value;exam.isPublished=$('#examPublished').checked;exam.availableFrom=$('#availableFrom').value?new Date($('#availableFrom').value).toISOString():null;exam.availableUntil=$('#availableUntil').value?new Date($('#availableUntil').value).toISOString():null;questions.forEach(q => { q.category = $(`[data-category="${q.id}"]`).value; }); const response = await fetch(`/api/exams/${encodeURIComponent(exam.examId)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({exam,questions}) }); if (!response.ok) throw Error(`試験設定の登録に失敗しました (${response.status})`); }
function generatedQuestions(examId,type,am,pm){return[{id:'am',count:am},{id:'pm',count:pm}].flatMap(section=>Array.from({length:section.count},(_,i)=>({id:`${examId.toLowerCase()}-${section.id}-${String(i+1).padStart(3,'0')}`,examId,section:section.id,number:i+1,category:type==='ME2'?categories[Math.min(5,Math.floor(i/10))]:categories[0],choiceCount:5,points:1})))}
function fillManager(){if(!exam)return;$('#examChoice').value=exam.examId;$('#examType').value=exam.examType;$('#amCount').value=exam.sections.find(s=>s.id==='am')?.questionCount||0;$('#pmCount').value=exam.sections.find(s=>s.id==='pm')?.questionCount||0;$('#examPublished').checked=Boolean(exam.isPublished);$('#availableFrom').value=exam.availableFrom?new Date(exam.availableFrom).toISOString().slice(0,16):'';$('#availableUntil').value=exam.availableUntil?new Date(exam.availableUntil).toISOString().slice(0,16):''}
async function loadAdminExam(id){({exam,questions}=await loadBase(id));render();$('#examName').value=exam.examName;fillManager();await restore()}
async function createExam(){const examId=$('#newExamId').value.trim().toUpperCase(),examName=$('#newExamName').value.trim(),type=$('#newExamType').value,am=Number($('#newAm').value),pm=Number($('#newPm').value);if(!/^[A-Z0-9_-]+$/.test(examId))throw Error('試験IDは半角英数字・_・-で入力してください');if(!examName)throw Error('試験名を入力してください');if(!Number.isInteger(am)||!Number.isInteger(pm)||am<0||pm<0||am+pm<1)throw Error('問題数が不正です');const created={schemaVersion:'1.0',examId,examName,examType:type,version:'1.0.0',formatVersion:'1',updatedAt:new Date().toISOString(),isPublished:true,availableFrom:null,availableUntil:null,sections:[{id:'am',name:'午前',questionCount:am},{id:'pm',name:'午後',questionCount:pm}],categories},createdQuestions=generatedQuestions(examId,type,am,pm),response=await fetch(`/api/exams/${encodeURIComponent(examId)}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({exam:created,questions:createdQuestions})});if(!response.ok)throw Error(`試験作成に失敗しました (${response.status})`);const option=document.createElement('option');option.value=examId;option.textContent=examName;$('#examChoice').append(option);await loadAdminExam(examId);show($('#message'),`${examName}を作成しました。正答を設定してください。`)}
async function init() { const list=await loadExamList();document.querySelector('main').insertAdjacentHTML('afterbegin',`<section class="exam-manager"><h2>試験を管理</h2><div class="manager-grid"><label>登録済み試験<select id="examChoice">${list.map(x=>`<option value="${esc(x.examId)}">${esc(x.examName)}</option>`).join('')}</select></label><label>試験種別<select id="examType"><option value="ME2">第2種ME</option><option value="NATIONAL">国試</option><option value="UNIFIED">統一模試</option><option value="OTHER">その他</option></select></label><label>午前問題数<input id="amCount" disabled></label><label>午後問題数<input id="pmCount" disabled></label><label>利用開始<input id="availableFrom" type="datetime-local"></label><label>利用期限<input id="availableUntil" type="datetime-local"></label><label class="publish-check"><input id="examPublished" type="checkbox">受験者画面に公開</label></div><details><summary>新しい試験を作成</summary><div class="manager-grid"><label>試験ID<input id="newExamId" placeholder="ME2_2027"></label><label>試験名<input id="newExamName"></label><label>試験種別<select id="newExamType"><option value="ME2">第2種ME</option><option value="NATIONAL">国試</option><option value="UNIFIED">統一模試</option><option value="OTHER">その他</option></select></label><label>午前問題数<input id="newAm" type="number" min="0" value="60"></label><label>午後問題数<input id="newPm" type="number" min="0" value="60"></label><button id="createExam" type="button">試験を作成</button></div></details></section>`);await loadAdminExam(list[0].examId);$('#examChoice').addEventListener('change',e=>loadAdminExam(e.target.value).catch(x=>show($('#message'),x.message,'error')));$('#newExamType').addEventListener('change',e=>{[$('#newAm').value,$('#newPm').value]=typeDefaults[e.target.value]});$('#createExam').addEventListener('click',()=>createExam().catch(e=>show($('#message'),e.message,'error'))); $('#validate').insertAdjacentHTML('afterend', '<button id="unpublishAnswers" class="danger">正答を未登録に戻す</button>'); $('#validate').addEventListener('click', () => registerExamName().then(register).catch(e => show($('#message'), e.message, 'error'))); $('#unpublishAnswers').addEventListener('click', () => unpublishAnswers().catch(e => show($('#message'), e.message, 'error'))); $('#importCsv').addEventListener('change', e => importCsv(e.target.files[0]).catch(x => show($('#message'), x.message, 'error'))); $('#exportCsv').addEventListener('click', exportCsv); $('#exportAnswers').addEventListener('click', () => { if (!lastRegistered) return show($('#message'), '登録済みの正答がありません。', 'error'); download(`${exam.examId}_published_answers.json`, JSON.stringify(lastRegistered, null, 2)); }); }
init().catch(e => show($('#message'), e.message, 'error'));
