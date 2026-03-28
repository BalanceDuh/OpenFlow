async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body}`);
  }
  return res.json();
}

async function requestWithPathFallback(paths, options = {}) {
  let lastError = null;
  for (const path of paths) {
    try {
      return await request(path, options);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      if (!message.startsWith("404 ")) {
        throw error;
      }
    }
  }
  throw lastError || new Error("request_failed");
}

async function streamRequest(path, { onEvent, timeoutMs = 420000, idleTimeoutMs = 45000, method = "GET", body } = {}) {
  const controller = new AbortController();
  let timeoutTimer = null;
  let idleTimer = null;

  const abortOnce = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  const resetIdleTimer = () => {
    if (!idleTimeoutMs) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortOnce(`stream_idle_timeout_${idleTimeoutMs}ms`);
    }, idleTimeoutMs);
  };

  if (timeoutMs) {
    timeoutTimer = setTimeout(() => {
      abortOnce(`stream_timeout_${timeoutMs}ms`);
    }, timeoutMs);
  }
  resetIdleTimer();

  let donePayload = null;
  let streamError = null;

  try {
    const headers = body ? { "Content-Type": "application/json" } : undefined;
    const res = await fetch(path, {
      signal: controller.signal,
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok || !res.body) {
      throw new Error(await res.text());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";

      for (const chunk of chunks) {
        const line = chunk
          .split("\n")
          .find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        onEvent?.(payload);
        if (payload.type === "done") {
          donePayload = payload;
        }
        if (payload.type === "error") {
          streamError = payload.error || "stream_error";
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      const message = typeof reason === "string" ? reason : error?.message || "stream_aborted";
      throw new Error(message);
    }
    throw error;
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (idleTimer) clearTimeout(idleTimer);
  }

  if (streamError) {
    throw new Error(streamError);
  }
  return donePayload;
}

export const api = {
  getBgmLibrary: () => request("/api/bgm-library"),
  getModelSettings: () => request("/api/model-settings"),
  updateModelSettings: (payload) =>
    request("/api/model-settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getStyleActionSettings: () => request("/api/style-action-settings"),
  updateStyleActionSettings: (payload) =>
    request("/api/style-action-settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getNarrativeActionSettings: () => request("/api/narrative-action-settings"),
  updateNarrativeActionSettings: (payload) =>
    request("/api/narrative-action-settings", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getPublishActionSettings: () =>
    requestWithPathFallback([
      "/api/publish-action-settings",
      "/api/publish-action-setting",
      "/api/publish-settings"
    ]),
  updatePublishActionSettings: (channel, payload) =>
    requestWithPathFallback(
      [
        `/api/publish-action-settings/${channel}`,
        `/api/publish-action-setting/${channel}`,
        `/api/publish-settings/${channel}`
      ],
      {
        method: "PUT",
        body: JSON.stringify(payload)
      }
    ),
  getCleanPrompt: () => request("/api/clean-prompt"),
  saveCleanPromptVersion: (content) =>
    request("/api/clean-prompt/versions", {
      method: "POST",
      body: JSON.stringify({ content })
    }),
  restoreCleanPromptVersion: (versionId) =>
    request(`/api/clean-prompt/restore/${versionId}`, {
      method: "POST"
    }),
  deleteCleanPromptVersion: (versionId) =>
    request(`/api/clean-prompt/versions/${versionId}`, {
      method: "DELETE"
    }),
  listTasks: () => request("/api/tasks"),
  getTaskSummaries: () =>
    requestWithPathFallback([
      "/api/tasks/summary",
      "/api/tasks"
    ]),
  createTask: (aspectRatio) => request("/api/tasks", { method: "POST", body: JSON.stringify({ aspectRatio }) }),
  deleteTask: (taskId) => request(`/api/tasks/${taskId}`, { method: "DELETE" }),
  getState: (taskId) => request(`/api/tasks/${taskId}/state`),
  uploadSource: async (taskId, file) => {
    const fd = new FormData();
    fd.set("image", file);
    const res = await fetch(`/api/tasks/${taskId}/upload-source`, { method: "POST", body: fd });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  },
  uploadProductionFrame: async (taskId, role, file) => {
    const fd = new FormData();
    fd.set("image", file);
    fd.set("role", role);
    const res = await fetch(`/api/tasks/${taskId}/production-frame/upload`, { method: "POST", body: fd });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  },
  uploadCoverSource: async (taskId, file) => {
    const fd = new FormData();
    fd.set("image", file);
    const res = await fetch(`/api/tasks/${taskId}/cover-source/upload`, { method: "POST", body: fd });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  },
  generateCoverFrame: async (taskId, payload = {}) => {
    const fd = new FormData();
    const baseArtifactId = String(payload?.baseArtifactId || "").trim();
    const selectedCoverArtifactId = String(payload?.selectedCoverArtifactId || "").trim();
    const title = String(payload?.title || "");
    const prompt = String(payload?.prompt || "");
    if (baseArtifactId) {
      fd.set("baseArtifactId", baseArtifactId);
    }
    if (selectedCoverArtifactId) {
      fd.set("selectedCoverArtifactId", selectedCoverArtifactId);
    }
    fd.set("title", title);
    fd.set("prompt", prompt);
    const referenceFiles = Array.isArray(payload?.referenceFiles) ? payload.referenceFiles : [];
    for (const file of referenceFiles) {
      fd.append("images", file);
    }
    const res = await fetch(`/api/tasks/${taskId}/cover-frame/generate`, { method: "POST", body: fd });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  },
  refineProductionFrame: async (taskId, role, prompt, files = []) => {
    const fd = new FormData();
    fd.set("role", role);
    fd.set("prompt", prompt);
    for (const file of files) {
      fd.append("images", file);
    }
    const res = await fetch(`/api/tasks/${taskId}/production-frame/refine`, { method: "POST", body: fd });
    if (!res.ok) {
      throw new Error(await res.text());
    }
    return res.json();
  },
  cleanImage: (taskId) => request(`/api/tasks/${taskId}/clean-image`, { method: "POST" }),
  cleanImageStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/clean-image/stream`, {
      timeoutMs: 420000,
      idleTimeoutMs: 45000,
      ...options
    }),
  cropImage: (taskId, payload) =>
    request(`/api/tasks/${taskId}/crop-image`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  generateStylePrompts: (taskId) => request(`/api/tasks/${taskId}/style-prompts/generate`, { method: "POST" }),
  generateStylePromptsStream: async (taskId, { onEvent }) => {
    const res = await fetch(`/api/tasks/${taskId}/style-prompts/generate/stream`, { method: "POST" });
    if (!res.ok || !res.body) {
      throw new Error(await res.text());
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let streamError = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() || "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        onEvent?.(payload);
        if (payload.type === "error") {
          streamError = payload.error || "style_prompt_stream_error";
        }
      }
    }

    if (streamError) {
      throw new Error(streamError);
    }
  },
  generateStyleImages: (taskId) => request(`/api/tasks/${taskId}/style-images/generate`, { method: "POST" }),
  generateStyleImagesStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/style-images/generate/stream`, {
      timeoutMs: 420000,
      idleTimeoutMs: 45000,
      ...options
    }),
  selectStartImage: (taskId, artifactId) =>
    request(`/api/tasks/${taskId}/start-image/select`, {
      method: "POST",
      body: JSON.stringify({ artifactId })
    }),
  generateNarrativePromptsStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/narrative-prompts/generate/stream`, {
      timeoutMs: 240000,
      idleTimeoutMs: 30000,
      ...options
    }),
  listNarrativeStylePrompts: (taskId) => request(`/api/tasks/${taskId}/narrative-style-prompts`),
  updateNarrativeStylePrompt: (taskId, promptId, payload) =>
    request(`/api/tasks/${taskId}/narrative-style-prompts/${promptId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  generateNarratives: (taskId) => request(`/api/tasks/${taskId}/narratives/generate`, { method: "POST" }),
  generateNarrativesStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/narratives/generate/stream`, {
      timeoutMs: 240000,
      idleTimeoutMs: 30000,
      ...options
    }),
  updateNarrativeOption: (taskId, narrativeId, payload) =>
    request(`/api/tasks/${taskId}/narratives/${narrativeId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  confirmNarrative: (taskId, narrativeId, payload) =>
    request(`/api/tasks/${taskId}/narratives/${narrativeId}/confirm`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  startProduction: (taskId, count) =>
    request(`/api/tasks/${taskId}/production/start`, {
      method: "POST",
      body: JSON.stringify({ count })
    }),
  startProductionStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/production/start/stream`, {
      timeoutMs: 1800000,
      idleTimeoutMs: 30000,
      ...options
    }),
  updateProductionConfig: (taskId, payload) =>
    request(`/api/tasks/${taskId}/production-config`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  previewBgm: (taskId, payload) =>
    requestWithPathFallback([
      `/api/tasks/${taskId}/bgm-preview`,
      `/api/tasks/${taskId}/bgm-preview/`
    ], {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  bgmAudioSourceUrl: (taskId, audioPath) =>
    `/api/tasks/${taskId}/bgm-audio-source?path=${encodeURIComponent(audioPath || "")}`,
  composeBgm: (taskId, payload) =>
    request(`/api/tasks/${taskId}/bgm-compose`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  composeBgmSegment: (taskId, payload) =>
    request(`/api/tasks/${taskId}/bgm-segment-compose`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  recommendBgmSegment: (taskId, payload) =>
    request(`/api/tasks/${taskId}/bgm-segment-recommend`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  savePromptVersion: (taskId, promptId, payload) =>
    request(`/api/tasks/${taskId}/prompts/${promptId}/versions`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  renamePrompt: (taskId, promptId, name) =>
    request(`/api/tasks/${taskId}/prompts/${promptId}/name`, {
      method: "PUT",
      body: JSON.stringify({ name })
    }),
  setPromptLang: (taskId, promptId, lang) =>
    request(`/api/tasks/${taskId}/prompts/${promptId}/lang`, {
      method: "PUT",
      body: JSON.stringify({ lang })
    }),
  restorePrompt: (taskId, promptId, versionId) =>
    request(`/api/tasks/${taskId}/prompts/${promptId}/restore/${versionId}`, { method: "POST" }),
  deletePromptVersion: (taskId, promptId, versionId) =>
    request(`/api/tasks/${taskId}/prompts/${promptId}/versions/${versionId}`, { method: "DELETE" }),
  publish: (taskId, payload = {}) =>
    request(`/api/tasks/${taskId}/publish`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  generatePublishPrefill: (taskId, payload = {}) =>
    request(`/api/tasks/${taskId}/publish/prefill-generate`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  generatePublishPrefillStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/publish/prefill-generate/stream`, {
      method: "POST",
      timeoutMs: 240000,
      idleTimeoutMs: 0,
      ...options
    }),
  publishStream: (taskId, options = {}) =>
    streamRequest(`/api/tasks/${taskId}/publish/stream`, {
      method: "POST",
      timeoutMs: 30000,
      idleTimeoutMs: 0,
      ...options
    })
};
