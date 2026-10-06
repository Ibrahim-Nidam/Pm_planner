// Technician PM Execution Page (SPECS §10.4, §9)
import { requireRole } from '../guard.js';
import { supabase } from '../supabase-client.js';
import { fetchServerContext, initServerTimeSync, formatDateDDMMYYYY, formatTime24h, formatDurationMinutes } from '../time.js';
import { renderTopBar, renderStatusBadge, showToast, openPhotoLightbox, confirmAction } from '../ui.js';

let taskId = new URLSearchParams(window.location.search).get('id');

async function init() {
  const guard = await requireRole('any');
  if (!guard) return;
  const { profile } = guard;

  initServerTimeSync();
  const serverCtx = await fetchServerContext();

  renderTopBar(document.getElementById('top-bar'), profile, "PM Details");

  if (!taskId) {
    document.getElementById('app').innerHTML = `<div class="p-6 bg-white rounded-2xl text-rose-600 font-semibold">Error: No task ID specified.</div>`;
    return;
  }

  await renderTaskDetails(profile, serverCtx);
}

async function compressImage(file, maxSide = 1600, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width > maxSide || height > maxSide) {
        if (width > height) {
          height = Math.round((height * maxSide) / width);
          width = maxSide;
        } else {
          width = Math.round((width * maxSide) / height);
          height = maxSide;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    };
    img.src = URL.createObjectURL(file);
  });
}

async function renderTaskDetails(profile, serverCtx) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="p-8 text-center text-slate-500 font-medium">Loading PM task...</div>`;

  // Fetch PM task with machine and schedule month info
  const { data: task, error } = await supabase
    .from('pm_tasks')
    .select('*, machines(*), schedule_months(*)')
    .eq('id', taskId)
    .single();

  if (error || !task) {
    app.innerHTML = `<div class="p-6 bg-white rounded-2xl text-rose-600 font-semibold">Error loading task: ${error?.message || 'Task not found'}</div>`;
    return;
  }

  // Fetch photos
  const { data: photos } = await supabase
    .from('pm_photos')
    .select('*')
    .eq('pm_task_id', task.id);

  // Generate signed URLs for photos
  const photoUrls = [];
  if (photos && photos.length > 0) {
    for (const photo of photos) {
      const { data: signedData } = await supabase.storage
        .from('pm-photos')
        .createSignedUrl(photo.storage_path, 3600);
      if (signedData?.signedUrl) {
        photoUrls.push({ id: photo.id, path: photo.storage_path, url: signedData.signedUrl });
      }
    }
  }

  const isTechnician = profile.role === 'technician';
  const isOwner = task.technician_id === profile.id;
  const isApproved = task.schedule_months?.status === 'approved';
  // Validation flags for Start Button
  const canStart = isTechnician && isOwner && isApproved && task.status === 'scheduled';

  // Start disabled reason string
  let startDisabledReason = '';
  if (!isApproved) startDisabledReason = 'Schedule is not published yet.';
  else if (task.status !== 'scheduled') startDisabledReason = `Task is ${task.status}.`;

  let photosHtml = photoUrls.map((p, idx) => `
    <div class="relative group rounded-xl overflow-hidden bg-slate-100 aspect-square shadow-sm cursor-pointer border border-slate-200 hover:border-slate-400 transition-all">
      <img src="${p.url}" alt="PM Evidence ${idx + 1}" data-photo-url="${p.url}" class="lightbox-trigger w-full h-full object-cover">
      <div class="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
        <span class="bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded">Click to Zoom</span>
      </div>
      ${(task.status === 'in_progress' || task.status === 'completed') && isOwner ? `
        <button data-photo-id="${p.id}" data-photo-path="${p.path}" class="delete-photo-btn absolute top-2 right-2 bg-rose-600 text-white text-xs px-2 py-1 rounded-md opacity-90 hover:opacity-100 shadow-sm">Delete</button>
      ` : ''}
    </div>
  `).join('');

  app.innerHTML = `
    <!-- Top Back Navigation -->
    <div>
      <a href="${profile.role === 'team_lead' ? '../lead/schedule.html' : 'dashboard.html'}" class="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-900 bg-white px-3 py-2 rounded-lg shadow-sm">
        &larr; Back to ${profile.role === 'team_lead' ? 'Schedule' : 'Dashboard'}
      </a>
    </div>

    <!-- Main Card -->
    <div class="bg-white rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 class="text-2xl font-bold text-slate-900 tracking-tight">${task.machines?.code} ${task.sequence === 2 ? '(2P)' : '(PM)'}</h2>
          <p class="text-xs font-semibold uppercase tracking-wider text-slate-400 mt-0.5">Line ${task.machines?.line || 'N/A'} &bull; ${task.machines?.location === 'terminal_1' ? 'Terminal 1' : 'Transit'}</p>
        </div>
        <div>
          ${renderStatusBadge(task.status)}
        </div>
      </div>

      <!-- Dates & Info Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-slate-50 p-4 rounded-xl">
          <span class="block text-xs font-semibold uppercase text-slate-400 mb-1">Scheduled Night</span>
          <span class="font-bold text-slate-800 text-sm">${formatDateDDMMYYYY(task.scheduled_date)}</span>
        </div>
        <div class="bg-slate-50 p-4 rounded-xl">
          <span class="block text-xs font-semibold uppercase text-slate-400 mb-1">Tolerance Limit</span>
          <span class="font-bold text-slate-800 text-sm">${formatDateDDMMYYYY(task.latest_allowed_date)}</span>
        </div>
      </div>

      ${task.postponed ? `
        <div class="bg-amber-50 p-4 rounded-xl text-amber-900 text-xs sm:text-sm font-medium space-y-1">
          <span class="font-bold block uppercase tracking-wider text-[10px]">Postponed to Alternate Night</span>
          <p>Reason: ${task.postpone_reason || 'N/A'}</p>
        </div>
      ` : ''}

      <!-- Execution Status Section -->
      ${task.status === 'scheduled' ? `
        <div class="space-y-3 pt-2">
          <button id="start-pm-btn" ${!canStart ? 'disabled' : ''} class="w-full py-4 bg-slate-900 text-white font-bold rounded-xl text-base shadow-sm hover:bg-slate-800 transition-all disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
            Start PM
          </button>
          ${!canStart ? `<p class="text-center text-xs font-medium text-slate-400">${startDisabledReason}</p>` : ''}
        </div>
      ` : ''}

      ${task.status === 'in_progress' || task.status === 'completed' ? `
        <!-- Timestamps -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl">
          <div>
            <span class="block text-[10px] font-semibold uppercase text-slate-400">Started</span>
            <span class="font-bold text-slate-800 text-xs">${formatDateDDMMYYYY(task.started_at)} ${formatTime24h(task.started_at)}</span>
          </div>
          <div>
            <span class="block text-[10px] font-semibold uppercase text-slate-400">Ended</span>
            <span class="font-bold text-slate-800 text-xs">${task.ended_at ? formatTime24h(task.ended_at) : 'In Progress'}</span>
          </div>
          <div>
            <span class="block text-[10px] font-semibold uppercase text-slate-400">Duration</span>
            <span class="font-bold text-slate-800 text-xs">${task.ended_at ? formatDurationMinutes(task.started_at, task.ended_at) : 'Running...'}</span>
          </div>
        </div>

        <!-- Notes Section -->
        <div class="space-y-2">
          <label for="pm-notes" class="block text-xs font-semibold uppercase text-slate-500">Notes & Changes Made</label>
          <textarea id="pm-notes" rows="4" ${task.status === 'completed' || !isOwner ? 'readonly' : ''} placeholder="Describe PM tasks completed..." class="w-full p-4 bg-slate-100 text-slate-900 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900">${task.notes || ''}</textarea>
          ${task.status === 'in_progress' ? '<span id="notes-status" class="text-[10px] text-slate-400 font-medium block text-right">Auto-saved</span>' : ''}
        </div>

        <!-- Photos Section -->
        <div class="space-y-3 pt-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold uppercase text-slate-500">Evidence Photos (${photoUrls.length}/5)</span>
            ${(task.status === 'in_progress' || task.status === 'completed') && isOwner && photoUrls.length < 5 ? `
              <label class="cursor-pointer bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-800 transition-all flex items-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                ${task.status === 'completed' ? 'Add Forgot Photo' : 'Upload Photo'}
                <input id="photo-file-input" type="file" accept="image/*" capture="environment" multiple class="hidden">
              </label>
            ` : ''}
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            ${photosHtml || '<p class="text-xs font-medium text-slate-400 py-2 col-span-full">No evidence photos uploaded yet.</p>'}
          </div>
        </div>

        ${task.status === 'in_progress' && isOwner ? `
          <div class="pt-4">
            <button id="end-pm-btn" class="w-full py-4 bg-emerald-700 text-white font-bold rounded-xl text-base shadow-sm hover:bg-emerald-800 transition-all">
              End PM
            </button>
          </div>
        ` : ''}
      ` : ''}
    </div>
  `;

  // Attach Lightbox triggers
  app.querySelectorAll('.lightbox-trigger').forEach(img => {
    img.addEventListener('click', () => {
      const url = img.getAttribute('data-photo-url');
      if (url) openPhotoLightbox(url, `${task.machines?.code} Evidence Photo`);
    });
  });

  // Attach Start PM Handler
  const startBtn = document.getElementById('start-pm-btn');
  if (startBtn && canStart) {
    startBtn.addEventListener('click', async () => {
      try {
        startBtn.disabled = true;
        startBtn.textContent = "Starting...";
        const { error: rpcErr } = await supabase.rpc('start_pm', {
          p_task_id: task.id,
          p_postpone_reason: null
        });
        if (rpcErr) throw rpcErr;
        showToast("PM started successfully", "success");
        await renderTaskDetails(profile, serverCtx);
      } catch (err) {
        showToast(err.message || "Failed to start PM", "error");
        startBtn.disabled = false;
        startBtn.textContent = "Start PM";
      }
    });
  }

  // Debounced notes auto-saver
  const notesTextarea = document.getElementById('pm-notes');
  if (notesTextarea && task.status === 'in_progress' && isOwner) {
    let saveTimeout = null;
    notesTextarea.addEventListener('input', () => {
      const statusEl = document.getElementById('notes-status');
      if (statusEl) statusEl.textContent = 'Saving...';
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(async () => {
        try {
          await supabase.rpc('save_pm_notes', {
            p_task_id: task.id,
            p_notes: notesTextarea.value
          });
          if (statusEl) statusEl.textContent = 'Saved';
        } catch (e) {
          if (statusEl) statusEl.textContent = 'Save error';
        }
      }, 1500);
    });
  }

  // Photo Upload Handler (Supports uploading during in_progress or completed)
  const photoInput = document.getElementById('photo-file-input');
  if (photoInput) {
    photoInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (!files || files.length === 0) return;

      if (photoUrls.length + files.length > 5) {
        showToast("Maximum 5 photos allowed per PM", "error");
        return;
      }

      showToast("Compressing and uploading photo(s)...", "info");

      for (const file of files) {
        try {
          const compressedBlob = await compressImage(file);
          const photoUuid = crypto.randomUUID();
          const storagePath = `${task.id}/${photoUuid}.jpg`;

          // Upload to bucket
          const { error: uploadErr } = await supabase.storage
            .from('pm-photos')
            .upload(storagePath, compressedBlob, { contentType: 'image/jpeg' });

          if (uploadErr) throw uploadErr;

          // Insert row
          const { error: dbErr } = await supabase
            .from('pm_photos')
            .insert({
              pm_task_id: task.id,
              storage_path: storagePath,
              uploaded_by: profile.id
            });

          if (dbErr) throw dbErr;
        } catch (err) {
          showToast(`Photo upload failed: ${err.message}`, "error");
        }
      }

      await renderTaskDetails(profile, serverCtx);
    });
  }

  // Delete Photo Handlers
  document.querySelectorAll('.delete-photo-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); // prevent opening lightbox
      const photoId = btn.dataset.photoId;
      const photoPath = btn.dataset.photoPath;

      if (!await confirmAction('Delete this evidence photo?', { title: 'Delete photo', confirmLabel: 'Delete photo', danger: true })) return;

      try {
        await supabase.storage.from('pm-photos').remove([photoPath]);
        await supabase.from('pm_photos').delete().eq('id', photoId);
        showToast("Photo deleted", "success");
        await renderTaskDetails(profile, serverCtx);
      } catch (err) {
        showToast("Delete failed", "error");
      }
    });
  });

  // End PM Button Handler
  const endBtn = document.getElementById('end-pm-btn');
  if (endBtn) {
    endBtn.addEventListener('click', async () => {
      if (!await confirmAction('End and complete this PM?', { title: 'Complete PM', confirmLabel: 'Complete PM' })) return;

      try {
        endBtn.disabled = true;
        endBtn.textContent = "Ending...";
        const finalNotes = document.getElementById('pm-notes')?.value;
        const { error: rpcErr } = await supabase.rpc('end_pm', {
          p_task_id: task.id,
          p_notes: finalNotes
        });
        if (rpcErr) throw rpcErr;
        showToast("PM completed successfully", "success");
        await renderTaskDetails(profile, serverCtx);
      } catch (err) {
        showToast(err.message || "Failed to end PM", "error");
        endBtn.disabled = false;
        endBtn.textContent = "End PM";
      }
    });
  }
}

init();
