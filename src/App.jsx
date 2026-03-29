import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import ImageCropper from "./ImageCropper";
import "./styles.css";

const LEGACY_PROMPT_TITLE_MAP = {
  "Part 1 Prompt": "分镜1提示词 / Part 1 Prompt",
  "Part 2 Prompt": "分镜2提示词 / Part 2 Prompt",
  "End Frame Prompt": "结尾画面提示词 / End Frame Prompt"
};

const LEGACY_PROMPT_CONTENT_MAP = {
  "Song-dynasty white-space minimalism, tiny red-robed figure, vast cyan sky, ancient twisted tree, cinematic realism":
    "中文：宋画留白极简风，小红袍人物，苍青天空，古树虬枝，电影级写实。\nEnglish: Song-dynasty white-space minimalism, tiny red-robed figure, vast cyan sky, ancient twisted tree, cinematic realism.",
  "Zen ink aesthetic, huge negative space, mountain ridge and lone traveler, restrained palette, poetic solitude":
    "中文：禅意水墨美学，大面积留白，山脊与独行旅人，克制配色，诗性孤寂。\nEnglish: Zen ink aesthetic, huge negative space, mountain ridge and lone traveler, restrained palette, poetic solitude.",
  "Traditional Chinese painting realism, clean composition, wind and cloud movement cues, 4K still frame":
    "中文：传统中国画写实感，干净构图，风云流动线索，4K静帧质感。\nEnglish: Traditional Chinese painting realism, clean composition, wind and cloud movement cues, 4K still frame.",
  "Slow dolly-in. The lone traveler stands still; robe edges flutter in wind.":
    "中文：镜头缓慢推进，独行者静立，衣摆在风中轻摆。\nEnglish: Slow dolly-in. The lone traveler stands still; robe edges flutter in wind.",
  "Camera eases right. Cloud layers roll and tree branches sway with stronger gust.":
    "中文：镜头向右平移，云层翻涌，树枝随风势增强而摆动。\nEnglish: Camera eases right. Cloud layers roll and tree branches sway with stronger gust.",
  "The traveler remains beneath the bent tree. Sky opens wider and silence deepens.":
    "中文：人物仍立于曲树之下，天空更开阔，静谧感加深。\nEnglish: The traveler remains beneath the bent tree. Sky opens wider and silence deepens.",
  "Wide static opening, fog crawling over ridge, subtle ambient movement only.":
    "中文：广角静态开场，薄雾沿山脊爬升，仅保留细微环境动态。\nEnglish: Wide static opening, fog crawling over ridge, subtle ambient movement only.",
  "Wind rises, branches flex and clouds surge while camera slowly pulls back.":
    "中文：风势渐起，枝干弯折、云层涌动，镜头缓慢后拉。\nEnglish: Wind rises, branches flex and clouds surge while camera slowly pulls back.",
  "A balanced final tableau of figure, ridge and tree under pale sky.":
    "中文：在浅色天空下，人物、山脊与古树形成均衡终景。\nEnglish: A balanced final tableau of figure, ridge and tree under pale sky.",
  "Gentle push-in as if listening to distant mountains, minimal but alive details.":
    "中文：轻柔推进，仿佛聆听远山回音，细节克制但有生命感。\nEnglish: Gentle push-in as if listening to distant mountains, minimal but alive details.",
  "Soft lateral move, atmosphere thickens, tiny figure contrasts colossal landscape.":
    "中文：镜头轻微横移，空气层次加厚，渺小人物对比宏阔山河。\nEnglish: Soft lateral move, atmosphere thickens, tiny figure contrasts colossal landscape.",
  "Still and solemn ending frame with strong negative space and calm motion residue.":
    "中文：以大留白和余韵式微动收束，形成庄重静止终帧。\nEnglish: Still and solemn ending frame with strong negative space and calm motion residue."
};

const NARRATIVE_PROMPT_ALIASES = {
  part1: ["分镜1提示词 / Part 1 Prompt", "Part 1 Prompt"],
  part2: ["分镜2提示词 / Part 2 Prompt", "Part 2 Prompt"],
  end: ["结尾画面提示词 / End Frame Prompt", "End Frame Prompt"]
};

function toBilingualPromptTitle(title) {
  if (!title) return "";
  if (title.includes(" / ")) return title;
  const styleMatch = title.match(/^Style Prompt\s+(\d+)$/);
  if (styleMatch) {
    return `风格提示词 ${styleMatch[1]} / Style Prompt ${styleMatch[1]}`;
  }
  return LEGACY_PROMPT_TITLE_MAP[title] || title;
}

function toBilingualPromptContent(content) {
  if (!content) return "";
  if (content.includes("中文：") && content.includes("English:")) return content;
  return LEGACY_PROMPT_CONTENT_MAP[content] || content;
}

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 12.65-5.65Z" />
  </svg>
);

const IconDelete = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM6 9h2v9H6V9Z" />
  </svg>
);

const IconSettings = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.15 7.15 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42L9.25 4.96c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.51.41 1.05.72 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
  </svg>
);

const IconCrop = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M7 17V5h12v2H9v10H7Zm-2 2h12v-2H7V7H5v12Zm4-6h10V9h-2v2h-8v2Z" />
  </svg>
);

const IconClean = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M16.24 3.56 21 8.32l-8.9 8.9H7.34L2.58 12.5l13.66-8.94Zm-8.2 11.66h3.24l7.3-7.3-2.34-2.34-10.9 7.14 2.7 2.5Z" />
    <path fill="currentColor" d="M4 19h16v2H4z" />
  </svg>
);

const IconExpand = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M4 9V4h5v2H6v3H4Zm10-5h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 4v-4h2v6h-6v-2h4Z" />
  </svg>
);

const IconSpark = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="m12 2 1.8 4.8L19 8.6l-4 3.2L16.3 17 12 14.1 7.7 17 9 11.8l-4-3.2 5.2-1.8L12 2Zm8 14 1 2.7L24 20l-3 1.3L20 24l-1-2.7L16 20l3-1.3 1-2.7ZM4 14l.8 2.1L7 17l-2.2.9L4 20l-.8-2.1L1 17l2.2-.9L4 14Z" />
  </svg>
);

const IconNarrative = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4v2h10V8H7Zm0 4v2h7v-2H7Z" />
  </svg>
);

const IconStartFrame = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M8 5v14l11-7-11-7Zm-3 1h2v12H5V6Z" />
  </svg>
);

const IconEndFrame = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M6 3h2v18H6V3Zm4 2h9l-2.6 3L19 11h-9V5Z" />
  </svg>
);

const IconCover = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h16V7H4Zm2 8 3.2-4 2.3 2.7 3.2-4.2L18 15H6Zm1-6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
  </svg>
);

const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M8 5v14l11-7-11-7Z" />
  </svg>
);

const IconPause = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
  </svg>
);

const IconStop = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M6 6h12v12H6V6Z" />
  </svg>
);

const IconPreview = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 5c5.5 0 9.5 4.2 10.7 6.3a1.2 1.2 0 0 1 0 1.4C21.5 14.8 17.5 19 12 19S2.5 14.8 1.3 12.7a1.2 1.2 0 0 1 0-1.4C2.5 9.2 6.5 5 12 5Zm0 2c-4.3 0-7.6 3.1-8.7 5 1.1 1.9 4.4 5 8.7 5s7.6-3.1 8.7-5c-1.1-1.9-4.4-5-8.7-5Zm0 2.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6Z"
    />
  </svg>
);

const IconCompose = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M4 4h16v16H4V4Zm2 2v12h12V6H6Zm2 2h4v2H8V8Zm0 4h8v2H8v-2Z" />
  </svg>
);

const IconAnalyzeMusic = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M5 4h2v14H5V4Zm4 4h2v10H9V8Zm4-3h2v13h-2V5Zm4 6h2v7h-2v-7Z" />
  </svg>
);

const IconPublish = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M12 3 6 9h4v6h4V9h4l-6-6Zm-7 14h14v4H5v-4Z" />
  </svg>
);

const IconClear = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Z" />
  </svg>
);

const IconCollapse = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M7 15h10v2H7v-2Zm-2-8h14v2H5V7Z" />
  </svg>
);

const IconHistory = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12 4a8 8 0 1 1-7.75 10h2.1A6 6 0 1 0 12 6c-2 0-3.77.98-4.86 2.5H10v2H3V3h2v3.2A7.97 7.97 0 0 1 12 4Zm-.7 3h1.6v5.1l3 1.8-.8 1.38-3.8-2.28V7Z"
    />
  </svg>
);

const IconUpload = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M11 4h2v8h3l-4 4-4-4h3V4Zm-6 12h14v4H5v-4Z" />
  </svg>
);

const IconPlus = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
  </svg>
);

const IconEnter = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path
      fill="currentColor"
      d="M4 6h10a4 4 0 0 1 4 4v2h2l-3.5 3.5L13 12h2v-2a2 2 0 0 0-2-2H4V6Zm0 10h8v2H4v-2Z"
    />
  </svg>
);

const IconFolderOpen = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1H3V6Zm0 4h20l-2.2 8.2a2 2 0 0 1-1.93 1.48H5.13a2 2 0 0 1-1.93-1.48L1 10h2Z" />
  </svg>
);

const IconSave = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M5 3h11l3 3v15H5V3Zm2 2v4h8V5H7Zm0 14h10v-8H7v8Z" />
  </svg>
);

const IconClose = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3 1.4 1.4Z" />
  </svg>
);

function latestArtifact(artifacts, type) {
  return artifacts.find((a) => a.type === type) || null;
}

function isProductionSelectableImage(artifact) {
  if (!artifact) return false;
  if (!String(artifact.mime_type || "").startsWith("image/")) return false;
  return [
    "source_image",
    "cleaned_image",
    "cropped_image",
    "style_image",
    "narrative_end_frame_image",
    "end_frame_image",
    "production_start_image",
    "production_end_image"
  ].includes(
    artifact.type
  );
}

function clampSegmentPlaybackRate(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0.5, Math.min(2, num));
}

function clampCoverDurationSeconds(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0.2, Math.min(8, num));
}

function waitForMediaReady(mediaEl, timeoutMs = 1500) {
  if (!mediaEl) return Promise.resolve();
  if (mediaEl.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      mediaEl.removeEventListener("loadedmetadata", finish);
      mediaEl.removeEventListener("canplay", finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    mediaEl.addEventListener("loadedmetadata", finish, { once: true });
    mediaEl.addEventListener("canplay", finish, { once: true });
    try {
      mediaEl.load?.();
    } catch {
      finish();
    }
  });
}

function seekMediaCurrentTime(mediaEl, targetSeconds, timeoutMs = 1200) {
  if (!mediaEl) return Promise.resolve();
  const clamped = Math.max(0, Number(targetSeconds) || 0);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      mediaEl.removeEventListener("seeked", finish);
      mediaEl.removeEventListener("timeupdate", onTimeUpdate);
      window.clearTimeout(timer);
      resolve();
    };
    const onTimeUpdate = () => {
      if (Math.abs((Number(mediaEl.currentTime) || 0) - clamped) <= 0.08) {
        finish();
      }
    };
    const timer = window.setTimeout(finish, timeoutMs);
    mediaEl.addEventListener("seeked", finish, { once: true });
    mediaEl.addEventListener("timeupdate", onTimeUpdate);
    try {
      mediaEl.currentTime = clamped;
    } catch {
      finish();
    }
  });
}

const IMAGE_MODEL_OPTIONS = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image"
];

function normalizeImageModel(value) {
  const model = String(value || "").trim();
  if (IMAGE_MODEL_OPTIONS.includes(model)) return model;
  return "gemini-2.5-flash-image";
}

const PUBLISH_CHANNELS = [
  {
    key: "video_channel",
    name: "视频号",
    fields: [
      { key: "title", label: "短标题", multiline: false },
      { key: "description", label: "视频描述", multiline: true }
    ]
  },
  {
    key: "douyin",
    name: "抖音号",
    fields: [
      { key: "title", label: "标题", multiline: false },
      { key: "description", label: "简介", multiline: true },
      { key: "topics", label: "话题标签", multiline: false }
    ]
  },
  {
    key: "xiaohongshu",
    name: "小红书",
    fields: [
      { key: "title", label: "笔记标题", multiline: false },
      { key: "description", label: "正文", multiline: true },
      { key: "topics", label: "话题标签", multiline: false }
    ]
  }
];

const EMPTY_PUBLISH_FORM = {
  video_channel: { title: "", description: "", topics: "" },
  douyin: { title: "", description: "", topics: "" },
  xiaohongshu: { title: "", description: "", topics: "" }
};

function createEmptyPublishForm() {
  return {
    video_channel: { ...EMPTY_PUBLISH_FORM.video_channel },
    douyin: { ...EMPTY_PUBLISH_FORM.douyin },
    xiaohongshu: { ...EMPTY_PUBLISH_FORM.xiaohongshu }
  };
}

const BGM_AUDIO_PATH_STORAGE_KEY = "openflow:last-bgm-audio-path";
const LAST_TASK_ID_STORAGE_KEY = "openflow:last-task-id";

function getStoredBgmAudioPath() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(BGM_AUDIO_PATH_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function saveStoredBgmAudioPath(pathValue) {
  if (typeof window === "undefined") return;
  const value = String(pathValue || "").trim();
  try {
    if (!value) {
      window.localStorage.removeItem(BGM_AUDIO_PATH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(BGM_AUDIO_PATH_STORAGE_KEY, value);
  } catch {
    // ignore storage write failures
  }
}

function getStoredTaskId() {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(LAST_TASK_ID_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function saveStoredTaskId(taskId) {
  if (typeof window === "undefined") return;
  const value = String(taskId || "").trim();
  try {
    if (!value) {
      window.localStorage.removeItem(LAST_TASK_ID_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LAST_TASK_ID_STORAGE_KEY, value);
  } catch {
    // ignore storage write failures
  }
}

function formatTaskTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString();
}

function formatMediaClock(secondsValue) {
  const total = Math.max(0, Number(secondsValue) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildTaskResourceLabels(item) {
  const summary = item?.resourceSummary || {};
  const counts = item?.counts || {};
  const labels = [];
  if (summary.hasSourceImage) labels.push("Source");
  if (summary.hasCleanedImage) labels.push("Cleaned");
  if (summary.hasCroppedImage) labels.push("Cropped");
  if (summary.hasStyleImages) labels.push(`Style x${counts.styleImageCount || 0}`);
  if (summary.hasSelectedStart) labels.push("Start");
  if (summary.hasSelectedEnd) labels.push("End");
  if (summary.hasNarrative) labels.push(`Narrative x${counts.narrativeCount || 0}`);
  if (summary.hasProductionRuns) labels.push(`Production x${counts.productionRunCount || 0}`);
  if (summary.hasCover) labels.push("Cover");
  if (summary.hasFinalVideo) labels.push(`Video x${counts.finalVideoCount || 0}`);
  return labels;
}

function normalizeTaskSummaryItem(item) {
  const counts = item?.counts || {};
  const resourceSummary = item?.resourceSummary || {};
  return {
    ...item,
    counts: {
      artifactCount: Number(counts.artifactCount) || 0,
      styleImageCount: Number(counts.styleImageCount) || 0,
      narrativeCount: Number(counts.narrativeCount) || 0,
      productionRunCount: Number(counts.productionRunCount) || 0,
      finalVideoCount: Number(counts.finalVideoCount) || 0
    },
    resourceSummary: {
      hasSourceImage: Boolean(resourceSummary.hasSourceImage),
      hasCleanedImage: Boolean(resourceSummary.hasCleanedImage),
      hasCroppedImage: Boolean(resourceSummary.hasCroppedImage),
      hasStyleImages: Boolean(resourceSummary.hasStyleImages),
      hasSelectedStart: Boolean(resourceSummary.hasSelectedStart || item?.selected_start_artifact_id),
      hasSelectedEnd: Boolean(resourceSummary.hasSelectedEnd || item?.selected_end_artifact_id),
      hasNarrative: Boolean(resourceSummary.hasNarrative || item?.selected_narrative_id),
      hasCover: Boolean(resourceSummary.hasCover || item?.cover_artifact_id || item?.cover_enabled),
      hasProductionRuns: Boolean(resourceSummary.hasProductionRuns),
      hasFinalVideo: Boolean(resourceSummary.hasFinalVideo)
    }
  };
}

function buildTaskSummaryFromState(baseItem, statePayload) {
  const task = statePayload?.task || {};
  const artifacts = Array.isArray(statePayload?.artifacts) ? statePayload.artifacts : [];
  const narratives = Array.isArray(statePayload?.narratives) ? statePayload.narratives : [];
  const productionTasks = Array.isArray(statePayload?.productionTasks) ? statePayload.productionTasks : [];

  const artifactTypeCounts = artifacts.reduce((acc, item) => {
    const type = String(item?.type || "");
    if (!type) return acc;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return normalizeTaskSummaryItem({
    ...baseItem,
    phase: task.phase || baseItem.phase,
    status: task.status || baseItem.status,
    aspect_ratio: task.aspect_ratio || baseItem.aspect_ratio,
    selected_start_artifact_id: task.selected_start_artifact_id || null,
    selected_end_artifact_id: task.selected_end_artifact_id || null,
    selected_narrative_id: task.selected_narrative_id || null,
    cover_artifact_id: task.cover_artifact_id || null,
    cover_enabled: task.cover_enabled || 0,
    counts: {
      artifactCount: artifacts.length,
      styleImageCount: artifactTypeCounts.style_image || 0,
      narrativeCount: narratives.length,
      productionRunCount: productionTasks.length,
      finalVideoCount:
        (artifactTypeCounts.video_bgm_stretch || 0) + (artifactTypeCounts.video_bgm || 0) + (artifactTypeCounts.video_stitched || 0)
    },
    resourceSummary: {
      hasSourceImage: Boolean(artifactTypeCounts.source_image),
      hasCleanedImage: Boolean(artifactTypeCounts.cleaned_image),
      hasCroppedImage: Boolean(artifactTypeCounts.cropped_image),
      hasStyleImages: Boolean(artifactTypeCounts.style_image),
      hasSelectedStart: Boolean(task.selected_start_artifact_id),
      hasSelectedEnd: Boolean(task.selected_end_artifact_id),
      hasNarrative: Boolean(task.selected_narrative_id) || narratives.length > 0,
      hasCover: Boolean(task.cover_artifact_id) || Boolean(task.cover_enabled),
      hasProductionRuns: productionTasks.length > 0,
      hasFinalVideo: Boolean(artifactTypeCounts.video_bgm_stretch || artifactTypeCounts.video_bgm || artifactTypeCounts.video_stitched)
    }
  });
}

function getPathBaseName(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState("detail");
  const [taskId, setTaskId] = useState(() => getStoredTaskId());
  const [taskList, setTaskList] = useState([]);
  const [state, setState] = useState(null);
  const [modelSettings, setModelSettings] = useState(null);
  const [showModelModal, setShowModelModal] = useState(false);
  const [showCleanPromptModal, setShowCleanPromptModal] = useState(false);
  const [showStylePromptGenerateModal, setShowStylePromptGenerateModal] = useState(false);
  const [showNarrativeGenerateModal, setShowNarrativeGenerateModal] = useState(false);
  const [showNarrativeScenesModal, setShowNarrativeScenesModal] = useState(false);
  const [showProductionHistoryModal, setShowProductionHistoryModal] = useState(false);
  const [showProductionCountModal, setShowProductionCountModal] = useState(false);
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [productionClipCount, setProductionClipCount] = useState(2);
  const [coverEnabledDraft, setCoverEnabledDraft] = useState(false);
  const [coverBaseArtifactIdDraft, setCoverBaseArtifactIdDraft] = useState("");
  const [coverSelectedArtifactIdDraft, setCoverSelectedArtifactIdDraft] = useState("");
  const [coverTitleDraft, setCoverTitleDraft] = useState("");
  const [coverPromptDraft, setCoverPromptDraft] = useState("");
  const [coverDurationDraft, setCoverDurationDraft] = useState("1.0");
  const [coverRefImagesDraft, setCoverRefImagesDraft] = useState([]);
  const [styleActionSettings, setStyleActionSettings] = useState(null);
  const [narrativeActionSettings, setNarrativeActionSettings] = useState(null);
  const [publishActionSettings, setPublishActionSettings] = useState({});
  const [showPublishPromptModal, setShowPublishPromptModal] = useState(false);
  const [publishPromptChannel, setPublishPromptChannel] = useState("video_channel");
  const [publishPromptDraft, setPublishPromptDraft] = useState("");
  const [publishForms, setPublishForms] = useState(createEmptyPublishForm);
  const [stylePromptGenDraft, setStylePromptGenDraft] = useState("");
  const [narrativeGenDraft, setNarrativeGenDraft] = useState("");
  const [cleanPrompt, setCleanPrompt] = useState(null);
  const [cleanPromptDraft, setCleanPromptDraft] = useState("");
  const [liveLogs, setLiveLogs] = useState([]);
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [cropSource, setCropSource] = useState("");
  const [isCropping, setIsCropping] = useState(false);
  const [narrativeModal, setNarrativeModal] = useState(null);
  const [promptModalType, setPromptModalType] = useState(null);
  const [imageViewer, setImageViewer] = useState(null);
  const [productionRefineRole, setProductionRefineRole] = useState(null);
  const [productionRefinePrompt, setProductionRefinePrompt] = useState("");
  const [productionRefineFiles, setProductionRefineFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [consoleClearedAt, setConsoleClearedAt] = useState(0);
  const [settingsDraft, setSettingsDraft] = useState({
    provider: "gemini",
    promptModel: "gemini-3.0-flash",
    imageModel: normalizeImageModel("gemini-2.5-flash-image"),
    videoModel: "veo-3.1-fast-generate-preview",
    apiKey: "",
    clearApiKey: false
  });
  const [bgmAudioPath, setBgmAudioPath] = useState(() => getStoredBgmAudioPath());
  const [bgmDurationSeconds, setBgmDurationSeconds] = useState("16");
  const [bgmSelectedVideoId, setBgmSelectedVideoId] = useState("");
  const [bgmPlaybackRate, setBgmPlaybackRate] = useState("1.00");
  const [bgmPreviewArtifactId, setBgmPreviewArtifactId] = useState("");
  const [bgmLibraryFiles, setBgmLibraryFiles] = useState([]);
  const [bgmLibraryDirectory, setBgmLibraryDirectory] = useState("");
  const [showBgmAudioPickerModal, setShowBgmAudioPickerModal] = useState(false);
  const [showMusicAnalysisModal, setShowMusicAnalysisModal] = useState(false);
  const [bgmAudioPickerQuery, setBgmAudioPickerQuery] = useState("");
  const [bgmSyncPlaying, setBgmSyncPlaying] = useState(false);
  const previewVideoRef = useRef(null);
  const previewAudioRef = useRef(null);
  const [segmentAudioPath, setSegmentAudioPath] = useState(() => getStoredBgmAudioPath());
  const [segmentSelectedVideoId, setSegmentSelectedVideoId] = useState("");
  const [segmentAudioDuration, setSegmentAudioDuration] = useState(0);
  const [segmentVideoDuration, setSegmentVideoDuration] = useState(0);
  const [segmentStartSeconds, setSegmentStartSeconds] = useState(0);
  const [segmentEndSeconds, setSegmentEndSeconds] = useState(0);
  const [segmentPlaybackRate, setSegmentPlaybackRate] = useState("1.00");
  const [segmentTargetDuration, setSegmentTargetDuration] = useState("");
  const [segmentSelectionPlaying, setSegmentSelectionPlaying] = useState(false);
  const [segmentSyncPlaying, setSegmentSyncPlaying] = useState(false);
  const segmentAudioRef = useRef(null);
  const segmentVideoRef = useRef(null);
  const segmentSyncTimerRef = useRef(null);
  const segmentSyncActiveRef = useRef(false);
  const segmentWaveformRef = useRef(null);
  const segmentWaveSurferRef = useRef(null);
  const segmentWaveRegionRef = useRef(null);
  const refreshTasks = async (preferredId = taskId) => {
    const fallbackId = String(preferredId || taskId || getStoredTaskId() || "").trim();
    const res = await api.getTaskSummaries();
    const rawItems = res.items || [];
    const hasSummaryFields = rawItems.some((item) => item?.counts || item?.resourceSummary);
    let items = rawItems.map(normalizeTaskSummaryItem);

    if (!hasSummaryFields && rawItems.length > 0) {
      items = await Promise.all(
        items.map(async (item) => {
          try {
            const statePayload = await api.getState(item.id);
            return buildTaskSummaryFromState(item, statePayload);
          } catch {
            return item;
          }
        })
      );
    }

    setTaskList(items);

    if (items.length === 0) {
      setTaskId("");
      setState(null);
      saveStoredTaskId("");
      return "";
    }

    const nextId =
      fallbackId && items.some((item) => item.id === fallbackId)
        ? fallbackId
        : items[0].id;
    if (nextId !== taskId) {
      setTaskId(nextId);
    }
    saveStoredTaskId(nextId);
    return nextId;
  };

  const refreshState = async (id = taskId) => {
    if (!id) {
      setState(null);
      return;
    }
    const res = await api.getState(id);
    setState(res);
    setAspectRatio(res.task.aspect_ratio || "9:16");
    if (res.modelSettings) {
      setModelSettings(res.modelSettings);
      setSettingsDraft((old) => ({
        ...old,
        provider: res.modelSettings.provider || "gemini",
        promptModel: res.modelSettings.prompt_model || "gemini-3.0-flash",
        imageModel: normalizeImageModel(res.modelSettings.image_model),
        videoModel: res.modelSettings.video_model || "veo-3.1-fast-generate-preview",
        apiKey: "",
        clearApiKey: false
      }));
    }
    if (res.cleanPrompt) {
      setCleanPrompt(res.cleanPrompt);
      setCleanPromptDraft(res.cleanPrompt.currentContent || "");
    }
    if (res.styleActionSettings) {
      setStyleActionSettings(res.styleActionSettings);
      setStylePromptGenDraft(res.styleActionSettings.prompt_generation_instruction || "");
    }
    if (res.narrativeActionSettings) {
      setNarrativeActionSettings(res.narrativeActionSettings);
      setNarrativeGenDraft(res.narrativeActionSettings.generation_instruction || "");
    }
    if (res.publishActionSettings) {
      setPublishActionSettings(res.publishActionSettings);
    }
  };

  const refreshModelSettings = async () => {
    const settings = await api.getModelSettings();
    setModelSettings(settings);
    setSettingsDraft((old) => ({
      ...old,
      provider: settings.provider || "gemini",
      promptModel: settings.prompt_model || "gemini-3.0-flash",
      imageModel: normalizeImageModel(settings.image_model),
      videoModel: settings.video_model || "veo-3.1-fast-generate-preview",
      apiKey: "",
      clearApiKey: false
    }));
  };

  const refreshCleanPrompt = async () => {
    const data = await api.getCleanPrompt();
    setCleanPrompt(data);
    setCleanPromptDraft(data.currentContent || "");
  };

  const refreshStyleActionSettings = async () => {
    const data = await api.getStyleActionSettings();
    setStyleActionSettings(data);
    setStylePromptGenDraft(data.prompt_generation_instruction || "");
  };

  const refreshNarrativeActionSettings = async () => {
    const data = await api.getNarrativeActionSettings();
    setNarrativeActionSettings(data);
    setNarrativeGenDraft(data.generation_instruction || "");
  };

  const refreshPublishActionSettings = async () => {
    try {
      const data = await api.getPublishActionSettings();
      setPublishActionSettings(data || {});
      return data || {};
    } catch (error) {
      const message = String(error?.message || "");
      if (message.startsWith("404 ")) {
        appendLiveLog("error", "[Publish] Prompt settings API not found. Please restart backend server to load latest routes.");
      } else {
        appendLiveLog("error", `[Publish] Load prompt settings failed: ${message || "unknown_error"}`);
      }
      return publishActionSettings || {};
    }
  };

  useEffect(() => {
    refreshTasks();
    refreshModelSettings();
    refreshCleanPrompt();
    refreshStyleActionSettings();
    refreshNarrativeActionSettings();
    refreshPublishActionSettings();
  }, []);

  useEffect(() => {
    refreshState();
  }, [taskId]);

  useEffect(() => {
    saveStoredTaskId(taskId);
  }, [taskId]);

  useEffect(() => {
    setPublishForms(createEmptyPublishForm());
  }, [taskId]);

  const styleImages = useMemo(
    () => (state?.artifacts || []).filter((a) => a.type === "style_image"),
    [state]
  );
  const selectedNarrativeStartArtifact =
    (state?.artifacts || []).find((a) => a.id === state?.task?.selected_start_artifact_id) || null;
  const narrativeReadyForGeneration = Boolean(taskId && selectedNarrativeStartArtifact);
  const narratives = state?.narratives || [];
  const narrativeSlots = [0, 1, 2].map((idx) => narratives[idx] || null);
  const narrativeStylePrompts = state?.narrativeStylePrompts || [];
  const prompts = state?.prompts || [];
  const stylePrompts = prompts.filter((p) => p.prompt_type === "style").slice(0, 3);
  const narrativePrompts = prompts.filter((p) => p.prompt_type === "narrative");
  const getNarrativePromptByAliases = (aliases) => narrativePrompts.find((p) => aliases.includes(p.name)) || null;
  const narrativePart1Prompt = getNarrativePromptByAliases(NARRATIVE_PROMPT_ALIASES.part1);
  const narrativePart2Prompt = getNarrativePromptByAliases(NARRATIVE_PROMPT_ALIASES.part2);
  const narrativeEndPrompt = getNarrativePromptByAliases(NARRATIVE_PROMPT_ALIASES.end);
  const logs = state?.logs || [];
  const combinedLogs = [...liveLogs, ...logs].slice(0, 300);
  const visibleLogs = useMemo(() => {
    if (!consoleClearedAt) return combinedLogs;
    return combinedLogs.filter((l) => {
      const timestamp = Date.parse(l.created_at || "");
      if (!Number.isFinite(timestamp)) return true;
      return timestamp >= consoleClearedAt;
    });
  }, [combinedLogs, consoleClearedAt]);
  const productionTasks = state?.productionTasks || [];
  const latestProductionTask = productionTasks.length ? productionTasks[productionTasks.length - 1] : null;
  const oldProductionTasks = productionTasks.slice(0, -1).reverse();
  const bgmVideoCandidates = useMemo(() => {
    const items = [];
    const slotOrder = { part1: 1, part2: 2, stitched: 3 };
    const pushItem = (task, slot, artifactId, url) => {
      if (!artifactId || !url) return;
      items.push({
        id: `${task.id}_${slot}`,
        runIndex: task.task_index,
        runLabel: `Run ${task.task_index + 1}`,
        slot,
        slotLabel: slot === "part1" ? "Part1" : slot === "part2" ? "Part2" : "Stitched",
        artifactId,
        url
      });
    };

    for (const task of productionTasks) {
      pushItem(task, "part1", task.part1_artifact_id, task.part1_url);
      pushItem(task, "part2", task.part2_artifact_id, task.part2_url);
      pushItem(task, "stitched", task.stitched_artifact_id, task.stitched_url);
    }

    return items.sort((a, b) => {
      if (a.runIndex !== b.runIndex) return a.runIndex - b.runIndex;
      return (slotOrder[a.slot] || 0) - (slotOrder[b.slot] || 0);
    });
  }, [productionTasks]);
  const bgmVideos = useMemo(() => (state?.artifacts || []).filter((a) => a.type === "video_bgm"), [state]);
  const latestBgmVideo = bgmVideos[0] || null;
  const bgmPreviewAudios = useMemo(() => (state?.artifacts || []).filter((a) => a.type === "audio_bgm_preview"), [state]);
  const latestBgmPreviewAudio = bgmPreviewAudios[0] || null;
  const activeBgmPreviewAudio =
    bgmPreviewAudios.find((item) => item.id === bgmPreviewArtifactId) || latestBgmPreviewAudio || null;
  const selectedBgmVideo = bgmVideoCandidates.find((item) => item.artifactId === bgmSelectedVideoId) || null;
  const segmentSelectedVideo = bgmVideoCandidates.find((item) => item.artifactId === segmentSelectedVideoId) || null;
  const segmentBgmVideos = useMemo(() => (state?.artifacts || []).filter((a) => a.type === "video_bgm_stretch"), [state]);
  const latestSegmentBgmVideo = segmentBgmVideos[0] || null;
  const segmentAudioSourceUrl =
    taskId && String(segmentAudioPath || "").trim() ? api.bgmAudioSourceUrl(taskId, String(segmentAudioPath || "").trim()) : "";
  const musicAnalysisUrl = taskId && String(segmentAudioPath || '').trim() ? api.bgmAudioSourceUrl(taskId, String(segmentAudioPath || '').trim()) + '&analysis=1' : '/Resource/Analysis/music-score-viewer-real-v4.html';
  const segmentClipDuration = Math.max(0, segmentEndSeconds - segmentStartSeconds);
  const segmentTargetDurationValue = Number(segmentTargetDuration);
  const segmentHasTargetDuration = Number.isFinite(segmentTargetDurationValue) && segmentTargetDurationValue > 0;
  const segmentManualPlaybackRate = clampSegmentPlaybackRate(segmentPlaybackRate, 1);
  const segmentEffectiveAudioRate = segmentHasTargetDuration
    ? clampSegmentPlaybackRate(segmentClipDuration / segmentTargetDurationValue, segmentManualPlaybackRate)
    : segmentManualPlaybackRate;
  const segmentMusicFinalDuration = segmentClipDuration / Math.max(segmentEffectiveAudioRate, 0.001);
  const coverImageCandidates = useMemo(
    () =>
      (state?.artifacts || [])
        .filter((a) => String(a.mime_type || "").startsWith("image/"))
        .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || "")),
    [state]
  );
  const coverEnabled = Boolean(state?.task?.cover_enabled);
  const coverArtifact = coverImageCandidates.find((a) => a.id === state?.task?.cover_artifact_id) || null;
  const coverDurationSeconds = clampCoverDurationSeconds(state?.task?.cover_duration_seconds, 1);
  const segmentCoverDuration = coverEnabled ? coverDurationSeconds : 0;
  const segmentCoverTransitionDuration = coverEnabled
    ? Math.max(0, Math.min(0.45, Math.max(0, segmentCoverDuration - 0.06), Math.max(0, segmentMusicFinalDuration * 0.24)))
    : 0;
  const segmentVideoBodyDuration = coverEnabled
    ? segmentMusicFinalDuration - segmentCoverDuration + segmentCoverTransitionDuration
    : segmentMusicFinalDuration;
  const segmentComputedVideoSpeed =
    segmentVideoBodyDuration > 0.05 && segmentVideoDuration > 0 ? segmentVideoDuration / segmentVideoBodyDuration : 1;
  const productionImageCandidates = (state?.artifacts || []).filter((a) => isProductionSelectableImage(a));
  const productionStartArtifact = productionImageCandidates.find((a) => a.id === state?.task?.selected_start_artifact_id) || null;
  const productionEndArtifact = productionImageCandidates.find((a) => a.id === state?.task?.selected_end_artifact_id) || null;
  const selectedProductionNarrative = narratives.find((n) => n.id === state?.task?.selected_narrative_id) || null;
  const productionReady = Boolean(taskId && productionStartArtifact && selectedProductionNarrative);
  const latestPublishVideo = useMemo(
    () => (state?.artifacts || []).find((a) => a.type === "video_bgm_stretch" || a.type === "video_bgm") || null,
    [state]
  );
  const publishReady = Boolean(taskId && latestPublishVideo);
  const publishButtonLabel = state?.task?.status === "waiting_login" ? "Resume Publish" : "Publish";
  const imageAspectRatio = aspectRatio === "16:9" ? "16 / 9" : "9 / 16";
  const filteredBgmLibraryFiles = useMemo(() => {
    const q = String(bgmAudioPickerQuery || "").trim().toLowerCase();
    if (!q) return bgmLibraryFiles;
    return bgmLibraryFiles.filter((filePath) => {
      const baseName = getPathBaseName(filePath).toLowerCase();
      return baseName.includes(q) || filePath.toLowerCase().includes(q);
    });
  }, [bgmAudioPickerQuery, bgmLibraryFiles]);

  const pickSegmentAudioPath = (pathValue) => {
    const nextPath = String(pathValue || "").trim();
    setSegmentAudioPath(nextPath);
    setBgmAudioPath(nextPath);
    saveStoredBgmAudioPath(nextPath);
  };

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const result = await api.getBgmLibrary();
        if (canceled) return;
        setBgmLibraryDirectory(String(result?.directory || "").trim());
        const files = Array.isArray(result?.files)
          ? result.files.map((item) => String(item || "").trim()).filter(Boolean)
          : [];
        setBgmLibraryFiles(files);

        const stored = getStoredBgmAudioPath();
        const current = String(segmentAudioPath || bgmAudioPath || "").trim();
        let nextPath = "";
        if (stored && files.includes(stored)) {
          nextPath = stored;
        } else if (current && files.includes(current)) {
          nextPath = current;
        } else if (files.length > 0) {
          nextPath = files[0];
        }

        if (!nextPath) return;
        pickSegmentAudioPath(nextPath);
      } catch {
        // Keep existing path value when library API is unavailable.
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (bgmVideoCandidates.length === 0) {
      if (bgmSelectedVideoId) setBgmSelectedVideoId("");
      return;
    }
    if (bgmVideoCandidates.some((item) => item.artifactId === bgmSelectedVideoId)) {
      return;
    }
    setBgmSelectedVideoId(bgmVideoCandidates[0].artifactId);
  }, [bgmVideoCandidates, bgmSelectedVideoId]);

  useEffect(() => {
    if (bgmVideoCandidates.length === 0) {
      if (segmentSelectedVideoId) setSegmentSelectedVideoId("");
      return;
    }
    if (bgmVideoCandidates.some((item) => item.artifactId === segmentSelectedVideoId)) {
      return;
    }
    setSegmentSelectedVideoId(bgmVideoCandidates[0].artifactId);
  }, [bgmVideoCandidates, segmentSelectedVideoId]);

  useEffect(() => {
    if (!activeBgmPreviewAudio?.id) return;
    setBgmPreviewArtifactId(activeBgmPreviewAudio.id);
    const rate = Number(activeBgmPreviewAudio?.meta?.playbackRate);
    if (Number.isFinite(rate)) {
      setBgmPlaybackRate(rate.toFixed(3));
    }
  }, [activeBgmPreviewAudio?.id, activeBgmPreviewAudio?.meta?.playbackRate]);

  useEffect(() => {
    stopBgmSyncPreview();
  }, [taskId, bgmSelectedVideoId, activeBgmPreviewAudio?.id]);

  useEffect(() => {
    stopSegmentSyncPreview();
  }, [taskId, segmentSelectedVideoId, segmentAudioSourceUrl]);

  useEffect(() => {
    return () => {
      stopSegmentSyncPreview();
    };
  }, []);

  useEffect(() => {
    const ws = segmentWaveSurferRef.current;
    if (!ws) return;
    ws.setPlaybackRate?.(segmentEffectiveAudioRate);
  }, [segmentEffectiveAudioRate]);

  useEffect(() => {
    let disposed = false;

    const destroyWave = () => {
      const ws = segmentWaveSurferRef.current;
      if (ws) {
        ws.destroy();
      }
      segmentWaveSurferRef.current = null;
      segmentWaveRegionRef.current = null;
      setSegmentSelectionPlaying(false);
    };

    const sourceUrl = String(segmentAudioSourceUrl || "").trim();
    if (!segmentWaveformRef.current || !sourceUrl) {
      destroyWave();
      setSegmentAudioDuration(0);
      setSegmentStartSeconds(0);
      setSegmentEndSeconds(0);
      return () => {
        disposed = true;
      };
    }

    destroyWave();

    (async () => {
      try {
        const [{ default: WaveSurfer }, { default: RegionsPlugin }] = await Promise.all([
          import("wavesurfer.js"),
          import("wavesurfer.js/dist/plugins/regions.esm.js")
        ]);
        if (disposed) return;

        const regions = RegionsPlugin.create();
        const ws = WaveSurfer.create({
          container: segmentWaveformRef.current,
          height: 72,
          waveColor: "#2a8bc6",
          progressColor: "#f97316",
          cursorColor: "#f8fafc",
          barWidth: 2,
          barGap: 1,
          barRadius: 2,
          normalize: true,
          url: sourceUrl,
          plugins: [regions]
        });
        segmentWaveSurferRef.current = ws;
        ws.on("play", () => setSegmentSelectionPlaying(true));
        ws.on("pause", () => setSegmentSelectionPlaying(false));
        ws.on("finish", () => setSegmentSelectionPlaying(false));

        ws.on("error", (err) => {
          appendLiveLog("error", `[BGM2] Waveform load failed: ${err?.message || String(err)}`);
        });

        ws.on("ready", () => {
          if (disposed) return;
          const duration = Number(ws.getDuration()) || 0;
          setSegmentAudioDuration(duration);

          let end = segmentEndSeconds > segmentStartSeconds + 0.05 ? segmentEndSeconds : 0;
          if (!Number.isFinite(end) || end <= 0) {
            end = segmentVideoDuration > 0 ? Math.min(duration, segmentVideoDuration) : duration;
          }
          end = Math.max(0.05, Math.min(end, duration));
          let start = Math.max(0, Math.min(segmentStartSeconds, Math.max(0, end - 0.05)));
          if (end <= start + 0.05) {
            start = Math.max(0, end - Math.min(1, end));
          }

          const region = regions.addRegion({
            start,
            end,
            drag: true,
            resize: true,
            minLength: 0.05,
            color: "rgba(59, 130, 246, 0.28)"
          });
          segmentWaveRegionRef.current = region;

          const syncRange = () => {
            const nextStart = Math.max(0, Number(region.start) || 0);
            const nextEnd = Math.max(nextStart + 0.05, Number(region.end) || nextStart + 0.05);
            setSegmentStartSeconds(nextStart);
            setSegmentEndSeconds(nextEnd);
          };

          syncRange();
          region.on("update", syncRange);
          region.on("update-end", syncRange);
        });
      } catch (error) {
        appendLiveLog("error", `[BGM2] Waveform init failed: ${error?.message || "unknown_error"}`);
      }
    })();

    return () => {
      disposed = true;
      destroyWave();
      setSegmentSelectionPlaying(false);
    };
  }, [segmentAudioSourceUrl, segmentVideoDuration]);

  const call = async (fn) => {
    try {
      setBusy(true);
      await fn();
      await refreshTasks();
      await refreshState();
    } finally {
      setBusy(false);
    }
  };

  const createTask = async (ratio = aspectRatio) => {
    try {
      setBusy(true);
      const created = await api.createTask(ratio);
      const nextTaskId = created?.task?.id || "";
      setAspectRatio(ratio);
      setTaskId(nextTaskId);
      saveStoredTaskId(nextTaskId);
      await refreshTasks(nextTaskId);
      await refreshState(nextTaskId);
    } finally {
      setBusy(false);
    }
  };

  const openTaskList = async () => {
    setCurrentPage("list");
    try {
      await refreshTasks();
    } catch (error) {
      appendLiveLog("error", `[Task List] load failed: ${error?.message || "unknown_error"}`);
    }
  };

  const openTaskDetail = async (nextTaskId) => {
    if (!nextTaskId) return;
    setTaskId(nextTaskId);
    setCurrentPage("detail");
  };

  const deleteTaskById = async (targetTaskId, { stayOnList = false } = {}) => {
    if (!targetTaskId || busy) return;
    const confirmed = window.confirm(`Delete task ${targetTaskId.slice(0, 14)}...?`);
    if (!confirmed) return;

    setBusy(true);
    try {
      await api.deleteTask(targetTaskId);
      const preferredId = targetTaskId === taskId ? "" : taskId;
      const nextId = await refreshTasks(preferredId);
      if (targetTaskId === taskId) {
        await refreshState(nextId);
      }
      if (stayOnList) setCurrentPage("list");
    } finally {
      setBusy(false);
    }
  };

  const deleteTask = async () => deleteTaskById(taskId);

  const saveModelSettings = () =>
    call(async () => {
      const payload = {
        provider: settingsDraft.provider,
        promptModel: settingsDraft.promptModel,
        imageModel: settingsDraft.imageModel,
        videoModel: settingsDraft.videoModel
      };
      const newApiKey = String(settingsDraft.apiKey || "").trim();
      if (settingsDraft.clearApiKey) {
        payload.clearApiKey = true;
      } else if (newApiKey) {
        payload.apiKey = newApiKey;
      }
      await api.updateModelSettings(payload);
      setSettingsDraft((old) => ({ ...old, apiKey: "", clearApiKey: false }));
      await refreshModelSettings();
    });

  const openModelSettings = async () => {
    await refreshModelSettings();
    setShowModelModal(true);
  };

  const openCleanPrompt = async () => {
    await refreshCleanPrompt();
    setShowCleanPromptModal(true);
  };

  const openStylePromptGenerateConfig = async () => {
    await refreshStyleActionSettings();
    setShowStylePromptGenerateModal(true);
  };

  const openNarrativeGenerateConfig = async () => {
    await refreshNarrativeActionSettings();
    setShowNarrativeGenerateModal(true);
  };

  const openNarrativeScenesConfig = async () => {
    await refreshState();
    setShowNarrativeScenesModal(true);
  };

  const updatePublishFormField = (channel, field, value) => {
    setPublishForms((old) => ({
      ...old,
      [channel]: {
        ...(old[channel] || { title: "", description: "", topics: "" }),
        [field]: value
      }
    }));
  };

  const openPublishPromptConfig = async (channel) => {
    const key = String(channel || "");
    setPublishPromptChannel(key);
    setPublishPromptDraft(publishActionSettings[key]?.instruction || "");
    setShowPublishPromptModal(true);

    if (!publishActionSettings[key]) {
      try {
        const settings = await refreshPublishActionSettings();
        if (settings[key]?.instruction) {
          setPublishPromptDraft(settings[key].instruction);
        }
      } catch (error) {
        appendLiveLog("error", `[Publish] Load prompt settings failed: ${error?.message || "unknown_error"}`);
      }
    }
  };

  const savePublishPromptConfig = () =>
    call(async () => {
      try {
        await api.updatePublishActionSettings(publishPromptChannel, { instruction: publishPromptDraft });
        await refreshPublishActionSettings();
        setShowPublishPromptModal(false);
        appendLiveLog("success", "[Publish] Prompt settings saved.");
      } catch (error) {
        const message = String(error?.message || "");
        if (message.startsWith("404 ")) {
          appendLiveLog("error", "[Publish] Save failed: prompt settings API missing. Restart backend server and retry.");
        } else {
          appendLiveLog("error", `[Publish] Save prompt settings failed: ${message || "unknown_error"}`);
        }
      }
    });

  const generatePublishPrefill = async (channel) => {
    if (!taskId) return;
    const channelName = PUBLISH_CHANNELS.find((item) => item.key === channel)?.name || channel;
    try {
      await call(async () => {
        appendLiveLog("info", `[Publish][${channelName}] Generating prefill by model...`);
        const done = await api.generatePublishPrefillStream(taskId, {
          body: {
            channel,
            sourceDescription: selectedProductionNarrative?.description || "",
            instruction: publishActionSettings[channel]?.instruction || ""
          },
          onEvent: (event) => {
            if (event?.type !== "prefill_debug") return;
            const stage = String(event.stage || "unknown");
            if (stage === "prompt_sent") {
              appendLiveLog("info", `[Publish][${channelName}] prompt_json=${JSON.stringify(event.request || {})}`);
              return;
            }
            if (stage === "model_raw") {
              appendLiveLog("info", `[Publish][${channelName}] model_raw_json=${String(event.raw || "")}`);
              return;
            }
            if (stage === "model_finish") {
              appendLiveLog("info", `[Publish][${channelName}] finish_reason=${String(event.finishReason || "")}`);
              return;
            }
            if (stage === "model_text") {
              appendLiveLog("info", `[Publish][${channelName}] model_text=${String(event.text || "")}`);
              return;
            }
            if (stage === "repair_raw") {
              appendLiveLog("info", `[Publish][${channelName}] repair_raw_json=${String(event.raw || "")}`);
              return;
            }
            if (stage === "repair_text") {
              appendLiveLog("info", `[Publish][${channelName}] repair_text=${String(event.text || "")}`);
              return;
            }
            if (stage === "parsed") {
              appendLiveLog("info", `[Publish][${channelName}] parsed_json=${JSON.stringify(event.parsed || {})}`);
              appendLiveLog("info", `[Publish][${channelName}] parse_path=${String(event.parsePath || "unknown")}`);
            }
          }
        });
        const result = done?.result || {};
        const next = result?.prefill || {};
        setPublishForms((old) => ({
          ...old,
          [channel]: {
            title: String(next.title || "").trim(),
            description: String(next.description || "").trim(),
            topics: String(next.topics || "").trim()
          }
        }));
        if (result?.meta?.prefillPath) {
          appendLiveLog("info", `[Publish][${channelName}] prefill_path=${result.meta.prefillPath}`);
        }
        if (result?.meta?.parsePath) {
          appendLiveLog("info", `[Publish][${channelName}] parse_path=${result.meta.parsePath}`);
        }
        if (result?.ok === false && result?.meta?.warning === "title_length_not_met") {
          const actual = Number(result?.meta?.actualTitleChars || 0);
          const min = Number(result?.meta?.minTitleChars || 0);
          appendLiveLog(
            "error",
            `[Publish][${channelName}] 标题未达长度要求（${actual}/${min}），已先填入表单，请编辑后再发布。`
          );
          return;
        }
        appendLiveLog("success", `[Publish][${channelName}] Prefill ready.`);
      });
    } catch (error) {
      const message = String(error?.message || "unknown_error");
      if (message.includes("publish_prefill_title_expand_failed_retry")) {
        appendLiveLog("error", `[Publish][${channelName}] 标题扩写未达到长度要求，请点击重试生成。`);
      } else if (message.includes("publish_prefill_disallowed_phrase_retry")) {
        appendLiveLog("error", `[Publish][${channelName}] 命中禁用短句，已停止本次生成，请重试。`);
      } else {
        appendLiveLog("error", `[Publish][${channelName}] Prefill failed: ${message}`);
      }
    }
  };

  const saveStylePromptGenerateConfig = () =>
    call(async () => {
      await api.updateStyleActionSettings({ promptGenerationInstruction: stylePromptGenDraft });
      await refreshStyleActionSettings();
    });

  const saveNarrativeGenerateConfig = () =>
    call(async () => {
      await api.updateNarrativeActionSettings({ generationInstruction: narrativeGenDraft });
      await refreshNarrativeActionSettings();
    });

  const saveCleanPrompt = () =>
    call(async () => {
      await api.saveCleanPromptVersion(cleanPromptDraft);
      await refreshCleanPrompt();
    });

  const restoreCleanPromptVersion = (versionId) =>
    call(async () => {
      await api.restoreCleanPromptVersion(versionId);
      await refreshCleanPrompt();
    });

  const deleteCleanPromptVersion = (versionId) =>
    call(async () => {
      await api.deleteCleanPromptVersion(versionId);
      await refreshCleanPrompt();
    });

  const uploadSourceFile = async (file) => {
    if (!file) return;
    if (!taskId) {
      appendLiveLog("error", "Please select 9:16 or 16:9 to create a task first.");
      return;
    }

    setBusy(true);
    try {
      await api.uploadSource(taskId, file);
      appendLiveLog("success", `Source image uploaded: ${file.name}`);
    } catch (error) {
      appendLiveLog("error", `Upload failed: ${error?.message || "unknown_error"}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };

  const handleSourceFileChange = (event) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    uploadSourceFile(file);
  };

  const appendLiveLog = (level, message, createdAt = new Date().toISOString()) => {
    const entry = {
      id: `live_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      level,
      message,
      created_at: createdAt
    };
    setLiveLogs((prev) => [entry, ...prev].slice(0, 100));
  };

  const handleStreamEvent = (event, errorPrefix) => {
    if (event.type === "log") {
      appendLiveLog(event.level || "info", event.message, event.timestamp || new Date().toISOString());
      return;
    }
    if (event.type === "heartbeat") {
      appendLiveLog("info", `[heartbeat] ${event.message || "stream alive"}`, event.timestamp || new Date().toISOString());
      return;
    }
    if (event.type === "timeout") {
      appendLiveLog("error", `[timeout] ${event.message || "request timeout"}`, event.timestamp || new Date().toISOString());
      return;
    }
    if (event.type === "error") {
      appendLiveLog("error", `${errorPrefix}: ${event.error}`);
      return;
    }
    if (event.type === "style_image_created") {
      const artifact = event.artifact;
      if (!artifact?.id) return;
      setState((prev) => {
        if (!prev || prev.task?.id !== taskId) return prev;
        const artifacts = prev.artifacts || [];
        if (artifacts.some((a) => a.id === artifact.id)) return prev;
        return {
          ...prev,
          artifacts: [artifact, ...artifacts]
        };
      });
    }
  };

  const cleanImage = async () => {
    if (!taskId) return;
    setBusy(true);
    setLiveLogs([]);
    try {
      await api.cleanImageStream(taskId, {
        onEvent: (event) => {
          handleStreamEvent(event, "Clean failed");
        }
      });
    } catch (error) {
      appendLiveLog("error", `Clean exception: ${error.message}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };

  const openCrop = () => {
    const cleaned = latestArtifact(state?.artifacts || [], "cleaned_image");
    const source = latestArtifact(state?.artifacts || [], "source_image");
    const candidate = cleaned || source;
    if (!candidate) return;
    setCropSource(candidate.url);
    setIsCropping(true);
  };

  const confirmCrop = (payload) =>
    call(async () => {
      await api.cropImage(taskId, {
        croppedDataUrl: payload.croppedDataUrl,
        ratio: aspectRatio,
        crop: payload.crop
      });
      setIsCropping(false);
    });

  const generateStylePrompts = async () => {
    if (!taskId) return;
    setBusy(true);
    setLiveLogs([]);
    try {
      await api.generateStylePromptsStream(taskId, {
        onEvent: (event) => {
          handleStreamEvent(event, "Style prompt generation failed");
        }
      });
    } catch (error) {
      appendLiveLog("error", `Style prompt generation exception: ${error?.message || "unknown_error"}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };
  const generateStyleImages = async () => {
    if (!taskId) return;
    setBusy(true);
    setLiveLogs([]);
    setState((prev) => {
      if (!prev || prev.task?.id !== taskId) return prev;
      return {
        ...prev,
        task: {
          ...prev.task,
          selected_start_artifact_id: null,
          phase: "STYLE"
        },
        artifacts: (prev.artifacts || []).filter((a) => a.type !== "style_image")
      };
    });
    try {
      await api.generateStyleImagesStream(taskId, {
        onEvent: (event) => {
          handleStreamEvent(event, "Style generation failed");
        }
      });
    } catch (error) {
      appendLiveLog("error", `Style generation exception: ${error?.message || "unknown_error"}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };
  const generateNarrativePrompts = async () => {
    if (!taskId) return;
    if (!selectedNarrativeStartArtifact) {
      appendLiveLog("error", "Please select a Step 2 style image as the start frame first.");
      return;
    }
    setBusy(true);
    setLiveLogs([]);
    try {
      await api.generateNarrativePromptsStream(taskId, {
        onEvent: (event) => {
          handleStreamEvent(event, "Narrative prompt generation failed");
          if (event.type === "item_saved") {
            refreshState();
          }
        }
      });
    } catch (error) {
      appendLiveLog("error", `Narrative prompt generation exception: ${error?.message || "unknown_error"}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };

  const generateNarratives = async () => {
    if (!taskId) return;
    if (!selectedNarrativeStartArtifact) {
      appendLiveLog("error", "Please select a Step 2 style image as the start frame first.");
      return;
    }
    setBusy(true);
    setLiveLogs([]);
    try {
      await api.generateNarrativesStream(taskId, {
        onEvent: (event) => {
          handleStreamEvent(event, "Generate Narrative failed");
          if (event.type === "item_saved") {
            refreshState();
          }
        }
      });
    } catch (error) {
      appendLiveLog("error", `Generate Narrative exception: ${error?.message || "unknown_error"}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };
  const updateProductionConfig = async (payload, source = "unknown") => {
    if (!taskId) {
      appendLiveLog("error", `[Production Config] ignored (${source}): task not selected`);
      return;
    }
    appendLiveLog("info", `[Production Config] request (${source}): ${JSON.stringify(payload)}`);
    try {
      await call(async () => {
        const result = await api.updateProductionConfig(taskId, payload);
        const task = result?.task || {};
        appendLiveLog(
          "success",
          `[Production Config] updated: start=${task.selected_start_artifact_id || "-"}, end=${task.selected_end_artifact_id || "-"}, narrative=${task.selected_narrative_id || "-"}`
        );
      });
    } catch (error) {
      appendLiveLog("error", `[Production Config] failed (${source}): ${error?.message || "unknown_error"}`);
    }
  };
  const selectProductionStart = (artifactId) => updateProductionConfig({ startArtifactId: artifactId }, "set_start");
  const selectProductionEnd = (artifactId) => updateProductionConfig({ endArtifactId: artifactId }, "set_end");
  const clearProductionEnd = () => updateProductionConfig({ endArtifactId: null }, "clear_end");
  const selectProductionNarrative = (narrativeId) => updateProductionConfig({ narrativeId }, "set_narrative");
  const openCoverModal = () => {
    const fallbackBaseId = String(state?.task?.cover_artifact_id || productionStartArtifact?.id || coverImageCandidates[0]?.id || "");
    setCoverRefImagesDraft((items) => {
      for (const item of items) {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch {
          // ignore
        }
      }
      return [];
    });
    setCoverEnabledDraft(Boolean(state?.task?.cover_enabled));
    setCoverBaseArtifactIdDraft(fallbackBaseId);
    setCoverSelectedArtifactIdDraft(String(state?.task?.cover_artifact_id || ""));
    setCoverTitleDraft(String(state?.task?.cover_title || ""));
    setCoverPromptDraft(String(state?.task?.cover_prompt || ""));
    setCoverDurationDraft(String(clampCoverDurationSeconds(state?.task?.cover_duration_seconds, 1)));
    setShowCoverModal(true);
  };
  const closeCoverModal = () => {
    setCoverRefImagesDraft((items) => {
      for (const item of items) {
        try {
          URL.revokeObjectURL(item.previewUrl);
        } catch {
          // ignore
        }
      }
      return [];
    });
    setShowCoverModal(false);
  };
  const appendCoverReferenceFiles = (fileList) => {
    const nextFiles = Array.from(fileList || []).filter((file) => String(file?.type || "").startsWith("image/"));
    if (!nextFiles.length) return;
    setCoverRefImagesDraft((current) => [
      ...current,
      ...nextFiles.map((file) => ({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file)
      }))
    ]);
  };
  const removeCoverReferenceFile = (id) => {
    setCoverRefImagesDraft((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) {
        try {
          URL.revokeObjectURL(target.previewUrl);
        } catch {
          // ignore
        }
      }
      return current.filter((item) => item.id !== id);
    });
  };
  const onCoverReferenceUpload = (event) => {
    appendCoverReferenceFiles(event.target?.files || []);
    if (event.target) {
      event.target.value = "";
    }
  };
  const onCoverPromptPaste = (event) => {
    const items = Array.from(event.clipboardData?.items || []);
    const imageFiles = items
      .map((item) => (item.kind === "file" ? item.getAsFile() : null))
      .filter((file) => file && String(file.type || "").startsWith("image/"));
    if (!imageFiles.length) return;
    event.preventDefault();
    appendCoverReferenceFiles(imageFiles);
  };
  const saveCoverConfig = async () => {
    if (!taskId) return;
    try {
      await updateProductionConfig(
        {
          coverEnabled: coverEnabledDraft,
          coverArtifactId: coverSelectedArtifactIdDraft || null,
          coverTitle: coverTitleDraft,
          coverPrompt: coverPromptDraft,
          coverDurationSeconds: clampCoverDurationSeconds(coverDurationDraft, 1)
        },
        "set_cover"
      );
      closeCoverModal();
    } catch (error) {
      appendLiveLog("error", `[Cover] Save config failed: ${error?.message || "unknown_error"}`);
    }
  };
  const generateCoverFrame = async () => {
    if (!taskId) return;
    const baseArtifactId = String(coverBaseArtifactIdDraft || "").trim();
    const title = String(coverTitleDraft || "").trim();
    const prompt = String(coverPromptDraft || "").trim();
    if (!baseArtifactId && coverRefImagesDraft.length === 0) {
      appendLiveLog("error", "[Cover] Please select a base image or paste/upload at least one reference image.");
      return;
    }
    if (!title) {
      appendLiveLog("error", "[Cover] Please input title text.");
      return;
    }
    try {
      await call(async () => {
        const result = await api.generateCoverFrame(taskId, {
          baseArtifactId,
          selectedCoverArtifactId: coverSelectedArtifactIdDraft,
          title,
          prompt,
          referenceFiles: coverRefImagesDraft.map((item) => item.file)
        });
        const nextCoverId = String(result?.artifactId || "");
        setCoverSelectedArtifactIdDraft(nextCoverId);
        setCoverEnabledDraft(true);
      });
      appendLiveLog("success", "[Cover] Cover generated.");
    } catch (error) {
      appendLiveLog("error", `[Cover] Generate failed: ${error?.message || "unknown_error"}`);
    }
  };
  const closeProductionRefineModal = () => {
    setProductionRefineRole(null);
    setProductionRefinePrompt("");
    setProductionRefineFiles([]);
  };
  const openProductionRefineModal = (role) => {
    if (!taskId) return;
    const targetArtifact = role === "start" ? productionStartArtifact : productionEndArtifact;
    if (!targetArtifact) {
      appendLiveLog("error", `[Production Refine] selected ${role} frame is required before refine.`);
      return;
    }
    const defaultPrompt = role === "start"
      ? (selectedProductionNarrative?.part1_prompt || "")
      : (selectedProductionNarrative?.end_frame_prompt || "");
    setProductionRefineRole(role);
    setProductionRefinePrompt(defaultPrompt);
    setProductionRefineFiles([]);
  };
  const onProductionRefineFilesChange = (event) => {
    const files = Array.from(event.target?.files || []);
    setProductionRefineFiles(files);
  };
  const submitProductionRefine = async () => {
    if (!taskId || !productionRefineRole) return;
    const promptText = String(productionRefinePrompt || "").trim();
    if (!promptText) {
      appendLiveLog("error", "[Production Refine] prompt is required.");
      return;
    }
    const targetArtifact = productionRefineRole === "start" ? productionStartArtifact : productionEndArtifact;
    if (!targetArtifact) {
      appendLiveLog("error", `[Production Refine] selected ${productionRefineRole} frame is missing.`);
      return;
    }

    appendLiveLog(
      "info",
      `[Production Refine] submitting ${productionRefineRole} frame with ${productionRefineFiles.length} reference image(s).`
    );
    try {
      await call(async () => {
        const result = await api.refineProductionFrame(taskId, productionRefineRole, promptText, productionRefineFiles);
        const task = result?.task || {};
        appendLiveLog(
          "success",
          `[Production Refine] ${productionRefineRole} frame refined: ${result?.artifactId || "-"}; start=${task.selected_start_artifact_id || "-"}, end=${task.selected_end_artifact_id || "-"}`
        );
      });
      closeProductionRefineModal();
    } catch (error) {
      appendLiveLog("error", `[Production Refine] failed: ${error?.message || "unknown_error"}`);
    }
  };
  const saveNarrativeDetail = async (narrativeId, payload, fieldLabel = "all") => {
    if (!taskId || !narrativeId) return;
    appendLiveLog("info", `[Narrative] saving prompt (${fieldLabel}): ${narrativeId}`);
    try {
      await call(async () => {
        const updated = await api.updateNarrativeOption(taskId, narrativeId, payload);
        setNarrativeModal(updated || null);
        appendLiveLog("success", `[Narrative] prompt saved (${fieldLabel}): ${narrativeId}`);
      });
    } catch (error) {
      appendLiveLog("error", `[Narrative] save failed (${fieldLabel}): ${error?.message || "unknown_error"}`);
    }
  };
  const narrativeModalValue = useMemo(() => {
    if (!narrativeModal) return null;
    return narratives.find((item) => item.id === narrativeModal.id) || narrativeModal;
  }, [narrativeModal, narratives]);
  const startProduction = async () => {
    if (!taskId) return;
    setBusy(true);
    setLiveLogs([]);
    try {
      appendLiveLog("info", `[Production] mode: ${productionClipCount === 1 ? "single 8s clip" : "two clips + stitched"}`);
      await api.startProductionStream(taskId, {
        method: "POST",
        body: { count: productionClipCount },
        onEvent: (event) => {
          handleStreamEvent(event, "Production failed");
          if (event.type === "item_saved" || event.type === "done") {
            refreshState();
          }
        }
      });
    } catch (error) {
      appendLiveLog("error", `Production exception: ${error?.message || "unknown_error"}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };
  const stopBgmSyncPreview = () => {
    const video = previewVideoRef.current;
    const audio = previewAudioRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setBgmSyncPlaying(false);
  };

  const syncPlayBgmPreview = async () => {
    if (!selectedBgmVideo?.url || !activeBgmPreviewAudio?.url) {
      appendLiveLog("error", "Please generate preview audio first, then sync play.");
      return;
    }
    const video = previewVideoRef.current;
    const audio = previewAudioRef.current;
    if (!video || !audio) {
      appendLiveLog("error", "Preview player not ready.");
      return;
    }

    try {
      stopBgmSyncPreview();
      const targetSeconds = Number(bgmDurationSeconds) || 16;
      video.muted = true;
      video.currentTime = 0;
      audio.currentTime = 0;
      await Promise.all([video.play(), audio.play()]);
      setBgmSyncPlaying(true);
      window.setTimeout(() => {
        stopBgmSyncPreview();
      }, Math.max(500, targetSeconds * 1000 + 120));
    } catch (error) {
      appendLiveLog("error", `Sync play failed: ${error?.message || "unknown_error"}`);
      stopBgmSyncPreview();
    }
  };

  const stopSegmentSyncPreview = () => {
    segmentSyncActiveRef.current = false;
    if (segmentSyncTimerRef.current) {
      window.cancelAnimationFrame(segmentSyncTimerRef.current);
      segmentSyncTimerRef.current = null;
    }
    const ws = segmentWaveSurferRef.current;
    if (ws?.isPlaying?.()) {
      ws.pause();
    }
    const video = segmentVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
      video.playbackRate = 1;
    }
    setSegmentSyncPlaying(false);
  };

  const getSegmentRange = () => {
    const region = segmentWaveRegionRef.current;
    const rawStart = region ? Number(region.start) : Number(segmentStartSeconds);
    const rawEnd = region ? Number(region.end) : Number(segmentEndSeconds);
    const start = Math.max(0, Number.isFinite(rawStart) ? rawStart : 0);
    const end = Math.max(start + 0.05, Number.isFinite(rawEnd) ? rawEnd : start + 0.05);
    return { start, end };
  };

  const syncPlaySegmentMatch = async () => {
    const ws = segmentWaveSurferRef.current;
    if (!ws) {
      appendLiveLog("error", "[BGM2] Waveform player not ready.");
      return;
    }
    const { start, end } = getSegmentRange();
    const video = segmentVideoRef.current;
    if (!video || !segmentSelectedVideo?.url || !segmentAudioSourceUrl) {
      appendLiveLog("error", "[BGM2] Segment preview player not ready.");
      return;
    }

    const clipDuration = end - start;
    const audioRate = clampSegmentPlaybackRate(segmentEffectiveAudioRate, 1);
    const finalMusicDuration = clipDuration / Math.max(audioRate, 0.001);
    const speed = Math.max(0.25, Math.min(4, Number(segmentComputedVideoSpeed) || 1));
    appendLiveLog(
      "info",
      `[BGM2] Preview start: clip=${clipDuration.toFixed(2)}s, musicRate=${audioRate.toFixed(3)}, musicFinal=${finalMusicDuration.toFixed(2)}s, videoSpeed=${speed.toFixed(3)}`
    );
    try {
      stopSegmentSyncPreview();
      segmentSyncActiveRef.current = true;
      video.currentTime = 0;
      video.playbackRate = speed;
      video.muted = true;
      ws.setPlaybackRate?.(audioRate);
      await waitForMediaReady(video);
      await seekMediaCurrentTime(video, 0);
      await Promise.all([video.play(), ws.play(start, end)]);
      setSegmentSyncPlaying(true);

      const tick = () => {
        if (!segmentSyncActiveRef.current) return;
        if (!ws.isPlaying?.()) {
          stopSegmentSyncPreview();
          return;
        }
        const audioPos = Math.max(start, Number(ws.getCurrentTime?.() || start));
        const elapsedReal = (audioPos - start) / Math.max(audioRate, 0.001);
        const targetVideoTime = Math.max(0, elapsedReal * speed);
        const drift = Math.abs((Number(video.currentTime) || 0) - targetVideoTime);
        if (drift > 0.1) {
          try {
            video.currentTime = targetVideoTime;
          } catch {
            // ignore seek correction failure
          }
        }
        segmentSyncTimerRef.current = window.requestAnimationFrame(tick);
      };
      segmentSyncTimerRef.current = window.requestAnimationFrame(tick);
    } catch (error) {
      appendLiveLog("error", `[BGM2] Preview failed: ${error?.message || "unknown_error"}`);
      stopSegmentSyncPreview();
    }
  };

  const toggleSegmentSelectionPlayback = () => {
    const ws = segmentWaveSurferRef.current;
    if (!ws) {
      appendLiveLog("error", "[BGM2] Waveform player not ready.");
      return;
    }
    if (ws.isPlaying()) {
      if (segmentSyncActiveRef.current) {
        stopSegmentSyncPreview();
      } else {
        ws.pause();
      }
      return;
    }
    stopSegmentSyncPreview();
    const { start, end } = getSegmentRange();
    ws.setPlaybackRate?.(segmentEffectiveAudioRate);
    ws.play(start, end);
  };

  const toggleSegmentSyncPreview = () => {
    if (segmentSyncPlaying) {
      stopSegmentSyncPreview();
      return;
    }
    syncPlaySegmentMatch();
  };

  const recommendSegmentRange = async () => {
    if (!taskId) return;
    const path = String(segmentAudioPath || "").trim();
    if (!path) {
      appendLiveLog("error", "[BGM2] Please provide audio file path.");
      return;
    }
    appendLiveLog("info", "[BGM2] Recommend segment start (full-song phrase scan).");
    try {
      await call(async () => {
        const result = await api.recommendBgmSegment(taskId, {
          videoArtifactId: segmentSelectedVideoId,
          audioPath: path,
          targetDurationSeconds: segmentVideoDuration > 0 ? segmentVideoDuration : undefined
        });
        const nextStart = Math.max(0, Number(result.startSeconds) || 0);
        const nextEnd = Math.max(nextStart + 0.05, Number(result.endSeconds) || nextStart + 0.05);
        setSegmentStartSeconds(nextStart);
        setSegmentEndSeconds(nextEnd);
        setSegmentTargetDuration("");
        setSegmentPlaybackRate("1.00");

        const region = segmentWaveRegionRef.current;
        if (region) {
          if (typeof region.setOptions === "function") {
            region.setOptions({ start: nextStart, end: nextEnd });
          } else if (typeof region.update === "function") {
            region.update({ start: nextStart, end: nextEnd });
          }
        }

        appendLiveLog(
          "success",
          `[BGM2] Recommend segment ready: start=${nextStart.toFixed(2)}s, end=${nextEnd.toFixed(2)}s, clip=${Number(result.clipDurationSeconds || nextEnd - nextStart).toFixed(2)}s`
        );
      });
    } catch (error) {
      appendLiveLog("error", `[BGM2] Recommend failed: ${error?.message || "unknown_error"}`);
    }
  };

  const composeSegmentBgm = async () => {
    if (!taskId) return;
    const path = String(segmentAudioPath || "").trim();
    if (!path) {
      appendLiveLog("error", "[BGM2] Please provide audio file path.");
      return;
    }
    if (!segmentSelectedVideoId) {
      appendLiveLog("error", "[BGM2] Please select production video.");
      return;
    }
    const start = Math.max(0, Number(segmentStartSeconds) || 0);
    const end = Number(segmentEndSeconds);
    if (!Number.isFinite(end) || end <= start) {
      appendLiveLog("error", "[BGM2] Invalid segment range.");
      return;
    }
    if (coverEnabled && !coverArtifact?.id) {
      appendLiveLog("error", "[BGM2] Cover is enabled but no cover image selected.");
      return;
    }
    if (coverEnabled && segmentMusicFinalDuration <= segmentCoverDuration + 0.12) {
      appendLiveLog(
        "error",
        `[BGM2] Music duration is too short for a ${segmentCoverDuration.toFixed(2)}s cover. Increase segment length or reduce music speed.`
      );
      return;
    }
    const speed = Math.max(0.25, Math.min(4, Number(segmentComputedVideoSpeed) || 1));
    const audioRate = clampSegmentPlaybackRate(segmentEffectiveAudioRate, 1);
    const targetMusicDuration = segmentHasTargetDuration ? Number(segmentTargetDurationValue) : undefined;
    appendLiveLog(
      "info",
      `[BGM2] Compose start: start=${start.toFixed(2)}s, end=${end.toFixed(2)}s, musicRate=${audioRate.toFixed(3)}, targetDuration=${targetMusicDuration ? `${targetMusicDuration.toFixed(2)}s` : "none"}, cover=${coverEnabled ? `${segmentCoverDuration.toFixed(2)}s` : "off"}, videoSpeed=${speed.toFixed(3)}`
    );
    try {
      await call(async () => {
        const result = await api.composeBgmSegment(taskId, {
          videoArtifactId: segmentSelectedVideoId,
          audioPath: path,
          audioStartSeconds: start,
          audioEndSeconds: end,
          audioPlaybackRate: audioRate,
          targetMusicDurationSeconds: targetMusicDuration,
          useCoverFrame: coverEnabled,
          coverArtifactId: coverArtifact?.id || "",
          coverDurationSeconds: segmentCoverDuration
        });
        appendLiveLog(
          "success",
          `[BGM2] Video ready: clip=${Number(result.clipDurationSeconds || end - start).toFixed(2)}s, musicFinal=${Number(result.finalMusicDurationSeconds || segmentMusicFinalDuration).toFixed(2)}s, cover=${result.useCoverFrame ? "on" : "off"}, musicRate=${Number(result.audioPlaybackRate || audioRate).toFixed(3)}, videoSpeed=${Number(result.videoSpeed || speed).toFixed(3)}`
        );
      });
    } catch (error) {
      appendLiveLog("error", `[BGM2] Compose failed: ${error?.message || "unknown_error"}`);
    }
  };

  const createBgmPreview = async (mode) => {
    if (!taskId) return;
    const trimmedPath = String(bgmAudioPath || "").trim();
    if (!trimmedPath) {
      appendLiveLog("error", "Please provide a local audio file path.");
      return;
    }
    if (!bgmSelectedVideoId) {
      appendLiveLog("error", "Please select a production video first.");
      return;
    }
    const duration = Number(bgmDurationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      appendLiveLog("error", "Duration must be a positive number (seconds).");
      return;
    }

    const rate = Number(bgmPlaybackRate);
    if (mode !== "auto" && (!Number.isFinite(rate) || rate < 0.85 || rate > 1.15)) {
      appendLiveLog("error", "Speed must be between 0.85 and 1.15.");
      return;
    }

    appendLiveLog(
      "info",
      `[BGM] Preview start: mode=${mode}, duration=${duration}s, speed=${Number.isFinite(rate) ? rate.toFixed(3) : "auto"}`
    );
    try {
      await call(async () => {
        const result = await api.previewBgm(taskId, {
          videoArtifactId: bgmSelectedVideoId,
          audioPath: trimmedPath,
          durationSeconds: duration,
          mode,
          playbackRate: rate
        });
        setBgmPreviewArtifactId(result.previewAudioArtifactId || "");
        if (Number.isFinite(result.playbackRate)) {
          setBgmPlaybackRate(Number(result.playbackRate).toFixed(3));
        }
        appendLiveLog(
          "success",
          `[BGM] Preview ready: start=${Number(result.startSeconds || 0).toFixed(2)}s, source=${Number(result.sourceDurationSeconds || duration).toFixed(2)}s, rate=${Number(result.playbackRate || 1).toFixed(3)}`
        );
      });
    } catch (error) {
      const message = String(error?.message || "unknown_error");
      if (message.includes("Cannot POST") && message.includes("bgm-preview")) {
        appendLiveLog("error", "[BGM] Preview failed: bgm-preview route unavailable. Please restart backend server to load latest API.");
      } else {
        appendLiveLog("error", `[BGM] Preview failed: ${message}`);
      }
    }
  };

  const composeBgm = async () => {
    if (!taskId) return;
    if (!bgmSelectedVideoId) {
      appendLiveLog("error", "Please select a production video first.");
      return;
    }
    if (!bgmPreviewArtifactId && !activeBgmPreviewAudio?.id) {
      appendLiveLog("error", "Please generate and confirm preview audio first.");
      return;
    }
    const duration = Number(bgmDurationSeconds);
    appendLiveLog("info", `[BGM] Compose start: duration=${duration}s`);
    try {
      await call(async () => {
        const result = await api.composeBgm(taskId, {
          videoArtifactId: bgmSelectedVideoId,
          previewAudioArtifactId: bgmPreviewArtifactId || activeBgmPreviewAudio?.id,
          durationSeconds: duration
        });
        appendLiveLog("success", `[BGM] Video ready: ${Number(result.durationSeconds || duration).toFixed(2)}s`);
      });
    } catch (error) {
      appendLiveLog("error", `[BGM] Compose failed: ${error?.message || "unknown_error"}`);
    }
  };
  const simplifyPublishErrorMessage = (error) => {
    const raw = String(error?.message || "publish_failed").trim();
    const preMatch = raw.match(/<pre>([\s\S]*?)<\/pre>/i);
    if (preMatch?.[1]) {
      return preMatch[1].replace(/\s+/g, " ").trim();
    }
    return raw.replace(/\s+/g, " ").trim();
  };

  const shouldFallbackToPublishPost = (errorText) => {
    const text = String(errorText || "");
    return (
      text.startsWith("404") ||
      text.includes("Cannot GET") ||
      text.includes("/publish/stream")
    );
  };

  const publishChannel = async (channel) => {
    if (!taskId) return;
    const draft = publishForms[channel] || { title: "", description: "", topics: "" };
    if (channel !== "video_channel") {
      appendLiveLog("info", `[Publish][${channel}] Channel panel is ready. API flow not implemented yet.`);
      return;
    }
    setBusy(true);
    try {
      appendLiveLog("info", "[Publish] Start publish flow...");
      const publishPayload = {
        sourceDescription: draft.description || selectedProductionNarrative?.description || "",
        shortTitle: draft.title || ""
      };
      let done = null;
      try {
        done = await api.publishStream(taskId, {
          body: publishPayload,
          onEvent: (event) => {
            if (event.type === "log") {
              appendLiveLog(event.level || "info", event.message, event.timestamp || new Date().toISOString());
              return;
            }
            if (event.type === "heartbeat") {
              appendLiveLog("info", event.message || "[Publish] waiting...", event.timestamp || new Date().toISOString());
            }
          }
        });
      } catch (streamError) {
        const streamMessage = simplifyPublishErrorMessage(streamError);
        if (!shouldFallbackToPublishPost(streamMessage)) {
          throw streamError;
        }
        appendLiveLog("info", "[Publish] Stream route unavailable, fallback to normal publish API...");
        done = await api.publish(taskId, publishPayload);
      }

      if (done?.note) {
        appendLiveLog(done?.status === "waiting_login" ? "info" : "success", `[Publish] ${done.note}`);
      }
    } catch (error) {
      appendLiveLog("error", `[Publish] ${simplifyPublishErrorMessage(error)}`);
    } finally {
      await refreshTasks();
      await refreshState();
      setBusy(false);
    }
  };

  const selectStartImage = (artifactId) => call(() => api.selectStartImage(taskId, artifactId));

  const savePrompt = (promptId, payload) => call(() => api.savePromptVersion(taskId, promptId, payload));
  const renamePrompt = (promptId, name) => call(() => api.renamePrompt(taskId, promptId, name));
  const setPromptLang = (promptId, lang) => call(() => api.setPromptLang(taskId, promptId, lang));

  const restorePrompt = (promptId, versionId) => call(() => api.restorePrompt(taskId, promptId, versionId));
  const deletePromptVersion = (promptId, versionId) => call(() => api.deletePromptVersion(taskId, promptId, versionId));
  const updateNarrativeStylePrompt = (promptId, payload) =>
    call(async () => {
      await api.updateNarrativeStylePrompt(taskId, promptId, payload);
      await refreshState();
    });

  const clearConsole = () => {
    setLiveLogs([]);
    setConsoleClearedAt(Date.now());
  };

  const openImageViewer = (url, title) => {
    if (!url) return;
    setImageViewer({ url, title: title || "Image" });
  };

  const taskInitPreview =
    latestArtifact(state?.artifacts || [], "source_image") ||
    latestArtifact(state?.artifacts || [], "cropped_image") ||
    latestArtifact(state?.artifacts || [], "cleaned_image");

  const currentTaskSummary = taskList.find((item) => item.id === taskId) || null;

  if (currentPage === "list") {
    return (
      <TaskListPage
        items={taskList}
        activeTaskId={taskId}
        busy={busy}
        onBack={() => setCurrentPage("detail")}
        onRefresh={() => refreshTasks()}
        onCreateTask={createTask}
        onOpenTask={openTaskDetail}
        onDeleteTask={(nextTaskId) => deleteTaskById(nextTaskId, { stayOnList: true })}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="top-header">
        <div>
          <h1>OpenFlow Creator</h1>
          {currentTaskSummary ? <p>{currentTaskSummary.id} · {currentTaskSummary.aspect_ratio}</p> : null}
        </div>
        <div className="toolbar">
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">Select Task</option>
            {taskList.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id.slice(0, 14)}... | {t.phase}
              </option>
            ))}
          </select>
          <div className="toolbar-actions">
            <button className="action-button" onClick={openTaskList} disabled={busy}>
              Task List
            </button>
            <button className="icon-button" onClick={openModelSettings} title="Model Settings">
              <IconSettings />
            </button>
            <button className="icon-button" onClick={() => refreshTasks()} title="Refresh Tasks">
              <IconRefresh />
            </button>
            <button className="icon-button" onClick={deleteTask} disabled={!taskId || busy} title="Delete Task">
              <IconDelete />
            </button>
          </div>
        </div>
      </header>

      <main className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-row">
              <div className="panel-step">Step 1</div>
              <h2>Image</h2>
            </div>
            <div className="section-actions">
              <button className="icon-button" onClick={openCleanPrompt} disabled={busy} title="Clean Prompt Settings">
                <IconSettings />
              </button>
              <button className="icon-button" onClick={cleanImage} disabled={!taskId || busy} title="Clean">
                <IconClean />
              </button>
              <button className="icon-button" onClick={openCrop} disabled={!taskId || busy} title="Crop">
                <IconCrop />
              </button>
            </div>
          </div>
          <div className="task-init-preview">
            {taskInitPreview ? (
              <div
                className="image-grid style-image-grid task-preview-grid"
                style={{ "--tile-ratio": imageAspectRatio }}
              >
                <div className="image-tile-wrap">
                  <button
                    className={`image-tile ${productionStartArtifact?.id === taskInitPreview.id ? "production-start-selected" : ""} ${
                      productionEndArtifact?.id === taskInitPreview.id ? "production-end-selected" : ""
                    }`}
                    onClick={() => openImageViewer(taskInitPreview.url, taskInitPreview.type)}
                  >
                    <img src={taskInitPreview.url} alt="preview" />
                  </button>
                  <button
                    className="image-view-btn"
                    title="View full image"
                    onClick={() => openImageViewer(taskInitPreview.url, taskInitPreview.type)}
                  >
                    <IconExpand />
                  </button>
                  <div className="image-production-actions">
                    <button className="icon-button sm production-overlay-btn" onClick={() => selectProductionStart(taskInitPreview.id)} title="Set as production start frame">
                      <IconStartFrame />
                    </button>
                    <button className="icon-button sm production-overlay-btn" onClick={() => selectProductionEnd(taskInitPreview.id)} title="Set as production end frame">
                      <IconEndFrame />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="image-grid style-image-grid task-preview-grid"
                style={{ "--tile-ratio": imageAspectRatio }}
              >
                <div className="image-placeholder-tile">No image yet</div>
              </div>
            )}
          </div>

          <div className="step-block image-input-panel">
            <div className="image-input-row">
              <div className="radio-row">
                <label className="radio-option">
                  <input
                    type="radio"
                    name="aspectRatio"
                    value="9:16"
                    checked={aspectRatio === "9:16"}
                    onChange={() => !busy && createTask("9:16")}
                  />
                  <span>9:16</span>
                </label>
                <label className="radio-option">
                  <input
                    type="radio"
                    name="aspectRatio"
                    value="16:9"
                    checked={aspectRatio === "16:9"}
                    onChange={() => !busy && createTask("16:9")}
                  />
                  <span>16:9</span>
                </label>
              </div>
              <div className="source-input-wrap">
                <input className="source-input" type="file" accept="image/*" onChange={handleSourceFileChange} />
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-row">
              <div className="panel-step">Step 2</div>
              <h2>Style</h2>
            </div>
            <div className="section-actions">
              <button className="icon-button" title="Generate Prompts" onClick={generateStylePrompts} disabled={!taskId || busy}>
                <IconSpark />
              </button>
              <button
                className="icon-button"
                title="Configure Generate Prompts Instruction"
                onClick={openStylePromptGenerateConfig}
                disabled={busy}
              >
                <IconSettings />
              </button>
              <button className="icon-button" title="Generate Style Images" onClick={generateStyleImages} disabled={!taskId || busy}>
                <IconCompose />
              </button>
              <button
                className="icon-button"
                title="Configure 3 Loop Prompts"
                onClick={() => setPromptModalType("style")}
                disabled={busy}
                >
                  <IconSettings />
                </button>
              </div>
          </div>

          <div className="image-grid style-image-grid" style={{ "--tile-ratio": imageAspectRatio }}>
            {styleImages.map((img) => (
              <div key={img.id} className="image-tile-wrap">
                <button
                  className={`image-tile ${state?.task?.selected_start_artifact_id === img.id ? "selected" : ""} ${
                    productionStartArtifact?.id === img.id ? "production-start-selected" : ""
                  } ${productionEndArtifact?.id === img.id ? "production-end-selected" : ""}`}
                  onClick={() => selectStartImage(img.id)}
                  title="Select as start frame"
                >
                  <img src={img.url} alt="style" />
                </button>
                <button
                  className="image-view-btn"
                  title="View full image"
                  onClick={() => openImageViewer(img.url, "Style Image")}
                >
                  <IconExpand />
                </button>
                <div className="image-production-actions">
                  <button className="icon-button sm production-overlay-btn" onClick={() => selectProductionStart(img.id)} title="Set as production start frame">
                    <IconStartFrame />
                  </button>
                  <button className="icon-button sm production-overlay-btn" onClick={() => selectProductionEnd(img.id)} title="Set as production end frame">
                    <IconEndFrame />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-row">
              <div className="panel-step">Step 3</div>
              <h2>Narrative</h2>
            </div>
            <div className="section-actions">
              <button
                className="icon-button"
                title={narrativeReadyForGeneration ? "Generate 3 Runtime Prompts" : "Select Step 2 image first"}
                onClick={generateNarrativePrompts}
                disabled={!narrativeReadyForGeneration || busy}
              >
                <IconSpark />
              </button>
              <button
                className="icon-button"
                title="Configure Narrative Generation Instruction"
                onClick={openNarrativeGenerateConfig}
                disabled={busy}
              >
                <IconSettings />
              </button>
              <button
                className="icon-button"
                title={narrativeReadyForGeneration ? "Generate Narrative" : "Select Step 2 image first"}
                onClick={generateNarratives}
                disabled={!narrativeReadyForGeneration || busy}
              >
                <IconCompose />
              </button>
              <button
                className="icon-button"
                title="Configure 3 Runtime Prompts"
                onClick={openNarrativeScenesConfig}
                disabled={busy}
                >
                  <IconSettings />
                </button>
              </div>
          </div>

          <div className="task-init-preview step3-start-frame-row">
            <div className="image-grid style-image-grid task-preview-grid step3-start-frame-grid" style={{ "--tile-ratio": imageAspectRatio }}>
              {selectedNarrativeStartArtifact ? (
                <div className="image-tile-wrap">
                  <button
                    className="image-tile selected"
                    onClick={() => openImageViewer(selectedNarrativeStartArtifact.url, "Narrative Start Frame")}
                    title="Selected start frame from Step 2"
                  >
                    <img src={selectedNarrativeStartArtifact.url} alt="narrative-start-frame" />
                  </button>
                  <button
                    className="image-view-btn"
                    title="View full image"
                    onClick={() => openImageViewer(selectedNarrativeStartArtifact.url, "Narrative Start Frame")}
                  >
                    <IconExpand />
                  </button>
                </div>
              ) : (
                <div className="image-placeholder-tile" aria-label="step3-start-frame-placeholder" />
              )}
            </div>
          </div>

          <div className="production-video-grid" style={{ "--production-ratio": imageAspectRatio }}>
            {narrativeSlots.map((scene, idx) => (
              <div key={scene?.id || `narrative-slot-${idx}`} className="production-video-slot">
                {scene?.end_frame_url ? (
                  <>
                    <button
                      className="narrative-slot-image"
                      onClick={() => openImageViewer(scene.end_frame_url, scene.title || `Narrative Scene ${idx + 1}`)}
                      title={scene.title || `Narrative Scene ${idx + 1}`}
                    >
                      <img src={scene.end_frame_url} alt={scene.title || `scene-${idx + 1}`} />
                    </button>
                    <div className="narrative-image-actions">
                      <button
                        className="icon-button sm narrative-overlay-btn"
                        title="View full image"
                        onClick={(event) => {
                          event.stopPropagation();
                          openImageViewer(scene.end_frame_url, scene.title || `Narrative Scene ${idx + 1}`);
                        }}
                      >
                        <IconExpand />
                      </button>
                      <button
                        className="icon-button sm narrative-overlay-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setNarrativeModal(scene);
                        }}
                        title="View Narrative"
                      >
                        <IconNarrative />
                      </button>
                    </div>
                    <div className="narrative-image-actions narrative-image-actions-left">
                      <button
                        className="icon-button sm production-overlay-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectProductionStart(scene.end_frame_artifact_id);
                        }}
                        disabled={!scene.end_frame_artifact_id}
                        title="Set as production start frame"
                      >
                        <IconStartFrame />
                      </button>
                      <button
                        className="icon-button sm production-overlay-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          selectProductionEnd(scene.end_frame_artifact_id);
                        }}
                        disabled={!scene.end_frame_artifact_id}
                        title="Set as production end frame"
                      >
                        <IconEndFrame />
                      </button>
                      <button
                        className={`icon-button sm production-overlay-btn ${selectedProductionNarrative?.id === scene.id ? "active" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectProductionNarrative(scene.id);
                        }}
                        title="Use this narrative in production"
                      >
                        <IconNarrative />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="image-placeholder-tile" />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div className="panel-title-row">
              <div className="panel-step">Step 4</div>
              <h2>Production</h2>
            </div>
            <div className="section-actions">
              <button
                className="icon-button"
                title="Production clip count"
                onClick={() => setShowProductionCountModal(true)}
                disabled={busy}
              >
                <IconSettings />
              </button>
              <button className="icon-button" title="Start Production" onClick={startProduction} disabled={!productionReady || busy}>
                <IconPlay />
              </button>
              <button
                className="icon-button"
                title="History Runs"
                onClick={() => setShowProductionHistoryModal(true)}
                disabled={oldProductionTasks.length === 0}
              >
                <IconHistory />
              </button>
            </div>
          </div>
          <div className="production-selection-summary three-cards" style={{ "--production-ratio": imageAspectRatio }}>
            <div className="image-tile-wrap production-frame-tile">
              {productionStartArtifact ? (
                <button className="image-tile" onClick={() => openImageViewer(productionStartArtifact.url, "Production Start Frame")}>
                  <img src={productionStartArtifact.url} alt="selected-start-frame" />
                </button>
              ) : (
                <div className="image-placeholder-tile" aria-label="production-start-placeholder" />
              )}
              <button
                className="image-view-btn production-upload-btn"
                title="Refine production start frame"
                onClick={() => openProductionRefineModal("start")}
                disabled={busy || !taskId}
              >
                <IconUpload />
              </button>
            </div>
            <div className="image-tile-wrap production-frame-tile">
              {productionEndArtifact ? (
                <button className="image-tile" onClick={() => openImageViewer(productionEndArtifact.url, "Production End Frame")}>
                  <img src={productionEndArtifact.url} alt="selected-end-frame" />
                </button>
              ) : (
                <div className="image-placeholder-tile" aria-label="production-end-placeholder" />
              )}
              <div className="production-frame-actions">
                {productionEndArtifact ? (
                  <button
                    className="image-view-btn production-clear-btn"
                    title="Clear production end frame"
                    onClick={clearProductionEnd}
                    disabled={busy || !taskId}
                  >
                    <IconClear />
                  </button>
                ) : null}
                <button
                  className="image-view-btn production-upload-btn"
                  title="Refine production end frame"
                  onClick={() => openProductionRefineModal("end")}
                  disabled={busy || !taskId}
                >
                  <IconUpload />
                </button>
              </div>
            </div>
            <div className="image-tile-wrap production-narrative-summary">
              {selectedProductionNarrative?.end_frame_url ? (
                <button className="image-tile" onClick={() => openImageViewer(selectedProductionNarrative.end_frame_url, "Production Narrative") }>
                  <img src={selectedProductionNarrative.end_frame_url} alt="selected-production-narrative" />
                </button>
              ) : (
                <div className="image-placeholder-tile" aria-label="production-narrative-placeholder" />
              )}
              <div className="narrative-image-actions">
                <button
                  className="icon-button sm narrative-overlay-btn"
                  onClick={() => selectedProductionNarrative && setNarrativeModal(selectedProductionNarrative)}
                  title="View narrative prompts"
                  disabled={!selectedProductionNarrative}
                >
                  <IconNarrative />
                </button>
              </div>
            </div>
          </div>

          <div className="production-video-grid" style={{ "--production-ratio": imageAspectRatio }}>
            <div className="production-video-slot">
              {latestProductionTask?.part1_url ? (
                <video controls src={latestProductionTask.part1_url} preload="metadata" />
              ) : (
                <div className="image-placeholder-tile" />
              )}
            </div>
            <div className="production-video-slot">
              {latestProductionTask?.part2_url ? (
                <video controls src={latestProductionTask.part2_url} preload="metadata" />
              ) : (
                <div className="image-placeholder-tile" />
              )}
            </div>
            <div className="production-video-slot">
              {latestProductionTask?.stitched_url ? (
                <video controls src={latestProductionTask.stitched_url} preload="metadata" />
              ) : (
                <div className="image-placeholder-tile" />
              )}
            </div>
          </div>

          {latestProductionTask ? (
            <div className="row">
              <small>
                Current run: {latestProductionTask.status} / {latestProductionTask.step}
              </small>
              {latestProductionTask.error ? <small className="log-error">{latestProductionTask.error}</small> : null}
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <div className="panel-step">Step 5</div>
            <h2>BGM</h2>
          </div>
          <div className="step-block">
            <div className="bgm-sub-panels">
              <div className="bgm-sub-panel bgm-params-panel">
                <div className="bgm-panel-top">
                  <div className="bgm-panel-icons">
                    <button
                      type="button"
                      className="icon-button sm"
                      title="Clear Target Duration"
                      onClick={() => setSegmentTargetDuration("")}
                      disabled={!taskId || busy || !segmentTargetDuration}
                    >
                      <IconClear />
                    </button>
                    <button
                      type="button"
                      className="icon-button sm"
                      title="Reset Speed to 1.00x"
                      onClick={() => setSegmentPlaybackRate("1.00")}
                      disabled={!taskId || busy}
                    >
                      <IconRefresh />
                    </button>
                  </div>
                </div>
                <div className="bgm-config-grid compact">
                  <label>
                    Production Video
                    <select
                      value={segmentSelectedVideoId}
                      onChange={(e) => setSegmentSelectedVideoId(e.target.value)}
                      disabled={!taskId || busy || bgmVideoCandidates.length === 0}
                    >
                      {bgmVideoCandidates.length === 0 ? <option value="">No production video yet</option> : null}
                      {bgmVideoCandidates.map((item) => (
                        <option key={`segment_${item.id}`} value={item.artifactId}>
                          {item.runLabel} - {item.slotLabel}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Audio File Path
                    <div className="audio-path-inline">
                      <input
                        value={segmentAudioPath}
                        onChange={(e) => pickSegmentAudioPath(e.target.value)}
                        placeholder="/absolute/path/to/music.mp3"
                        disabled={!taskId || busy}
                      />
                      <button
                        type="button"
                        className="icon-button sm"
                        title="Open music picker"
                        onClick={() => {
                          setBgmAudioPickerQuery("");
                          setShowBgmAudioPickerModal(true);
                        }}
                        disabled={!taskId || busy}
                      >
                        <IconFolderOpen />
                      </button>
                    </div>
                  </label>

                  <label>
                    Music Speed (manual)
                    <select value={segmentPlaybackRate} onChange={(e) => setSegmentPlaybackRate(e.target.value)} disabled={!taskId || busy}>
                      <option value="0.50">0.50x</option>
                      <option value="0.75">0.75x</option>
                      <option value="0.90">0.90x</option>
                      <option value="1.00">1.00x</option>
                      <option value="1.10">1.10x</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.50">1.50x</option>
                      <option value="2.00">2.00x</option>
                    </select>
                  </label>

                  <label>
                    Target Music Duration (seconds)
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      placeholder="Optional, overrides speed"
                      value={segmentTargetDuration}
                      onChange={(e) => setSegmentTargetDuration(e.target.value)}
                      disabled={!taskId || busy}
                    />
                  </label>
                </div>

                <div className="row bgm-action-row segment-selected-audio-row compact">
                  <small>
                    Selected: <span className="segment-selected-audio-name">{segmentAudioPath ? getPathBaseName(segmentAudioPath) : "None"}</span>
                  </small>
                </div>
              </div>

              <div className="bgm-sub-panel bgm-wave-panel">
                <div className="bgm-panel-top">
                  <div className="bgm-panel-icons">
                    <button
                      type="button"
                      className="icon-button sm"
                      title="Music Analysis" aria-label="Music Analysis"
                      onClick={() => setShowMusicAnalysisModal(true)}
                      disabled={false}
                    >
                      <><IconAnalyzeMusic /><span style={{ marginLeft: 6, fontSize: 12 }}>Music Analysis</span></>
                    </button>
                    <button
                      type="button"
                      className="icon-button sm"
                      title="Recommend Segment"
                      onClick={recommendSegmentRange}
                      disabled={!taskId || busy || !segmentAudioSourceUrl}
                    >
                      <IconSpark />
                    </button>
                    <button
                      type="button"
                      className="icon-button sm"
                      title={segmentSelectionPlaying ? "Pause Segment" : "Play Segment"}
                      onClick={toggleSegmentSelectionPlayback}
                      disabled={!taskId || busy || !segmentAudioSourceUrl || segmentClipDuration <= 0.05}
                    >
                      {segmentSelectionPlaying ? <IconPause /> : <IconPlay />}
                    </button>
                  </div>
                </div>
                <div className="segment-waveform-shell">
                  <div ref={segmentWaveformRef} className="segment-waveform" />
                </div>
                <small>Drag both handles on waveform to set start/end.</small>
              </div>

              <div className="bgm-sub-panel bgm-summary-panel">
                <div className="bgm-panel-top">
                  <div className="bgm-panel-icons">
                    <button
                      type="button"
                      className={`icon-button ${coverEnabled ? "active" : ""}`}
                      title="Cover Frame"
                      onClick={openCoverModal}
                      disabled={!taskId || busy}
                    >
                      <IconCover />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title={segmentSyncPlaying ? "Stop Preview" : "Preview Match"}
                      onClick={toggleSegmentSyncPreview}
                      disabled={
                        !segmentSyncPlaying &&
                        (!taskId || busy || !segmentSelectedVideo?.url || !segmentAudioSourceUrl || segmentClipDuration <= 0.05)
                      }
                    >
                      {segmentSyncPlaying ? <IconStop /> : <IconPreview />}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      title="Compose Matched Video"
                      onClick={composeSegmentBgm}
                      disabled={
                        !taskId ||
                        busy ||
                        !segmentSelectedVideoId ||
                        !segmentAudioSourceUrl ||
                        segmentClipDuration <= 0.05 ||
                        (coverEnabled && (!coverArtifact?.id || segmentMusicFinalDuration <= segmentCoverDuration + 0.12))
                      }
                    >
                      <IconCompose />
                    </button>
                  </div>
                </div>
                <div className="segment-summary-box">
                  <div>Start: {segmentStartSeconds.toFixed(2)}s</div>
                  <div>End: {segmentEndSeconds.toFixed(2)}s</div>
                  <div>Clip: {segmentClipDuration.toFixed(2)}s</div>
                  <div>Music Final: {segmentMusicFinalDuration.toFixed(2)}s</div>
                  <div>
                    Cover: {coverEnabled ? `On (${coverArtifact ? `${segmentCoverDuration.toFixed(2)}s + turn ${segmentCoverTransitionDuration.toFixed(2)}s` : "missing image"})` : "Off"}
                  </div>
                  <div>Music Rate: {segmentEffectiveAudioRate.toFixed(3)}x</div>
                  <div>Video Speed: {Number(segmentComputedVideoSpeed || 1).toFixed(3)}x</div>
                </div>
              </div>
            </div>

            <audio
              ref={segmentAudioRef}
              className="bgm-hidden-audio"
              src={segmentAudioSourceUrl || ""}
              preload="metadata"
              onError={() => {
                if (segmentAudioSourceUrl) {
                  appendLiveLog("error", "[BGM2] Audio source load failed. Check file path and backend access.");
                }
              }}
            />

            <div className="row between">
              <small>Flow: choose segment, adjust music timing, then preview and compose with video speed match.</small>
            </div>
          </div>

          <div className="production-video-grid bgm-preview-grid" style={{ "--production-ratio": imageAspectRatio }}>
            <div className="production-video-slot">
              {segmentSelectedVideo?.url ? (
                <video
                  ref={segmentVideoRef}
                  controls
                  src={segmentSelectedVideo.url}
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const duration = Number(e.currentTarget.duration) || 0;
                    setSegmentVideoDuration(duration);
                  }}
                />
              ) : (
                <div className="image-placeholder-tile">No selected production video</div>
              )}
            </div>
            <div className="production-video-slot">
              {latestSegmentBgmVideo?.url ? (
                <video controls src={latestSegmentBgmVideo.url} preload="metadata" />
              ) : (
                <div className="image-placeholder-tile">No mode-2 output yet</div>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title-row">
            <div className="panel-step">Step 6</div>
            <h2>Publish</h2>
          </div>

          <div className="publish-channel-grid">
            {PUBLISH_CHANNELS.map((channel) => {
              const isVideoChannel = channel.key === "video_channel";
              const draft = publishForms[channel.key] || { title: "", description: "", topics: "" };
              const publishTitle = isVideoChannel ? publishButtonLabel : "Publish";
              return (
                <div key={channel.key} className="publish-channel-card">
                  <div className="row between publish-channel-head">
                    <div className="publish-channel-title-wrap">
                      <h3>{channel.name}</h3>
                    </div>
                    <div className="publish-channel-actions">
                      <button
                        type="button"
                        className="icon-button sm"
                        title="AI Generate Prefill"
                        onClick={() => generatePublishPrefill(channel.key)}
                        disabled={busy || !taskId}
                      >
                        <IconSpark />
                      </button>
                      <button
                        type="button"
                        className="icon-button sm"
                        title="Edit Channel Prompt"
                        onClick={() => openPublishPromptConfig(channel.key)}
                        disabled={busy}
                      >
                        <IconSettings />
                      </button>
                      <button
                        type="button"
                        className="icon-button sm"
                        title={publishTitle}
                        onClick={() => publishChannel(channel.key)}
                        disabled={busy || !publishReady}
                      >
                        <IconPublish />
                      </button>
                    </div>
                  </div>

                  <div className="publish-prefill-grid">
                    {channel.fields.map((field) => (
                      <label key={`${channel.key}_${field.key}`}>
                        {field.label}
                        {field.multiline ? (
                          <textarea
                            value={draft[field.key] || ""}
                            placeholder={`点击 ✨ 自动生成 ${field.label}`}
                            onChange={(e) => updatePublishFormField(channel.key, field.key, e.target.value)}
                            disabled={busy || !taskId}
                          />
                        ) : (
                          <input
                            value={draft[field.key] || ""}
                            placeholder={`点击 ✨ 自动生成 ${field.label}`}
                            onChange={(e) => updatePublishFormField(channel.key, field.key, e.target.value)}
                            disabled={busy || !taskId}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </main>

      <section className={`console-dock ${consoleExpanded ? "expanded" : "collapsed"}`}>
        {consoleExpanded ? (
          <>
            <div className="console-header">
              <h2>Console</h2>
              <div className="console-actions">
                <button className="icon-button sm console-icon-btn" onClick={clearConsole} title="Clear Console">
                  <IconClear />
                </button>
                <button
                  className="icon-button sm console-icon-btn"
                  onClick={() => setConsoleExpanded(false)}
                  title="Collapse Console"
                >
                  <IconCollapse />
                </button>
              </div>
            </div>
            <div className="console-box">
              {visibleLogs.length === 0 ? (
                <div className="log-empty">No logs yet</div>
              ) : (
                visibleLogs.map((l) => (
                  <div key={l.id} className={`log-${l.level}`}>
                    [{new Date(l.created_at).toLocaleTimeString()}] {l.message}
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="console-collapsed-bar">
            <button
              className="icon-button sm console-icon-btn"
              onClick={() => setConsoleExpanded(true)}
              title="Expand Console"
            >
              <IconExpand />
            </button>
          </div>
        )}
      </section>

      {isCropping && cropSource && (
        <ImageCropper
          imageSrc={cropSource}
          aspectRatio={aspectRatio}
          onCancel={() => setIsCropping(false)}
          onConfirm={confirmCrop}
        />
      )}

      {showModelModal && (
        <ModelSettingsModal
          settingsDraft={settingsDraft}
          modelSettings={modelSettings}
          onClose={() => setShowModelModal(false)}
          onChange={setSettingsDraft}
          onSave={saveModelSettings}
          busy={busy}
        />
      )}

      {showCleanPromptModal && cleanPrompt && (
        <CleanPromptModal
          draft={cleanPromptDraft}
          onDraftChange={setCleanPromptDraft}
          cleanPrompt={cleanPrompt}
          onClose={() => setShowCleanPromptModal(false)}
          onSave={saveCleanPrompt}
          onRestore={restoreCleanPromptVersion}
          onDelete={deleteCleanPromptVersion}
          busy={busy}
        />
      )}

      {showStylePromptGenerateModal && (
        <StylePromptGenerateConfigModal
          draft={stylePromptGenDraft}
          onDraftChange={setStylePromptGenDraft}
          onClose={() => setShowStylePromptGenerateModal(false)}
          onSave={saveStylePromptGenerateConfig}
          onOpenPromptManager={() => {
            setShowStylePromptGenerateModal(false);
            setPromptModalType("style");
          }}
          busy={busy}
        />
      )}

      {showNarrativeGenerateModal && (
        <NarrativeGenerateConfigModal
          draft={narrativeGenDraft}
          onDraftChange={setNarrativeGenDraft}
          onClose={() => setShowNarrativeGenerateModal(false)}
          onSave={saveNarrativeGenerateConfig}
          busy={busy}
        />
      )}

      {showPublishPromptModal && (
        <PublishPromptConfigModal
          channel={publishPromptChannel}
          channelName={PUBLISH_CHANNELS.find((item) => item.key === publishPromptChannel)?.name || publishPromptChannel}
          draft={publishPromptDraft}
          onDraftChange={setPublishPromptDraft}
          onClose={() => setShowPublishPromptModal(false)}
          onSave={savePublishPromptConfig}
          busy={busy}
        />
      )}

      {showNarrativeScenesModal && (
        <NarrativeScenesModal
          prompts={narrativeStylePrompts}
          onClose={() => setShowNarrativeScenesModal(false)}
          onSavePrompt={updateNarrativeStylePrompt}
          busy={busy}
        />
      )}

      {showProductionHistoryModal && (
        <ProductionHistoryModal runs={oldProductionTasks} onClose={() => setShowProductionHistoryModal(false)} />
      )}

      {showProductionCountModal && (
        <ProductionCountModal
          value={productionClipCount}
          onChange={(value) => setProductionClipCount(value)}
          onClose={() => setShowProductionCountModal(false)}
        />
      )}

      {showCoverModal && (
        <CoverFrameModal
          candidates={coverImageCandidates}
          aspectRatio={imageAspectRatio}
          selectedCoverArtifactId={coverSelectedArtifactIdDraft}
          baseArtifactId={coverBaseArtifactIdDraft}
          enabled={coverEnabledDraft}
          coverDurationSeconds={coverDurationDraft}
          referenceImages={coverRefImagesDraft}
          titleText={coverTitleDraft}
          promptText={coverPromptDraft}
          busy={busy}
          onClose={closeCoverModal}
          onEnabledChange={setCoverEnabledDraft}
          onSelectCover={setCoverSelectedArtifactIdDraft}
          onSelectBase={setCoverBaseArtifactIdDraft}
          onTitleChange={setCoverTitleDraft}
          onPromptChange={setCoverPromptDraft}
          onCoverDurationChange={setCoverDurationDraft}
          onReferenceUpload={onCoverReferenceUpload}
          onPromptPaste={onCoverPromptPaste}
          onRemoveReference={removeCoverReferenceFile}
          onGenerate={generateCoverFrame}
          onSave={saveCoverConfig}
        />
      )}

      {productionRefineRole && (
        <ProductionFrameRefineModal
          role={productionRefineRole}
          targetArtifact={productionRefineRole === "start" ? productionStartArtifact : productionEndArtifact}
          prompt={productionRefinePrompt}
          files={productionRefineFiles}
          onPromptChange={setProductionRefinePrompt}
          onFilesChange={onProductionRefineFilesChange}
          onClose={closeProductionRefineModal}
          onSubmit={submitProductionRefine}
          busy={busy}
        />
      )}

      {promptModalType && (
        <PromptManagerModal
          type={promptModalType}
          prompts={promptModalType === "style" ? stylePrompts : narrativePrompts}
          onClose={() => setPromptModalType(null)}
          onSave={savePrompt}
          onRename={renamePrompt}
          onSetLang={setPromptLang}
          onRestore={restorePrompt}
          onDelete={deletePromptVersion}
        />
      )}

      {narrativeModalValue && (
        <NarrativeDetailModal
          value={narrativeModalValue}
          onClose={() => setNarrativeModal(null)}
          onSave={saveNarrativeDetail}
          onRestoreVersion={restorePrompt}
          onDeleteVersion={deletePromptVersion}
          part1Prompt={narrativePart1Prompt}
          part2Prompt={narrativePart2Prompt}
          endPrompt={narrativeEndPrompt}
          busy={busy}
        />
      )}

      {imageViewer && <ImageViewerModal value={imageViewer} onClose={() => setImageViewer(null)} />}

      {showMusicAnalysisModal && (
        <MusicAnalysisModal
          taskId={taskId}
          audioUrl={segmentAudioSourceUrl}
          audioPath={segmentAudioPath}
          libraryDirectory={bgmLibraryDirectory}
          files={bgmLibraryFiles}
          currentStart={segmentStartSeconds}
          currentEnd={segmentEndSeconds}
          onApply={({ start, end }) => {
            setSegmentStartSeconds(start);
            setSegmentEndSeconds(end);
            setShowMusicAnalysisModal(false);
          }}
          onClose={() => setShowMusicAnalysisModal(false)}
        />
      )}

      {showBgmAudioPickerModal && (
        <BgmAudioPickerModal
          taskId={taskId}
          files={filteredBgmLibraryFiles}
          query={bgmAudioPickerQuery}
          currentPath={segmentAudioPath}
          directory={bgmLibraryDirectory}
          onQueryChange={setBgmAudioPickerQuery}
          onClose={() => {
            setShowBgmAudioPickerModal(false);
            setBgmAudioPickerQuery("");
          }}
          onSelect={(pathValue) => {
            pickSegmentAudioPath(pathValue);
            setShowBgmAudioPickerModal(false);
            setBgmAudioPickerQuery("");
          }}
        />
      )}
    </div>
  );
}

function TaskListPage({ items, activeTaskId, busy, onBack, onRefresh, onCreateTask, onOpenTask, onDeleteTask }) {
  return (
    <div className="app-root task-list-root">
      <header className="top-header task-list-header">
        <div>
          <h1>Task List</h1>
          <p>查看全部 Task 的状态、资源概览和统计信息。</p>
        </div>
        <div className="toolbar task-list-toolbar">
          <button className="action-button" onClick={onBack} disabled={busy}>
            Back To Task
          </button>
          <button className="action-button small" onClick={() => onCreateTask("9:16")} disabled={busy}>
            New 9:16
          </button>
          <button className="action-button small" onClick={() => onCreateTask("16:9")} disabled={busy}>
            New 16:9
          </button>
          <button className="icon-button" onClick={onRefresh} title="Refresh Tasks" disabled={busy}>
            <IconRefresh />
          </button>
        </div>
      </header>

      <main className="task-list-page">
        <section className="task-list-panel">
          <div className="task-list-head task-list-row">
            <div>Task</div>
            <div>Status</div>
            <div>Counts</div>
            <div>Resources</div>
            <div>Updated</div>
            <div>Actions</div>
          </div>

          {items.length === 0 ? (
            <div className="task-list-empty">
              <div>No tasks yet.</div>
            </div>
          ) : (
            items.map((item) => {
              const resourceLabels = buildTaskResourceLabels(item);
              return (
                <div
                  key={item.id}
                  className={`task-list-row task-list-item ${item.id === activeTaskId ? "active" : ""}`}
                  onClick={() => onOpenTask(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenTask(item.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="task-list-primary">
                    <strong>{item.id}</strong>
                    <span>{item.aspect_ratio}</span>
                  </div>
                  <div className="task-list-status">
                    <span className="task-badge">{item.phase}</span>
                    <span className="task-badge muted">{item.status}</span>
                  </div>
                  <div className="task-list-counts">
                    <span className="task-chip">Artifacts {item.counts?.artifactCount || 0}</span>
                    <span className="task-chip">Style {item.counts?.styleImageCount || 0}</span>
                    <span className="task-chip">Narrative {item.counts?.narrativeCount || 0}</span>
                    <span className="task-chip">Production {item.counts?.productionRunCount || 0}</span>
                  </div>
                  <div className="task-list-resources">
                    {resourceLabels.length > 0 ? (
                      resourceLabels.map((label) => (
                        <span key={`${item.id}_${label}`} className="task-chip resource">
                          {label}
                        </span>
                      ))
                    ) : (
                      <span className="task-list-empty-text">No resources yet</span>
                    )}
                  </div>
                  <div className="task-list-updated">{formatTaskTime(item.updated_at)}</div>
                  <div className="task-list-actions" onClick={(event) => event.stopPropagation()}>
                    <button type="button" className="action-button small" onClick={() => onOpenTask(item.id)} disabled={busy}>
                      Open
                    </button>
                    <button type="button" className="action-button small danger" onClick={() => onDeleteTask(item.id)} disabled={busy}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}


function MusicAnalysisModal({
  taskId,
  audioUrl,
  audioPath,
  libraryDirectory,
  files,
  currentStart,
  currentEnd,
  onApply,
  onClose
}) {
  const audioRef = useRef(null);
  const wrapRef = useRef(null);
  const [status, setStatus] = useState('加载分析数据中…');
  const [analysis, setAnalysis] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [dragging, setDragging] = useState(null);
  const [start, setStart] = useState(Number.isFinite(currentStart) ? currentStart : 0);
  const [end, setEnd] = useState(Number.isFinite(currentEnd) && currentEnd > (currentStart || 0) ? currentEnd : Math.max(8, (currentStart || 0) + 8));

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        if (!taskId || !audioPath) {
          setStatus('缺少音频路径');
          return;
        }
        const result = await api.getBgmAnalysis(taskId, audioPath);
        if (canceled) return;
        setAnalysis(result);
        setStatus('分析数据已就绪');
        const d = Number(result?.duration) || 0;
        if (d > 0) {
          setEnd((prev) => {
            const base = prev > start + 0.05 ? prev : Math.min(d, Math.max(8, start + 8));
            return Math.max(start + 0.05, Math.min(d, base));
          });
        }
      } catch (error) {
        if (canceled) return;
        setStatus(`分析加载失败：${error?.message || 'unknown_error'}`);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [taskId, audioPath]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const onTime = () => setCurrentTime(Number(audio.currentTime) || 0);
    const onLoaded = () => setStatus((s) => (String(s).includes('失败') ? s : '音频已就绪'));
    const onPlay = () => setStatus('播放中');
    const onPause = () => setStatus('已暂停');
    const onErr = () => setStatus('音频加载失败');
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('error', onErr);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('error', onErr);
    };
  }, [audioUrl]);

  const duration = Number(analysis?.duration) || 20;
  const left = 80;
  const width = 1400;
  const W = 1540;
  const H = 640;
  const xAt = (t) => left + (Math.max(0, Math.min(duration, t)) / Math.max(duration, 0.001)) * width;

  const validRms = useMemo(() => (analysis?.bins || []).map((b) => b.rms).filter(Number.isFinite), [analysis]);
  const minR = validRms.length ? Math.min(...validRms) : -60;
  const maxR = validRms.length ? Math.max(...validRms) : 0;
  const normR = (v) => (Number.isFinite(v) && maxR !== minR ? (v - minR) / (maxR - minR) : 0);

  const setByClientX = (clientX, mode = 'cursor') => {
    const wrap = wrapRef.current;
    const audio = audioRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const rel = Math.max(left, Math.min(left + width, clientX - rect.left));
    const t = ((rel - left) / width) * duration;
    if (mode === 'start') {
      const next = Math.max(0, Math.min(t, end - 0.05));
      setStart(next);
    } else if (mode === 'end') {
      const next = Math.max(start + 0.05, Math.min(duration, t));
      setEnd(next);
    } else {
      if (audio) audio.currentTime = Math.max(0, Math.min(duration, t));
      setCurrentTime(Math.max(0, Math.min(duration, t)));
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging) return;
      setByClientX(e.clientX, dragging);
    };
    const onUp = () => setDragging(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, start, end, duration]);

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal-card" style={{ width: 'min(96vw, 1560px)', height: 'min(94vh, 1000px)' }} onClick={(e) => e.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 12, alignItems: 'center' }}>
          <div>
            <h3 style={{ marginBottom: 6 }}>Music Analysis</h3>
            <div style={{ fontSize: 12, opacity: 0.8 }}>真实数据驱动：波形、节拍、音符、拖拽与区间选择均在此弹窗中完成。</div>
          </div>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ display: 'grid', gap: 8, marginBottom: 12, fontSize: 12 }}>
          <div><b>当前音乐：</b>{audioPath || 'None'}</div>
          <div><b>音乐目录：</b>{libraryDirectory || 'Unknown'}</div>
          <div><b>目录文件：</b>{(files || []).map((x) => x.split('/').pop()).join(' / ') || 'None'}</div>
        </div>

        <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <audio ref={audioRef} src={audioUrl || ''} controls preload="metadata" style={{ width: 520 }} />
          <div style={{ fontSize: 12 }}>状态：{status}</div>
          <div style={{ fontSize: 12 }}>时长：{duration.toFixed(2)}s</div>
          <div style={{ fontSize: 12 }}>当前：{currentTime.toFixed(2)}s</div>
          <div style={{ fontSize: 12 }}>Start：{start.toFixed(2)}s</div>
          <div style={{ fontSize: 12 }}>End：{end.toFixed(2)}s</div>
        </div>

        <div ref={wrapRef} style={{ position: 'relative', border: '1px solid #334155', borderRadius: 12, background: '#020617', overflow: 'hidden' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            <rect x="0" y="0" width={W} height={H} fill="#020617" />
            {Array.from({ length: Math.floor(duration) + 1 }, (_, i) => (
              <g key={i}>
                <line x1={xAt(i)} y1="40" x2={xAt(i)} y2="600" stroke="#334155" strokeOpacity="0.35" />
                <text x={xAt(i) - 6} y="26" fill="#cbd5e1" fontSize="12">{i}s</text>
              </g>
            ))}

            <text x="20" y="74" fill="#cbd5e1" fontSize="13">真实波形 / RMS</text>
            {(analysis?.bins || []).map((b, idx) => {
              const x = xAt(b.t);
              const h = 18 + normR(b.rms) * 100;
              return <line key={`bar_${idx}`} x1={x} y1="160" x2={x} y2={160 - h} stroke="#38bdf8" strokeWidth="2" opacity="0.92" />;
            })}
            <line x1="80" y1="160" x2="1480" y2="160" stroke="#38bdf8" strokeOpacity="0.22" />

            <text x="20" y="252" fill="#cbd5e1" fontSize="13">真实节拍 / Beat Peaks</text>
            {(analysis?.beats || []).map((t, idx) => <line key={`beat_${idx}`} x1={xAt(t)} y1="270" x2={xAt(t)} y2="314" stroke="#f59e0b" strokeWidth="2" />)}

            <text x="20" y="356" fill="#cbd5e1" fontSize="13">真实音符块 / Pitch Notes</text>
            {[366, 386, 406, 426, 446].map((y) => <line key={y} x1="80" y1={y} x2="1480" y2={y} stroke="#64748b" opacity="0.82" />)}
            {(analysis?.notes || []).map((n, idx) => {
              const x = xAt(n.start);
              const w = Math.max(6, xAt(n.end) - xAt(n.start));
              const y = 446 - ((n.midi - 48) / 24) * 90;
              return <rect key={`note_${idx}`} x={x} y={y - 7} width={w} height="14" rx="5" fill="#22c55e" fillOpacity="0.88" stroke="#22c55e" />;
            })}

            <text x="20" y="536" fill="#cbd5e1" fontSize="13">时间窗选择 / Segment Window</text>
            <rect x={xAt(start)} y="510" width={Math.max(8, xAt(end) - xAt(start))} height="56" fill="#a78bfa" fillOpacity="0.10" stroke="#a78bfa" strokeDasharray="6 4" />
            <line x1={xAt(start)} y1="510" x2={xAt(start)} y2="566" stroke="#a78bfa" strokeWidth="4" />
            <line x1={xAt(end)} y1="510" x2={xAt(end)} y2="566" stroke="#a78bfa" strokeWidth="4" />
          </svg>

          <div title="播放指针" onMouseDown={(e) => { setDragging('cursor'); setByClientX(e.clientX, 'cursor'); }} style={{ position: 'absolute', left: xAt(currentTime), top: 0, bottom: 0, width: 2, background: '#f43f5e', boxShadow: '0 0 12px rgba(244,63,94,.55)', cursor: 'ew-resize' }} />
          <div title="拖动 Start" onMouseDown={(e) => { setDragging('start'); setByClientX(e.clientX, 'start'); }} style={{ position: 'absolute', left: xAt(start) - 6, top: 510, width: 12, height: 56, cursor: 'ew-resize' }} />
          <div title="拖动 End" onMouseDown={(e) => { setDragging('end'); setByClientX(e.clientX, 'end'); }} style={{ position: 'absolute', left: xAt(end) - 6, top: 510, width: 12, height: 56, cursor: 'ew-resize' }} />
        </div>

        <div className="row between" style={{ marginTop: 14, alignItems: 'center' }}>
          <div style={{ fontSize: 12, opacity: 0.82 }}>已接入真实分析数据：RMS、Beat Peaks、Pitch Note Blocks。可播放、拖拽播放指针、拖动 Start/End，并回写 Step5。</div>
          <button onClick={() => onApply?.({ start, end })}>Apply to Step5</button>
        </div>
      </div>
    </div>
  );
}
function BgmAudioPickerModal({ taskId, files, query, currentPath, directory, onQueryChange, onClose, onSelect }) {
  const audioRef = useRef(null);
  const [previewPath, setPreviewPath] = useState(() => String(currentPath || "").trim());
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState("1.00");
  const [pendingAutoPlay, setPendingAutoPlay] = useState(false);

  const previewSourceUrl =
    taskId && String(previewPath || "").trim() ? api.bgmAudioSourceUrl(taskId, String(previewPath || "").trim()) : "";

  useEffect(() => {
    const nextPath = String(currentPath || "").trim();
    if (!nextPath) return;
    if (!files.includes(nextPath)) return;
    setPreviewPath(nextPath);
  }, [currentPath, files]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const rate = Number(playbackRate) || 1;
    audio.playbackRate = rate;
  }, [playbackRate]);

  useEffect(() => {
    if (!pendingAutoPlay) return;
    const audio = audioRef.current;
    if (!audio || !previewSourceUrl) {
      setPendingAutoPlay(false);
      return;
    }
    audio
      .play()
      .then(() => {
        setPendingAutoPlay(false);
      })
      .catch(() => {
        setPendingAutoPlay(false);
        setIsPlaying(false);
      });
  }, [pendingAutoPlay, previewSourceUrl]);

  const togglePreview = async (filePath) => {
    if (!taskId) return;
    const target = String(filePath || "").trim();
    if (!target) return;

    const audio = audioRef.current;
    if (!audio) {
      setPreviewPath(target);
      setPendingAutoPlay(true);
      return;
    }

    if (target !== previewPath) {
      setPreviewPath(target);
      setCurrentTime(0);
      setDuration(0);
      setPendingAutoPlay(true);
      return;
    }

    if (isPlaying) {
      audio.pause();
      return;
    }

    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  };

  const handleSeek = (value) => {
    const nextTime = Math.max(0, Number(value) || 0);
    setCurrentTime(nextTime);
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = nextTime;
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal-card bgm-picker-modal" onClick={(event) => event.stopPropagation()}>
        <div className="row between">
          <h3>Select BGM Audio</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="bgm-picker-dir">
          <IconFolderOpen />
          <span>Folder: {directory || "(not available)"}</span>
        </div>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search mp3 file name"
          autoFocus
        />
        <div className="bgm-picker-list">
          {files.length === 0 ? (
            <div className="log-empty">No mp3 files found.</div>
          ) : (
            files.map((filePath) => {
              const selected = filePath === currentPath;
              const previewing = filePath === previewPath;
              return (
                <div
                  key={filePath}
                  className={`bgm-picker-item ${selected ? "active" : ""} ${previewing ? "previewing" : ""}`}
                  title={filePath}
                >
                  <button
                    type="button"
                    className="icon-button sm"
                    onClick={() => togglePreview(filePath)}
                    title={previewing && isPlaying ? "Pause preview" : "Play preview"}
                    disabled={!taskId}
                  >
                    {previewing && isPlaying ? <IconPause /> : <IconPlay />}
                  </button>
                  <span className="bgm-picker-name">{getPathBaseName(filePath)}</span>
                  <button type="button" className="action-button small" onClick={() => onSelect(filePath)}>
                    Select
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="bgm-picker-preview-bar">
          <audio
            ref={audioRef}
            src={previewSourceUrl}
            preload="metadata"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => {
              setIsPlaying(false);
              setCurrentTime(0);
            }}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
            onLoadedMetadata={(event) => {
              const d = Number(event.currentTarget.duration) || 0;
              setDuration(d);
            }}
          />
          <div className="bgm-picker-preview-top">
            <span className="bgm-picker-preview-name">{previewPath ? getPathBaseName(previewPath) : "No preview selected"}</span>
            <span className="bgm-picker-preview-time">
              {formatMediaClock(currentTime)} / {formatMediaClock(duration)}
            </span>
          </div>
          <div className="bgm-picker-preview-controls">
            <input
              type="range"
              min="0"
              max={Math.max(duration, 0.1)}
              step="0.01"
              value={Math.min(currentTime, Math.max(duration, 0.1))}
              onChange={(event) => handleSeek(event.target.value)}
              disabled={!previewSourceUrl}
            />
            <select value={playbackRate} onChange={(event) => setPlaybackRate(event.target.value)} disabled={!previewSourceUrl}>
              <option value="0.75">0.75x</option>
              <option value="1.00">1.00x</option>
              <option value="1.25">1.25x</option>
              <option value="1.50">1.50x</option>
              <option value="2.00">2.00x</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoverFrameModal({
  candidates,
  aspectRatio,
  selectedCoverArtifactId,
  baseArtifactId,
  enabled,
  coverDurationSeconds,
  referenceImages,
  titleText,
  promptText,
  busy,
  onClose,
  onEnabledChange,
  onSelectCover,
  onSelectBase,
  onTitleChange,
  onPromptChange,
  onCoverDurationChange,
  onReferenceUpload,
  onPromptPaste,
  onRemoveReference,
  onGenerate,
  onSave
}) {
  const baseArtifact = candidates.find((item) => item.id === baseArtifactId) || null;
  const selectedCover = candidates.find((item) => item.id === selectedCoverArtifactId) || null;
  const canGenerate = !busy && (Boolean(baseArtifactId) || referenceImages.length > 0) && Boolean(String(titleText || "").trim());
  const canSave = !busy && (!enabled || Boolean(selectedCoverArtifactId));
  const onPromptKeyDown = (event) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    if (canGenerate) {
      onGenerate();
    }
  };
  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal-card cover-modal" onClick={(event) => event.stopPropagation()}>
        <div className="row between cover-modal-head">
          <h3>Cover</h3>
          <div className="row cover-head-icons">
            <button type="button" className="icon-button sm" title="Generate Cover" onClick={onGenerate} disabled={!canGenerate}>
              <IconSpark />
            </button>
            <button type="button" className="icon-button sm" title="Save" onClick={onSave} disabled={!canSave}>
              <IconSave />
            </button>
            <button type="button" className="icon-button sm" title="Close" onClick={onClose}>
              <IconClose />
            </button>
          </div>
        </div>

        <div className="cover-config-row cover-config-row-top">
          <label className="cover-field-base">
            选择历史图片（用于生成）
            <select value={baseArtifactId} onChange={(event) => onSelectBase(event.target.value)} disabled={busy || candidates.length === 0}>
              {candidates.length === 0 ? <option value="">No image yet</option> : null}
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.type} · {new Date(item.created_at).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </label>
          <label className="cover-field-selected">
            已选择封面图
            <select value={selectedCoverArtifactId} onChange={(event) => onSelectCover(event.target.value)} disabled={busy || candidates.length === 0}>
              <option value="">None</option>
              {candidates.map((item) => (
                <option key={`cover_${item.id}`} value={item.id}>
                  {item.type} · {new Date(item.created_at).toLocaleTimeString()}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="cover-config-row cover-config-row-second">
          <label className="cover-field-title">
            标题（必须出现在图里）
            <input value={titleText} onChange={(event) => onTitleChange(event.target.value)} placeholder="输入封面标题" disabled={busy} />
          </label>

          <div className="cover-field-toggle">
            <div className="cover-field-label">启用封面</div>
            <label className="check-line cover-enable-line">
              <span className="cover-enable-toggle">
                <input type="checkbox" checked={enabled} onChange={(event) => onEnabledChange(event.target.checked)} disabled={busy} />
                <span>启用封面</span>
              </span>
              <span className="cover-duration-control">
                <span>封面时长</span>
                <input
                  type="number"
                  min="0.2"
                  max="8"
                  step="0.1"
                  value={coverDurationSeconds}
                  onChange={(event) => onCoverDurationChange(event.target.value)}
                  disabled={busy || !enabled}
                />
                <span>s</span>
              </span>
            </label>
          </div>
        </div>

        <div className="cover-prompt-shell">
          {referenceImages.length > 0 && (
            <div className="cover-ref-strip">
              {referenceImages.map((item) => (
                <div key={item.id} className="cover-ref-chip">
                  <img src={item.previewUrl} alt={item.file?.name || "reference"} />
                  <button type="button" className="cover-ref-remove" onClick={() => onRemoveReference(item.id)} disabled={busy}>
                    <IconClose />
                  </button>
                  <small>{item.file?.name || "image"}</small>
                </div>
              ))}
            </div>
          )}

          <div className="cover-textarea-wrap">
            <textarea
              value={promptText}
              onChange={(event) => onPromptChange(event.target.value)}
              onKeyDown={onPromptKeyDown}
              onPaste={onPromptPaste}
              placeholder="输入画面提示词；可直接粘贴图片，或点击 + 上传多张参考图"
              disabled={busy}
            />
            <div className="cover-prompt-actions">
              <label className="icon-button sm" title="Upload Images">
                <IconPlus />
                <input type="file" accept="image/*" multiple className="hidden-file-input" onChange={onReferenceUpload} disabled={busy} />
              </label>
              <button type="button" className="icon-button sm" title="Send (Enter)" onClick={onGenerate} disabled={!canGenerate}>
                <IconEnter />
              </button>
            </div>
          </div>
        </div>

        <div className="cover-preview-grid" style={{ "--tile-ratio": aspectRatio }}>
          <div className="cover-preview-card">
            <div className="cover-preview-head">待生成图片</div>
            {baseArtifact?.url ? (
              <div className="image-tile">
                <img src={baseArtifact.url} alt="cover-base-preview" />
              </div>
            ) : (
              <div className="image-placeholder-tile">No base image selected</div>
            )}
          </div>
          <div className="cover-preview-card">
            <div className="cover-preview-head">生成后的图片</div>
            {selectedCover?.url ? (
              <div className="image-tile selected">
                <img src={selectedCover.url} alt="cover-generated-preview" />
              </div>
            ) : (
              <div className="image-placeholder-tile">No cover selected</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelSettingsModal({ settingsDraft, modelSettings, onClose, onChange, onSave, busy }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card model-modal">
        <h3>Global Model Settings</h3>
        <div className="model-grid">
          <label>
            Provider
            <select
              value={settingsDraft.provider}
              onChange={(e) => onChange((s) => ({ ...s, provider: e.target.value }))}
            >
              <option value="gemini">gemini</option>
            </select>
          </label>
          <label>
            Prompt Model
            <select
              value={settingsDraft.promptModel}
              onChange={(e) => onChange((s) => ({ ...s, promptModel: e.target.value }))}
            >
              <option value="gemini-3.0-flash">gemini-3.0-flash</option>
              <option value="gemini-3.0-pro">gemini-3.0-pro</option>
            </select>
          </label>
          <label>
            Image Model
            <select
              value={settingsDraft.imageModel}
              onChange={(e) => onChange((s) => ({ ...s, imageModel: normalizeImageModel(e.target.value) }))}
            >
              <option value="gemini-3.1-flash-image-preview">gemini-3.1-flash-image-preview</option>
              <option value="gemini-3-pro-image-preview">gemini-3-pro-image-preview</option>
              <option value="gemini-2.5-flash-image">gemini-2.5-flash-image</option>
            </select>
          </label>
          <label>
            Video Model
            <select
              value={settingsDraft.videoModel}
              onChange={(e) => onChange((s) => ({ ...s, videoModel: e.target.value }))}
            >
              <option value="veo-3.1-fast-generate-preview">veo-3.1-fast-generate-preview (start+end frame)</option>
              <option value="veo-3.1-generate-preview">veo-3.1-generate-preview (start+end frame)</option>
            </select>
          </label>
          <label>
            Saved API Key
            <input
              type="text"
              value={modelSettings?.has_api_key ? modelSettings.api_key_masked : "Not configured"}
              readOnly
            />
          </label>
          <label>
            Replace API Key (Optional)
            <input
              type="password"
              placeholder="Leave empty to keep current key"
              value={settingsDraft.apiKey}
              onChange={(e) => onChange((s) => ({ ...s, apiKey: e.target.value, clearApiKey: false }))}
            />
          </label>
          <label className="check-line">
            <input
              type="checkbox"
              checked={Boolean(settingsDraft.clearApiKey)}
              onChange={(e) => onChange((s) => ({ ...s, clearApiKey: e.target.checked, apiKey: "" }))}
            />
            <span>Clear saved API key</span>
          </label>
        </div>
        <div className="row between">
          <small>
            {modelSettings?.has_api_key
              ? `Saved key: ${modelSettings.api_key_masked} · prompt=${modelSettings.prompt_model || "gemini-3.0-flash"}`
              : "No API key saved"}
            {modelSettings?.encryption_enabled ? " · encrypted at rest" : " · encryption key not configured"}
            {" · video generation requires a start frame; end frame is optional"}
          </small>
          <div className="row">
            <button onClick={onClose}>Close</button>
            <button onClick={onSave} disabled={busy}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CleanPromptModal({ draft, onDraftChange, cleanPrompt, onClose, onSave, onRestore, onDelete, busy }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card">
        <h3>Clean Prompt Configuration</h3>
        <textarea value={draft} onChange={(e) => onDraftChange(e.target.value)} />
        <div className="row between">
          <small>Current version: {cleanPrompt.currentVersionId}</small>
          <div className="row">
            <button onClick={onClose}>Close</button>
            <button onClick={onSave} disabled={busy}>Save Version</button>
          </div>
        </div>
        <div className="version-row">
          {cleanPrompt.versions.slice(0, 20).map((v) => (
            <div key={v.id} className="version-pill-wrap">
              <button className="version-pill" onClick={() => onRestore(v.id)}>
                {new Date(v.created_at).toLocaleTimeString()} · {v.source}
              </button>
              <button
                className="version-delete"
                title="Delete version"
                disabled={busy || cleanPrompt.versions.length <= 1}
                onClick={() => onDelete(v.id)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StylePromptGenerateConfigModal({ draft, onDraftChange, onClose, onSave, onOpenPromptManager, busy }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card">
        <h3>Generate Prompts Instruction</h3>
        <textarea value={draft} onChange={(e) => onDraftChange(e.target.value)} />
        <div className="row between">
          <small>Controls how style prompts are generated.</small>
          <div className="row">
            <button onClick={onClose}>Close</button>
            <button onClick={onOpenPromptManager}>Edit Prompt Items</button>
            <button onClick={onSave} disabled={busy}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NarrativeGenerateConfigModal({ draft, onDraftChange, onClose, onSave, busy }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card">
        <h3>Narrative Generation Instruction</h3>
        <textarea value={draft} onChange={(e) => onDraftChange(e.target.value)} />
        <div className="row between">
          <small>Used by sparkle button to generate 3 runtime prompts from selected style image.</small>
          <div className="row">
            <button onClick={onClose}>Close</button>
            <button onClick={onSave} disabled={busy}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PublishPromptConfigModal({ channel, channelName, draft, onDraftChange, onClose, onSave, busy }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card">
        <h3>{channelName} 提示词配置 / {channel}</h3>
        <textarea value={draft} onChange={(e) => onDraftChange(e.target.value)} />
        <div className="row between">
          <small>用于 Step 6 ✨ 按钮生成该渠道的预填内容。</small>
          <div className="row">
            <button onClick={onClose}>Close</button>
            <button onClick={onSave} disabled={busy}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NarrativeScenesModal({ prompts, onClose, onSavePrompt, busy }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card prompt-manager-modal">
        <div className="row between">
          <h3>3 Runtime Prompts Configuration</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="prompt-list">
          {prompts.length === 0 ? (
            <div className="log-empty">No runtime prompts yet. Click sparkle to generate first.</div>
          ) : (
            prompts.map((prompt, idx) => (
              <NarrativePromptEditor key={prompt.id} value={prompt} index={idx + 1} onSavePrompt={onSavePrompt} busy={busy} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ProductionHistoryModal({ runs, onClose }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card production-history-modal">
        <div className="row between">
          <h3>Production History</h3>
          <button onClick={onClose}>Close</button>
        </div>
        {runs.length === 0 ? (
          <div className="log-empty">No history runs yet.</div>
        ) : (
          <div className="history-run-list">
            {runs.map((t) => (
              <div key={t.id} className="history-run-item">
                <div>Run {t.task_index + 1}</div>
                <span>{t.status}</span>
                <div className="row old-run-links">
                  {t.part1_url ? <a href={t.part1_url} target="_blank" rel="noreferrer">Part1</a> : null}
                  {t.part2_url ? <a href={t.part2_url} target="_blank" rel="noreferrer">Part2</a> : null}
                  {t.stitched_url ? <a href={t.stitched_url} target="_blank" rel="noreferrer">Stitched</a> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductionCountModal({ value, onChange, onClose }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card">
        <h3>Production Clip Count</h3>
        <div className="radio-row">
          <label className="radio-option">
            <input type="radio" name="production-clip-count" checked={value === 1} onChange={() => onChange(1)} />
            1 clip (single 8s, start + end)
          </label>
          <label className="radio-option">
            <input type="radio" name="production-clip-count" checked={value === 2} onChange={() => onChange(2)} />
            2 clips (current behavior)
          </label>
        </div>
        <div className="row between">
          <small>This selection applies to the next production run only.</small>
          <div className="row">
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductionFrameRefineModal({ role, targetArtifact, prompt, files, onPromptChange, onFilesChange, onClose, onSubmit, busy }) {
  const roleText = role === "start" ? "首帧" : "尾帧";
  return (
    <div className="modal-wrap">
      <div className="modal-card production-refine-modal">
        <h3>微调{roleText}</h3>
        <div className="production-refine-preview-wrap">
          {targetArtifact?.url ? (
            <img src={targetArtifact.url} alt={`production-${role}-frame`} className="production-refine-preview-image" />
          ) : (
            <div className="image-placeholder-tile">No selected frame</div>
          )}
        </div>
        <label className="production-refine-field">
          Prompt
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={`请输入用于微调${roleText}的提示词`}
            disabled={busy}
          />
        </label>
        <label className="production-refine-field">
          Reference Images (Optional)
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={onFilesChange}
            disabled={busy}
          />
        </label>
        <div className="production-refine-file-list">
          {files.length > 0 ? files.map((file) => <span key={`${file.name}_${file.size}`}>{file.name}</span>) : <small>No uploads</small>}
        </div>
        <div className="row between">
          <small>提交时会发送当前选中{roleText} + 提示词 + 可选参考图给模型。</small>
          <div className="row">
            <button onClick={onClose} disabled={busy}>Cancel</button>
            <button onClick={onSubmit} disabled={busy || !String(prompt || "").trim()}>Refine</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NarrativePromptEditor({ value, index, onSavePrompt, busy }) {
  const [name, setName] = useState(value.name || "");
  const [promptText, setPromptText] = useState(value.prompt_text || "");

  useEffect(() => {
    setName(value.name || "");
    setPromptText(value.prompt_text || "");
  }, [value]);

  return (
    <div className="prompt-card">
      <div className="row between">
        <strong>Runtime Prompt {index}</strong>
        <button
          disabled={busy}
          onClick={() =>
            onSavePrompt(value.id, {
              name,
              prompt_text: promptText
            })
          }
        >
          Save Prompt
        </button>
      </div>
      <input className="prompt-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Prompt name" />
      <textarea
        value={promptText}
        onChange={(e) => setPromptText(e.target.value)}
        placeholder="Instruction used by Generate Narrative to produce Part1 / Part2 / End Frame Prompt and tail frame image"
      />
    </div>
  );
}

function PromptManagerModal({ type, prompts, onClose, onSave, onRename, onSetLang, onRestore, onDelete }) {
  return (
    <div className="modal-wrap">
      <div className="modal-card prompt-manager-modal">
        <div className="row between">
          <h3>{type === "style" ? "风格提示词设置 / Style Prompt Settings" : "叙事提示词设置 / Narrative Prompt Settings"}</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="prompt-list">
          {prompts.length === 0 ? (
            <div className="log-empty">No prompts yet. Generate first.</div>
          ) : (
            prompts.map((p) => {
              const current = p.versions.find((v) => v.id === p.current_version_id) || p.versions[0];
              return (
                <PromptEditor
                  key={p.id}
                  title={p.name}
                  activeLang={p.active_lang === "zh" ? "zh" : "en"}
                  contentZh={current?.content_zh || ""}
                  contentEn={current?.content_en || ""}
                  versions={p.versions}
                  onRename={(name) => onRename(p.id, name)}
                  onSave={(payload) => onSave(p.id, payload)}
                  onSetLang={(lang) => onSetLang(p.id, lang)}
                  onRestore={(versionId) => onRestore(p.id, versionId)}
                  onDelete={(versionId) => onDelete(p.id, versionId)}
                />
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function PromptEditor({ title, activeLang, contentZh, contentEn, versions, onRename, onSave, onSetLang, onRestore, onDelete }) {
  const [name, setName] = useState(title);
  const [valueZh, setValueZh] = useState(contentZh);
  const [valueEn, setValueEn] = useState(contentEn);

  useEffect(() => {
    setName(title);
  }, [title]);

  useEffect(() => {
    setValueZh(contentZh);
  }, [contentZh]);

  useEffect(() => {
    setValueEn(contentEn);
  }, [contentEn]);

  return (
    <div className="prompt-card">
      <div className="row between">
        <input className="prompt-name-input" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <button className={activeLang === "en" ? "active" : ""} onClick={() => onSetLang("en")}>
            EN
          </button>
          <button className={activeLang === "zh" ? "active" : ""} onClick={() => onSetLang("zh")}>
            中文
          </button>
          <button onClick={() => onRename(name)}>Save Name</button>
          <button onClick={() => onSave({ contentZh: valueZh, contentEn: valueEn })}>Save Version</button>
        </div>
      </div>
      <textarea value={valueZh} onChange={(e) => setValueZh(e.target.value)} placeholder="中文提示词" />
      <textarea value={valueEn} onChange={(e) => setValueEn(e.target.value)} placeholder="English prompt" />
      <div className="version-row">
        {versions.slice(0, 8).map((v) => (
          <div key={v.id} className="version-pill-wrap">
            <button className="version-pill" onClick={() => onRestore(v.id)}>
              {new Date(v.created_at).toLocaleTimeString()}
            </button>
            <button
              className="version-delete"
              title="Delete version"
              disabled={versions.length <= 1}
              onClick={() => onDelete(v.id)}
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImageViewerModal({ value, onClose }) {
  return (
    <div className="modal-wrap image-modal-wrap" onClick={onClose}>
      <div className="modal-card image-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between image-modal-head">
          <h3>{value.title || "Image"}</h3>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="image-modal-body">
          <img src={value.url} alt={value.title || "full-size"} />
        </div>
      </div>
    </div>
  );
}

function NarrativeDetailModal({
  value,
  onClose,
  onSave,
  onRestoreVersion,
  onDeleteVersion,
  part1Prompt,
  part2Prompt,
  endPrompt,
  busy
}) {
  const [part1, setPart1] = useState(value.part1_prompt || "");
  const [part2, setPart2] = useState(value.part2_prompt || "");
  const [endFrame, setEndFrame] = useState(value.end_frame_prompt || "");

  useEffect(() => {
    setPart1(value.part1_prompt || "");
    setPart2(value.part2_prompt || "");
    setEndFrame(value.end_frame_prompt || "");
  }, [value.id, value.part1_prompt, value.part2_prompt, value.end_frame_prompt]);

  const renderVersionRow = (prompt) => {
    if (!prompt?.id) return null;
    const versions = prompt.versions || [];
    if (versions.length === 0) return null;
    return (
      <>
        <div className="version-row">
          {versions.slice(0, 8).map((v) => (
            <div key={v.id} className="version-pill-wrap">
              <button className="version-pill" onClick={() => onRestoreVersion?.(prompt.id, v.id)}>
                {new Date(v.created_at).toLocaleTimeString()}
              </button>
              <button
                className="version-delete"
                title="Delete version"
                disabled={busy || versions.length <= 1}
                onClick={() => onDeleteVersion?.(prompt.id, v.id)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <div className="modal-wrap">
      <div className="modal-card">
        <h3>{value.title}</h3>
        <div className="narrative-detail-block">
          <label>Part 1 Prompt</label>
          <textarea value={part1} onChange={(event) => setPart1(event.target.value)} />
          <div className="row between">
            <small>Current version: {part1Prompt?.current_version_id || "-"}</small>
            <button onClick={() => onSave?.(value.id, { part1_prompt: part1 }, "part1")} disabled={busy}>
              Save Version
            </button>
          </div>
          {renderVersionRow(part1Prompt)}
        </div>
        <div className="narrative-detail-block">
          <label>Part 2 Prompt</label>
          <textarea value={part2} onChange={(event) => setPart2(event.target.value)} />
          <div className="row between">
            <small>Current version: {part2Prompt?.current_version_id || "-"}</small>
            <button onClick={() => onSave?.(value.id, { part2_prompt: part2 }, "part2")} disabled={busy}>
              Save Version
            </button>
          </div>
          {renderVersionRow(part2Prompt)}
        </div>
        <div className="narrative-detail-block">
          <label>End Frame Prompt</label>
          <textarea value={endFrame} onChange={(event) => setEndFrame(event.target.value)} />
          <div className="row between">
            <small>Current version: {endPrompt?.current_version_id || "-"}</small>
            <button onClick={() => onSave?.(value.id, { end_frame_prompt: endFrame }, "end_frame")} disabled={busy}>
              Save Version
            </button>
          </div>
          {renderVersionRow(endPrompt)}
        </div>
        <div className="row">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
