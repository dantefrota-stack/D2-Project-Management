const words = {
  pt: {
    heading: 'Relatórios de andamento', intro: 'Grave uma atualização da obra e revise o relatório antes de salvar.',
    record: 'Gravar atualização', stop: 'Encerrar gravação', listening: 'Gravando', generating: 'Preparando relatório…',
    unavailable: 'Microfone indisponível neste navegador. Você pode descrever o andamento por texto.',
    consent: 'O áudio é enviado para processamento e não é armazenado. A transcrição e o relatório são salvos apenas após sua revisão.',
    notes: 'Ou descreva o andamento por texto', notesPlaceholder: 'Descreva o trabalho realizado, situação atual, pendências e próximos passos.',
    generate: 'Gerar relatório', review: 'Revisar antes de salvar', title: 'Título', summary: 'Resumo executivo',
    completed: 'Trabalho realizado', progress: 'Andamento atual', issues: 'Riscos e pendências', nextSteps: 'Próximos passos',
    transcript: 'Transcrição / notas originais', save: 'Salvar relatório', history: 'Relatórios desta obra',
    empty: 'Nenhum relatório registrado nesta obra.', onePdf: 'Baixar este PDF', allPdf: 'Baixar todos em PDF',
    recordedBy: 'Registrado por', saveDone: 'Relatório salvo.', noAudio: 'A gravação está vazia. Tente novamente.',
    tooLarge: 'Gravação acima de 6 MB. Faça uma atualização mais curta.', microphoneDenied: 'Não foi possível acessar o microfone. Verifique a permissão do navegador.',
    moreDetail: 'Descreva o andamento com mais detalhes.', reviewWarning: 'Confira nomes, datas, números e fatos antes de salvar.',
    spokenLanguage: 'Idioma falado', detectAutomatically: 'Detectar automaticamente', portuguese: 'Português', english: 'English', spanish: 'Español', reportLanguageHint: 'O relatório será escrito no idioma selecionado no Portal; a transcrição manterá o idioma falado.',
    correctLanguage: 'Corrigir idioma do relatório',
    pdfLanguage: 'Idioma do PDF', originalLanguage: 'Original (sem tradução)',
    pdfReview: 'Revise a tradução antes de enviar.',
  },
  en: {
    heading: 'Progress reports', intro: 'Record a project update and review the report before saving.',
    record: 'Record update', stop: 'Stop recording', listening: 'Recording', generating: 'Preparing report…',
    unavailable: 'Microphone unavailable in this browser. You can describe the progress in text.',
    consent: 'Audio is sent for processing and is not stored. The transcript and report are saved only after your review.',
    notes: 'Or describe progress in text', notesPlaceholder: 'Describe completed work, current status, issues, and next steps.',
    generate: 'Generate report', review: 'Review before saving', title: 'Title', summary: 'Executive summary',
    completed: 'Completed work', progress: 'Current progress', issues: 'Risks and pending items', nextSteps: 'Next steps',
    transcript: 'Transcript / original notes', save: 'Save report', history: 'Reports for this project',
    empty: 'No reports recorded for this project.', onePdf: 'Download this PDF', allPdf: 'Download all as PDF',
    recordedBy: 'Recorded by', saveDone: 'Report saved.', noAudio: 'Recording is empty. Please try again.',
    tooLarge: 'Recording exceeds 6 MB. Please make a shorter update.', microphoneDenied: 'Microphone access failed. Check the browser permission.',
    moreDetail: 'Describe the progress in more detail.', reviewWarning: 'Check names, dates, numbers, and facts before saving.',
    spokenLanguage: 'Spoken language', detectAutomatically: 'Detect automatically', portuguese: 'Português', english: 'English', spanish: 'Español', reportLanguageHint: 'The report uses the Portal language; the transcript keeps the language spoken.',
    correctLanguage: 'Correct report language',
    pdfLanguage: 'PDF language', originalLanguage: 'Original (no translation)',
    pdfReview: 'Review the translation before sharing.',
  },
  es: {
    heading: 'Informes de avance', intro: 'Graba una actualización de la obra y revisa el informe antes de guardarlo.',
    record: 'Grabar actualización', stop: 'Detener grabación', listening: 'Grabando', generating: 'Preparando informe…',
    unavailable: 'El micrófono no está disponible en este navegador. Puedes describir el avance por texto.',
    consent: 'El audio se envía para procesarse y no se almacena. La transcripción y el informe se guardan solo tras tu revisión.',
    notes: 'O describe el avance por texto', notesPlaceholder: 'Describe el trabajo realizado, estado actual, pendientes y próximos pasos.',
    generate: 'Generar informe', review: 'Revisar antes de guardar', title: 'Título', summary: 'Resumen ejecutivo',
    completed: 'Trabajo realizado', progress: 'Avance actual', issues: 'Riesgos y pendientes', nextSteps: 'Próximos pasos',
    transcript: 'Transcripción / notas originales', save: 'Guardar informe', history: 'Informes de esta obra',
    empty: 'Todavía no hay informes en esta obra.', onePdf: 'Descargar este PDF', allPdf: 'Descargar todos en PDF',
    recordedBy: 'Registrado por', saveDone: 'Informe guardado.', noAudio: 'La grabación está vacía. Inténtalo de nuevo.',
    tooLarge: 'La grabación supera 6 MB. Haz una actualización más breve.', microphoneDenied: 'No se pudo acceder al micrófono. Revisa los permisos del navegador.',
    moreDetail: 'Describe el avance con más detalle.', reviewWarning: 'Comprueba nombres, fechas, números y hechos antes de guardar.',
    spokenLanguage: 'Idioma hablado', detectAutomatically: 'Detectar automáticamente', portuguese: 'Português', english: 'English', spanish: 'Español', reportLanguageHint: 'El informe usa el idioma del Portal; la transcripción conserva el idioma hablado.',
    correctLanguage: 'Corregir idioma del informe',
    pdfLanguage: 'Idioma del PDF', originalLanguage: 'Original (sin traducción)',
    pdfReview: 'Revisa la traducción antes de enviarla.',
  },
};
const reportFields = ['title', 'summary', 'completed', 'progress', 'issues', 'nextSteps', 'transcript'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const niceDate = (value, lang) => {
  const timestamp = value?.seconds ? value.seconds * 1000 : Date.parse(value || '');
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat(lang === 'pt' ? 'pt-BR' : lang === 'es' ? 'es-ES' : 'en-US', {dateStyle: 'medium', timeStyle: 'short'}).format(timestamp) : '';
};

export function createProjectProgressUI({getToken, getLang}) {
  const languageChoices = ['auto', 'pt', 'en', 'es'];
  let spokenLanguage = 'auto';
  let exportLanguage = 'original';
  try {
    const saved = localStorage.getItem('d2-project-progress.spoken-language');
    if (languageChoices.includes(saved)) spokenLanguage = saved;
  } catch {}
  let project = null;
  let root = null;
  let reports = [];
  let draft = null;
  let notes = '';
  let status = '';
  let error = '';
  let busy = false;
  let loadingFor = '';
  let recorder = null;
  let stream = null;
  let timeout = null;
  let discardRecording = false;

  const lang = () => Object.hasOwn(words, getLang()) ? getLang() : 'pt';
  const w = () => words[lang()];
  async function request(body, pdf = false, expectedId = project?.id) {
    if (!expectedId) throw Error('Project not selected.');
    const token = await getToken();
    if (!token) throw Error('Session expired.');
    const response = await fetch('/api/progress-reports', {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify({projectId: expectedId, lang: lang(), ...body}), cache: 'no-store',
    });
    if (pdf && response.ok) return response.blob();
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(result.error || 'Unable to process the report.');
    return result;
  }
  function setMessage(nextStatus = '', nextError = '') {
    status = nextStatus;
    error = nextError;
    const label = root?.querySelector('[data-progress-status]');
    if (label) { label.textContent = error || status; label.classList.toggle('error', !!error); }
  }
  async function load(expectedId) {
    if (loadingFor === expectedId) return;
    loadingFor = expectedId;
    try {
      const token = await getToken();
      if (!token) throw Error('Session expired.');
      const response = await fetch(`/api/progress-reports?projectId=${encodeURIComponent(expectedId)}`, {headers: {Authorization: `Bearer ${token}`}, cache: 'no-store'});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Unable to load reports.');
      if (project?.id === expectedId) { reports = Array.isArray(data.reports) ? data.reports : []; render(); }
    } catch (cause) {
      if (project?.id === expectedId) setMessage('', cause.message);
    } finally { loadingFor = ''; }
  }
  function render() {
    if (!root || !project) return;
    const t = w();
    const micAvailable = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    root.innerHTML = `
      <div class="progress-head">
        <div class="progress-head-main">
          <button type="button" class="progress-mic ${recorder ? 'recording' : ''}" data-mic aria-label="${recorder ? t.stop : t.record}" ${busy || !micAvailable ? 'disabled' : ''}><i data-lucide="${recorder ? 'square' : 'mic'}"></i><strong>${recorder ? t.stop : t.record}</strong></button>
          <div><span class="progress-kicker">D2 • ${escape(project.empresa)}</span><h2>${t.heading}</h2><p>${t.intro}</p><p class="progress-consent">${micAvailable ? t.consent : t.unavailable}</p></div>
        </div>
      </div>
      <label class="progress-language"><span>${t.spokenLanguage}</span><select data-spoken-language ${busy || recorder ? 'disabled' : ''}>
        ${[['auto', t.detectAutomatically], ['pt', t.portuguese], ['en', t.english], ['es', t.spanish]].map(([id, label]) => `<option value="${id}" ${spokenLanguage === id ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label><p class="progress-language-hint">${t.reportLanguageHint}</p>
      <label class="progress-notes"><span>${t.notes}</span><textarea data-notes maxlength="16000" placeholder="${t.notesPlaceholder}" ${busy || recorder ? 'disabled' : ''}>${escape(notes)}</textarea></label>
      <button type="button" class="progress-generate" data-generate ${busy || recorder ? 'disabled' : ''}>${busy ? t.generating : t.generate}</button>
      <p class="progress-status ${error ? 'error' : ''}" data-progress-status role="status">${escape(error || status)}</p>
      ${draft ? `<div class="progress-draft"><h3>${t.review}</h3><p>${t.reviewWarning}</p>
        ${reportFields.map(key => `<label class="progress-field"><span>${t[key]}</span><textarea data-field="${key}" maxlength="${key === 'transcript' ? 16000 : key === 'title' ? 160 : key === 'summary' || key === 'progress' || key === 'issues' ? 1200 : 1800}" rows="${key === 'title' ? 2 : key === 'transcript' ? 5 : 3}">${escape(draft[key])}</textarea></label>`).join('')}
        <div class="progress-draft-actions"><button type="button" class="progress-correct-language" data-localize ${busy ? 'disabled' : ''}>${t.correctLanguage}</button><button type="button" class="progress-save" data-save ${busy ? 'disabled' : ''}>${t.save}</button></div>
      </div>` : ''}
      <div class="progress-history"><div class="progress-history-title"><div><h3>${t.history}</h3><span>${reports.length}</span></div><div class="progress-history-actions">
        <label class="progress-pdf-language"><span>${t.pdfLanguage}</span><select data-export-language>
          ${[['original', t.originalLanguage], ['pt', t.portuguese], ['en', t.english], ['es', t.spanish]].map(([id, label]) => `<option value="${id}" ${exportLanguage === id ? 'selected' : ''}>${label}</option>`).join('')}
        </select><small data-pdf-review ${exportLanguage === 'original' ? 'hidden' : ''}>${t.pdfReview}</small></label><button type="button" class="progress-all-pdf" data-all-pdf ${reports.length ? '' : 'disabled'}><i data-lucide="files"></i>${t.allPdf}</button></div></div>
        ${reports.length ? reports.map(row => `<article class="progress-report">
          <div class="progress-report-top"><div><h4>${escape(row.title)}</h4><small>${escape(niceDate(row.createdAt, lang()))} • ${t.recordedBy}: ${escape(row.createdBy?.name || row.createdBy?.email || '—')}</small></div>
          <button type="button" data-one-pdf="${escape(row.id)}"><i data-lucide="file-down"></i>${t.onePdf}</button></div>
          <p>${escape(row.summary)}</p>
          ${['completed', 'progress', 'issues', 'nextSteps'].filter(key => row[key]).map(key => `<div class="progress-report-section"><strong>${t[key]}</strong><p>${escape(row[key])}</p></div>`).join('')}
        </article>`).join('') : `<p class="progress-empty">${t.empty}</p>`}
      </div>`;
    root.querySelector('[data-mic]')?.addEventListener('click', () => recorder ? recorder.stop() : startRecording());
    root.querySelector('[data-spoken-language]')?.addEventListener('change', event => {
      if (!languageChoices.includes(event.target.value)) return;
      spokenLanguage = event.target.value;
      try { localStorage.setItem('d2-project-progress.spoken-language', spokenLanguage); } catch {}
    });
    root.querySelector('[data-notes]')?.addEventListener('input', event => { notes = event.target.value; });
    root.querySelector('[data-generate]')?.addEventListener('click', () => generateFromNotes());
    root.querySelectorAll('[data-field]').forEach(field => field.addEventListener('input', () => { draft[field.dataset.field] = field.value; }));
    root.querySelector('[data-save]')?.addEventListener('click', () => saveDraft());
    root.querySelector('[data-localize]')?.addEventListener('click', () => correctLanguage());
    root.querySelector('[data-all-pdf]')?.addEventListener('click', () => downloadPdf({all: true}));
    root.querySelector('[data-export-language]')?.addEventListener('change', event => {
      if (['original', 'pt', 'en', 'es'].includes(event.target.value)) {
        exportLanguage = event.target.value;
        root.querySelector('[data-pdf-review]').hidden = exportLanguage === 'original';
      }
    });
    root.querySelectorAll('[data-one-pdf]').forEach(button => button.addEventListener('click', () => downloadPdf({ids: [button.dataset.onePdf]})));
    try { window.lucide?.createIcons(); } catch {}
  }
  async function generateFromNotes() {
    if (busy || recorder) return;
    if (notes.trim().length < 15) return setMessage('', w().moreDetail);
    const expectedId = project.id;
    busy = true; setMessage(w().generating); render();
    try {
      const result = await request({action: 'generate', notes: notes.trim(), spokenLanguage}, false, expectedId);
      if (project?.id === expectedId) { draft = result.draft; setMessage(); }
    } catch (cause) { setMessage('', cause.message); }
    finally { busy = false; render(); }
  }
  async function startRecording() {
    if (busy || recorder || !project) return;
    const recordedProjectId = project.id;
    try {
      stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}});
      if (project?.id !== recordedProjectId) { stream.getTracks().forEach(track => track.stop()); stream = null; return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      const chunks = [];
      discardRecording = false;
      recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
      recorder.onerror = () => setMessage('', w().microphoneDenied);
      recorder.onstop = async () => {
        clearTimeout(timeout);
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        const recordedMime = recorder?.mimeType || mimeType || 'audio/webm';
        recorder = null;
        if (discardRecording || project?.id !== recordedProjectId) return render();
        busy = true; setMessage(w().generating); render();
        try {
          const blob = new Blob(chunks, {type: recordedMime});
          if (blob.size < 300) throw Error(w().noAudio);
          if (blob.size > 6 * 1024 * 1024) throw Error(w().tooLarge);
          const audio = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(Error(w().noAudio));
            reader.readAsDataURL(blob);
          });
          const result = await request({action: 'generate', audio, spokenLanguage}, false, recordedProjectId);
          if (project?.id === recordedProjectId) { draft = result.draft; setMessage(); }
        } catch (cause) { setMessage('', cause.message); }
        finally { busy = false; render(); }
      };
      recorder.start(1000);
      timeout = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 5 * 60 * 1000);
      setMessage(w().listening);
      render();
    } catch (cause) {
      stream?.getTracks().forEach(track => track.stop());
      stream = null; recorder = null;
      setMessage('', w().microphoneDenied);
      render();
    }
  }
  async function saveDraft() {
    if (!draft || busy) return;
    const expectedId = project.id;
    busy = true; render();
    try {
      await request({action: 'save', draft}, false, expectedId);
      if (project?.id === expectedId) {
        draft = null; notes = ''; setMessage(w().saveDone); await load(expectedId);
      }
    } catch (cause) { setMessage('', cause.message); }
    finally { busy = false; render(); }
  }
  async function correctLanguage() {
    if (!draft || busy) return;
    const expectedId = project.id;
    busy = true; setMessage(w().generating); render();
    try {
      const result = await request({action: 'localize', draft}, false, expectedId);
      if (project?.id === expectedId) { draft = result.draft; setMessage(); }
    } catch (cause) { setMessage('', cause.message); }
    finally { busy = false; render(); }
  }
  async function downloadPdf(selection) {
    if (busy || !reports.length) return;
    const expectedId = project.id;
    busy = true; render();
    try {
      const blob = await request({action: 'pdf', exportLang: exportLanguage, ...selection}, true, expectedId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `project-progress-${expectedId}-${exportLanguage}.pdf`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) { setMessage('', cause.message); }
    finally { busy = false; render(); }
  }
  return {
    mount(container, nextProject) {
      if (!container || !nextProject) return;
      const changed = nextProject.id !== project?.id;
      if (changed) {
        if (recorder?.state === 'recording') { discardRecording = true; recorder.stop(); }
        project = nextProject; reports = []; draft = null; notes = ''; status = ''; error = '';
      }
      const existing = container.querySelector('.project-progress');
      existing?.remove();
      root = document.createElement('section');
      root.className = 'project-progress no-print';
      const header = container.querySelector('.v86-head');
      if (header) header.after(root); else container.prepend(root);
      render();
      if (changed) load(nextProject.id);
    },
    clear() {
      if (recorder?.state === 'recording') { discardRecording = true; recorder.stop(); }
      project = null; root = null; draft = null; notes = '';
    },
  };
}
