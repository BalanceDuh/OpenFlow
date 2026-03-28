import express from "express";
import cors from "cors";
import multer from "multer";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import puppeteer from "puppeteer-core";
import { db, initDb, uid, now, addLog } from "./db.js";

initDb();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use((req, _res, next) => {
  if (req.url.includes("/bgm-preview/") || req.url.includes("/bgm-compose/")) {
    req.url = req.url.replace(/\/bgm-preview\/?(?=\?|$)/, "/bgm-preview");
    req.url = req.url.replace(/\/bgm-compose\/?(?=\?|$)/, "/bgm-compose");
  }
  next();
});

const STYLE_SEEDS = [
  {
    zh: "宋代留白美学，人物极小、景观巨大，苍茫山水与古树构图，强调孤寂与静穆，真实世界材质与光影，4K电影感画质。",
    en: "Song-dynasty blank-leaving aesthetics with a tiny human figure against monumental landscapes, austere mountains and ancient tree composition, conveying solitude and stillness, realistic materials and lighting, cinematic 4K film quality."
  },
  {
    zh: "中国武侠写实风，小人物立于天地之间，山脊云海与风势形成强烈张力，突出孤胆与寂寥，真实场景逻辑，4K电影级细节。",
    en: "Chinese wuxia cinematic realism: a small lone character within vast world scale, mountain ridges, cloud sea and wind tension, highlighting heroic solitude, physically plausible real-world scenes, and cinematic 4K detail."
  },
  {
    zh: "国画美风写实融合，大面积留白与巨景压迫感，小人物强化尺度反差，体现孤寂之美，真实自然纹理，4K电影质感。",
    en: "Chinese painting-inspired aesthetic realism with large negative space and imposing scenery, tiny figure for dramatic scale contrast, expressing solitary beauty, natural real-world texture, and cinematic 4K quality."
  }
];

const NARRATIVE_SEEDS = [
  {
    title: "静观长风",
    description: "镜头微移，人物衣摆与云雾缓慢流动",
    part1: "中文：镜头缓慢推进，独行者静立，衣摆在风中轻摆。\nEnglish: Slow dolly-in. The lone traveler stands still; robe edges flutter in wind.",
    part2: "中文：镜头向右平移，云层翻涌，树枝随风势增强而摆动。\nEnglish: Camera eases right. Cloud layers roll and tree branches sway with stronger gust.",
    end: "中文：人物仍立于曲树之下，天空更开阔，静谧感加深。\nEnglish: The traveler remains beneath the bent tree. Sky opens wider and silence deepens."
  },
  {
    title: "风起云涌",
    description: "先静后动，强调天空与树势变化",
    part1: "中文：广角静态开场，薄雾沿山脊爬升，仅保留细微环境动态。\nEnglish: Wide static opening, fog crawling over ridge, subtle ambient movement only.",
    part2: "中文：风势渐起，枝干弯折、云层涌动，镜头缓慢后拉。\nEnglish: Wind rises, branches flex and clouds surge while camera slowly pulls back.",
    end: "中文：在浅色天空下，人物、山脊与古树形成均衡终景。\nEnglish: A balanced final tableau of figure, ridge and tree under pale sky."
  },
  {
    title: "远山对谈",
    description: "人物与天地的无声对话",
    part1: "中文：轻柔推进，仿佛聆听远山回音，细节克制但有生命感。\nEnglish: Gentle push-in as if listening to distant mountains, minimal but alive details.",
    part2: "中文：镜头轻微横移，空气层次加厚，渺小人物对比宏阔山河。\nEnglish: Soft lateral move, atmosphere thickens, tiny figure contrasts colossal landscape.",
    end: "中文：以大留白和余韵式微动收束，形成庄重静止终帧。\nEnglish: Still and solemn ending frame with strong negative space and calm motion residue."
  }
];

const NARRATIVE_STYLE_DEFAULTS = [
  {
    name: "宋代留白",
    prompt_text:
      "宋代留白风格：小人物与巨景强烈尺度反差，苍茫山水、古树、静穆氛围。请生成用于后续执行的视频脚本与尾帧图提示词模板（非最终结果），并强制要求：视角保持一致、4K、电影感、无背景音乐、无任何字幕、只有环境声、人物衣服随风飘动、树木随风摆动（若有树木）、水体流淌（若有水体）、风起云涌、整体风景结构不改变。"
  },
  {
    name: "中国武侠",
    prompt_text:
      "中国武侠写实风格：风势、云海、山脊张力，小人物孤立于天地之间。请生成用于后续执行的视频脚本与尾帧图提示词模板（非最终结果），并强制要求：视角保持一致、4K、电影感、无背景音乐、无任何字幕、只有环境声、人物衣服随风飘动、树木随风摆动（若有树木）、水体流淌（若有水体）、风起云涌、整体风景结构不改变。"
  },
  {
    name: "国画美风",
    prompt_text:
      "国画美风写实融合：留白、笔触感、自然纹理与电影光影并存。请生成用于后续执行的视频脚本与尾帧图提示词模板（非最终结果），并强制要求：视角保持一致、4K、电影感、无背景音乐、无任何字幕、只有环境声、人物衣服随风飘动、树木随风摆动（若有树木）、水体流淌（若有水体）、风起云涌、整体风景结构不改变。"
  }
];

const NARRATIVE_VIDEO_REQUIREMENTS =
  "视角保持一致、4K、电影感、无背景音乐、无任何字幕、只有环境声、人物衣服随风飘动、树木随风摆动（若有树木）、水体流淌（若有水体）、风起云涌、整体风景结构不改变。";

const NARRATIVE_PROMPT_FIELDS = [
  ["分镜1提示词 / Part 1 Prompt", "Part 1 Prompt", "part1"],
  ["分镜2提示词 / Part 2 Prompt", "Part 2 Prompt", "part2"],
  ["结尾画面提示词 / End Frame Prompt", "End Frame Prompt", "end"]
];

const STYLE_REQUEST_TIMEOUT_MS = Number(process.env.STYLE_REQUEST_TIMEOUT_MS || 180000);
const STYLE_HEARTBEAT_MS = Number(process.env.STYLE_HEARTBEAT_MS || 12000);
const STYLE_MAX_ATTEMPTS = Math.max(1, Number(process.env.STYLE_MAX_ATTEMPTS || 3));
const FFMPEG_BIN = process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg";
const DEFAULT_BGM_LIBRARY_DIR = "/Users/duheng/Development/OpenCode/OpenFlow/Resource/古风音乐";
const BGM_LIBRARY_DIR = String(process.env.BGM_LIBRARY_DIR || DEFAULT_BGM_LIBRARY_DIR).trim() || DEFAULT_BGM_LIBRARY_DIR;
const VEO_POLL_INTERVAL_MS = Number(process.env.VEO_POLL_INTERVAL_MS || 10000);
const SUPPORTED_IMAGE_MODELS = new Set([
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image"
]);
const VEO_MAX_WAIT_MS = Number(process.env.VEO_MAX_WAIT_MS || 900000);
const VEO_START_END_FRAME_MODELS = ["veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"];
const PRODUCTION_REFINE_MAX_REFERENCES = Math.max(0, Number(process.env.PRODUCTION_REFINE_MAX_REFERENCES) || 8);
const WECHAT_PUBLISH_URL = "https://channels.weixin.qq.com/platform/post/list";
const PUBLISH_CHANNELS = ["video_channel", "douyin", "xiaohongshu"];
const PUBLISH_CHANNEL_LABELS = {
  video_channel: "视频号",
  douyin: "抖音号",
  xiaohongshu: "小红书"
};
const PUBLISH_LIGHT_VARIATION_CARDS = [
  {
    id: "card_a",
    direction: "保持主旨不变，替换意象词和节奏词，语气平稳。"
  },
  {
    id: "card_b",
    direction: "保持克制，句式略有变化，开头避免与最近结果重复。"
  },
  {
    id: "card_c",
    direction: "保留核心画面，强调环境感受，减少陈词套话。"
  },
  {
    id: "card_d",
    direction: "主语和视角做轻微切换，但不要改变主题和风格边界。"
  }
];
const DISALLOWED_PUBLISH_PHRASES = [
  "把心事交给长风慢慢讲完",
  "在远山与暮色之间与自己和解",
  "把沉默酿成一束温热的光"
];
const WECHAT_PUBLISH_TIMEOUT_MS = Math.min(30000, Math.max(5000, Number(process.env.WECHAT_PUBLISH_TIMEOUT_MS || 30000)));
const WECHAT_PUBLISH_STEP_TIMEOUT_MS = Math.min(30000, Math.max(5000, Number(process.env.WECHAT_PUBLISH_STEP_TIMEOUT_MS || 30000)));
const WECHAT_PUBLISH_HEARTBEAT_MS = Math.min(5000, Math.max(1000, Number(process.env.WECHAT_PUBLISH_HEARTBEAT_MS || 3000)));
const WECHAT_PUBLISH_CDP_PORT = Number(process.env.WECHAT_PUBLISH_CDP_PORT || 9222);
const WECHAT_PUBLISH_ENTRY_URLS = [
  "https://channels.weixin.qq.com/platform/post/create",
  "https://channels.weixin.qq.com/platform/post/create?type=2",
  "https://channels.weixin.qq.com/platform/post/create?tab=video"
];
const WECHAT_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
];
const WECHAT_PUBLISH_SESSIONS = new Map();
const PUBLISH_PREFILL_RECENT_CACHE = new Map();

function frameCapableModelsText() {
  return VEO_START_END_FRAME_MODELS.join(", ");
}

function artifactToVeoImagePayload(artifact) {
  if (!artifact?.data) {
    return null;
  }
  return {
    mimeType: artifact.mime_type || "image/png",
    bytesBase64Encoded: artifact.data.toString("base64")
  };
}

function isFrameFieldUnsupported(message) {
  if (!message) {
    return false;
  }
  const msg = String(message).toLowerCase();
  return (
    (msg.includes("image") || msg.includes("lastframe") || msg.includes("bytesbase64encoded")) &&
    (msg.includes("not support") || msg.includes("isn't supported") || msg.includes("unknown name") || msg.includes("invalid"))
  );
}
const MODEL_SETTINGS_SECRET = process.env.OPENFLOW_MASTER_KEY || process.env.OPENFLOW_SETTINGS_KEY || "";

function resolveSettingsKey() {
  const secret = String(MODEL_SETTINGS_SECRET || "").trim();
  if (!secret) return null;
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  const base64 = Buffer.from(secret, "base64");
  if (base64.length === 32) {
    return base64;
  }
  return createHash("sha256").update(secret).digest();
}

const SETTINGS_KEY = resolveSettingsKey();

function encryptApiKey(plainText) {
  const value = String(plainText || "").trim();
  if (!value) return "";
  if (!SETTINGS_KEY) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SETTINGS_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptApiKey(storedValue) {
  const value = String(storedValue || "").trim();
  if (!value) return "";
  if (!value.startsWith("enc:v1:")) {
    return value;
  }
  if (!SETTINGS_KEY) {
    return "";
  }
  const parts = value.split(":");
  if (parts.length !== 5) return "";
  try {
    const iv = Buffer.from(parts[2], "base64");
    const tag = Buffer.from(parts[3], "base64");
    const encrypted = Buffer.from(parts[4], "base64");
    const decipher = createDecipheriv("aes-256-gcm", SETTINGS_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

function maskApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return "";
  if (value.length <= 8) {
    return `${value.slice(0, 2)}****${value.slice(-2)}`;
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function decodeDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!m) {
    throw new Error("invalid data url");
  }
  return { mimeType: m[1], buffer: Buffer.from(m[2], "base64") };
}

function artifactUrl(id) {
  return `/api/artifacts/${id}/content`;
}

function getModelSettings() {
  const row = db.prepare("SELECT * FROM model_settings WHERE id = 'default'").get();
  if (!row) return null;
  const decrypted = decryptApiKey(row.api_key);

  if (decrypted && !String(row.api_key || "").startsWith("enc:v1:") && SETTINGS_KEY) {
    const encrypted = encryptApiKey(decrypted);
    db.prepare("UPDATE model_settings SET api_key = ?, updated_at = ? WHERE id = 'default'").run(encrypted, now());
    row.api_key = encrypted;
  }

  return {
    ...row,
    api_key: decrypted,
    has_api_key: Boolean(decrypted),
    api_key_masked: maskApiKey(decrypted),
    encryption_enabled: Boolean(SETTINGS_KEY)
  };
}

function updateModelSettings(payload) {
  const currentRow = db.prepare("SELECT * FROM model_settings WHERE id = 'default'").get();
  const current = getModelSettings();
  const provider = payload?.provider || current.provider || "gemini";
  const promptModel = payload?.promptModel || current.prompt_model || "gemini-3.0-flash";
  const rawImageModel = payload?.imageModel || current.image_model || "gemini-2.5-flash-image";
  const imageModel = SUPPORTED_IMAGE_MODELS.has(String(rawImageModel || "").trim())
    ? String(rawImageModel).trim()
    : "gemini-2.5-flash-image";
  const videoModel = payload?.videoModel || current.video_model || "veo-3.1-fast-generate-preview";
  const shouldClear = Boolean(payload?.clearApiKey);
  const incomingApiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : null;
  const hasNewApiKey = incomingApiKey !== null && incomingApiKey !== "";
  const apiKeyStored = shouldClear
    ? ""
    : hasNewApiKey
      ? encryptApiKey(incomingApiKey)
      : currentRow.api_key;

  db.prepare(
    "UPDATE model_settings SET provider = ?, prompt_model = ?, image_model = ?, video_model = ?, api_key = ?, updated_at = ? WHERE id = 'default'"
  ).run(provider, promptModel, imageModel, videoModel, apiKeyStored, now());
  return getModelSettings();
}

function getStyleActionSettings() {
  return db.prepare("SELECT * FROM style_action_settings WHERE id = 'default'").get();
}

function updateStyleActionSettings(payload) {
  const current = getStyleActionSettings();
  const promptInstruction = (payload?.promptGenerationInstruction ?? current.prompt_generation_instruction).trim();
  const styleImageInstruction = (payload?.styleImageInstruction ?? current.style_image_instruction).trim();
  db.prepare(
    "UPDATE style_action_settings SET prompt_generation_instruction = ?, style_image_instruction = ?, updated_at = ? WHERE id = 'default'"
  ).run(promptInstruction, styleImageInstruction, now());
  return getStyleActionSettings();
}

function getNarrativeActionSettings() {
  return db.prepare("SELECT * FROM narrative_action_settings WHERE id = 'default'").get();
}

function updateNarrativeActionSettings(payload) {
  const current = getNarrativeActionSettings();
  const generationInstruction = (payload?.generationInstruction ?? current.generation_instruction).trim();
  db.prepare("UPDATE narrative_action_settings SET generation_instruction = ?, updated_at = ? WHERE id = 'default'").run(
    generationInstruction,
    now()
  );
  return getNarrativeActionSettings();
}

function normalizePublishChannel(channel) {
  const key = String(channel || "").trim();
  if (!PUBLISH_CHANNELS.includes(key)) {
    throw new Error("publish_channel_invalid");
  }
  return key;
}

function getPublishActionSettings() {
  const rows = db
    .prepare("SELECT channel, instruction, updated_at FROM publish_action_settings ORDER BY channel ASC")
    .all();
  const mapped = {};
  for (const channel of PUBLISH_CHANNELS) {
    const row = rows.find((item) => item.channel === channel);
    mapped[channel] = {
      channel,
      instruction: String(row?.instruction || "").trim(),
      updated_at: row?.updated_at || ""
    };
  }
  return mapped;
}

function updatePublishActionSetting(channel, payload) {
  const key = normalizePublishChannel(channel);
  const current = db
    .prepare("SELECT channel, instruction, updated_at FROM publish_action_settings WHERE channel = ?")
    .get(key);
  const instruction = String(payload?.instruction ?? current?.instruction ?? "").trim();
  if (!instruction) {
    throw new Error("publish_instruction_required");
  }
  db.prepare(
    "INSERT INTO publish_action_settings (channel, instruction, updated_at) VALUES (?, ?, ?) ON CONFLICT(channel) DO UPDATE SET instruction = excluded.instruction, updated_at = excluded.updated_at"
  ).run(key, instruction, now());
  return db.prepare("SELECT channel, instruction, updated_at FROM publish_action_settings WHERE channel = ?").get(key);
}

function ensureNarrativeStylePrompts(taskId) {
  const rows = db
    .prepare("SELECT * FROM narrative_style_prompts WHERE task_id = ? ORDER BY prompt_index ASC")
    .all(taskId);
  if (rows.length >= 3) {
    return rows.slice(0, 3);
  }

  const tx = db.transaction(() => {
    for (let i = 0; i < 3; i += 1) {
      const idx = i + 1;
      const existing = rows.find((r) => r.prompt_index === idx);
      if (!existing) {
        const seed = NARRATIVE_STYLE_DEFAULTS[i];
        const at = now();
        db.prepare(
          "INSERT OR IGNORE INTO narrative_style_prompts (id, task_id, prompt_index, name, prompt_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(uid("nsp"), taskId, idx, seed.name, seed.prompt_text, at, at);
      }
    }
  });
  tx();

  return db
    .prepare("SELECT * FROM narrative_style_prompts WHERE task_id = ? ORDER BY prompt_index ASC")
    .all(taskId)
    .slice(0, 3);
}

function getNarrativeStylePrompts(taskId) {
  return ensureNarrativeStylePrompts(taskId);
}

function getCleanPromptState() {
  const state = db.prepare("SELECT * FROM clean_prompt_state WHERE id = 'default'").get();
  const versions = db
    .prepare("SELECT * FROM clean_prompt_versions ORDER BY created_at DESC")
    .all();
  const current = versions.find((v) => v.id === state.current_version_id) || versions[0];
  return {
    currentVersionId: state.current_version_id,
    currentContent: current?.content || "",
    versions
  };
}

function saveCleanPromptVersion(content, source = "user") {
  const versionId = uid("cpv");
  db.prepare(
    "INSERT INTO clean_prompt_versions (id, content, source, created_at) VALUES (?, ?, ?, ?)"
  ).run(versionId, content, source, now());
  db.prepare("UPDATE clean_prompt_state SET current_version_id = ?, updated_at = ? WHERE id = 'default'").run(
    versionId,
    now()
  );
  return versionId;
}

function restoreCleanPromptVersion(versionId) {
  const version = db.prepare("SELECT * FROM clean_prompt_versions WHERE id = ?").get(versionId);
  if (!version) {
    return null;
  }
  db.prepare("UPDATE clean_prompt_state SET current_version_id = ?, updated_at = ? WHERE id = 'default'").run(
    versionId,
    now()
  );
  return version;
}

function getTask(taskId) {
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
}

function ensureTask(taskId) {
  const task = getTask(taskId);
  if (!task) {
    const err = new Error("task_not_found");
    err.status = 404;
    throw err;
  }
  return task;
}

function insertArtifact(taskId, type, mimeType, buffer, meta = {}) {
  const id = uid("artifact");
  db.prepare(
    "INSERT INTO artifacts (id, task_id, type, mime_type, data, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, taskId, type, mimeType, buffer, JSON.stringify(meta), now());
  return id;
}

function latestArtifact(taskId, type) {
  return db
    .prepare("SELECT * FROM artifacts WHERE task_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1")
    .get(taskId, type);
}

function normalizeProductionClipCount(rawCount) {
  const value = Number(rawCount);
  return value === 1 ? 1 : 2;
}

function getImageArtifactInTask(taskId, artifactId) {
  if (!artifactId) return null;
  return db
    .prepare("SELECT * FROM artifacts WHERE id = ? AND task_id = ? AND mime_type LIKE 'image/%'")
    .get(artifactId, taskId);
}

function requireSelectedStartFrameArtifact(taskId) {
  const task = ensureTask(taskId);
  const selectedArtifactId = task.selected_start_artifact_id;
  if (!selectedArtifactId) {
    throw new Error("start_frame_required");
  }
  const artifact = getImageArtifactInTask(taskId, selectedArtifactId);
  if (!artifact) {
    throw new Error("start_frame_required");
  }
  return artifact;
}

function getVideoArtifactInTask(taskId, artifactId) {
  if (!artifactId) return null;
  return db
    .prepare("SELECT * FROM artifacts WHERE id = ? AND task_id = ? AND mime_type LIKE 'video/%'")
    .get(artifactId, taskId);
}

function getAudioArtifactInTask(taskId, artifactId) {
  if (!artifactId) return null;
  return db
    .prepare("SELECT * FROM artifacts WHERE id = ? AND task_id = ? AND mime_type LIKE 'audio/%'")
    .get(artifactId, taskId);
}

function normalizeDurationSeconds(value, fallback = 16) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(180, num));
}

function normalizePlaybackRate(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0.85, Math.min(1.15, num));
}

function normalizeSegmentPlaybackRate(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0.5, Math.min(2.0, num));
}

function atempoFilterChain(rate) {
  const filters = [];
  let remain = rate;
  while (remain > 2.0) {
    filters.push("atempo=2.0");
    remain /= 2.0;
  }
  while (remain < 0.5) {
    filters.push("atempo=0.5");
    remain /= 0.5;
  }
  filters.push(`atempo=${remain.toFixed(6)}`);
  return filters;
}

function buildPromptPayload(taskId) {
  const prompts = db
    .prepare("SELECT * FROM prompts WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId)
    .map((p) => {
      const versions = db
        .prepare("SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC")
        .all(p.id);
      return { ...p, versions };
    });
  return prompts;
}

function taskState(taskId) {
  const task = ensureTask(taskId);
  const modelSettings = getModelSettings();
  const styleActionSettings = getStyleActionSettings();
  const narrativeActionSettings = getNarrativeActionSettings();
  const publishActionSettings = getPublishActionSettings();
  const narrativeStylePrompts = getNarrativeStylePrompts(taskId);
  const artifacts = db
    .prepare("SELECT id, task_id, type, mime_type, meta_json, created_at FROM artifacts WHERE task_id = ? ORDER BY created_at DESC")
    .all(taskId)
    .map((a) => ({ ...a, url: artifactUrl(a.id), meta: a.meta_json ? JSON.parse(a.meta_json) : {} }));
  const narratives = db
    .prepare("SELECT * FROM narrative_options WHERE task_id = ? ORDER BY created_at ASC")
    .all(taskId)
    .map((n) => ({
      ...n,
      end_frame_url: n.end_frame_artifact_id ? artifactUrl(n.end_frame_artifact_id) : null
    }));
  const productionTasks = db
    .prepare("SELECT * FROM production_tasks WHERE task_id = ? ORDER BY task_index ASC")
    .all(taskId)
    .map((t) => ({
      ...t,
      part1_url: t.part1_artifact_id ? artifactUrl(t.part1_artifact_id) : null,
      bridge_url: t.bridge_artifact_id ? artifactUrl(t.bridge_artifact_id) : null,
      part2_url: t.part2_artifact_id ? artifactUrl(t.part2_artifact_id) : null,
      stitched_url: t.stitched_artifact_id ? artifactUrl(t.stitched_artifact_id) : null
    }));
  const logs = db.prepare("SELECT * FROM logs WHERE task_id = ? ORDER BY created_at DESC LIMIT 200").all(taskId);
  return {
    task,
    modelSettings: {
      id: modelSettings.id,
      provider: modelSettings.provider,
      prompt_model: modelSettings.prompt_model,
      image_model: modelSettings.image_model,
      video_model: modelSettings.video_model,
      has_api_key: modelSettings.has_api_key,
      api_key_masked: modelSettings.api_key_masked,
      encryption_enabled: modelSettings.encryption_enabled
    },
    styleActionSettings,
    narrativeActionSettings,
    publishActionSettings,
    narrativeStylePrompts,
    cleanPrompt: getCleanPromptState(),
    prompts: buildPromptPayload(taskId),
    narratives,
    artifacts,
    productionTasks,
    logs
  };
}

function taskSummaryList() {
  const tasks = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100").all();

  return tasks.map((task) => {
    const artifactCounts = db
      .prepare("SELECT type, COUNT(*) AS count FROM artifacts WHERE task_id = ? GROUP BY type")
      .all(task.id)
      .reduce((acc, row) => {
        acc[row.type] = Number(row.count) || 0;
        return acc;
      }, {});

    const narrativeCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM narrative_options WHERE task_id = ?")
      .get(task.id);
    const productionRunCountRow = db
      .prepare("SELECT COUNT(*) AS count FROM production_tasks WHERE task_id = ?")
      .get(task.id);
    const artifactCountRow = db.prepare("SELECT COUNT(*) AS count FROM artifacts WHERE task_id = ?").get(task.id);

    return {
      id: task.id,
      phase: task.phase,
      status: task.status,
      aspect_ratio: task.aspect_ratio,
      selected_start_artifact_id: task.selected_start_artifact_id,
      selected_end_artifact_id: task.selected_end_artifact_id,
      selected_narrative_id: task.selected_narrative_id,
      cover_artifact_id: task.cover_artifact_id,
      cover_enabled: task.cover_enabled,
      created_at: task.created_at,
      updated_at: task.updated_at,
      counts: {
        artifactCount: Number(artifactCountRow?.count) || 0,
        styleImageCount: artifactCounts.style_image || 0,
        narrativeCount: Number(narrativeCountRow?.count) || 0,
        productionRunCount: Number(productionRunCountRow?.count) || 0,
        finalVideoCount: (artifactCounts.video_bgm_stretch || 0) + (artifactCounts.video_bgm || 0) + (artifactCounts.video_stitched || 0)
      },
      resourceSummary: {
        hasSourceImage: Boolean(artifactCounts.source_image),
        hasCleanedImage: Boolean(artifactCounts.cleaned_image),
        hasCroppedImage: Boolean(artifactCounts.cropped_image),
        hasStyleImages: Boolean(artifactCounts.style_image),
        hasSelectedStart: Boolean(task.selected_start_artifact_id),
        hasSelectedEnd: Boolean(task.selected_end_artifact_id),
        hasNarrative: Boolean(task.selected_narrative_id) || (Number(narrativeCountRow?.count) || 0) > 0,
        hasCover: Boolean(task.cover_artifact_id) || Boolean(task.cover_enabled),
        hasProductionRuns: (Number(productionRunCountRow?.count) || 0) > 0,
        hasFinalVideo: Boolean(artifactCounts.video_bgm_stretch || artifactCounts.video_bgm || artifactCounts.video_stitched)
      }
    };
  });
}

async function cleanImageWithGemini({ taskId, sourceArtifact, settings, promptText, onMessage }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }

  const send = (level, message) => {
    addLog(taskId, level, message);
    if (onMessage) {
      onMessage({ type: "log", level, message, timestamp: new Date().toISOString() });
    }
  };

  send("info", `Clean API call start: provider=${settings.provider}, image_model=${settings.image_model}`);
  send("info", `Clean prompt: ${promptText}`);

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: sourceArtifact.mime_type,
              data: sourceArtifact.data.toString("base64")
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.image_model}:generateContent?key=${settings.api_key}`;

  const raw = await new Promise((resolve, reject) => {
    const child = spawn("curl", ["-sS", url, "-H", "Content-Type: application/json", "--data-binary", "@-"], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`curl_exit_${code}: ${stderr || "unknown"}`));
        return;
      }
      if (stderr.trim()) {
        send("info", `curl stderr: ${stderr.trim()}`);
      }
      resolve(stdout);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });

  let response;
  try {
    response = JSON.parse(raw);
  } catch {
    send("error", `Clean API parse failed: ${String(raw).slice(0, 300)}`);
    throw new Error("gemini_clean_parse_failed");
  }

  if (response.error) {
    send("error", `Clean API error: ${response.error.message || "unknown"}`);
    throw new Error(response.error.message || "gemini_clean_api_error");
  }

  const responseParts = response.candidates?.[0]?.content?.parts || [];
  const textPart = responseParts.find((p) => p.text)?.text || collectCandidateText(response) || "";
  const imageCandidate = extractStyleImageCandidate(response);

  if (!imageCandidate?.data) {
    send("error", `Clean API response missing image output. text=${textPart || "<empty>"}`);
    throw new Error("gemini_clean_no_image_output");
  }

  const cleanedData = imageCandidate.data;
  const cleanedMimeType = imageCandidate.mimeType || "image/png";
  const cleanedBuffer = Buffer.from(cleanedData, "base64");
  const cleanedId = insertArtifact(taskId, "cleaned_image", cleanedMimeType, cleanedBuffer, {
    operation: "clean_text_border",
    provider: settings.provider,
    imageModel: settings.image_model,
    promptVersionId: getCleanPromptState().currentVersionId,
    responseText: textPart
  });

  send("success", `Clean API response success: artifact=${cleanedId}`);

  return { artifactId: cleanedId, url: artifactUrl(cleanedId) };
}

async function refineProductionFrameWithGemini({ taskId, role, baseFrameArtifact, referenceFiles, settings, promptText }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }
  const roleKey = role === "start" ? "start" : "end";
  const roleLabel = roleKey === "start" ? "start frame" : "end frame";
  const cleanPrompt = String(promptText || "").trim();
  if (!cleanPrompt) {
    throw new Error("production_refine_prompt_required");
  }
  const refs = Array.isArray(referenceFiles) ? referenceFiles : [];
  addLog(
    taskId,
    "info",
    `[Production Refine] ${roleLabel} start: image_model=${settings.image_model}, references=${refs.length}`
  );

  const parts = [
    {
      text: [
        `Task: refine selected ${roleLabel} image for production.`,
        "The first attached image is the currently selected target frame.",
        "If additional images are attached, treat them as optional visual references.",
        "Keep camera perspective, scene structure, and subject identity coherent unless explicitly changed by prompt.",
        `User prompt: ${cleanPrompt}`
      ].join("\n")
    },
    {
      inline_data: {
        mime_type: baseFrameArtifact.mime_type || "image/png",
        data: baseFrameArtifact.data.toString("base64")
      }
    },
    ...refs.map((file) => ({
      inline_data: {
        mime_type: file.mimetype || "image/png",
        data: file.buffer.toString("base64")
      }
    }))
  ];

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.image_model}:generateContent?key=${settings.api_key}`;
  const raw = await runCurlJson({
    url,
    payload,
    timeoutMs: STYLE_REQUEST_TIMEOUT_MS
  });

  let response;
  try {
    response = JSON.parse(raw);
  } catch {
    throw new Error("gemini_production_refine_parse_failed");
  }
  if (response.error) {
    throw new Error(response.error.message || "gemini_production_refine_api_error");
  }

  const imageCandidate = extractStyleImageCandidate(response);
  if (!imageCandidate?.data) {
    throw new Error("gemini_production_refine_no_image_output");
  }

  const artifactType = roleKey === "start" ? "production_start_image" : "production_end_image";
  const artifactId = insertArtifact(taskId, artifactType, imageCandidate.mimeType, Buffer.from(imageCandidate.data, "base64"), {
    role: roleKey,
    operation: "refine_with_prompt",
    sourceArtifactId: baseFrameArtifact.id,
    referenceCount: refs.length,
    promptText: cleanPrompt,
    provider: settings.provider,
    imageModel: settings.image_model,
    referenceNames: refs.map((file) => file.originalname || "image")
  });

  if (roleKey === "start") {
    db.prepare("UPDATE tasks SET selected_start_artifact_id = ?, updated_at = ? WHERE id = ?").run(artifactId, now(), taskId);
  } else {
    db.prepare("UPDATE tasks SET selected_end_artifact_id = ?, updated_at = ? WHERE id = ?").run(artifactId, now(), taskId);
  }
  addLog(taskId, "success", `[Production Refine] ${roleLabel} success: ${artifactId}`);
  return { role: roleKey, artifactId, url: artifactUrl(artifactId), task: getTask(taskId) };
}

async function generateCoverFrameWithGemini({ taskId, baseArtifact = null, referenceFiles = [], settings, title, promptText }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }
  const coverTitle = String(title || "").trim();
  const userPrompt = String(promptText || "").trim();
  if (!coverTitle) {
    throw new Error("cover_title_required");
  }

  addLog(taskId, "info", `[Cover] Generating cover frame with title: ${coverTitle}`);

  const refs = Array.isArray(referenceFiles)
    ? referenceFiles.filter((file) => file?.buffer && String(file.mimetype || "").startsWith("image/"))
    : [];
  if (!baseArtifact && refs.length === 0) {
    throw new Error("cover_base_image_required");
  }

  const imageParts = [];
  if (baseArtifact?.data) {
    imageParts.push({
      inline_data: {
        mime_type: baseArtifact.mime_type || "image/png",
        data: baseArtifact.data.toString("base64")
      }
    });
  }
  for (const file of refs) {
    imageParts.push({
      inline_data: {
        mime_type: file.mimetype || "image/png",
        data: Buffer.from(file.buffer).toString("base64")
      }
    });
  }

  const parts = [
    {
      text: [
        "Generate a cinematic video cover image.",
        `Use all attached images as references (count=${imageParts.length}).`,
        "The generated image MUST contain clearly readable Chinese text exactly matching this title:",
        `TITLE: ${coverTitle}`,
        "Do not paraphrase, shorten, translate, or change any character in TITLE.",
        "The title text must be rendered naturally into the composition, legible, with good contrast.",
        "No watermark, no extra random text, no subtitles.",
        userPrompt ? `Additional creative prompt: ${userPrompt}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    }
  ];
  parts.push(...imageParts);

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.image_model}:generateContent?key=${settings.api_key}`;
  const raw = await runCurlJson({
    url,
    payload,
    timeoutMs: STYLE_REQUEST_TIMEOUT_MS
  });

  let response;
  try {
    response = JSON.parse(raw);
  } catch {
    throw new Error("gemini_cover_parse_failed");
  }
  if (response.error) {
    throw new Error(response.error.message || "gemini_cover_api_error");
  }

  const imageCandidate = extractStyleImageCandidate(response);
  if (!imageCandidate?.data) {
    throw new Error("gemini_cover_no_image_output");
  }

  const artifactId = insertArtifact(taskId, "cover_frame_image", imageCandidate.mimeType, Buffer.from(imageCandidate.data, "base64"), {
    operation: "cover_frame_generate",
    sourceArtifactId: baseArtifact?.id || null,
    referenceCount: imageParts.length,
    title: coverTitle,
    promptText: userPrompt,
    provider: settings.provider,
    imageModel: settings.image_model
  });

  db.prepare("UPDATE tasks SET cover_enabled = 1, cover_artifact_id = ?, cover_title = ?, cover_prompt = ?, updated_at = ? WHERE id = ?").run(
    artifactId,
    coverTitle,
    userPrompt,
    now(),
    taskId
  );
  addLog(taskId, "success", `[Cover] Cover generated: ${artifactId}`);
  return { artifactId, url: artifactUrl(artifactId), task: getTask(taskId) };
}

function stylePromptsWithCurrentContent(taskId) {
  return db
    .prepare(
      "SELECT p.id, p.name, p.active_lang, p.current_version_id, pv.content_zh, pv.content_en, CASE WHEN p.active_lang = 'zh' THEN COALESCE(NULLIF(pv.content_zh, ''), pv.content_en) ELSE COALESCE(NULLIF(pv.content_en, ''), pv.content_zh) END AS content FROM prompts p LEFT JOIN prompt_versions pv ON pv.id = p.current_version_id WHERE p.task_id = ? AND p.prompt_type = 'style' ORDER BY p.created_at ASC LIMIT 3"
    )
    .all(taskId);
}

function resolvePromptModel(promptModel) {
  const v = String(promptModel || "").trim();
  if (!v || v === "gemini-3.0-flash") return "gemini-2.5-flash";
  if (v === "gemini-3.0-pro") return "gemini-2.5-pro";
  return v;
}

function extractJsonArray(text) {
  const cleaned = String(text || "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fence ? fence[1] : cleaned;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start >= 0 && end > start) {
    return candidate.slice(start, end + 1);
  }
  return candidate;
}

function resolveTaskAspectRatio(taskId) {
  const task = getTask(taskId);
  return task?.aspect_ratio === "16:9" ? "16:9" : "9:16";
}

function splitBilingualContent(value) {
  const text = String(value || "").trim();
  const zhMatch = text.match(/(?:^|\n)\s*中文[:：]\s*([\s\S]*?)(?=\n\s*English\s*:|$)/i);
  const enMatch = text.match(/(?:^|\n)\s*English\s*:\s*([\s\S]*?)$/i);
  return {
    zh: (zhMatch?.[1] || "").trim(),
    en: (enMatch?.[1] || "").trim()
  };
}

function resolvePromptVersionBilingualInput(payload) {
  const zh = String(payload?.contentZh || "").trim();
  const en = String(payload?.contentEn || "").trim();
  if (zh || en) {
    return { zh, en };
  }
  const parsed = splitBilingualContent(payload?.content || "");
  return { zh: parsed.zh, en: parsed.en };
}

function persistNarrativePromptVersions(taskId, payload = {}, source = "user") {
  const values = [
    String(payload.part1 || "").trim(),
    String(payload.part2 || "").trim(),
    String(payload.end || "").trim()
  ];

  NARRATIVE_PROMPT_FIELDS.forEach((field, index) => {
    const [nameZh, nameEn] = field;
    const content = values[index];
    if (!content) return;
    let prompt = db
      .prepare("SELECT * FROM prompts WHERE task_id = ? AND prompt_type = 'narrative' AND name IN (?, ?)")
      .get(taskId, nameZh, nameEn);

    if (!prompt) {
      const promptId = uid("prompt");
      db.prepare(
        "INSERT INTO prompts (id, task_id, prompt_type, name, active_lang, current_version_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)"
      ).run(promptId, taskId, "narrative", nameZh, "zh", now());
      prompt = db.prepare("SELECT * FROM prompts WHERE id = ?").get(promptId);
    }

    const bilingual = splitBilingualContent(content);
    const fallbackZh = bilingual.zh || (!bilingual.en ? content : "");
    const vid = uid("pv");
    db.prepare(
      "INSERT INTO prompt_versions (id, prompt_id, content, content_zh, content_en, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(vid, prompt.id, bilingual.en || fallbackZh, fallbackZh, bilingual.en, source, now());
    db.prepare("UPDATE prompts SET current_version_id = ? WHERE id = ?").run(vid, prompt.id);
  });
}

function getCurrentNarrativePromptContent(taskId, aliases) {
  const row = db
    .prepare(
      "SELECT p.active_lang, pv.content_zh, pv.content_en FROM prompts p LEFT JOIN prompt_versions pv ON pv.id = p.current_version_id WHERE p.task_id = ? AND p.prompt_type = 'narrative' AND p.name IN (?, ?) ORDER BY p.created_at ASC LIMIT 1"
    )
    .get(taskId, aliases[0], aliases[1]);
  if (!row) return "";
  const preferred = row.active_lang === "en" ? row.content_en : row.content_zh;
  return String(preferred || row.content_zh || row.content_en || "").trim();
}

function syncNarrativeOptionFromPromptVersions(taskId) {
  const task = getTask(taskId);
  const targetNarrative = task?.selected_narrative_id
    ? db.prepare("SELECT * FROM narrative_options WHERE task_id = ? AND id = ?").get(taskId, task.selected_narrative_id)
    : db.prepare("SELECT * FROM narrative_options WHERE task_id = ? ORDER BY created_at DESC LIMIT 1").get(taskId);
  if (!targetNarrative) return;

  const part1 =
    getCurrentNarrativePromptContent(taskId, [NARRATIVE_PROMPT_FIELDS[0][0], NARRATIVE_PROMPT_FIELDS[0][1]]) ||
    targetNarrative.part1_prompt;
  const part2 =
    getCurrentNarrativePromptContent(taskId, [NARRATIVE_PROMPT_FIELDS[1][0], NARRATIVE_PROMPT_FIELDS[1][1]]) ||
    targetNarrative.part2_prompt;
  const endFrame =
    getCurrentNarrativePromptContent(taskId, [NARRATIVE_PROMPT_FIELDS[2][0], NARRATIVE_PROMPT_FIELDS[2][1]]) ||
    targetNarrative.end_frame_prompt;

  db.prepare("UPDATE narrative_options SET part1_prompt = ?, part2_prompt = ?, end_frame_prompt = ? WHERE id = ?").run(
    part1,
    part2,
    endFrame,
    targetNarrative.id
  );
}

async function generateStylePromptsWithGemini({ taskId, sourceArtifact, settings, instruction, onMessage }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }

  const send = (level, message) => {
    addLog(taskId, level, message);
    onMessage?.({ type: "log", level, message, timestamp: new Date().toISOString() });
  };

  const modelForCall = resolvePromptModel(settings.prompt_model);
  const taskAspectRatio = resolveTaskAspectRatio(taskId);
  send("info", `Prompt API call start: provider=${settings.provider}, prompt_model=${settings.prompt_model}, resolved=${modelForCall}`);

  const instructionText = (instruction || "").trim() || "Generate 3 style prompts.";
  const promptText = [
    "You are a cinematic style prompt generator.",
    "Return ONLY valid JSON array with exactly 3 items.",
    'Each item must be: {"name":"Style Prompt N","content_zh":"...","content_en":"..."}.',
    "Output both Chinese and English prompts with aligned meaning.",
    "Keep subject identity stable and style diversity clear.",
    `Target aspect ratio for generated images: ${taskAspectRatio}.`,
    `Every prompt content must explicitly preserve ${taskAspectRatio} framing/composition.`,
    `Instruction: ${instructionText}`
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelForCall}:generateContent?key=${settings.api_key}`;
  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: sourceArtifact.mime_type,
              data: sourceArtifact.data.toString("base64")
            }
          }
        ]
      }
    ]
  };

  const raw = await runCurlJson({
    url,
    payload,
    timeoutMs: STYLE_REQUEST_TIMEOUT_MS,
    onStderr: (line) => {
      const text = line.trim();
      if (text) send("info", `curl stderr: ${text}`);
    }
  });

  let response;
  try {
    response = JSON.parse(raw);
  } catch {
    send("error", `Prompt API parse failed: ${String(raw).slice(0, 300)}`);
    throw new Error("gemini_prompt_parse_failed");
  }

  if (response.error) {
    send("error", `Prompt API error: ${response.error.message || "unknown"}`);
    throw new Error(response.error.message || "gemini_prompt_api_error");
  }

  const textPart = (response.candidates?.[0]?.content?.parts || []).find((p) => p.text)?.text || "";
  let parsed;
  try {
    parsed = JSON.parse(extractJsonArray(textPart));
  } catch {
    send("error", `Prompt JSON extraction failed: ${String(textPart).slice(0, 400)}`);
    throw new Error("gemini_prompt_json_invalid");
  }

  if (!Array.isArray(parsed) || parsed.length < 1) {
    throw new Error("gemini_prompt_empty");
  }

  const normalized = parsed.slice(0, 3).map((item, idx) => {
    const fallback = STYLE_SEEDS[idx % STYLE_SEEDS.length];
    const contentZh = String(item?.content_zh || "").trim();
    const contentEn = String(item?.content_en || "").trim();
    return {
      name: String(item?.name || `Style Prompt ${idx + 1}`).trim() || `Style Prompt ${idx + 1}`,
      contentZh: contentZh || fallback.zh,
      contentEn: contentEn || fallback.en
    };
  });
  while (normalized.length < 3) {
    const fallback = STYLE_SEEDS[normalized.length % STYLE_SEEDS.length];
    normalized.push({
      name: `Style Prompt ${normalized.length + 1}`,
      contentZh: fallback.zh,
      contentEn: fallback.en
    });
  }

  const existing = db
    .prepare("SELECT * FROM prompts WHERE task_id = ? AND prompt_type = 'style' ORDER BY created_at ASC")
    .all(taskId);

  const tx = db.transaction(() => {
    for (let i = 0; i < 3; i += 1) {
      const row = normalized[i];
      const existingPrompt = existing[i];
      const at = now();

      if (!existingPrompt) {
        const promptId = uid("prompt");
        const versionId = uid("pv");
        db.prepare(
          "INSERT INTO prompts (id, task_id, prompt_type, name, active_lang, current_version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(promptId, taskId, "style", row.name, "en", versionId, at);
        db.prepare(
          "INSERT INTO prompt_versions (id, prompt_id, content, content_zh, content_en, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(versionId, promptId, row.contentEn || row.contentZh, row.contentZh, row.contentEn, "system", at);
      } else {
        const versionId = uid("pv");
        db.prepare("UPDATE prompts SET name = ?, current_version_id = ? WHERE id = ?").run(row.name, versionId, existingPrompt.id);
        db.prepare(
          "INSERT INTO prompt_versions (id, prompt_id, content, content_zh, content_en, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(versionId, existingPrompt.id, row.contentEn || row.contentZh, row.contentZh, row.contentEn, "system", at);
      }
    }
  });
  tx();

  send("success", `Style prompts generated with ${modelForCall}`);
  return { prompts: buildPromptPayload(taskId) };
}

function extractJsonObject(text) {
  const cleaned = String(text || "").trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fence ? fence[1] : cleaned;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return candidate.slice(start, end + 1);
  }
  return candidate;
}

function collectCandidateText(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

async function generateNarrativePromptsWithGemini({ taskId, sourceArtifact, settings, instruction, onMessage }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }

  const send = (level, message) => {
    addLog(taskId, level, message);
    onMessage?.({ type: "log", level, message, timestamp: new Date().toISOString() });
  };

  const modelForCall = resolvePromptModel(settings.prompt_model);
  const taskAspectRatio = resolveTaskAspectRatio(taskId);
  send(
    "info",
    `Narrative style-prompt API start: provider=${settings.provider}, prompt_model=${settings.prompt_model}, resolved=${modelForCall}`
  );

  const baseInstruction = String(instruction || "").trim();
  const promptText = [
    "You are a creative director for short-video style strategy.",
    "Return ONLY valid JSON array with exactly 3 items.",
    'Each item: {"name":"...","prompt_text":"..."}.',
    "The 3 style names and order are fixed: 宋代留白, 中国武侠, 国画美风.",
    "These are runtime prompt templates used later by another generation step.",
    "Do NOT output final Part1/Part2/End Frame Prompt now.",
    "Do NOT output final end-frame image now.",
    `Every prompt_text must enforce these video requirements: ${NARRATIVE_VIDEO_REQUIREMENTS}`,
    `Aspect ratio target: ${taskAspectRatio}.`,
    baseInstruction ? `Instruction: ${baseInstruction}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const textUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelForCall}:generateContent?key=${settings.api_key}`;
  const textPayload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: sourceArtifact.mime_type,
              data: sourceArtifact.data.toString("base64")
            }
          }
        ]
      }
    ]
  };

  const rawText = await runCurlJson({
    url: textUrl,
    payload: textPayload,
    timeoutMs: STYLE_REQUEST_TIMEOUT_MS,
    onStderr: (line) => {
      const text = line.trim();
      if (text) send("info", `curl stderr: ${text}`);
    }
  });

  let textResponse;
  try {
    textResponse = JSON.parse(rawText);
  } catch {
    send("error", "Narrative style-prompt parse failed");
    throw new Error("gemini_narrative_style_parse_failed");
  }
  if (textResponse.error) {
    send("error", `Narrative style-prompt API error: ${textResponse.error.message || "unknown"}`);
    throw new Error(textResponse.error.message || "gemini_narrative_style_api_error");
  }

  const textPart = (textResponse.candidates?.[0]?.content?.parts || []).find((p) => p.text)?.text || "";
  let parsed;
  try {
    parsed = JSON.parse(extractJsonArray(textPart));
  } catch {
    send("error", `Narrative style-prompt JSON invalid: ${String(textPart).slice(0, 400)}`);
    throw new Error("gemini_narrative_style_json_invalid");
  }

  const rawItems = Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  const normalized = NARRATIVE_STYLE_DEFAULTS.map((styleSeed, idx) => {
    const item = rawItems[idx] || {};
    const generatedText = String(item?.prompt_text || "").trim();
    const baseText = generatedText || styleSeed.prompt_text;
    const withRequirements = baseText.includes("固定视频生成要求") ? baseText : `${baseText}\n\n固定视频生成要求：${NARRATIVE_VIDEO_REQUIREMENTS}`;
    return {
      prompt_index: idx + 1,
      name: styleSeed.name,
      prompt_text: withRequirements
    };
  });

  const existing = ensureNarrativeStylePrompts(taskId);
  const tx = db.transaction(() => {
    for (let i = 0; i < 3; i += 1) {
      const row = normalized[i];
      const existingRow = existing[i];
      if (existingRow) {
        db.prepare("UPDATE narrative_style_prompts SET name = ?, prompt_text = ?, updated_at = ? WHERE id = ?").run(
          row.name,
          row.prompt_text,
          now(),
          existingRow.id
        );
      }
    }
  });
  tx();

  const items = getNarrativeStylePrompts(taskId);
  items.forEach((item, i) => {
    onMessage?.({ type: "item_saved", kind: "narrative_style_prompt", index: i + 1, promptId: item.id, timestamp: new Date().toISOString() });
  });
  send("success", `Narrative style-prompts generated with ${modelForCall}`);
  return { narrativeStylePrompts: items };
}

async function generateNarrativeEndFramesWithGemini({ taskId, sourceArtifact, settings, generationInstruction, onMessage }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }

  const stylePrompts = getNarrativeStylePrompts(taskId);
  if (stylePrompts.length === 0) {
    throw new Error("narrative_style_prompts_required");
  }

  const send = (level, message) => {
    addLog(taskId, level, message);
    onMessage?.({ type: "log", level, message, timestamp: new Date().toISOString() });
  };

  const promptModelForCall = resolvePromptModel(settings.prompt_model);
  const imageModelForCall = settings.image_model;
  const taskAspectRatio = resolveTaskAspectRatio(taskId);
  const instruction = String(generationInstruction || "").trim();
  send(
    "info",
    `Narrative execution start: prompt_model=${promptModelForCall}, image_model=${imageModelForCall}, prompts=${stylePrompts.length}, aspect_ratio=${taskAspectRatio}`
  );

  db.prepare("DELETE FROM artifacts WHERE task_id = ? AND type = 'narrative_end_frame_image'").run(taskId);
  db.prepare("DELETE FROM narrative_options WHERE task_id = ?").run(taskId);

  for (let i = 0; i < stylePrompts.length; i += 1) {
    const stylePrompt = stylePrompts[i];
    const index = i + 1;
    send("info", `Narrative ${index}/3 generating scripts from runtime prompt: ${stylePrompt.name}`);

    const textUrl = `https://generativelanguage.googleapis.com/v1beta/models/${promptModelForCall}:generateContent?key=${settings.api_key}`;
    const textPrompt = [
      "You are generating one narrative scene for a two-part short video loop.",
      "Return ONLY valid JSON object with keys:",
      '{"title":"...","description":"...","part1_prompt":"...","part2_prompt":"...","end_frame_prompt":"..."}',
      "Do not include markdown, explanation, or extra keys.",
      `Target aspect ratio for all prompts: ${taskAspectRatio}.`,
      instruction ? `Generation instruction: ${instruction}` : "",
      `Runtime style prompt: ${stylePrompt.prompt_text}`
    ]
      .filter(Boolean)
      .join("\n");

    const rawText = await runCurlJson({
      url: textUrl,
      payload: {
        contents: [
          {
            parts: [
              { text: textPrompt },
              {
                inline_data: {
                  mime_type: sourceArtifact.mime_type,
                  data: sourceArtifact.data.toString("base64")
                }
              }
            ]
          }
        ]
      },
      timeoutMs: STYLE_REQUEST_TIMEOUT_MS,
      onStderr: (line) => {
        const text = line.trim();
        if (text) send("info", `curl stderr: ${text}`);
      }
    });

    let textResponse;
    try {
      textResponse = JSON.parse(rawText);
    } catch {
      throw new Error(`gemini_narrative_text_parse_failed_scene_${index}`);
    }
    if (textResponse.error) {
      throw new Error(textResponse.error.message || `gemini_narrative_text_api_error_scene_${index}`);
    }

    const sceneText = (textResponse.candidates?.[0]?.content?.parts || []).find((p) => p.text)?.text || "";
    let sceneJson;
    try {
      sceneJson = JSON.parse(extractJsonObject(sceneText));
    } catch {
      throw new Error(`gemini_narrative_text_json_invalid_scene_${index}`);
    }

    const fallback = NARRATIVE_SEEDS[(index - 1) % NARRATIVE_SEEDS.length];
    const title = String(sceneJson?.title || stylePrompt.name || fallback.title).trim() || `Narrative ${index}`;
    const description = String(sceneJson?.description || fallback.description).trim() || fallback.description;
    const part1Prompt = String(sceneJson?.part1_prompt || sceneJson?.part1 || fallback.part1).trim() || fallback.part1;
    const part2Prompt = String(sceneJson?.part2_prompt || sceneJson?.part2 || fallback.part2).trim() || fallback.part2;
    const endFramePrompt = String(sceneJson?.end_frame_prompt || sceneJson?.end || fallback.end).trim() || fallback.end;

    send("info", `Narrative ${index}/3 generating tail frame image`);

    const imageUrl = `https://generativelanguage.googleapis.com/v1beta/models/${imageModelForCall}:generateContent?key=${settings.api_key}`;
    const imagePayload = {
      contents: [
        {
          parts: [
            {
              text: [
                `Scene ${index} tail frame generation task.`,
                "The attached image is the required first frame (start frame).",
                "Generate the tail frame based on this same scene timeline.",
                "Keep subject identity, environment structure, camera perspective, and visual style continuous with the first frame.",
                `Tail-frame prompt: ${endFramePrompt}`
              ].join("\n")
            },
            {
              inline_data: {
                mime_type: sourceArtifact.mime_type,
                data: sourceArtifact.data.toString("base64")
              }
            }
          ]
        }
      ],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    };

    const rawImage = await runCurlJson({
      url: imageUrl,
      payload: imagePayload,
      timeoutMs: STYLE_REQUEST_TIMEOUT_MS,
      onStderr: (line) => {
        const text = line.trim();
        if (text) send("info", `curl stderr: ${text}`);
      }
    });

    let imageResponse;
    try {
      imageResponse = JSON.parse(rawImage);
    } catch {
      send("error", `End-frame parse failed scene ${index}`);
      throw new Error("gemini_narrative_endframe_parse_failed");
    }
    if (imageResponse.error) {
      send("error", `End-frame API error scene ${index}: ${imageResponse.error.message || "unknown"}`);
      throw new Error(imageResponse.error.message || "gemini_narrative_endframe_api_error");
    }

    const imageParts = imageResponse.candidates?.[0]?.content?.parts || [];
    const imagePart = imageParts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const imageData = imagePart?.inlineData?.data || imagePart?.inline_data?.data;
    if (!imageData) {
      throw new Error(`gemini_narrative_endframe_no_image_scene_${index}`);
    }
    const imageMime = imagePart?.inlineData?.mimeType || imagePart?.inline_data?.mime_type || "image/png";
    const endFrameArtifactId = insertArtifact(taskId, "narrative_end_frame_image", imageMime, Buffer.from(imageData, "base64"), {
      scene_index: index,
      narrative_title: title,
      end_frame_prompt: endFramePrompt,
      provider: settings.provider,
      imageModel: imageModelForCall
    });

    const narrativeId = uid("narrative");
    db.prepare(
      "INSERT INTO narrative_options (id, task_id, title, description, part1_prompt, part2_prompt, end_frame_prompt, end_frame_artifact_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(narrativeId, taskId, title, description, part1Prompt, part2Prompt, endFramePrompt, endFrameArtifactId, now());

    onMessage?.({
      type: "item_saved",
      kind: "narrative_scene",
      index,
      narrativeId,
      endFrameArtifactId,
      endFrameUrl: artifactUrl(endFrameArtifactId),
      timestamp: new Date().toISOString()
    });
    send("success", `Narrative ${index}/3 saved`);
  }

  db.prepare("UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?").run("GENERATION", now(), taskId);

  return {
    narratives: db
      .prepare("SELECT * FROM narrative_options WHERE task_id = ? ORDER BY created_at ASC")
      .all(taskId)
      .map((n) => ({ ...n, end_frame_url: n.end_frame_artifact_id ? artifactUrl(n.end_frame_artifact_id) : null }))
  };
}

function runCurlJsonOnce({ url, payload, timeoutMs, onStderr }) {
  return new Promise((resolve, reject) => {
    const curlArgs = [
      "-sS",
      "--http1.1",
      url,
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      "@-"
    ];
    const child = spawn("curl", curlArgs, {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      const part = chunk.toString();
      stderr += part;
      onStderr?.(part);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("style_request_timeout"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`curl_exit_${code}: ${stderr || "unknown"}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function isTransientCurlError(error) {
  const msg = String(error?.message || "");
  return (
    msg.includes("style_request_timeout") ||
    msg.includes("veo_operation_poll_timeout") ||
    msg.includes("curl_exit_") ||
    msg.includes("socket") ||
    msg.includes("ECONN") ||
    msg.includes("ETIMEDOUT")
  );
}

async function runCurlJson({ url, payload, timeoutMs, onStderr, maxAttempts = 2, retryDelayMs = 800 }) {
  const totalAttempts = Math.max(1, Number(maxAttempts) || 1);
  let lastError = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await runCurlJsonOnce({ url, payload, timeoutMs, onStderr });
    } catch (error) {
      lastError = error;
      const retryable = isTransientCurlError(error);
      if (!retryable || attempt >= totalAttempts) {
        throw error;
      }
      onStderr?.(`runCurlJson retry ${attempt}/${totalAttempts - 1}: ${error?.message || String(error)}\n`);
      await sleep(retryDelayMs);
    }
  }
  throw lastError || new Error("curl_json_unknown_error");
}

function extractFirstJsonObjectString(rawText) {
  const text = String(rawText || "").trim();
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("json_object_not_found");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  throw new Error("json_object_unclosed");
}

function parseJsonObjectSafe(rawText, contextLabel, onLog) {
  const raw = String(rawText || "").trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    try {
      const firstObj = extractFirstJsonObjectString(raw);
      const parsed = JSON.parse(firstObj);
      if (raw !== firstObj) {
        onLog?.(
          "warn",
          `${contextLabel} response contained extra trailing bytes; recovered first JSON object (raw_len=${raw.length}, json_len=${firstObj.length})`
        );
      }
      return parsed;
    } catch {
      const snippet = raw.slice(0, 500).replace(/\s+/g, " ");
      onLog?.("error", `${contextLabel} parse failed. raw_head=${snippet}`);
      throw error;
    }
  }
}

function extractStyleImageCandidate(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const data = part?.inlineData?.data || part?.inline_data?.data;
      if (!data) {
        continue;
      }
      return {
        data,
        mimeType: part?.inlineData?.mimeType || part?.inline_data?.mime_type || "image/png"
      };
    }
  }
  return null;
}

async function generateStyleImagesWithGemini({ taskId, sourceArtifact, settings, onMessage }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }

  const stylePrompts = stylePromptsWithCurrentContent(taskId);
  const taskAspectRatio = resolveTaskAspectRatio(taskId);
  const styleActionSettings = getStyleActionSettings();
  if (stylePrompts.length === 0) {
    throw new Error("style_prompt_required");
  }

  const send = (level, message) => {
    addLog(taskId, level, message);
    onMessage?.({ type: "log", level, message, timestamp: new Date().toISOString() });
  };

  const sendHeartbeat = (message, meta = {}) => {
    onMessage?.({ type: "heartbeat", message, timestamp: new Date().toISOString(), ...meta });
  };

  send(
    "info",
    `Style API call start: provider=${settings.provider}, image_model=${settings.image_model}, prompts=${stylePrompts.length}, aspect_ratio=${taskAspectRatio}, timeout=${Math.ceil(
      STYLE_REQUEST_TIMEOUT_MS / 1000
    )}s`
  );

  db.prepare("DELETE FROM artifacts WHERE task_id = ? AND type = 'style_image'").run(taskId);
  db.prepare("UPDATE tasks SET selected_start_artifact_id = NULL, phase = ?, updated_at = ? WHERE id = ?").run("STYLE", now(), taskId);

  const created = [];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.image_model}:generateContent?key=${settings.api_key}`;

  for (let i = 0; i < stylePrompts.length; i += 1) {
    const prompt = stylePrompts[i];
    const promptText = (prompt.content || "").trim();
    if (!promptText) {
      throw new Error(`style_prompt_content_required:${prompt.id}`);
    }

    const index = i + 1;
    send("info", `Style ${index}/${stylePrompts.length} start: ${prompt.name} (lang=${prompt.active_lang === "zh" ? "zh" : "en"})`);

    let successItem = null;
    for (let attempt = 1; attempt <= STYLE_MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      const retryInstruction =
        attempt === 1
          ? styleActionSettings.style_image_instruction
          : `${styleActionSettings.style_image_instruction}\n\nIMPORTANT: Return exactly one generated image and no text-only output.`;

      const payload = {
        contents: [
          {
            parts: [
              {
                text: `${promptText}\n\nTarget Aspect Ratio: ${taskAspectRatio}. The generated frame must strictly follow ${taskAspectRatio} composition.\n\nStyle-Image Instruction: ${retryInstruction}`
              },
              {
                inline_data: {
                  mime_type: sourceArtifact.mime_type,
                  data: sourceArtifact.data.toString("base64")
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseModalities: ["IMAGE"]
        }
      };

      const heartbeat = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        const msg = `Style ${index}/${stylePrompts.length} attempt ${attempt}/${STYLE_MAX_ATTEMPTS} running ${elapsed}s`;
        sendHeartbeat(msg, {
          promptId: prompt.id,
          promptIndex: index,
          attempt,
          maxAttempts: STYLE_MAX_ATTEMPTS,
          elapsedSeconds: elapsed
        });
      }, STYLE_HEARTBEAT_MS);

      let raw;
      try {
        raw = await runCurlJson({
          url,
          payload,
          timeoutMs: STYLE_REQUEST_TIMEOUT_MS,
          onStderr: (line) => {
            const text = line.trim();
            if (text) {
              send("info", `curl stderr: ${text}`);
            }
          }
        });
      } catch (error) {
        clearInterval(heartbeat);
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        if (error.message === "style_request_timeout") {
          const msg = `Style ${index}/${stylePrompts.length} attempt ${attempt}/${STYLE_MAX_ATTEMPTS} timeout after ${Math.ceil(
            STYLE_REQUEST_TIMEOUT_MS / 1000
          )}s (elapsed=${elapsed}s)`;
          send("error", msg);
          onMessage?.({
            type: "timeout",
            message: msg,
            promptId: prompt.id,
            promptIndex: index,
            attempt,
            maxAttempts: STYLE_MAX_ATTEMPTS,
            timeoutMs: STYLE_REQUEST_TIMEOUT_MS,
            timestamp: new Date().toISOString()
          });
        }
        if (attempt >= STYLE_MAX_ATTEMPTS) {
          throw error;
        }
        send("warn", `Style ${index}/${stylePrompts.length} attempt ${attempt} failed, retrying`);
        continue;
      }

      let response;
      try {
        response = JSON.parse(raw);
      } catch {
        clearInterval(heartbeat);
        send("error", `Style API parse failed: ${String(raw).slice(0, 300)}`);
        if (attempt >= STYLE_MAX_ATTEMPTS) {
          throw new Error("gemini_style_parse_failed");
        }
        send("warn", `Style ${index}/${stylePrompts.length} attempt ${attempt} parse failed, retrying`);
        continue;
      }

      if (response.error) {
        clearInterval(heartbeat);
        send("error", `Style API error: ${response.error.message || "unknown"}`);
        if (attempt >= STYLE_MAX_ATTEMPTS) {
          throw new Error(response.error.message || "gemini_style_api_error");
        }
        send("warn", `Style ${index}/${stylePrompts.length} attempt ${attempt} returned API error, retrying`);
        continue;
      }

      const imageCandidate = extractStyleImageCandidate(response);
      if (!imageCandidate?.data) {
        clearInterval(heartbeat);
        send("error", `Style API response missing image output (attempt ${attempt}/${STYLE_MAX_ATTEMPTS})`);
        if (attempt >= STYLE_MAX_ATTEMPTS) {
          throw new Error("gemini_style_no_image_output");
        }
        send("warn", `Style ${index}/${stylePrompts.length} attempt ${attempt} returned no image, retrying`);
        continue;
      }

      clearInterval(heartbeat);
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      successItem = {
        prompt,
        styleMimeType: imageCandidate.mimeType,
        styleBuffer: Buffer.from(imageCandidate.data, "base64")
      };
      send(
        "success",
        `Style ${index}/${stylePrompts.length} success in ${elapsed}s (attempt ${attempt}/${STYLE_MAX_ATTEMPTS})`
      );
      break;
    }

    if (!successItem) {
      throw new Error("gemini_style_generation_failed");
    }

    const styleId = insertArtifact(taskId, "style_image", successItem.styleMimeType, successItem.styleBuffer, {
      promptId: successItem.prompt.id,
      promptVersionId: successItem.prompt.current_version_id,
      provider: settings.provider,
      imageModel: settings.image_model,
      sourceArtifactId: sourceArtifact.id,
      styleImageInstruction: styleActionSettings.style_image_instruction,
      taskAspectRatio
    });
    created.push(styleId);

    const artifact = db
      .prepare("SELECT id, task_id, type, mime_type, meta_json, created_at FROM artifacts WHERE id = ?")
      .get(styleId);
    if (artifact) {
      onMessage?.({
        type: "style_image_created",
        promptId: successItem.prompt.id,
        promptIndex: index,
        artifact: {
          ...artifact,
          url: artifactUrl(artifact.id),
          meta: artifact.meta_json ? JSON.parse(artifact.meta_json) : {}
        },
        timestamp: new Date().toISOString()
      });
    }
  }

  db.prepare("UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?").run("NARRATIVE", now(), taskId);
  send("success", `Style images generated (${settings.image_model})`);
  return { artifactIds: created };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureFfmpegReady() {
  await new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, ["-version"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg_not_available:${stderr || code}`));
      }
    });
  });
}

async function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`cmd_exit_${code}:${stderr || stdout}`));
      }
    });
  });
}

async function runCurlGetText({ url, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["-sS", "--http1.1", "-L", url], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("veo_operation_poll_timeout"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`curl_get_exit_${code}:${stderr || "unknown"}`));
        return;
      }
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

async function runCurlGetBuffer({ url, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", ["-sS", "--http1.1", "-L", url], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("veo_download_timeout"));
        return;
      }
      if (code !== 0) {
        reject(new Error(`curl_download_exit_${code}:${stderr || "unknown"}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function fetchVideoBytes(video, apiKey) {
  if (video?.videoBytes) {
    return {
      buffer: Buffer.from(video.videoBytes, "base64"),
      mimeType: video.mimeType || "video/mp4"
    };
  }
  if (!video?.uri) {
    throw new Error("veo_video_missing_uri");
  }

  const withKey = video.uri.includes("key=") ? video.uri : `${video.uri}${video.uri.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
  const arrayBuffer = await runCurlGetBuffer({ url: withKey, timeoutMs: STYLE_REQUEST_TIMEOUT_MS });
  return {
    buffer: arrayBuffer,
    mimeType: video.mimeType || "video/mp4"
  };
}

async function generateVideoWithVeo({ settings, prompt, startImageArtifact, endImageArtifact = null, aspectRatio, onLog }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }
  const startImage = artifactToVeoImagePayload(startImageArtifact);
  if (!startImage) {
    onLog?.("error", "Missing start frame image; prompt-only video generation is forbidden");
    throw new Error("veo_start_frame_required");
  }
  const endImage = endImageArtifact ? artifactToVeoImagePayload(endImageArtifact) : null;
  if (endImageArtifact && !endImage) {
    onLog?.("error", "Missing end frame image; prompt-only video generation is forbidden");
    throw new Error("veo_end_frame_required");
  }

  const startSha = startImageArtifact?.data
    ? createHash("sha256").update(startImageArtifact.data).digest("hex").slice(0, 12)
    : "-";
  const endSha = endImageArtifact?.data
    ? createHash("sha256").update(endImageArtifact.data).digest("hex").slice(0, 12)
    : "-";

  onLog?.(
    "info",
    `VEO request start: model=${settings.video_model}, aspect_ratio=${aspectRatio}, start_frame=yes, end_frame=${endImage ? "yes" : "no"}`
  );
  onLog?.(
    "info",
    `VEO frame proof: start_id=${startImageArtifact?.id || "-"}, end_id=${endImageArtifact?.id || "-"}, start_mime=${startImageArtifact?.mime_type || "-"}, end_mime=${endImageArtifact?.mime_type || "-"}, start_sha12=${startSha}, end_sha12=${endSha}`
  );
  onLog?.("info", `VEO payload proof: fields=${endImage ? "image,lastFrame" : "image"}`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.video_model}:predictLongRunning?key=${settings.api_key}`;
  const instance = {
    prompt,
    image: startImage
  };
  if (endImage) {
    instance.lastFrame = endImage;
  }
  const payload = {
    instances: [
      instance
    ],
    parameters: {
      sampleCount: 1,
      aspectRatio
    }
  };

  const startedRaw = await runCurlJson({
    url,
    payload,
    timeoutMs: STYLE_REQUEST_TIMEOUT_MS
  });
  const started = parseJsonObjectSafe(startedRaw, "VEO start", onLog);

  if (started.error) {
    const msg = started.error?.message || "veo_start_failed";
    if (isFrameFieldUnsupported(msg)) {
      onLog?.(
        "error",
        `Current VEO model does not support required start/end frame transport; aborted. model=${settings.video_model}. Supported models: ${frameCapableModelsText()}`
      );
      throw new Error(`veo_frame_transport_not_supported:${msg}`);
    }
    throw new Error(msg);
  }
  if (!started.name) {
    throw new Error("veo_operation_name_missing");
  }

  const startedAt = Date.now();
  let operation = started;
  while (!operation.done) {
    if (Date.now() - startedAt > VEO_MAX_WAIT_MS) {
      throw new Error("veo_operation_timeout");
    }
    await sleep(VEO_POLL_INTERVAL_MS);
    const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operation.name}?key=${settings.api_key}`;
    const polledRaw = await runCurlGetText({ url: pollUrl, timeoutMs: STYLE_REQUEST_TIMEOUT_MS });
    operation = parseJsonObjectSafe(polledRaw, "VEO poll", onLog);
    onLog?.("info", `VEO operation polling: ${operation.name || "unnamed_operation"}`);
  }

  if (operation.error) {
    const msg = operation.error?.message || JSON.stringify(operation.error);
    throw new Error(`veo_operation_failed:${msg}`);
  }

  const video = operation.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
  if (!video) {
    throw new Error("veo_no_video_generated");
  }

  const bytes = await fetchVideoBytes(video, settings.api_key);
  onLog?.("success", `VEO video ready: ${bytes.mimeType}`);
  return bytes;
}

async function extractLastFrameWithFfmpeg(videoBuffer, outputExt = "jpg") {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-ffmpeg-"));
  const inputPath = path.join(tempDir, "input.mp4");
  const outputPath = path.join(tempDir, `last.${outputExt}`);
  await fs.writeFile(inputPath, videoBuffer);
  await runCmd(FFMPEG_BIN, ["-y", "-sseof", "-0.1", "-i", inputPath, "-frames:v", "1", outputPath]);
  const frameBuffer = await fs.readFile(outputPath);
  await fs.rm(tempDir, { recursive: true, force: true });
  return {
    buffer: frameBuffer,
    mimeType: outputExt === "png" ? "image/png" : "image/jpeg"
  };
}

async function concatVideosWithFfmpeg(videoA, videoB) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-concat-"));
  const inputA = path.join(tempDir, "a.mp4");
  const inputB = path.join(tempDir, "b.mp4");
  const output = path.join(tempDir, "stitched.mp4");
  await fs.writeFile(inputA, videoA);
  await fs.writeFile(inputB, videoB);
  await runCmd(FFMPEG_BIN, [
    "-y",
    "-i",
    inputA,
    "-i",
    inputB,
    "-filter_complex",
    "[0:v:0][1:v:0]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    output
  ]);
  const stitched = await fs.readFile(output);
  await fs.rm(tempDir, { recursive: true, force: true });
  return {
    buffer: stitched,
    mimeType: "video/mp4"
  };
}

function parseDurationFromFfmpegLog(logText) {
  const m = String(logText || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const s = Number(m[3]);
  if (![h, mm, s].every(Number.isFinite)) return null;
  return h * 3600 + mm * 60 + s;
}

async function detectAudioDurationSeconds(audioPath) {
  const { stderr } = await runCmd(FFMPEG_BIN, ["-hide_banner", "-i", audioPath, "-t", "0.01", "-f", "null", "-"]);
  const duration = parseDurationFromFfmpegLog(stderr);
  if (!duration || duration <= 0) {
    throw new Error("bgm_audio_duration_detect_failed");
  }
  return duration;
}

async function detectVideoDurationSeconds(videoBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-video-duration-"));
  const videoPath = path.join(tempDir, "input.mp4");
  try {
    await fs.writeFile(videoPath, videoBuffer);
    const { stderr } = await runCmd(FFMPEG_BIN, ["-hide_banner", "-i", videoPath, "-t", "0.01", "-f", "null", "-"]);
    const duration = parseDurationFromFfmpegLog(stderr);
    if (!duration || duration <= 0) {
      throw new Error("bgm_video_duration_detect_failed");
    }
    return duration;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function parseVideoResolutionFromFfmpegLog(logText) {
  const lines = String(logText || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("Video:")) continue;
    const m = line.match(/(\d{2,5})x(\d{2,5})/);
    if (!m) continue;
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      continue;
    }
    return { width, height };
  }
  return null;
}

async function detectVideoResolution(videoBuffer) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-video-size-"));
  const videoPath = path.join(tempDir, "input.mp4");
  try {
    await fs.writeFile(videoPath, videoBuffer);
    const { stderr } = await runCmd(FFMPEG_BIN, ["-hide_banner", "-i", videoPath, "-t", "0.01", "-f", "null", "-"]);
    const size = parseVideoResolutionFromFfmpegLog(stderr);
    if (!size?.width || !size?.height) {
      throw new Error("bgm_video_resolution_detect_failed");
    }
    return size;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function detectSilenceIntervals(audioPath) {
  const { stderr } = await runCmd(FFMPEG_BIN, [
    "-hide_banner",
    "-i",
    audioPath,
    "-af",
    "silencedetect=noise=-32dB:d=0.28",
    "-f",
    "null",
    "-"
  ]);
  const lines = String(stderr || "").split(/\r?\n/);
  const intervals = [];
  let activeStart = null;
  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      activeStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch && activeStart !== null) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > activeStart) {
        intervals.push({ start: activeStart, end });
      }
      activeStart = null;
    }
  }
  return intervals.sort((a, b) => a.start - b.start);
}

function buildNonSilentSegments(totalDuration, silenceIntervals) {
  const segments = [];
  let cursor = 0;
  for (const interval of silenceIntervals) {
    const start = Math.max(0, interval.start);
    const end = Math.max(start, interval.end);
    if (start > cursor + 0.05) {
      segments.push({ start: cursor, end: start });
    }
    cursor = Math.max(cursor, end);
  }
  if (totalDuration > cursor + 0.05) {
    segments.push({ start: cursor, end: totalDuration });
  }
  return segments.filter((seg) => seg.end - seg.start >= 0.4);
}

function selectAutoPhraseSegment({ totalDuration, targetDuration, nonSilentSegments, silenceIntervals }) {
  if (!nonSilentSegments.length) {
    return {
      startSeconds: 0,
      sourceDurationSeconds: Math.min(totalDuration, targetDuration),
      playbackRate: Math.min(1.15, Math.max(0.85, Math.min(totalDuration, targetDuration) / targetDuration)),
      score: 9.99
    };
  }

  let best = null;
  const maxJoin = 6;
  for (let i = 0; i < nonSilentSegments.length; i += 1) {
    for (let j = i; j < Math.min(nonSilentSegments.length, i + maxJoin); j += 1) {
      const start = nonSilentSegments[i].start;
      const end = nonSilentSegments[j].end;
      const phraseDuration = end - start;
      if (phraseDuration < targetDuration * 0.75 || phraseDuration > targetDuration * 1.4) {
        continue;
      }

      const desiredRate = phraseDuration / targetDuration;
      const clippedRate = normalizePlaybackRate(desiredRate, 1);
      const clipPenalty = Math.abs(desiredRate - clippedRate) * 6;
      const lengthPenalty = Math.abs(phraseDuration - targetDuration) / Math.max(targetDuration, 0.001);
      const ratePenalty = Math.abs(clippedRate - 1);
      const startPenalty = start / Math.max(totalDuration, 1);
      const innerSilence = silenceIntervals
        .map((sil) => Math.max(0, Math.min(end, sil.end) - Math.max(start, sil.start)))
        .reduce((sum, n) => sum + n, 0);
      const silencePenalty = innerSilence / Math.max(phraseDuration, 0.001);
      const score = clipPenalty + lengthPenalty * 1.4 + ratePenalty * 1.2 + startPenalty * 0.1 + silencePenalty * 0.6;

      if (!best || score < best.score) {
        best = {
          startSeconds: start,
          sourceDurationSeconds: phraseDuration,
          playbackRate: clippedRate,
          score
        };
      }
    }
  }

  if (best) return best;

  const fallbackLength = Math.min(totalDuration, targetDuration);
  return {
    startSeconds: 0,
    sourceDurationSeconds: fallbackLength,
    playbackRate: normalizePlaybackRate(fallbackLength / targetDuration, 1),
    score: 8.88
  };
}

async function renderBgmPreviewAudio({ audioBuffer, startSeconds, sourceDurationSeconds, targetDurationSeconds, playbackRate }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-bgm-preview-"));
  const inputPath = path.join(tempDir, "input.mp3");
  const outputPath = path.join(tempDir, "preview.m4a");
  try {
    await fs.writeFile(inputPath, audioBuffer);
    const target = normalizeDurationSeconds(targetDurationSeconds, 16);
    const rate = normalizePlaybackRate(playbackRate, 1);
    const sourceDur = Math.max(0.2, sourceDurationSeconds);
    const fadeDuration = Math.max(0.08, Math.min(0.2, target * 0.08));
    const fadeOutStart = Math.max(0, target - fadeDuration);

    const filters = [
      `atrim=start=${startSeconds.toFixed(3)}:end=${(startSeconds + sourceDur).toFixed(3)}`,
      "asetpts=PTS-STARTPTS"
    ];
    if (Math.abs(rate - 1) > 0.003) {
      filters.push(...atempoFilterChain(rate));
    }
    filters.push(`apad=pad_dur=${target.toFixed(3)}`);
    filters.push(`afade=t=in:st=0:d=${fadeDuration.toFixed(3)}`);
    filters.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeDuration.toFixed(3)}`);

    await runCmd(FFMPEG_BIN, [
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      `[0:a]${filters.join(",")}[aout]`,
      "-map",
      "[aout]",
      "-t",
      target.toFixed(3),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      outputPath
    ]);

    return {
      buffer: await fs.readFile(outputPath),
      mimeType: "audio/mp4",
      targetDurationSeconds: target,
      playbackRate: rate
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function composeVideoWithPreparedAudio({ videoBuffer, audioBuffer, durationSeconds }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-bgm-compose-"));
  const videoPath = path.join(tempDir, "input.mp4");
  const audioPath = path.join(tempDir, "preview.m4a");
  const outputPath = path.join(tempDir, "bgm_mix.mp4");
  try {
    await fs.writeFile(videoPath, videoBuffer);
    await fs.writeFile(audioPath, audioBuffer);
    const targetDuration = normalizeDurationSeconds(durationSeconds, 16);
    await runCmd(FFMPEG_BIN, [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-t",
      targetDuration.toFixed(3),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath
    ]);
    return {
      buffer: await fs.readFile(outputPath),
      mimeType: "video/mp4",
      durationSeconds: targetDuration
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function composeVideoByAudioSegment({
  videoBuffer,
  audioBuffer,
  audioStartSeconds,
  audioEndSeconds,
  audioPlaybackRate,
  targetMusicDurationSeconds,
  coverImageBuffer = null,
  coverDurationSeconds = 1
}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-bgm-stretch-"));
  const videoPath = path.join(tempDir, "input.mp4");
  const audioPath = path.join(tempDir, "input_audio.mp3");
  const coverPath = path.join(tempDir, "cover.png");
  const outputPath = path.join(tempDir, "output.mp4");
  try {
    await fs.writeFile(videoPath, videoBuffer);
    await fs.writeFile(audioPath, audioBuffer);
    const useCover = Boolean(coverImageBuffer);
    if (useCover) {
      await fs.writeFile(coverPath, coverImageBuffer);
    }

    const start = Math.max(0, Number(audioStartSeconds) || 0);
    const end = Math.max(start + 0.05, Number(audioEndSeconds) || start + 0.05);
    const clipDuration = end - start;
    const hasTargetDuration = Number.isFinite(targetMusicDurationSeconds) && targetMusicDurationSeconds > 0;
    const effectiveAudioRate = hasTargetDuration
      ? normalizeSegmentPlaybackRate(clipDuration / targetMusicDurationSeconds, 1)
      : normalizeSegmentPlaybackRate(audioPlaybackRate, 1);
    const finalMusicDuration = clipDuration / Math.max(effectiveAudioRate, 0.001);
    const coverDuration = useCover ? Math.max(0.2, Math.min(8, Number(coverDurationSeconds) || 1)) : 0;
    const maxTransition = useCover ? Math.min(0.45, Math.max(0, coverDuration - 0.06), Math.max(0, finalMusicDuration * 0.24)) : 0;
    const transitionDuration = useCover ? Math.max(0, maxTransition) : 0;
    const videoBodyDuration = useCover ? finalMusicDuration - coverDuration + transitionDuration : finalMusicDuration;
    if (videoBodyDuration <= 0.08) {
      throw new Error("bgm_cover_duration_exceeds_music_duration");
    }
    const videoDuration = await detectVideoDurationSeconds(videoBuffer);
    const videoResolution = await detectVideoResolution(videoBuffer);
    const outputWidth = Math.max(2, Math.floor(videoResolution.width / 2) * 2);
    const outputHeight = Math.max(2, Math.floor(videoResolution.height / 2) * 2);
    const stretchRatio = videoBodyDuration / Math.max(videoDuration, 0.001);
    const videoSpeed = Math.max(0.25, Math.min(4, 1 / Math.max(stretchRatio, 0.001)));

    const audioFilters = [
      `atrim=start=${start.toFixed(3)}:end=${end.toFixed(3)}`,
      "asetpts=PTS-STARTPTS"
    ];
    if (Math.abs(effectiveAudioRate - 1) > 0.003) {
      audioFilters.push(...atempoFilterChain(effectiveAudioRate));
    }
    audioFilters.push(`afade=t=in:st=0:d=0.12`);
    audioFilters.push(`afade=t=out:st=${Math.max(0, finalMusicDuration - 0.12).toFixed(3)}:d=0.12`);

    const ffmpegArgs = ["-y", "-i", videoPath, "-i", audioPath];
    if (useCover) {
      ffmpegArgs.push("-loop", "1", "-t", coverDuration.toFixed(3), "-i", coverPath);
    }
    const filterComplex = useCover
      ? `[0:v]setpts=${stretchRatio.toFixed(8)}*PTS,fps=30,scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight},setsar=1,format=yuv420p,trim=duration=${videoBodyDuration.toFixed(3)}[vmain];[2:v]fps=30,scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight},setsar=1,format=yuv420p,trim=duration=${coverDuration.toFixed(3)}[vcover];[vcover][vmain]xfade=transition=wipeleft:duration=${transitionDuration.toFixed(3)}:offset=${Math.max(0, coverDuration - transitionDuration).toFixed(3)},format=yuv420p[v];[1:a]${audioFilters.join(",")}[a]`
      : `[0:v]setpts=${stretchRatio.toFixed(8)}*PTS,fps=30,scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight},setsar=1,format=yuv420p[v];[1:a]${audioFilters.join(",")}[a]`;
    ffmpegArgs.push(
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-t",
      finalMusicDuration.toFixed(3),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath
    );
    await runCmd(FFMPEG_BIN, ffmpegArgs);

    return {
      buffer: await fs.readFile(outputPath),
      mimeType: "video/mp4",
      audioStartSeconds: start,
      audioEndSeconds: end,
      clipDurationSeconds: clipDuration,
      finalMusicDurationSeconds: finalMusicDuration,
      coverDurationSeconds: coverDuration,
      coverTransitionSeconds: transitionDuration,
      videoBodyDurationSeconds: videoBodyDuration,
      useCoverFrame: useCover,
      audioPlaybackRate: effectiveAudioRate,
      videoDurationSeconds: videoDuration,
      videoWidth: outputWidth,
      videoHeight: outputHeight,
      videoSpeed
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function resolveChromeExecutablePath() {
  const fromEnv = String(process.env.CHROME_EXECUTABLE_PATH || "").trim();
  const candidates = fromEnv ? [fromEnv, ...WECHAT_CHROME_PATHS] : WECHAT_CHROME_PATHS;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error("chrome_not_found:set_CHROME_EXECUTABLE_PATH_or_install_google_chrome");
}

function normalizePublishSentence(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[。.!?！？]+$/g, "")
    .trim();
  if (!text) {
    return "云水之间，风起云涌，心自安然";
  }
  const maxChars = 30;
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}`;
}

function resolvePublishBaseDescription(taskId) {
  const task = getTask(taskId);
  if (!task) return "";

  const selected = task.selected_narrative_id
    ? db.prepare("SELECT * FROM narrative_options WHERE id = ? AND task_id = ?").get(task.selected_narrative_id, taskId)
    : null;
  if (selected?.description) {
    return selected.description;
  }

  const latestNarrative = db
    .prepare("SELECT * FROM narrative_options WHERE task_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(taskId);
  if (latestNarrative?.description) {
    return latestNarrative.description;
  }
  return latestNarrative?.title || "";
}

function buildWechatPublishDescription(taskId, rawDescription) {
  const source = String(rawDescription || "").trim() || resolvePublishBaseDescription(taskId);
  const oneLiner = normalizePublishSentence(source);
  return `${oneLiner}。`;
}

function buildWechatPublishShortTitle(taskId, rawDescription) {
  const source = String(rawDescription || "").trim() || resolvePublishBaseDescription(taskId);
  const oneLiner = normalizePublishSentence(source).replace(/[。.!?！？]+$/g, "").trim();
  const maxChars = 20;
  return oneLiner.length <= maxChars ? oneLiner : oneLiner.slice(0, maxChars);
}

function trimToLength(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || !Number.isFinite(maxLength) || maxLength <= 0) {
    return text;
  }
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function normalizeGeneratedPrefillStrict(channel, raw) {
  const titleMaxLength = channel === "video_channel" ? 0 : channel === "xiaohongshu" ? 20 : 28;
  const title = trimToLength(raw?.title || "", titleMaxLength);
  const description = trimToLength(raw?.description || "", 280);
  if (!title) {
    throw new Error("publish_prefill_title_missing");
  }
  if (!description) {
    throw new Error("publish_prefill_description_missing");
  }

  if (channel === "video_channel") {
    return {
      title,
      description,
      topics: ""
    };
  }

  const topicsRaw = Array.isArray(raw?.topics)
    ? raw.topics.map((item) => String(item || "").trim()).filter(Boolean).join(" ")
    : String(raw?.topics || "").trim();
  const topics = trimToLength(topicsRaw, 120);
  return {
    title,
    description,
    topics
  };
}

function extractHashtagTokens(text) {
  const input = String(text || "");
  const matches = input.match(/#[^#\s，。,.!?！？；;:：]+/g) || [];
  const uniq = [];
  for (const tag of matches) {
    const body = String(tag || "").slice(1);
    if (!body) continue;
    if (body.length > 6) continue;
    if (/号前|内容都一致|前的内容/.test(body)) continue;
    if (!uniq.includes(tag)) {
      uniq.push(tag);
    }
  }
  return uniq;
}

function stripTrailingHashtags(text) {
  let value = String(text || "").trim();
  value = value.replace(/(\s*#[^#\s，。,.!?！？；;:：]+)+\s*$/g, "").trim();
  return value;
}

function stripAllHashtags(text) {
  return String(text || "")
    .replace(/#[^#\s，。,.!?！？；;:：]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVideoChannelTitleComplete(text) {
  let title = stripTrailingHashtags(text)
    .replace(/[。.!?！？\s]+$/g, "")
    .trim();
  if (!title) return "";
  return title.replace(/[，,、；;:\-\s]+$/g, "").trim();
}

function parseVideoChannelPrefillFromText(rawText) {
  const cleaned = String(rawText || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned) {
    return { title: "", description: "" };
  }

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  let title = "";
  let description = "";

  if (lines.length >= 2) {
    title = normalizeVideoChannelTitleComplete(lines[0]);
    description = lines.slice(1).join(" ").trim();
  } else {
    const single = lines[0] || cleaned;
    const firstTagIndex = single.indexOf("#");
    if (firstTagIndex > 0) {
      title = normalizeVideoChannelTitleComplete(single.slice(0, firstTagIndex));
      description = single;
    } else {
      title = normalizeVideoChannelTitleComplete(single);
      description = "";
    }
  }

  if (!title && description) {
    title = normalizeVideoChannelTitleComplete(stripAllHashtags(description));
  }

  return {
    title,
    description: description || title
  };
}

function chineseNumeralToInt(raw) {
  const text = String(raw || "").trim();
  if (!text) return 0;
  const digit = Number(text);
  if (Number.isFinite(digit) && digit > 0) {
    return Math.floor(digit);
  }

  const map = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [left, right] = text.split("十");
    const tens = left ? map[left] || 0 : 1;
    const ones = right ? map[right] || 0 : 0;
    const value = tens * 10 + ones;
    return value > 0 ? value : 0;
  }
  return map[text] || 0;
}

function parseMinCharsFromInstruction(instructionText) {
  const text = String(instructionText || "");
  if (!text) return 0;

  const numeric = text.match(/(\d{1,3})\s*个?字\s*(以上|及以上|不少于|至少)/);
  if (numeric?.[1]) {
    return Math.max(0, Number(numeric[1]) || 0);
  }

  const zh = text.match(/([一二三四五六七八九十两]{1,3})\s*个?字\s*(以上|及以上|不少于|至少)/);
  if (zh?.[1]) {
    return chineseNumeralToInt(zh[1]);
  }

  return 0;
}

function countMeaningfulChars(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  const compact = value.replace(/[\s，。,.!?！？、；;:：'"“”‘’()（）【】\-]/g, "");
  return Array.from(compact).length;
}

function composeVideoChannelDescription(titleText, hashtags) {
  const title = normalizeVideoChannelTitleComplete(titleText);
  if (!title) {
    throw new Error("publish_prefill_video_channel_title_missing");
  }
  if (!Array.isArray(hashtags) || hashtags.length === 0) {
    throw new Error("publish_prefill_video_channel_hashtags_missing");
  }
  return `${title} ${hashtags.join("")}`;
}

function applyVideoChannelFixedHashtags(prefill, instructionText) {
  const hashtags = extractHashtagTokens(instructionText);
  const title = normalizeVideoChannelTitleComplete(prefill?.title || "");
  const description = composeVideoChannelDescription(title, hashtags);
  return {
    prefill: {
      title,
      description,
      topics: ""
    },
    hashtags
  };
}

function buildPublishPrefillCacheKey(taskId, channel) {
  return `${String(taskId || "")}:${String(channel || "")}`;
}

function findDisallowedPublishPhrase(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return DISALLOWED_PUBLISH_PHRASES.find((phrase) => value.includes(phrase)) || "";
}

function getRecentPublishPrefillSamples(taskId, channel) {
  const key = buildPublishPrefillCacheKey(taskId, channel);
  const items = PUBLISH_PREFILL_RECENT_CACHE.get(key);
  if (!Array.isArray(items)) return [];
  const filtered = items.filter((item) => !findDisallowedPublishPhrase(item));
  if (filtered.length !== items.length) {
    PUBLISH_PREFILL_RECENT_CACHE.set(key, filtered.slice(0, 5));
  }
  return filtered.slice(0, 5);
}

function rememberPublishPrefillSample(taskId, channel, prefill) {
  const key = buildPublishPrefillCacheKey(taskId, channel);
  const text = `${String(prefill?.title || "").trim()} | ${String(prefill?.description || "").trim()}`.trim();
  if (!text) return;
  if (findDisallowedPublishPhrase(text)) return;
  const old = getRecentPublishPrefillSamples(taskId, channel);
  const deduped = [text, ...old.filter((item) => item !== text)].slice(0, 5);
  PUBLISH_PREFILL_RECENT_CACHE.set(key, deduped);
}

function normalizePrefillForCompare(prefill) {
  const title = String(prefill?.title || "").replace(/\s+/g, "").trim();
  const description = String(prefill?.description || "").replace(/\s+/g, "").trim();
  const topics = String(prefill?.topics || "").replace(/\s+/g, "").trim();
  return `${title}|${description}|${topics}`;
}

function extractOpeningSignature(text) {
  const raw = String(text || "").replace(/\s+/g, "").trim();
  if (!raw) return "";
  const firstClause = raw.split(/[，。！？；,.!?;:：]/)[0] || raw;
  const compact = firstClause.replace(/["'“”‘’()（）【】\[\]<>《》]/g, "");
  return compact.slice(0, 10);
}

function hasLongVerbatimOverlap(text, source, minLen = 8) {
  const a = String(text || "").replace(/[\s，。,.!?！？、；;:：'"“”‘’()（）【】\-]/g, "").trim();
  const b = String(source || "").replace(/[\s，。,.!?！？、；;:：'"“”‘’()（）【】\-]/g, "").trim();
  const size = Math.max(2, Number(minLen) || 8);
  if (!a || !b || a.length < size || b.length < size) return false;
  for (let i = 0; i <= b.length - size; i += 1) {
    const chunk = b.slice(i, i + size);
    if (chunk && a.includes(chunk)) return true;
  }
  return false;
}

function pickRandomVariationCard() {
  return PUBLISH_LIGHT_VARIATION_CARDS[Math.floor(Math.random() * PUBLISH_LIGHT_VARIATION_CARDS.length)];
}

async function repairPublishPrefillJsonWithGemini({ taskId, channelLabel, modelForCall, apiKey, brokenText, attempt, minTitleChars = 0 }) {
  const repairPrompt = [
    "Return ONLY one valid JSON object. No markdown, no explanation.",
    channelLabel === "视频号"
      ? '{"title":"...","description":"..."}'
      : '{"title":"...","description":"...","topics":"#a #b #c"}',
    "Rules:",
    "- Simplified Chinese only",
    channelLabel === "视频号" ? "- description must start exactly with title" : "",
    channelLabel === "视频号" ? "- do not include hashtags in title/description" : "",
    channelLabel === "视频号" && minTitleChars > 0 ? `- title length >= ${minTitleChars} Chinese chars` : "",
    "Broken text:",
    String(brokenText || "").slice(0, 2000)
  ].join("\n");

  addLog(taskId, "info", `[Publish][${channelLabel}] JSON repair call attempt=${attempt}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelForCall}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: repairPrompt }] }],
    generationConfig: {
      temperature: 0.05,
      topP: 0.9,
      maxOutputTokens: 2046,
      responseMimeType: "application/json",
      responseSchema:
        channelLabel === "视频号"
          ? {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                description: { type: "STRING" }
              },
              required: ["title", "description"]
            }
          : {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                description: { type: "STRING" },
                topics: { type: "STRING" }
              },
              required: ["title", "description"]
            }
    }
  };

  const raw = await runCurlJson({ url, payload, timeoutMs: STYLE_REQUEST_TIMEOUT_MS });
  const response = JSON.parse(raw);
  if (response.error) {
    throw new Error(response.error.message || "gemini_publish_prefill_repair_api_error");
  }
  return {
    raw,
    text: collectCandidateText(response)
  };
}

async function expandVideoChannelTitleWithGemini({ taskId, modelForCall, apiKey, title, sourceDescription, minTitleChars, attempt }) {
  const prompt = [
    "Rewrite the title into ONE complete Simplified Chinese sentence.",
    `Keep the same core meaning, but length must be at least ${Math.max(1, Number(minTitleChars) || 1)} Chinese characters.`,
    "Do not output hashtags.",
    "Output only plain text, no JSON, no markdown.",
    `Current title: ${String(title || "").trim()}`,
    `Source: ${String(sourceDescription || "").trim()}`
  ].join("\n");

  addLog(taskId, "info", `[Publish][视频号] Expand title call attempt=${attempt}`);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelForCall}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 2046
    }
  };
  const raw = await runCurlJson({ url, payload, timeoutMs: STYLE_REQUEST_TIMEOUT_MS });
  const response = JSON.parse(raw);
  if (response.error) {
    throw new Error(response.error.message || "gemini_expand_video_title_api_error");
  }
  const text = (response.candidates?.[0]?.content?.parts || []).find((p) => p.text)?.text || "";
  return String(text).replace(/```[\s\S]*?```/g, "").replace(/[\n\r]+/g, " ").trim();
}

function containsEnoughChinese(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  const chars = Array.from(value);
  const han = chars.filter((ch) => /[\u4e00-\u9fff]/.test(ch)).length;
  return han >= Math.max(2, Math.floor(chars.length * 0.25));
}

function validatePublishPrefillContent(channel, prefill, options = {}) {
  if (!containsEnoughChinese(prefill?.title) || !containsEnoughChinese(prefill?.description)) {
    throw new Error("publish_prefill_non_chinese_output");
  }
  if (channel === "video_channel") {
    const title = String(prefill?.title || "").trim();
    const description = String(prefill?.description || "").trim();
    const descNoTags = stripAllHashtags(description);
    if (!descNoTags || !descNoTags.includes(title)) {
      throw new Error("publish_prefill_video_channel_title_description_mismatch");
    }
    const tags = extractHashtagTokens(description);
    if (tags.length === 0) {
      throw new Error("publish_prefill_video_channel_hashtags_missing");
    }

    const minChars = Math.max(0, Number(options.minTitleChars) || 0);
    if (minChars > 0) {
      const actual = countMeaningfulChars(title);
      if (actual < minChars) {
        throw new Error(`publish_prefill_video_channel_title_too_short:${actual}<${minChars}`);
      }
    }
  }
}

async function generatePublishPrefillWithGemini({ taskId, channel, sourceDescription, instruction, currentDraft, settings, onDebugEvent }) {
  if (!settings.api_key) {
    throw new Error("gemini_api_key_missing");
  }
  const modelForCall = resolvePromptModel(settings.prompt_model);
  const resolvedChannel = normalizePublishChannel(channel);
  const instructionText = String(instruction || "").trim();
  if (!instructionText) {
    throw new Error("publish_prefill_instruction_missing");
  }
  const baseSource = String(sourceDescription || "").trim() || resolvePublishBaseDescription(taskId);
  const channelLabel = PUBLISH_CHANNEL_LABELS[resolvedChannel] || resolvedChannel;
  const minTitleChars = resolvedChannel === "video_channel" ? parseMinCharsFromInstruction(instructionText) : 0;
  const recentSamples = getRecentPublishPrefillSamples(taskId, resolvedChannel);
  const channelHint =
    resolvedChannel === "video_channel"
      ? "短标题与视频描述前缀一致，系统自动拼接固定话题后缀。"
      : resolvedChannel === "douyin"
        ? "标题简短有记忆点，描述有节奏感，话题2-4个"
        : "标题有审美感，描述像笔记分享，话题2-4个";
  const draftHint = [
    `title=${String(currentDraft?.title || "").trim()}`,
    `description=${String(currentDraft?.description || "").trim()}`,
    `topics=${String(currentDraft?.topics || "").trim()}`
  ].join("\n");
  const avoidHint = recentSamples.length ? recentSamples.map((item, idx) => `${idx + 1}. ${item}`).join("\n") : "none";
  const recentSet = new Set(recentSamples.map((item) => String(item || "").replace(/\s+/g, "").trim()));
  const recentOpeningSet = new Set(
    recentSamples
      .map((item) => String(item || "").split("|")[0])
      .map((title) => extractOpeningSignature(title))
      .filter(Boolean)
  );
  const avoidOpenings = Array.from(recentOpeningSet).join(" | ") || "none";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelForCall}:generateContent?key=${settings.api_key}`;
  const emitDebug = (stage, payload = {}) => {
    onDebugEvent?.({
      stage,
      timestamp: new Date().toISOString(),
      ...payload
    });
  };
  let lastError = null;
  let lastShortPrefill = null;
  let lastShortMeta = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const seed = `${Date.now()}-${Math.floor(Math.random() * 100000)}-${attempt}`;
    const card = pickRandomVariationCard();
    const promptText =
      resolvedChannel === "video_channel"
        ? instructionText
        : [
            "You generate publish prefill fields for Chinese social media channels.",
            "Return ONLY one valid JSON object.",
            'JSON schema: {"title":"...","description":"...","topics":"#a #b #c"}.',
            "Do not add markdown fences.",
            `Attempt: ${attempt}`,
            `Random seed: ${seed}`,
            `Variation card: ${card.id} - ${card.direction}`,
            "Randomization policy: light random only. Keep stable style and meaning, but avoid repeating exact wording.",
            "Hard rule: opening phrase must differ from recent outputs. Do not repeat exact sentence patterns.",
            "Rewrite rule: do not copy source description verbatim. Avoid any long exact phrase from source.",
            `Forbidden opening signatures: ${avoidOpenings}`,
            "Language rule: output must be Simplified Chinese only.",
            `Channel: ${channelLabel}`,
            `Style guidance: ${channelHint}`,
            `Business instruction: ${instructionText}`,
            `Source description: ${baseSource}`,
            `Current draft (can refine):\n${draftHint}`,
            `Avoid repeating these recent outputs:\n${avoidHint}`
          ].join("\n");

    addLog(taskId, "info", `[Publish][${channelLabel}] Prompt call model=${modelForCall} attempt=${attempt} seed=${seed} card=${card.id}\n${promptText}`);

    const payload = {
      contents: [
        {
          parts: [{ text: promptText }]
        }
      ],
      generationConfig: {
        temperature: resolvedChannel === "video_channel" ? 0.35 : 0.85,
        topP: resolvedChannel === "video_channel" ? 0.9 : 0.95,
        maxOutputTokens: 2046,
        ...(resolvedChannel === "video_channel"
          ? { thinkingConfig: { thinkingBudget: 0 } }
          : {
              responseMimeType: "application/json",
              responseSchema: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  description: { type: "STRING" },
                  topics: { type: "STRING" }
                },
                required: ["title", "description"]
              }
            })
      }
    };

    emitDebug("prompt_sent", {
      attempt,
      seed,
      variationCard: card.id,
      request: {
        model: modelForCall,
        url,
        payload,
        passthroughInstruction: resolvedChannel === "video_channel"
      }
    });

    const raw = await runCurlJson({
      url,
      payload,
      timeoutMs: STYLE_REQUEST_TIMEOUT_MS
    });

    emitDebug("model_raw", {
      attempt,
      raw
    });

    let response;
    try {
      response = JSON.parse(raw);
    } catch {
      lastError = new Error("publish_prefill_model_http_invalid_json");
      continue;
    }
    if (response.error) {
      throw new Error(response.error.message || "gemini_publish_prefill_api_error");
    }

    const finishReason = String(response?.candidates?.[0]?.finishReason || "");
    emitDebug("model_finish", {
      attempt,
      finishReason
    });
    const textPart = collectCandidateText(response);
    emitDebug("model_text", {
      attempt,
      text: textPart
    });
    if (!String(textPart || "").trim()) {
      lastError = new Error("publish_prefill_model_empty_response");
      continue;
    }
    let parsed;
    let parsePath = "direct";
    if (resolvedChannel === "video_channel") {
      const trimmed = String(textPart || "").trim();
      let textPrefill = parseVideoChannelPrefillFromText(trimmed);
      if (trimmed.startsWith("{") && trimmed.includes("\"title\"")) {
        try {
          const obj = JSON.parse(extractJsonObject(trimmed));
          textPrefill = {
            title: normalizeVideoChannelTitleComplete(String(obj?.title || "")),
            description: String(obj?.description || "").trim()
          };
          parsePath = "json_from_text";
        } catch {
          // keep plain text path
        }
      }
      if (!textPrefill.title) {
        addLog(taskId, "error", `[Publish][${channelLabel}] Empty title text attempt=${attempt}: ${trimmed.slice(0, 400)}`);
        lastError = new Error("publish_prefill_model_response_invalid_text");
        continue;
      }
      parsed = {
        title: textPrefill.title,
        description: String(textPrefill.description || textPrefill.title || "").trim(),
        topics: ""
      };
      parsePath = parsePath === "json_from_text" ? "json_from_text" : "plain_text";
    } else {
      try {
        parsed = JSON.parse(extractJsonObject(textPart));
      } catch {
        parsePath = "repair";
        try {
          const repaired = await repairPublishPrefillJsonWithGemini({
            taskId,
            channelLabel,
            modelForCall,
            apiKey: settings.api_key,
            brokenText: textPart,
            attempt,
            minTitleChars
          });
          emitDebug("repair_raw", {
            attempt,
            raw: repaired.raw
          });
          emitDebug("repair_text", {
            attempt,
            text: repaired.text
          });
          parsed = JSON.parse(extractJsonObject(repaired.text));
          addLog(taskId, "info", `[Publish][${channelLabel}] JSON repaired successfully on attempt=${attempt}`);
        } catch {
          addLog(
            taskId,
            "error",
            `[Publish][${channelLabel}] Invalid JSON response attempt=${attempt}: ${String(textPart).slice(0, 400)}`
          );
          lastError = new Error("publish_prefill_model_response_invalid_json");
          continue;
        }
      }
    }
    emitDebug("parsed", {
      attempt,
      parsePath,
      parsed
    });
    let prefill = normalizeGeneratedPrefillStrict(resolvedChannel, parsed);
    let fixedHashtags = [];
    let prefillPath = "direct";
    if (resolvedChannel === "video_channel") {
      const normalizedTitle = normalizeVideoChannelTitleComplete(prefill.title || "");
      const modelDescription = String(prefill.description || "").trim();
      const modelTags = extractHashtagTokens(modelDescription);
      if (modelTags.length > 0) {
        const contentNoTags = stripAllHashtags(modelDescription);
        const descriptionWithPrefix = contentNoTags.includes(normalizedTitle)
          ? modelDescription
          : `${normalizedTitle} ${modelDescription}`.trim();
        prefill = {
          title: normalizedTitle,
          description: descriptionWithPrefix,
          topics: ""
        };
        fixedHashtags = modelTags;
        prefillPath = "model_text_split";
      } else {
        const normalizedVideo = applyVideoChannelFixedHashtags(
          {
            title: normalizedTitle,
            description: normalizedTitle,
            topics: ""
          },
          instructionText
        );
        prefill = normalizedVideo.prefill;
        fixedHashtags = normalizedVideo.hashtags;
      }
      if (minTitleChars > 0 && countMeaningfulChars(prefill.title) < minTitleChars) {
        try {
          const expanded = await expandVideoChannelTitleWithGemini({
            taskId,
            modelForCall,
            apiKey: settings.api_key,
            title: prefill.title,
            sourceDescription: baseSource,
            minTitleChars,
            attempt
          });
          const expandedVideo = applyVideoChannelFixedHashtags(
            { title: expanded, description: expanded, topics: "" },
            instructionText
          );
          prefill = expandedVideo.prefill;
          fixedHashtags = expandedVideo.hashtags;
          prefillPath = "model_expand";
          addLog(taskId, "info", `[Publish][${channelLabel}] Expanded title=${prefill.title}`);
          addLog(taskId, "info", `[Publish][${channelLabel}] prefill_path=model_expand`);
        } catch (error) {
          addLog(taskId, "info", `[Publish][${channelLabel}] Expand title failed attempt=${attempt}: ${error.message || String(error)}`);
          addLog(taskId, "info", `[Publish][${channelLabel}] prefill_path=model_expand_failed local_fallback=disabled`);
        }
      }
      if (minTitleChars > 0 && countMeaningfulChars(prefill.title) < minTitleChars) {
        addLog(
          taskId,
          "info",
          `[Publish][${channelLabel}] Title still shorter than min chars after model expansion attempt=${attempt}; prefill_path=model_expand local_fallback=disabled`
        );
        lastShortPrefill = {
          title: String(prefill.title || "").trim(),
          description: String(prefill.description || "").trim(),
          topics: String(prefill.topics || "").trim()
        };
        lastShortMeta = {
          model: modelForCall,
          seed,
          variationCard: card.id,
          attempt,
          prefillPath: "model_expand",
          minTitleChars,
          actualTitleChars: countMeaningfulChars(prefill.title)
        };
        lastError = new Error("publish_prefill_title_expand_failed_retry");
        lastError.partialPrefill = lastShortPrefill;
        lastError.partialMeta = lastShortMeta;
        continue;
      }
      if (prefillPath === "direct") {
        addLog(taskId, "info", `[Publish][${channelLabel}] prefill_path=direct`);
      }
      addLog(taskId, "info", `[Publish][${channelLabel}] Fixed hashtags=${fixedHashtags.join("")}`);
    }
    try {
      validatePublishPrefillContent(resolvedChannel, prefill, { minTitleChars });
    } catch (validationError) {
      addLog(taskId, "info", `[Publish][${channelLabel}] Attempt ${attempt} failed validation: ${validationError.message}`);
      lastError = validationError;
      continue;
    }
    const normalized = normalizePrefillForCompare(prefill);
    if (recentSet.has(normalized)) {
      addLog(taskId, "info", `[Publish][${channelLabel}] Attempt ${attempt} duplicated recent output, retrying...`);
      lastError = new Error("publish_prefill_repeated_output");
      continue;
    }
    const openingSignature = extractOpeningSignature(prefill.title);
    if (openingSignature && recentOpeningSet.has(openingSignature)) {
      addLog(taskId, "info", `[Publish][${channelLabel}] Attempt ${attempt} repeated opening signature=${openingSignature}, retrying...`);
      lastError = new Error("publish_prefill_repeated_opening");
      continue;
    }
    if (resolvedChannel === "video_channel" && hasLongVerbatimOverlap(prefill.title, baseSource, 8)) {
      addLog(taskId, "info", `[Publish][${channelLabel}] Attempt ${attempt} copied source phrase, retrying...`);
      lastError = new Error("publish_prefill_source_phrase_copied");
      continue;
    }
    const disallowedPhrase = findDisallowedPublishPhrase(`${prefill.title} ${prefill.description}`);
    if (disallowedPhrase) {
      addLog(taskId, "info", `[Publish][${channelLabel}] Attempt ${attempt} hit disallowed phrase=${disallowedPhrase}, retrying...`);
      lastError = new Error("publish_prefill_disallowed_phrase_retry");
      continue;
    }

    rememberPublishPrefillSample(taskId, resolvedChannel, prefill);
    addLog(
      taskId,
      "info",
      `[Publish][${channelLabel}] Prompt response attempt=${attempt} seed=${seed} card=${card.id} result=${JSON.stringify(prefill)}`
    );
    return {
      prefill,
      meta: {
        model: modelForCall,
        seed,
        variationCard: card.id,
        attempt,
        prefillPath,
        parsePath
      }
    };
  }

  if (lastError?.message === "publish_prefill_title_expand_failed_retry" && lastShortPrefill) {
    lastError.partialPrefill = lastShortPrefill;
    lastError.partialMeta = lastShortMeta;
  }
  throw lastError || new Error("publish_prefill_generation_failed");
}

function latestPublishVideoArtifact(taskId) {
  return db
    .prepare(
      "SELECT * FROM artifacts WHERE task_id = ? AND type IN ('video_bgm_stretch', 'video_bgm') ORDER BY created_at DESC LIMIT 1"
    )
    .get(taskId);
}

function pushPublishLog(taskId, onMessage, level, message, extra = {}) {
  addLog(taskId, level, message);
  onMessage?.({
    type: "log",
    level,
    message,
    timestamp: new Date().toISOString(),
    ...extra
  });
}

async function clickElementByText(page, targets, timeoutMs) {
  await page.waitForFunction(
    (texts) => {
      const normalizedTargets = Array.isArray(texts)
        ? texts.map((item) => String(item || "").replace(/\s+/g, "")).filter(Boolean)
        : [];
      if (normalizedTargets.length === 0) return false;
      const elements = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"));
      for (const target of normalizedTargets) {
        const found = elements.find((el) => {
          const text = String(el.textContent || "").replace(/\s+/g, "");
          if (!text || !text.includes(target)) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        });
        if (found) {
          const clickable = found.closest("button, [role='button'], a") || found;
          try {
            clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          } catch {
            // ignore
          }
          const htmlEl = clickable;
          if (typeof htmlEl.click === "function") {
            htmlEl.click();
            return true;
          }
          clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
          return true;
        }
      }
      return false;
    },
    { timeout: timeoutMs },
    targets
  );
}

async function clickElementByTextAcrossFrames(page, targets) {
  const frames = page.frames();
  const debug = [];
  for (const frame of frames) {
    let frameUrl = "about:blank";
    try {
      frameUrl = String(frame.url() || "");
      const result = await frame.evaluate((texts) => {
        const normalizedTargets = Array.isArray(texts)
          ? texts.map((item) => String(item || "").replace(/\s+/g, "")).filter(Boolean)
          : [];
        if (normalizedTargets.length === 0) {
          return { clicked: false, sampleTexts: [], matchedText: "" };
        }

        const elements = Array.from(document.querySelectorAll("button, [role='button'], a, div, span"));
        const sampleTexts = [];
        for (const el of elements) {
          const text = String(el.textContent || "").replace(/\s+/g, "").trim();
          if (!text) continue;
          if (text.length < 2) continue;
          if (sampleTexts.includes(text)) continue;
          sampleTexts.push(text.slice(0, 24));
          if (sampleTexts.length >= 12) break;
        }

        for (const target of normalizedTargets) {
          const candidates = elements
            .map((el) => {
              const text = String(el.textContent || "").replace(/\s+/g, "");
              if (!text || !text.includes(target)) return null;
              const style = window.getComputedStyle(el);
              if (style.visibility === "hidden" || style.display === "none") return null;
              const rect = el.getBoundingClientRect();
              if (rect.width <= 1 || rect.height <= 1) return null;
              const isDisabled =
                el.hasAttribute("disabled") ||
                el.getAttribute("aria-disabled") === "true" ||
                style.pointerEvents === "none";
              if (isDisabled) return null;
              let score = 0;
              if (text === target) score += 120;
              if (text.startsWith(target)) score += 80;
              if (text.includes(target)) score += 50;
              if (el.tagName === "BUTTON") score += 45;
              if (el.getAttribute("role") === "button") score += 25;
              if (/发表视频|发布视频/.test(text)) score += 90;
              if (/orange|warning|primary/.test((el.className || "").toString().toLowerCase())) score += 18;
              score += Math.min(30, rect.width / 10);
              return { el, score };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);

          const found = candidates[0]?.el || null;
          if (!found) continue;
          const clickable = found.closest("button, [role='button'], a") || found;
          try {
            clickable.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          } catch {
            // ignore
          }
          const htmlEl = clickable;
          if (typeof htmlEl.click === "function") {
            htmlEl.click();
            return { clicked: true, sampleTexts, matchedText: target };
          }
          clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
          return { clicked: true, sampleTexts, matchedText: target };
        }
        return { clicked: false, sampleTexts, matchedText: "" };
      }, targets);

      debug.push({
        frameUrl,
        matchedText: result?.matchedText || "",
        sampleTexts: Array.isArray(result?.sampleTexts) ? result.sampleTexts : [],
        error: result?.error || ""
      });

      if (result?.clicked) {
        return { clicked: true, debug };
      }
    } catch (error) {
      debug.push({
        frameUrl,
        matchedText: "",
        sampleTexts: [],
        error: error?.message || "frame_eval_failed"
      });
    }
  }
  return { clicked: false, debug };
}

async function fillFirstDescriptionField(page, text) {
  const filled = await page.evaluate((value) => {
    const controls = Array.from(document.querySelectorAll("textarea, [contenteditable]"));
    for (const control of controls) {
      const style = window.getComputedStyle(control);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = control.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;

      if (control instanceof HTMLTextAreaElement) {
        control.focus();
        control.value = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      if (control instanceof HTMLElement && control.isContentEditable) {
        control.focus();
        control.textContent = value;
        control.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, text);
  if (!filled) {
    throw new Error("wechat_publish_description_input_not_found");
  }
}

async function fillFirstDescriptionFieldAcrossFrames(page, text) {
  const frames = page.frames();
  for (const frame of frames) {
    const filled = await frame
      .evaluate((value) => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 20;
        };

        const collectDeep = () => {
          const all = [];
          const walk = (root) => {
            if (!root) return;
            const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
            for (const node of nodes) {
              all.push(node);
              if (node.shadowRoot) walk(node.shadowRoot);
            }
          };
          walk(document);
          return all;
        };

        const elements = collectDeep();
        const direct = elements.find((el) => {
          if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLElement && el.isContentEditable)) return false;
          if (!visible(el)) return false;
          const attrs = `${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("name") || ""}`;
          return /添加描述|视频描述|描述|caption|desc|说点什么/i.test(attrs);
        });
        if (direct) {
          if (direct instanceof HTMLTextAreaElement) {
            direct.focus();
            direct.value = value;
            direct.dispatchEvent(new Event("input", { bubbles: true }));
            direct.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          direct.focus();
          direct.textContent = value;
          direct.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }

        const labels = elements.filter((el) => ["LABEL", "SPAN", "DIV"].includes(el.tagName)).filter((el) => {
          const t = String(el.textContent || "").replace(/\s+/g, "");
          return t === "视频描述" || t.startsWith("视频描述");
        });

        const containers = [];
        for (const label of labels) {
          const row =
            label.closest(".ant-form-item, .form-item, .weui-form, .post-edit, li, tr") ||
            label.parentElement ||
            null;
          if (row) containers.push(row);
          if (label.parentElement?.parentElement) containers.push(label.parentElement.parentElement);
        }

        const controls = containers
          .flatMap((container) => Array.from(container.querySelectorAll("textarea, [contenteditable]")))
          .filter((el) => visible(el));

        const control = controls[0];
        if (!control) return false;

        if (control instanceof HTMLTextAreaElement || control instanceof HTMLInputElement) {
          control.focus();
          control.value = value;
          control.dispatchEvent(new Event("input", { bubbles: true }));
          control.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }

        if (control instanceof HTMLElement && control.isContentEditable) {
          control.focus();
          control.textContent = value;
          control.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }

        return false;
      }, text)
      .catch(() => false);
    if (filled) {
      const verified = await frame
        .evaluate((value) => {
          const visible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.visibility === "hidden" || style.display === "none") return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 20 && rect.height > 20;
          };
          const collectDeep = () => {
            const all = [];
            const walk = (root) => {
              if (!root) return;
              const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
              for (const node of nodes) {
                all.push(node);
                if (node.shadowRoot) walk(node.shadowRoot);
              }
            };
            walk(document);
            return all;
          };
          const elements = collectDeep();

          const direct = elements.find((el) => {
            if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLElement && el.isContentEditable)) return false;
            if (!visible(el)) return false;
            const attrs = `${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("name") || ""}`;
            return /添加描述|视频描述|描述|caption|desc|说点什么/i.test(attrs);
          });
          const normalized = String(value || "").trim();
          if (direct instanceof HTMLTextAreaElement) {
            if (String(direct.value || "").trim() === normalized) return true;
          } else if (direct instanceof HTMLElement && direct.isContentEditable) {
            if (String(direct.textContent || "").trim().includes(normalized)) return true;
          }

          const labels = elements.filter((el) => ["LABEL", "SPAN", "DIV"].includes(el.tagName)).filter((el) => {
            const t = String(el.textContent || "").replace(/\s+/g, "");
            return t === "视频描述" || t.startsWith("视频描述");
          });
          const containers = [];
          for (const label of labels) {
            const row =
              label.closest(".ant-form-item, .form-item, .weui-form, .post-edit, li, tr") ||
              label.parentElement ||
              null;
            if (row) containers.push(row);
            if (label.parentElement?.parentElement) containers.push(label.parentElement.parentElement);
          }
          const controls = containers.flatMap((container) => Array.from(container.querySelectorAll("textarea, [contenteditable]")));
          return controls.some((control) => {
            if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
              return String(control.value || "").trim() === normalized;
            }
            if (control instanceof HTMLElement && control.isContentEditable) {
              return String(control.textContent || "").includes(normalized);
            }
            return false;
          });
        }, text)
        .catch(() => false);
      if (verified) {
        return true;
      }
    }
  }
  return false;
}

async function fillTopicInputIfPresent(page, topics) {
  const topicText = topics.join(" ");
  return page.evaluate((value) => {
    const controls = Array.from(document.querySelectorAll("input, textarea"));
    const candidate = controls.find((el) => {
      const attrs = `${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("name") || ""}`;
      return /话题/.test(attrs);
    });
    if (!candidate) return false;
    candidate.focus();
    candidate.value = value;
    candidate.dispatchEvent(new Event("input", { bubbles: true }));
    candidate.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, topicText);
}

async function fillTopicInputIfPresentAcrossFrames(page, topics) {
  const topicText = topics.join(" ");
  const frames = page.frames();
  for (const frame of frames) {
    const filled = await frame
      .evaluate((value) => {
        const controls = Array.from(document.querySelectorAll("input, textarea"));
        const candidate = controls.find((el) => {
          const attrs = `${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("name") || ""}`;
          return /话题|标签|topic|tag/i.test(attrs);
        });
        if (!candidate) return false;
        candidate.focus();
        candidate.value = value;
        candidate.dispatchEvent(new Event("input", { bubbles: true }));
        candidate.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, topicText)
      .catch(() => false);
    if (filled) {
      return true;
    }
  }
  return false;
}

async function fillShortTitleIfPresentAcrossFrames(page, titleText) {
  if (!titleText) return false;
  const frames = page.frames();
  for (const frame of frames) {
    const filled = await frame
      .evaluate((value) => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 20;
        };

        const collectDeep = () => {
          const all = [];
          const walk = (root) => {
            if (!root) return;
            const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
            for (const node of nodes) {
              all.push(node);
              if (node.shadowRoot) walk(node.shadowRoot);
            }
          };
          walk(document);
          return all;
        };
        const elements = collectDeep();

        const direct = elements.find((el) => {
          if (!(el instanceof HTMLInputElement)) return false;
          if (!visible(el)) return false;
          const attrs = `${el.getAttribute("placeholder") || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("name") || ""}`;
          return /短标题/.test(attrs);
        });
        if (direct) {
          direct.focus();
          direct.value = value;
          direct.dispatchEvent(new Event("input", { bubbles: true }));
          direct.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }

        const labels = elements.filter((el) => ["LABEL", "SPAN", "DIV"].includes(el.tagName)).filter((el) => {
          const t = String(el.textContent || "").replace(/\s+/g, "");
          return t === "短标题" || t.startsWith("短标题");
        });
        const containers = [];
        for (const label of labels) {
          const row =
            label.closest(".ant-form-item, .form-item, .weui-form, .post-edit, li, tr") ||
            label.parentElement ||
            null;
          if (row) containers.push(row);
          if (label.parentElement?.parentElement) containers.push(label.parentElement.parentElement);
        }
        const candidate = containers
          .flatMap((container) => Array.from(container.querySelectorAll("input[type='text'], input:not([type]), input[type='search']")))
          .find((el) => visible(el));
        if (!candidate) return false;
        candidate.focus();
        candidate.value = value;
        candidate.dispatchEvent(new Event("input", { bubbles: true }));
        candidate.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, titleText)
      .catch(() => false);
    if (filled) {
      return true;
    }
  }
  return false;
}

async function clickElementByTextAcrossFramesWithDebug(page, targets) {
  return clickElementByTextAcrossFrames(page, targets);
}

async function ensureLocationHidden(page, taskId, onMessage) {
  pushPublishLog(taskId, onMessage, "info", "[Publish] Start location step (set to 不显示位置)");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (const frame of page.frames()) {
      const result = await frame
        .evaluate(() => {
          const compact = (s) => String(s || "").replace(/\s+/g, "");
          const visible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 8 && rect.height > 8;
          };

          const clickLikeUser = (el) => {
            if (!el) return false;
            const target = el.closest("button, [role='button'], [role='option'], a, label") || el;
            try {
              target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
            } catch {
              // ignore
            }
            if (typeof target.click === "function") {
              target.click();
            } else {
              target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
              target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
              target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
            }
            return true;
          };

          const positionRow =
            document.querySelector(".post-position-wrap") ||
            Array.from(document.querySelectorAll(".form-item, .form-item-body, .form")).find((el) => /位置/.test(compact(el.textContent || ""))) ||
            null;
          const locationDisplay =
            positionRow?.querySelector?.(".position-display .location-name") ||
            document.querySelector(".position-display .location-name") ||
            null;

          if (locationDisplay && /不显示位置/.test(compact(locationDisplay.textContent || ""))) {
            return { ok: true, acted: false, stage: "already_hidden", optionSamples: [] };
          }

          const trigger =
            positionRow?.querySelector?.(".position-display") ||
            positionRow?.querySelector?.(".position-display-wrap") ||
            document.querySelector(".position-display") ||
            null;

          let acted = false;
          if (trigger && visible(trigger)) {
            acted = clickLikeUser(trigger) || acted;
          }

          const locationPanel =
            positionRow?.querySelector?.(".location-filter-wrap") ||
            document.querySelector(".location-filter-wrap") ||
            null;
          const searchInput =
            locationPanel?.querySelector?.(".search-input input") ||
            document.querySelector(".location-filter-wrap .search-input input") ||
            document.querySelector("input[placeholder*='搜索附近位置']");

          if (searchInput && visible(searchInput)) {
            searchInput.focus();
            searchInput.value = "不显示位置";
            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
            searchInput.dispatchEvent(new Event("change", { bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
            acted = true;
          }

          const optionNodes = Array.from(
            document.querySelectorAll(".common-option-list-wrap .option-item .location-item-info .name, .common-option-list-wrap .option-item .name")
          ).filter((el) => visible(el));
          const optionSamples = optionNodes
            .map((el) => compact(el.textContent || ""))
            .filter(Boolean)
            .filter((text) => text.length <= 20)
            .filter((text) => /位置|定位|上海|北京|省|市|不显示/.test(text))
            .slice(0, 12);

          const hideOption = optionNodes.find((el) => compact(el.textContent || "") === "不显示位置") || null;

          if (hideOption) {
            acted = clickLikeUser(hideOption.closest(".option-item") || hideOption) || acted;
          }

          const afterDisplay =
            positionRow?.querySelector?.(".position-display .location-name") ||
            document.querySelector(".position-display .location-name") ||
            null;
          const ok = Boolean(afterDisplay && /不显示位置/.test(compact(afterDisplay.textContent || "")));
          return { ok, acted, stage: ok ? "confirmed" : "waiting_confirm", optionSamples };
        })
        .catch(() => ({ ok: false, acted: false, stage: "eval_failed", optionSamples: [] }));

      if (result?.ok) {
        pushPublishLog(taskId, onMessage, "success", "[Publish] Location set: 不显示位置");
        return true;
      }
      if (attempt === 0 && Array.isArray(result?.optionSamples) && result.optionSamples.length > 0) {
        pushPublishLog(taskId, onMessage, "info", `[Publish] Location option samples: ${result.optionSamples.join("|")}`);
      }
      if (result?.acted) {
        await sleep(350);
      }
    }

    const direct = await clickElementByTextAcrossFramesWithDebug(page, ["不显示位置"]);
    if (direct?.clicked) {
      await sleep(350);
      const verified = await isLocationHiddenAcrossFrames(page);
      if (verified) {
        pushPublishLog(taskId, onMessage, "success", "[Publish] Location set: 不显示位置 (fallback)");
        return true;
      }
    }
  }
  pushPublishLog(taskId, onMessage, "info", "[Publish] Location option 不显示位置 not found, keep unchanged");
  return false;
}

async function uploadVideoWithFallback(page, videoPath, taskId, onMessage) {
  let fileInput = null;
  try {
    fileInput = await waitForFileInputAcrossFrames(page, 2500);
  } catch {
    fileInput = null;
  }

  if (fileInput) {
    pushPublishLog(taskId, onMessage, "info", "[Publish] Upload strategy A: direct file input handle");
    await fileInput.uploadFile(videoPath);
    return;
  }

  pushPublishLog(taskId, onMessage, "info", "[Publish] Upload strategy B: click upload button then capture file chooser");
  try {
    const chooserPromise = page.waitForFileChooser({ timeout: WECHAT_PUBLISH_STEP_TIMEOUT_MS });
    await clickElementByTextAcrossFramesWithDebug(page, ["上传视频", "上传", "本地上传", "点击上传", "重新上传"]);
    const chooser = await chooserPromise;
    await chooser.accept([videoPath]);
    return;
  } catch (error) {
    pushPublishLog(taskId, onMessage, "info", `[Publish] Strategy B failed: ${error.message || String(error)}`);
  }

  pushPublishLog(taskId, onMessage, "info", "[Publish] Upload strategy C: wait file input after upload-button click");
  const uploadClick = await clickElementByTextAcrossFramesWithDebug(page, ["上传视频", "上传", "本地上传", "点击上传", "重新上传"]);
  if (uploadClick?.clicked) {
    await sleep(500);
  }
  fileInput = await waitForFileInputAcrossFrames(page, WECHAT_PUBLISH_STEP_TIMEOUT_MS);
  await fileInput.uploadFile(videoPath);
}

async function dismissDraftSaveDialogIfPresent(page, taskId, onMessage) {
  for (const frame of page.frames()) {
    const result = await frame
      .evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 8 && rect.height > 8;
        };
        const compact = (s) => String(s || "").replace(/\s+/g, "");
        const dialogs = Array.from(document.querySelectorAll("[role='dialog'], .ant-modal, .weui-dialog, .dialog")).filter((el) => {
          if (!visible(el)) return false;
          const text = compact(el.textContent || "");
          return /将此次编辑保留|无法保存草稿|不保存|保存/.test(text);
        });
        const dialog = dialogs[0];
        if (!dialog) return { found: false, clicked: false };
        const buttons = Array.from(dialog.querySelectorAll("button, [role='button']")).filter((el) => visible(el));
        const pick = (needle) =>
          buttons.find((el) => {
            const t = compact(el.textContent || "");
            return t === needle || t.includes(needle);
          });
        const target = pick("不保存") || pick("放弃") || pick("确认放弃") || pick("保存");
        if (!target) return { found: true, clicked: false };
        const clickable = target.closest("button, [role='button']") || target;
        if (typeof clickable.click === "function") {
          clickable.click();
        } else {
          clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
          clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
          clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
        }

        const stillVisible = visible(dialog);
        return { found: true, clicked: true, stillVisible };
      })
      .catch(() => ({ found: false, clicked: false, stillVisible: false }));
    if (result.clicked) {
      await sleep(500);
      const closed = await frame
        .evaluate(() => {
          const visible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden") return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 8 && rect.height > 8;
          };
          const compact = (s) => String(s || "").replace(/\s+/g, "");
          const dialogs = Array.from(document.querySelectorAll("[role='dialog'], .ant-modal, .weui-dialog, .dialog")).filter((el) => {
            if (!visible(el)) return false;
            const text = compact(el.textContent || "");
            return /将此次编辑保留|无法保存草稿/.test(text);
          });
          return dialogs.length === 0;
        })
        .catch(() => false);
      pushPublishLog(taskId, onMessage, "info", `[Publish] Draft confirm click sent (closed=${closed ? 1 : 0})`);
      return closed;
    }
  }

  return false;
}

async function inspectUploadAndEditorState(page) {
  const frames = page.frames();
  const details = [];
  for (const frame of frames) {
    const frameUrl = String(frame.url() || "");
    const info = await frame
      .evaluate(() => {
        const text = String(document.body?.innerText || "").replace(/\s+/g, " ");
        const hasVideoPreview = document.querySelectorAll("video").length > 0;
        const hasUploadingText = /上传中|处理中|转码中|正在上传|上传进度/.test(text);
        const hasUploadedText = /上传成功|重新上传|更换视频|替换视频|移除视频|封面|视频时长/.test(text);
        const hasDescriptionKeyword = /视频描述|描述|说点什么|添加描述/.test(text);
        const hasDescriptionControl = Array.from(document.querySelectorAll("textarea, [contenteditable], input[type='text']")).some((el) => {
          const attrs = `${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("name") || ""}`;
          const nearestText = String(el.closest("label, .form-item, .weui-form, .post-edit")?.textContent || "").replace(/\s+/g, "");
          return /视频描述|描述|文案|caption|desc|说点什么/i.test(attrs) || /视频描述|描述/.test(nearestText);
        });
        return {
          hasVideoPreview,
          hasUploadingText,
          hasUploadedText,
          hasDescriptionKeyword,
          hasDescriptionControl
        };
      })
      .catch(() => ({
        hasVideoPreview: false,
        hasUploadingText: false,
        hasUploadedText: false,
        hasDescriptionKeyword: false,
        hasDescriptionControl: false
      }));
    details.push({ frameUrl, ...info });
  }

  const hasVideoPreview = details.some((d) => d.hasVideoPreview);
  const hasUploadingText = details.some((d) => d.hasUploadingText);
  const hasUploadedText = details.some((d) => d.hasUploadedText);
  const hasDescriptionKeyword = details.some((d) => d.hasDescriptionKeyword);
  const hasDescriptionControl = details.some((d) => d.hasDescriptionControl);

  const uploadReady = (hasVideoPreview || hasUploadedText || hasDescriptionControl) && !hasUploadingText;
  return {
    uploadReady,
    hasVideoPreview,
    hasUploadingText,
    hasUploadedText,
    hasDescriptionKeyword,
    hasDescriptionControl,
    details
  };
}

function formatUploadEditorState(state) {
  if (!state) return "state=none";
  const detailText = (state.details || [])
    .map((d) => {
      const u = String(d.frameUrl || "about:blank").slice(0, 40);
      return `${u}[v:${d.hasVideoPreview ? 1 : 0},up:${d.hasUploadingText ? 1 : 0},ok:${d.hasUploadedText ? 1 : 0},desc:${d.hasDescriptionControl ? 1 : 0}]`;
    })
    .slice(0, 3)
    .join(" ; ");
  return `ready=${state.uploadReady ? 1 : 0} video=${state.hasVideoPreview ? 1 : 0} uploading=${state.hasUploadingText ? 1 : 0} uploaded=${state.hasUploadedText ? 1 : 0} descCtl=${state.hasDescriptionControl ? 1 : 0} ${detailText}`;
}

async function waitForUploadAndDescriptionReady(page, taskId, onMessage, timeoutMs) {
  const startedAt = Date.now();
  let nextLogAt = 0;
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await inspectUploadAndEditorState(page);
    if (lastState.uploadReady) {
      pushPublishLog(taskId, onMessage, "success", `[Publish] Upload readiness confirmed: ${formatUploadEditorState(lastState)}`);
      return true;
    }
    const nowTs = Date.now();
    if (nowTs >= nextLogAt) {
      const elapsed = Math.floor((nowTs - startedAt) / 1000);
      pushPublishLog(taskId, onMessage, "info", `[Publish] Waiting upload completion... ${elapsed}s ${formatUploadEditorState(lastState)}`);
      nextLogAt = nowTs + WECHAT_PUBLISH_HEARTBEAT_MS;
    }
    await sleep(500);
  }
  pushPublishLog(taskId, onMessage, "error", `[Publish] Upload readiness timeout: ${formatUploadEditorState(lastState)}`);
  return false;
}

function createPublishStepTimeoutError(stepKey) {
  const error = new Error(`wechat_publish_step_timeout:${stepKey}`);
  error.publishStep = stepKey;
  return error;
}

function resolvePublishFailedStep(error) {
  if (!error) return "unknown";
  if (error.publishStep) {
    return String(error.publishStep);
  }
  const message = String(error.message || "");
  const stepTimeoutMatch = message.match(/^wechat_publish_step_timeout:([a-z0-9_]+)$/i);
  if (stepTimeoutMatch?.[1]) {
    return stepTimeoutMatch[1];
  }
  return "unknown";
}

function resolvePublishFailedStatus(error) {
  const step = resolvePublishFailedStep(error);
  return `publish_failed_step:${step}`;
}

async function hasUploadStartedSignal(page) {
  const state = await inspectUploadAndEditorState(page);
  return state.hasVideoPreview || state.hasUploadedText || state.hasUploadingText;
}

async function isDescriptionFilledAcrossFrames(page, descriptionText) {
  const expected = String(descriptionText || "").trim();
  if (!expected) return true;
  const frames = page.frames();
  for (const frame of frames) {
    const matched = await frame
      .evaluate((value) => {
        const normalized = String(value || "").trim();
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 20;
        };

        const collectDeep = () => {
          const all = [];
          const walk = (root) => {
            if (!root) return;
            const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
            for (const node of nodes) {
              all.push(node);
              if (node.shadowRoot) walk(node.shadowRoot);
            }
          };
          walk(document);
          return all;
        };
        const elements = collectDeep();
        const direct = elements.find((el) => {
          if (!(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLElement && el.isContentEditable)) return false;
          if (!visible(el)) return false;
          const attrs = `${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("name") || ""}`;
          return /添加描述|视频描述|描述|caption|desc|说点什么/i.test(attrs);
        });
        if (direct instanceof HTMLTextAreaElement && String(direct.value || "").trim() === normalized) return true;
        if (direct instanceof HTMLElement && direct.isContentEditable && String(direct.textContent || "").trim().includes(normalized)) return true;

        const labels = elements.filter((el) => ["LABEL", "SPAN", "DIV"].includes(el.tagName)).filter((el) => {
          const t = String(el.textContent || "").replace(/\s+/g, "");
          return t === "视频描述" || t.startsWith("视频描述");
        });
        const containers = [];
        for (const label of labels) {
          const row =
            label.closest(".ant-form-item, .form-item, .weui-form, .post-edit, li, tr") ||
            label.parentElement ||
            null;
          if (row && visible(row)) containers.push(row);
          if (label.parentElement?.parentElement && visible(label.parentElement.parentElement)) {
            containers.push(label.parentElement.parentElement);
          }
        }
        const controls = containers.flatMap((container) => Array.from(container.querySelectorAll("textarea, [contenteditable]")));
        return controls.some((control) => {
          if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
            return String(control.value || "").trim() === normalized;
          }
          if (control instanceof HTMLElement && control.isContentEditable) {
            return String(control.textContent || "").includes(normalized);
          }
          return false;
        });
      }, expected)
      .catch(() => false);
    if (matched) return true;
  }
  return false;
}

async function isShortTitleFilledAcrossFrames(page, shortTitleText) {
  const expected = String(shortTitleText || "").trim();
  if (!expected) return true;
  const frames = page.frames();
  for (const frame of frames) {
    const matched = await frame
      .evaluate((value) => {
        const normalized = String(value || "").trim();
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.visibility === "hidden" || style.display === "none") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 20;
        };

        const collectDeep = () => {
          const all = [];
          const walk = (root) => {
            if (!root) return;
            const nodes = root.querySelectorAll ? Array.from(root.querySelectorAll("*")) : [];
            for (const node of nodes) {
              all.push(node);
              if (node.shadowRoot) walk(node.shadowRoot);
            }
          };
          walk(document);
          return all;
        };
        const elements = collectDeep();
        const direct = elements.find((el) => {
          if (!(el instanceof HTMLInputElement)) return false;
          if (!visible(el)) return false;
          const attrs = `${el.getAttribute?.("placeholder") || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("name") || ""}`;
          return /短标题/.test(attrs);
        });
        if (direct && String(direct.value || "").trim() === normalized) return true;

        const labels = elements.filter((el) => ["LABEL", "SPAN", "DIV"].includes(el.tagName)).filter((el) => {
          const t = String(el.textContent || "").replace(/\s+/g, "");
          return t === "短标题" || t.startsWith("短标题");
        });
        const containers = [];
        for (const label of labels) {
          const row =
            label.closest(".ant-form-item, .form-item, .weui-form, .post-edit, li, tr") ||
            label.parentElement ||
            null;
          if (row && visible(row)) containers.push(row);
          if (label.parentElement?.parentElement && visible(label.parentElement.parentElement)) {
            containers.push(label.parentElement.parentElement);
          }
        }
        const controls = containers.flatMap((container) =>
          Array.from(container.querySelectorAll("input[type='text'], input:not([type]), input[type='search']"))
        );
        return controls.some((control) => {
          const val = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement ? control.value : control.textContent;
          return String(val || "").trim() === normalized;
        });
      }, expected)
      .catch(() => false);
    if (matched) return true;
  }
  return false;
}

async function isLocationHiddenAcrossFrames(page) {
  const frames = page.frames();
  for (const frame of frames) {
    const matched = await frame
      .evaluate(() => {
        const compact = (s) => String(s || "").replace(/\s+/g, "");
        const strictDisplay =
          document.querySelector(".post-position-wrap .position-display .location-name") ||
          document.querySelector(".position-display .location-name") ||
          null;
        if (strictDisplay && /不显示位置/.test(compact(strictDisplay.textContent || ""))) {
          return true;
        }

        const locationRows = Array.from(document.querySelectorAll("label, span, div")).filter((el) => {
          const t = compact(el.textContent || "");
          return /位置/.test(t) && /不显示位置/.test(t);
        });
        return locationRows.length > 0;
      })
      .catch(() => false);
    if (matched) return true;
  }
  return false;
}

async function isOriginalDeclarationCheckedAcrossFrames(page) {
  const frames = page.frames();
  for (const frame of frames) {
    const checked = await frame
      .evaluate(() => {
        const input =
          document.querySelector(".declare-original-checkbox input.ant-checkbox-input") ||
          document.querySelector(".declare-original-checkbox input[type='checkbox']") ||
          null;
        if (!input) return false;
        return Boolean(input.checked);
      })
      .catch(() => false);
    if (checked) return true;
  }
  return false;
}

async function isOriginalRightsDialogVisibleAcrossFrames(page) {
  const state = await inspectOriginalRightsDialogAcrossFrames(page);
  return state.visible;
}

async function inspectOriginalRightsDialogAcrossFrames(page) {
  const details = [];
  for (const frame of page.frames()) {
    const frameUrl = String(frame.url() || "");
    const info = await frame
      .evaluate(() => {
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 8 && rect.height > 8;
        };
        const compact = (s) => String(s || "").replace(/\s+/g, "");
        const dialog = Array.from(
          document.querySelectorAll(".declare-original-dialog .weui-desktop-dialog, .declare-original-dialog, .weui-desktop-dialog")
        ).find((el) => isVisible(el) && /原创权益|声明原创|我已阅读并同意/.test(compact(el.textContent || "")));
        if (!dialog) {
          return { found: false, visible: false, checked: false, primaryText: "", primaryDisabled: false };
        }
        const checkbox = dialog.querySelector("input.ant-checkbox-input") || dialog.querySelector("input[type='checkbox']");
        const primary =
          dialog.querySelector("button.weui-desktop-btn.weui-desktop-btn_primary") ||
          Array.from(dialog.querySelectorAll("button, [role='button']")).find((el) => /声明原创/.test(compact(el.textContent || "")));
        return {
          found: true,
          visible: true,
          checked: Boolean(checkbox?.checked),
          primaryText: compact(primary?.textContent || ""),
          primaryDisabled:
            Boolean(primary?.hasAttribute?.("disabled")) ||
            primary?.getAttribute?.("aria-disabled") === "true" ||
            /disabled/.test(String(primary?.className || "").toLowerCase()) ||
            window.getComputedStyle(primary || document.body).pointerEvents === "none"
        };
      })
      .catch(() => ({ found: false, visible: false, checked: false, primaryText: "", primaryDisabled: false }));
    details.push({ frameUrl, ...info });
  }
  const active = details.find((d) => d.visible) || null;
  return {
    visible: Boolean(active),
    checked: Boolean(active?.checked),
    primaryText: String(active?.primaryText || ""),
    primaryDisabled: Boolean(active?.primaryDisabled),
    details
  };
}

async function toggleOriginalDeclarationAcrossFrames(page) {
  const frames = page.frames();
  for (const frame of frames) {
    const clicked = await frame
      .evaluate(() => {
        const input =
          document.querySelector(".declare-original-checkbox input.ant-checkbox-input") ||
          document.querySelector(".declare-original-checkbox input[type='checkbox']") ||
          null;
        if (!input) return false;
        if (input.checked) return true;
        const wrapper = input.closest("label, .ant-checkbox-wrapper, .declare-original-checkbox") || input;
        if (typeof wrapper.click === "function") {
          wrapper.click();
        } else {
          wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
        }
        return true;
      })
      .catch(() => false);
    if (clicked) return true;
  }
  return false;
}

async function handleOriginalRightsDialogAcrossFrames(page, taskId, onMessage) {
  const frames = page.frames();
  for (const frame of frames) {
    const result = await frame
      .evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 8 && rect.height > 8;
        };

        const allCandidates = Array.from(
          document.querySelectorAll(
            ".declare-original-dialog .weui-desktop-dialog, .declare-original-dialog, .weui-desktop-dialog, [role='dialog'], .ant-modal, .weui-dialog"
          )
        );
        const dialog = allCandidates.find((el) => {
          if (!visible(el)) return false;
          const text = String(el.textContent || "").replace(/\s+/g, "");
          return /原创权益/.test(text) || (/我已阅读并同意/.test(text) && /声明原创/.test(text));
        });

        if (!dialog) {
          return { found: false, checkboxChecked: false, confirmed: false };
        }

        const getChecked = (el) => {
          if (!el) return false;
          if (el instanceof HTMLInputElement) return Boolean(el.checked);
          if (el.getAttribute("role") === "checkbox") return el.getAttribute("aria-checked") === "true";
          const aria = el.getAttribute("aria-checked");
          if (aria === "true") return true;
          return false;
        };

        let checkbox = dialog.querySelector("input.ant-checkbox-input") || dialog.querySelector("input[type='checkbox'], [role='checkbox']");

        let checkboxChecked = getChecked(checkbox);
        if (checkbox && !checkboxChecked) {
          const wrapper = checkbox.closest("label.ant-checkbox-wrapper, .ant-checkbox-wrapper, label, .ant-checkbox");
          const clickTarget = wrapper || checkbox;
          if (typeof clickTarget.click === "function") {
            clickTarget.click();
          } else {
            clickTarget.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
          }
          checkboxChecked = getChecked(checkbox);
        }

        const buttons = Array.from(dialog.querySelectorAll("button, [role='button'], a, div, span")).filter((el) => visible(el));
        const confirmBtn = buttons
          .map((el) => {
            const text = String(el.textContent || "").replace(/\s+/g, "");
            if (!text) return null;
            const isPrimaryText = text.includes("声明原创");
            const isFallbackText = /确定|确认|完成|同意/.test(text);
            if (!isPrimaryText && !isFallbackText) return null;
            const disabled =
              el.hasAttribute("disabled") ||
              el.getAttribute("aria-disabled") === "true" ||
              window.getComputedStyle(el).pointerEvents === "none" ||
              /disabled/.test(String(el.className || "").toLowerCase());
            return { text, disabled, score: text === "声明原创" ? 120 : isPrimaryText ? 100 : 55 };
          })
          .filter(Boolean)
          .sort((a, b) => b.score - a.score)[0];

        const confirmed = false;

        return {
          found: true,
          checkboxChecked,
          confirmed,
          canConfirm: Boolean(confirmBtn && !confirmBtn.disabled),
          confirmText: String(confirmBtn?.text || "")
        };
      })
      .catch(() => ({ found: false, checkboxChecked: false, confirmed: false, canConfirm: false, confirmText: "" }));

    if (result.found && result.checkboxChecked && !result.confirmed) {
      const clickedByHandle = await (async () => {
        const buttonHandle = await frame
          .evaluateHandle(() => {
            const isVisible = (el) => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 8 && rect.height > 8;
            };
            const compact = (s) => String(s || "").replace(/\s+/g, "");
            const dialog = Array.from(
              document.querySelectorAll(".declare-original-dialog .weui-desktop-dialog, .declare-original-dialog, .weui-desktop-dialog")
            ).find((el) => isVisible(el) && /原创权益|声明原创|我已阅读并同意/.test(compact(el.textContent || "")));
            if (!dialog) return null;

            const buttons = Array.from(dialog.querySelectorAll("button, [role='button'], a, div, span")).filter((el) => isVisible(el));
            const primary = buttons
              .map((el) => {
                const text = compact(el.textContent || "");
                if (!text) return null;
                if (!text.includes("声明原创") && !/确定|确认|完成|同意/.test(text)) return null;
                const disabled =
                  el.hasAttribute("disabled") ||
                  el.getAttribute("aria-disabled") === "true" ||
                  /disabled/.test(String(el.className || "").toLowerCase()) ||
                  window.getComputedStyle(el).pointerEvents === "none";
                return { el, score: text === "声明原创" ? 120 : 70, disabled };
              })
              .filter(Boolean)
              .sort((a, b) => b.score - a.score)
              .find((item) => !item.disabled);
            return primary?.el || null;
          })
          .catch(() => null);

        const btn = buttonHandle?.asElement?.() || null;
        if (btn) {
          try {
            await page.bringToFront().catch(() => {});
            await btn.evaluate((el) => {
              try {
                el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
              } catch {
                // ignore
              }
            });
            const box = await btn.boundingBox().catch(() => null);
            if (box && Number.isFinite(box.x) && Number.isFinite(box.y) && box.width > 1 && box.height > 1) {
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.down();
              await page.mouse.up();
            } else {
              await btn.click({ delay: 50 });
            }
            await buttonHandle?.dispose?.();
            return true;
          } catch {
            try {
              await btn.evaluate((el) => {
                el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true }));
                el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, composed: true }));
                el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true }));
                el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true }));
                el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
              });
              await buttonHandle?.dispose?.();
              return true;
            } catch {
              await buttonHandle?.dispose?.();
            }
          }
        }
        await buttonHandle?.dispose?.();
        return false;
      })();

      if (clickedByHandle) {
        await sleep(220);
        const closedAfterHandleClick = await frame
          .evaluate(() => {
            const visible = (el) => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (style.display === "none" || style.visibility === "hidden") return false;
              const rect = el.getBoundingClientRect();
              return rect.width > 8 && rect.height > 8;
            };
            const dialog = document.querySelector(".declare-original-dialog, .weui-desktop-dialog");
            return !dialog || !visible(dialog);
          })
          .catch(() => false);

        if (closedAfterHandleClick) {
          pushPublishLog(taskId, onMessage, "success", "[Publish] Original rights dialog confirmed by handle click");
          return { found: true, checkboxChecked: true, confirmed: true };
        }

        try {
          await page.keyboard.press("Enter");
          await sleep(180);
          const closedAfterEnter = await frame
            .evaluate(() => {
              const visible = (el) => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (style.display === "none" || style.visibility === "hidden") return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 8 && rect.height > 8;
              };
              const dialog = document.querySelector(".declare-original-dialog, .weui-desktop-dialog");
              return !dialog || !visible(dialog);
            })
            .catch(() => false);
          if (closedAfterEnter) {
            pushPublishLog(taskId, onMessage, "success", "[Publish] Original rights dialog confirmed by Enter fallback");
            return { found: true, checkboxChecked: true, confirmed: true };
          }
        } catch {
          // ignore keyboard fallback failures
        }

        pushPublishLog(taskId, onMessage, "info", "[Publish] Original dialog primary button clicked but dialog still visible");
      } else {
        pushPublishLog(
          taskId,
          onMessage,
          "info",
          `[Publish] Original dialog primary button handle not found (canConfirm=${result.canConfirm ? 1 : 0}, text=${result.confirmText || "none"})`
        );
      }
    }

    if (result.found) {
      if (result.checkboxChecked && result.confirmed) {
        pushPublishLog(taskId, onMessage, "success", "[Publish] Original rights dialog confirmed automatically");
      } else {
        pushPublishLog(
          taskId,
          onMessage,
          "info",
          `[Publish] Original rights dialog found (checked=${result.checkboxChecked ? 1 : 0}, confirmed=${result.confirmed ? 1 : 0})`
        );
      }
      return result;
    }
  }

  return { found: false, checkboxChecked: false, confirmed: false };
}

async function runPublishStepWithRetry({ taskId, onMessage, stepKey, probeDone, runAction }) {
  const stepPrefix = `[Publish][step=${stepKey}]`;
  const alreadyDone = await probeDone();
  if (alreadyDone) {
    pushPublishLog(taskId, onMessage, "info", `${stepPrefix} already done, skip`);
    return;
  }

  const startedAt = Date.now();
  let nextLogAt = 0;
  while (Date.now() - startedAt < WECHAT_PUBLISH_STEP_TIMEOUT_MS) {
    try {
      await runAction();
    } catch (error) {
      pushPublishLog(taskId, onMessage, "info", `${stepPrefix} action retry: ${error?.message || "unknown"}`);
    }

    const done = await probeDone();
    if (done) {
      pushPublishLog(taskId, onMessage, "success", `${stepPrefix} completed`);
      return;
    }

    const nowTs = Date.now();
    if (nowTs >= nextLogAt) {
      const elapsed = Math.floor((nowTs - startedAt) / 1000);
      pushPublishLog(taskId, onMessage, "info", `${stepPrefix} waiting... ${elapsed}s`);
      nextLogAt = nowTs + WECHAT_PUBLISH_HEARTBEAT_MS;
    }
    await sleep(700);
  }
  throw createPublishStepTimeoutError(stepKey);
}

async function waitForFileInputAcrossFrames(page, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frames = page.frames();
    for (const frame of frames) {
      const directInput = await frame.$("input[type='file']").catch(() => null);
      if (directInput) {
        return directInput;
      }

      const deepHandle = await frame
        .evaluateHandle(() => {
          const search = (root) => {
            if (!root) return null;
            if (typeof root.querySelector === "function") {
              const direct = root.querySelector("input[type='file']");
              if (direct) return direct;
            }
            const all = typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll("*")) : [];
            for (const el of all) {
              if (el?.shadowRoot) {
                const found = search(el.shadowRoot);
                if (found) return found;
              }
            }
            return null;
          };
          return search(document);
        })
        .catch(() => null);

      const deepInput = deepHandle?.asElement?.() || null;
      if (deepInput) {
        return deepInput;
      }
      await deepHandle?.dispose?.();
    }
    await sleep(500);
  }
  throw new Error("wechat_publish_file_input_not_found");
}

async function resolveLatestWechatPage(browser, fallbackPage) {
  try {
    const pages = await browser.pages();
    const channelsPages = pages.filter((p) => String(p.url() || "").includes("channels.weixin.qq.com"));
    const latest = channelsPages[channelsPages.length - 1];
    if (latest && !latest.isClosed()) {
      latest.setDefaultTimeout?.(WECHAT_PUBLISH_STEP_TIMEOUT_MS);
      return latest;
    }
  } catch {
    // ignore and fallback
  }
  return fallbackPage;
}

async function inspectPublishEntryStateAcrossFrames(page) {
  const pageUrl = String(page.url() || "");
  const frames = page.frames();
  const frameStates = [];

  for (const frame of frames) {
    const frameUrl = String(frame.url() || "");
    const state = await frame
      .evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };

        const fileInputs = Array.from(document.querySelectorAll("input[type='file']"));
        const visibleFileInputs = fileInputs.filter((el) => visible(el)).length;
        const anyFileInputs = fileInputs.length;
        const textareas = Array.from(document.querySelectorAll("textarea")).filter((el) => visible(el)).length;
        const editables = Array.from(document.querySelectorAll("[contenteditable]")).filter((el) => visible(el)).length;
        const bodyText = String(document.body?.innerText || "").replace(/\s+/g, " ");
        const hasUploadKeyword = /上传视频|上传|拖拽|本地上传/.test(bodyText);
        const hasDescKeyword = /视频描述|描述|话题|添加话题|添加标签/.test(bodyText);

        return {
          anyFileInputs,
          visibleFileInputs,
          textareas,
          editables,
          hasUploadKeyword,
          hasDescKeyword
        };
      })
      .catch(() => ({
        anyFileInputs: 0,
        visibleFileInputs: 0,
        textareas: 0,
        editables: 0,
        hasUploadKeyword: false,
        hasDescKeyword: false
      }));

    frameStates.push({ frameUrl, ...state });
  }

  const hasAnyFileInput = frameStates.some((s) => s.anyFileInputs > 0);
  const hasVisibleFileInput = frameStates.some((s) => s.visibleFileInputs > 0);
  const hasMetaFields = frameStates.some((s) => s.textareas > 0 || s.editables > 0);
  const hasEntryKeywords = frameStates.some((s) => s.hasUploadKeyword || s.hasDescKeyword);
  const routeLooksLikePublish = /\/platform\/post\/(create|edit|publish|video)/.test(pageUrl);

  const ready = hasAnyFileInput || (hasMetaFields && hasEntryKeywords) || routeLooksLikePublish;
  let signal = "none";
  if (hasAnyFileInput) {
    signal = hasVisibleFileInput ? "file_input_visible" : "file_input_present";
  } else if (hasMetaFields && hasEntryKeywords) {
    signal = "publish_form_detected";
  } else if (routeLooksLikePublish) {
    signal = "publish_route_detected";
  }

  return {
    ready,
    signal,
    pageUrl,
    frameStates
  };
}

async function waitForPublishEntryState(page, timeoutMs) {
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastState = await inspectPublishEntryStateAcrossFrames(page);
    if (lastState.ready) {
      return { ok: true, state: lastState };
    }
    await sleep(400);
  }
  return { ok: false, state: lastState };
}

async function collectPublishFrameDiagnostics(page) {
  const pageUrl = String(page.url() || "");
  const frames = page.frames();
  const details = [];

  for (const frame of frames) {
    const frameUrl = String(frame.url() || "");
    const info = await frame
      .evaluate(() => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 1 && rect.height > 1;
        };

        const countVisible = (selector) => Array.from(document.querySelectorAll(selector)).filter((el) => visible(el)).length;
        const allText = String(document.body?.innerText || "").replace(/\s+/g, " ");
        const sampleButtons = Array.from(document.querySelectorAll("button, [role='button'], a"))
          .map((el) => String(el.textContent || "").replace(/\s+/g, "").trim())
          .filter(Boolean)
          .slice(0, 8);

        return {
          fileInputs: document.querySelectorAll("input[type='file']").length,
          visibleFileInputs: countVisible("input[type='file']"),
          textareas: document.querySelectorAll("textarea").length,
          visibleTextareas: countVisible("textarea"),
          visibleInputs: countVisible("input"),
          visibleEditables: countVisible("[contenteditable]"),
          hasUploadWord: /上传视频|上传|本地上传|拖拽/.test(allText),
          hasDescWord: /视频描述|描述|话题|短标题/.test(allText),
          sampleButtons
        };
      })
      .catch(() => ({
        fileInputs: 0,
        visibleFileInputs: 0,
        textareas: 0,
        visibleTextareas: 0,
        visibleInputs: 0,
        visibleEditables: 0,
        hasUploadWord: false,
        hasDescWord: false,
        sampleButtons: []
      }));
    details.push({ frameUrl, ...info });
  }

  return { pageUrl, details };
}

function formatPublishDiagnosticsSnapshot(diag) {
  const pageUrl = String(diag?.pageUrl || "").slice(0, 70) || "unknown";
  const frameText = (diag?.details || [])
    .map((item) => {
      const f = String(item.frameUrl || "about:blank").slice(0, 42);
      const btn = Array.isArray(item.sampleButtons) ? item.sampleButtons.slice(0, 2).join("|") : "";
      return `${f}[file:${item.fileInputs}/${item.visibleFileInputs},desc:${item.visibleTextareas + item.visibleEditables},btn:${btn || "-"}]`;
    })
    .slice(0, 4)
    .join(" ; ");
  return `url=${pageUrl} frames=${(diag?.details || []).length} ${frameText || "no-frame-data"}`;
}

async function collectFieldDiagnostics(page, fieldKeyword) {
  const keyword = String(fieldKeyword || "").trim();
  const details = [];
  for (const frame of page.frames()) {
    const frameUrl = String(frame.url() || "");
    const item = await frame
      .evaluate((key) => {
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 8 && rect.height > 8;
        };
        const compact = (s) => String(s || "").replace(/\s+/g, "");
        const labels = Array.from(document.querySelectorAll("label, span, div")).filter((el) => {
          const t = compact(el.textContent || "");
          return visible(el) && t.includes(key);
        });
        const controls = Array.from(document.querySelectorAll("textarea, input, [contenteditable], [role='combobox'], [role='checkbox']")).filter(
          (el) => visible(el)
        );
        const buttons = Array.from(document.querySelectorAll("button, [role='button'], a")).filter((el) => visible(el));
        const controlSamples = controls
          .map((el) => {
            const tag = el.tagName.toLowerCase();
            const attrs = `${el.getAttribute?.("placeholder") || ""}|${el.getAttribute?.("aria-label") || ""}|${el.getAttribute?.("name") || ""}`;
            const txt = compact(el.textContent || "").slice(0, 30);
            return `${tag}:${attrs}:${txt}`;
          })
          .slice(0, 10);
        const labelSamples = labels.map((el) => compact(el.textContent || "").slice(0, 40)).slice(0, 6);
        const buttonSamples = buttons.map((el) => compact(el.textContent || "").slice(0, 24)).filter(Boolean).slice(0, 12);
        return {
          labelCount: labels.length,
          controlCount: controls.length,
          labelSamples,
          controlSamples,
          buttonSamples
        };
      }, keyword)
      .catch(() => ({ labelCount: 0, controlCount: 0, labelSamples: [], controlSamples: [], buttonSamples: [] }));
    details.push({ frameUrl, ...item });
  }
  return details;
}

async function tryDirectNavigateToPublishEntry(taskId, page, onMessage) {
  for (const url of WECHAT_PUBLISH_ENTRY_URLS) {
    pushPublishLog(taskId, onMessage, "info", `[Publish] Direct navigate fallback: ${url}`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: WECHAT_PUBLISH_STEP_TIMEOUT_MS });
    } catch (error) {
      pushPublishLog(taskId, onMessage, "info", `[Publish] Direct navigate failed: ${url} (${error.message || String(error)})`);
      continue;
    }
    const entered = await waitForPublishEntryState(page, 7000);
    if (entered.ok) {
      pushPublishLog(taskId, onMessage, "success", `[Publish] Entered publish flow by direct URL: ${entered.state?.signal || "unknown"}`);
      return true;
    }
  }
  return false;
}

async function getOrCreateWechatPublishSession(taskId, onMessage) {
  const executablePath = await resolveChromeExecutablePath();
  const profileDir = path.join(process.cwd(), "data", "wechat-chrome-profile");
  await fs.mkdir(profileDir, { recursive: true });

  const existing = WECHAT_PUBLISH_SESSIONS.get(taskId);
  if (existing?.browser?.isConnected?.() && existing?.page && !existing.page.isClosed()) {
    pushPublishLog(taskId, onMessage, "info", "[Publish] Reuse existing Chrome session");
    try {
      await existing.page.bringToFront();
    } catch {
      // ignore bring-to-front failures
    }
    existing.lastActiveAt = Date.now();
    return existing;
  }

  const createSessionFromBrowser = async (connectedBrowser, tag) => {
    const activePage = await connectedBrowser.newPage();
    activePage.setDefaultTimeout?.(WECHAT_PUBLISH_STEP_TIMEOUT_MS);
    const reused = {
      browser: connectedBrowser,
      page: activePage,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    WECHAT_PUBLISH_SESSIONS.set(taskId, reused);
    pushPublishLog(taskId, onMessage, "info", `[Publish] ${tag}`);
    return reused;
  };

  const tryConnectBrowserByPort = async (port) => {
    if (!Number.isFinite(Number(port)) || Number(port) <= 0) return null;
    try {
      const connectedBrowser = await puppeteer.connect({
        browserURL: `http://127.0.0.1:${Number(port)}`,
        defaultViewport: null
      });
      return connectedBrowser;
    } catch {
      return null;
    }
  };

  const connectFromDevToolsActivePort = async () => {
    try {
      const portFile = await fs.readFile(path.join(profileDir, "DevToolsActivePort"), "utf8");
      const lines = String(portFile || "").split(/\r?\n/).filter(Boolean);
      const discoveredPort = Number(lines[0]);
      if (!Number.isFinite(discoveredPort) || discoveredPort <= 0) {
        return null;
      }
      return tryConnectBrowserByPort(discoveredPort);
    } catch {
      return null;
    }
  };

  const terminatePublishChromeByProfile = () =>
    new Promise((resolve) => {
      const pattern = `--user-data-dir=${profileDir}`;
      const killer = spawn("pkill", ["-f", pattern]);
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });

  const browserByFixedPort = await tryConnectBrowserByPort(WECHAT_PUBLISH_CDP_PORT);
  if (browserByFixedPort) {
    return createSessionFromBrowser(browserByFixedPort, "Connected to existing Chrome debug session");
  }

  const browserByPortFile = await connectFromDevToolsActivePort();
  if (browserByPortFile) {
    return createSessionFromBrowser(browserByPortFile, "Connected to existing Chrome session from profile port file");
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath,
      userDataDir: profileDir,
      defaultViewport: null,
      args: [
        "--lang=zh-CN",
        "--start-maximized",
        "--window-size=1720,1080",
        `--remote-debugging-port=${WECHAT_PUBLISH_CDP_PORT}`,
        "--remote-debugging-address=127.0.0.1"
      ]
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (message.includes("already running") || message.includes("userDataDir")) {
      const reconnectFixed = await tryConnectBrowserByPort(WECHAT_PUBLISH_CDP_PORT);
      if (reconnectFixed) {
        return createSessionFromBrowser(reconnectFixed, "Reconnected to existing Chrome profile session");
      }

      const reconnectPortFile = await connectFromDevToolsActivePort();
      if (reconnectPortFile) {
        return createSessionFromBrowser(reconnectPortFile, "Reconnected to existing Chrome session from profile port file");
      }

      pushPublishLog(taskId, onMessage, "info", "[Publish] Profile is locked. Trying to terminate stale publish Chrome process...");
      await terminatePublishChromeByProfile();
      await sleep(600);

      try {
        browser = await puppeteer.launch({
          headless: false,
          executablePath,
          userDataDir: profileDir,
          defaultViewport: null,
          args: [
            "--lang=zh-CN",
            "--start-maximized",
            "--window-size=1720,1080",
            `--remote-debugging-port=${WECHAT_PUBLISH_CDP_PORT}`,
            "--remote-debugging-address=127.0.0.1"
          ]
        });
        pushPublishLog(taskId, onMessage, "info", "[Publish] Relaunched Chrome after clearing stale lock");
      } catch {
        throw new Error("wechat_chrome_profile_locked:close_existing_chrome_or_enable_debug_port");
      }
    }
    throw error;
  }
  const page = await browser.newPage();
  page.setDefaultTimeout(WECHAT_PUBLISH_STEP_TIMEOUT_MS);
  const session = {
    browser,
    page,
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };
  WECHAT_PUBLISH_SESSIONS.set(taskId, session);
  browser.on("disconnected", () => {
    const active = WECHAT_PUBLISH_SESSIONS.get(taskId);
    if (active?.browser === browser) {
      WECHAT_PUBLISH_SESSIONS.delete(taskId);
    }
  });
  pushPublishLog(taskId, onMessage, "info", "[Publish] Open new Chrome session");
  return session;
}

async function runWechatPublishAutomation({ taskId, videoArtifact, descriptionText, shortTitleText, onMessage }) {
  const session = await getOrCreateWechatPublishSession(taskId, onMessage);
  let page = session.page;

  try {
    const freshPage = await session.browser.newPage();
    freshPage.setDefaultTimeout?.(WECHAT_PUBLISH_STEP_TIMEOUT_MS);
    try {
      await session.page?.close?.();
    } catch {
      // ignore
    }
    page = freshPage;
    session.page = freshPage;
    pushPublishLog(taskId, onMessage, "info", "[Publish] Fresh page created for current run");
  } catch {
    // keep existing page
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openflow-publish-"));
  const tempVideoPath = path.join(tempDir, `${taskId}.mp4`);

  try {
    const startedAt = Date.now();
    page.on("dialog", async (dialog) => {
      try {
        await dialog.accept();
      } catch {
        // ignore dialog errors
      }
    });
    pushPublishLog(taskId, onMessage, "info", `[Publish] Pipeline start (step-timeout=${WECHAT_PUBLISH_STEP_TIMEOUT_MS}ms, total-timeout=${WECHAT_PUBLISH_TIMEOUT_MS}ms)`);
    await fs.writeFile(tempVideoPath, videoArtifact.data);
    pushPublishLog(taskId, onMessage, "info", `[Publish] Prepared local video file: ${tempVideoPath}`);
    session.lastActiveAt = Date.now();
    page = await resolveLatestWechatPage(session.browser, page);
    session.page = page;
    pushPublishLog(taskId, onMessage, "info", `[Publish] Active page selected: ${String(page.url() || "about:blank")}`);

    pushPublishLog(taskId, onMessage, "info", "[Publish] Open WeChat Channels post list");
    try {
      await page.goto(WECHAT_PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: WECHAT_PUBLISH_STEP_TIMEOUT_MS });
    } catch (error) {
      pushPublishLog(taskId, onMessage, "info", `[Publish] Navigate post list failed once: ${error.message || String(error)}`);
      await dismissDraftSaveDialogIfPresent(page, taskId, onMessage);
      await page.goto(WECHAT_PUBLISH_URL, { waitUntil: "domcontentloaded", timeout: WECHAT_PUBLISH_STEP_TIMEOUT_MS });
    }
    pushPublishLog(taskId, onMessage, "info", `[Publish] Navigated: ${String(page.url() || "unknown")}`);

    const beforeEntryDiag = await collectPublishFrameDiagnostics(page);
    pushPublishLog(taskId, onMessage, "info", `[Publish] Pre-entry diagnostics: ${formatPublishDiagnosticsSnapshot(beforeEntryDiag)}`);

    let fileInput = null;
    try {
      fileInput = await waitForFileInputAcrossFrames(page, 1500);
      pushPublishLog(taskId, onMessage, "info", "[Publish] File input already exists, skip entry click");
    } catch {
      fileInput = null;
    }

    if (!fileInput) {
      pushPublishLog(taskId, onMessage, "info", "[Publish] Waiting for login and '发表视频' button");
      const waitStartedAt = Date.now();
      let clicked = false;
      let nextHeartbeatAt = Date.now() + WECHAT_PUBLISH_HEARTBEAT_MS;
      let clickNoTransitionCount = 0;
      let lastSearchDebug = [];
      while (Date.now() - waitStartedAt < WECHAT_PUBLISH_TIMEOUT_MS) {
        const searchResult = await clickElementByTextAcrossFrames(page, ["发表视频", "发布视频", "去发表视频", "去发布视频"]);
        lastSearchDebug = Array.isArray(searchResult?.debug) ? searchResult.debug : [];
        if (searchResult?.clicked) {
          const matched = lastSearchDebug.find((item) => item.matchedText)?.matchedText || "unknown";
          pushPublishLog(taskId, onMessage, "info", `[Publish] Publish button matched by text: ${matched}, waiting for publish entry state...`);
          await sleep(700);

          page = await resolveLatestWechatPage(session.browser, page);
          session.page = page;
          const entered = await waitForPublishEntryState(page, 7000);
          if (entered.ok) {
            clicked = true;
            pushPublishLog(taskId, onMessage, "success", `[Publish] Entered publish flow: ${entered.state?.signal || "unknown"}`);
            const enteredDiag = await collectPublishFrameDiagnostics(page);
            pushPublishLog(taskId, onMessage, "info", `[Publish] Post-entry diagnostics: ${formatPublishDiagnosticsSnapshot(enteredDiag)}`);
            break;
          }

          clickNoTransitionCount += 1;

          const stateSummary = (entered.state?.frameStates || [])
            .map((item) => {
              const shortUrl = String(item.frameUrl || "about:blank").slice(0, 48);
              return `${shortUrl}[file:${item.anyFileInputs},desc:${item.textareas + item.editables}]`;
            })
            .slice(0, 4)
            .join(" ; ");
          pushPublishLog(
            taskId,
            onMessage,
            "info",
            `[Publish] Click happened but entry state not confirmed yet, continue searching. url=${entered.state?.pageUrl || page.url()} samples=${stateSummary || "none"}`
          );

          if (clickNoTransitionCount >= 3) {
            const directOk = await tryDirectNavigateToPublishEntry(taskId, page, onMessage);
            if (directOk) {
              clicked = true;
              break;
            }
            clickNoTransitionCount = 0;
          }
        }

        const nowTs = Date.now();
        if (nowTs >= nextHeartbeatAt) {
          const elapsed = Math.floor((nowTs - waitStartedAt) / 1000);
          const currentUrl = String(page.url() || "");
          const frameCount = lastSearchDebug.length;
          const sampleSummary = lastSearchDebug
            .map((item) => {
              const src = item.frameUrl ? item.frameUrl.slice(0, 48) : "about:blank";
              const sample = Array.isArray(item.sampleTexts) ? item.sampleTexts.slice(0, 3).join("|") : "";
              return `${src}=>${sample || "no-text"}`;
            })
            .slice(0, 3)
            .join(" ; ");
          onMessage?.({
            type: "heartbeat",
            message: `[Publish] Waiting login or publish button... ${elapsed}s (${currentUrl}) frames=${frameCount} samples=${sampleSummary || "none"}`,
            timestamp: new Date().toISOString()
          });
          if (elapsed > 0 && elapsed % 45 === 0) {
            pushPublishLog(taskId, onMessage, "info", "[Publish] Retry reload current page during wait");
            await page.reload({ waitUntil: "domcontentloaded", timeout: WECHAT_PUBLISH_STEP_TIMEOUT_MS }).catch(() => {});
          }
          nextHeartbeatAt = nowTs + WECHAT_PUBLISH_HEARTBEAT_MS;
        }
        await sleep(800);
      }
      if (!clicked) {
        pushPublishLog(taskId, onMessage, "info", "[Publish] Waiting login timeout. Keep browser session alive, click Publish again to resume.");
        return {
          ok: true,
          status: "waiting_login",
          note: "Login wait timeout. Browser session is still open, finish login then click Publish again to resume."
        };
      }
      pushPublishLog(taskId, onMessage, "success", "[Publish] '发表视频' clicked");
    }

    await dismissDraftSaveDialogIfPresent(page, taskId, onMessage);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "auto" }));
    let descDiagLogged = false;
    let locationDiagLogged = false;
    let originalDiagLogged = false;
    await runPublishStepWithRetry({
      taskId,
      onMessage,
      stepKey: "upload_started",
      probeDone: () => hasUploadStartedSignal(page),
      runAction: async () => {
        await uploadVideoWithFallback(page, tempVideoPath, taskId, onMessage);
      }
    });
    pushPublishLog(taskId, onMessage, "success", "[Publish] Upload triggered for Step5 final BGM output");

    await runPublishStepWithRetry({
      taskId,
      onMessage,
      stepKey: "fill_description",
      probeDone: () => isDescriptionFilledAcrossFrames(page, descriptionText),
      runAction: async () => {
        const descFilled = (await fillFirstDescriptionFieldAcrossFrames(page, descriptionText)) ||
          (await (async () => {
            try {
              await fillFirstDescriptionField(page, descriptionText);
              return true;
            } catch {
              return false;
            }
          })());
        if (!descFilled) {
          await dismissDraftSaveDialogIfPresent(page, taskId, onMessage);
          if (!descDiagLogged) {
            const diag = await collectFieldDiagnostics(page, "视频描述");
            pushPublishLog(taskId, onMessage, "info", `[Publish] Description diagnostics: ${JSON.stringify(diag).slice(0, 1200)}`);
            descDiagLogged = true;
          }
          throw new Error("wechat_publish_description_input_not_found");
        }
      }
    });
    pushPublishLog(taskId, onMessage, "success", `[Publish] Description filled: ${descriptionText}`);

    await runPublishStepWithRetry({
      taskId,
      onMessage,
      stepKey: "set_location_hidden",
      probeDone: () => isLocationHiddenAcrossFrames(page),
      runAction: async () => {
        const done = await ensureLocationHidden(page, taskId, onMessage);
        if (!done) {
          if (!locationDiagLogged) {
            const diag = await collectFieldDiagnostics(page, "位置");
            pushPublishLog(taskId, onMessage, "info", `[Publish] Location diagnostics: ${JSON.stringify(diag).slice(0, 1200)}`);
            locationDiagLogged = true;
          }
          throw new Error("wechat_publish_location_not_hidden");
        }
      }
    });

    await runPublishStepWithRetry({
      taskId,
      onMessage,
      stepKey: "fill_short_title",
      probeDone: () => isShortTitleFilledAcrossFrames(page, shortTitleText),
      runAction: async () => {
        const shortTitleFilled = await fillShortTitleIfPresentAcrossFrames(page, shortTitleText);
        if (!shortTitleFilled) {
          throw new Error("wechat_publish_short_title_input_not_found");
        }
      }
    });

    await runPublishStepWithRetry({
      taskId,
      onMessage,
      stepKey: "check_original",
      probeDone: async () => {
        const checked = await isOriginalDeclarationCheckedAcrossFrames(page);
        if (!checked) return false;
        const dialogState = await inspectOriginalRightsDialogAcrossFrames(page);
        return !dialogState.visible;
      },
      runAction: async () => {
        const toggled = await toggleOriginalDeclarationAcrossFrames(page);
        await sleep(300);
        const dialogBefore = await inspectOriginalRightsDialogAcrossFrames(page);
        if (dialogBefore.visible) {
          pushPublishLog(
            taskId,
            onMessage,
            "info",
            `[Publish] Original dialog before confirm: checked=${dialogBefore.checked ? 1 : 0} btn=${dialogBefore.primaryText || "none"} disabled=${dialogBefore.primaryDisabled ? 1 : 0}`
          );
        }
        let dialogResult = await handleOriginalRightsDialogAcrossFrames(page, taskId, onMessage);
        if (!dialogResult.found) {
          await sleep(650);
          dialogResult = await handleOriginalRightsDialogAcrossFrames(page, taskId, onMessage);
        }

        await sleep(280);
        const dialogAfter = await inspectOriginalRightsDialogAcrossFrames(page);
        if (dialogAfter.visible) {
          pushPublishLog(
            taskId,
            onMessage,
            "info",
            `[Publish] Original dialog after confirm: checked=${dialogAfter.checked ? 1 : 0} btn=${dialogAfter.primaryText || "none"} disabled=${dialogAfter.primaryDisabled ? 1 : 0}`
          );
        }
        if (dialogAfter.visible) {
          pushPublishLog(taskId, onMessage, "info", "[Publish] Original rights dialog still visible after attempt");
        }
        if (dialogResult.found && !dialogResult.confirmed) {
          throw new Error("wechat_publish_original_dialog_not_confirmed");
        }
        if (dialogAfter.visible) {
          throw new Error("wechat_publish_original_dialog_still_visible");
        }
        if (!toggled && !dialogResult.found) {
          if (!originalDiagLogged) {
            const diag = await collectFieldDiagnostics(page, "声明原创");
            pushPublishLog(taskId, onMessage, "info", `[Publish] Original diagnostics: ${JSON.stringify(diag).slice(0, 1200)}`);
            originalDiagLogged = true;
          }
          throw new Error("wechat_publish_original_toggle_not_found");
        }
      }
    });

    const finalDiag = await collectPublishFrameDiagnostics(page);
    pushPublishLog(taskId, onMessage, "info", `[Publish] Final diagnostics: ${formatPublishDiagnosticsSnapshot(finalDiag)}`);

    pushPublishLog(taskId, onMessage, "success", `[Publish] Completed in ${Date.now() - startedAt}ms. Waiting for manual final publish click in browser.`);
    return {
      ok: true,
      status: "waiting_manual_publish",
      note: "Browser remains open. Please click final publish manually after review."
    };
  } catch (error) {
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function executePublishPipeline({ taskId, sourceDescription, shortTitle, onMessage = null }) {
  ensureTask(taskId);

  const videoArtifact = latestPublishVideoArtifact(taskId);
  if (!videoArtifact) {
    throw new Error("publish_video_required:please_generate_step5_final_bgm_video_first");
  }

  const publishDescription = buildWechatPublishDescription(taskId, sourceDescription);
  const publishShortTitle = String(shortTitle || "").trim() || buildWechatPublishShortTitle(taskId, sourceDescription);

  db.prepare("UPDATE tasks SET status = ?, phase = ?, updated_at = ? WHERE id = ?").run("publishing", "RESULT", now(), taskId);
  pushPublishLog(taskId, onMessage, "info", `[Publish] Start Chrome automation with artifact=${videoArtifact.id}`);

  const automationResult = await runWechatPublishAutomation({
    taskId,
    videoArtifact,
    descriptionText: publishDescription,
    shortTitleText: publishShortTitle,
    onMessage
  });

  const nextStatus = automationResult?.status === "waiting_login" ? "waiting_login" : "waiting_manual_publish";
  db.prepare("UPDATE tasks SET status = ?, phase = ?, updated_at = ? WHERE id = ?").run(nextStatus, "RESULT", now(), taskId);
  return {
    ok: true,
    status: nextStatus,
    videoArtifactId: videoArtifact.id,
    description: publishDescription,
    shortTitle: publishShortTitle,
    topics: [],
    note:
      automationResult?.note ||
      (nextStatus === "waiting_login"
        ? "Login required. Browser session remains open, finish login then click Publish again to resume."
        : "Browser remains open. Please click final publish manually after review.")
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/model-settings", (_req, res) => {
  const settings = getModelSettings();
  res.json({
    id: settings.id,
    provider: settings.provider,
    prompt_model: settings.prompt_model,
    image_model: settings.image_model,
    video_model: settings.video_model,
    has_api_key: settings.has_api_key,
    api_key_masked: settings.api_key_masked,
    encryption_enabled: settings.encryption_enabled
  });
});

app.get("/api/bgm-library", async (_req, res, next) => {
  try {
    const directory = path.normalize(BGM_LIBRARY_DIR);
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        res.json({ directory, files: [] });
        return;
      }
      throw error;
    }
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"))
      .map((entry) => path.join(directory, entry.name))
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
    res.json({ directory, files });
  } catch (err) {
    next(err);
  }
});

app.put("/api/model-settings", (req, res, next) => {
  try {
    const provider = (req.body?.provider || "gemini").trim();
    if (provider !== "gemini") {
      throw new Error("only_gemini_supported_now");
    }
    const updated = updateModelSettings(req.body || {});
    res.json({
      id: updated.id,
      provider: updated.provider,
      prompt_model: updated.prompt_model,
      image_model: updated.image_model,
      video_model: updated.video_model,
      has_api_key: updated.has_api_key,
      api_key_masked: updated.api_key_masked,
      encryption_enabled: updated.encryption_enabled
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/style-action-settings", (_req, res) => {
  res.json(getStyleActionSettings());
});

app.put("/api/style-action-settings", (req, res, next) => {
  try {
    const updated = updateStyleActionSettings(req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.get("/api/narrative-action-settings", (_req, res) => {
  res.json(getNarrativeActionSettings());
});

app.put("/api/narrative-action-settings", (req, res, next) => {
  try {
    const updated = updateNarrativeActionSettings(req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.get("/api/publish-action-settings", (_req, res) => {
  res.json(getPublishActionSettings());
});

app.get("/api/publish-action-setting", (_req, res) => {
  res.json(getPublishActionSettings());
});

app.get("/api/publish-settings", (_req, res) => {
  res.json(getPublishActionSettings());
});

app.put("/api/publish-action-settings/:channel", (req, res, next) => {
  try {
    const updated = updatePublishActionSetting(req.params.channel, req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.put("/api/publish-action-setting/:channel", (req, res, next) => {
  try {
    const updated = updatePublishActionSetting(req.params.channel, req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.put("/api/publish-settings/:channel", (req, res, next) => {
  try {
    const updated = updatePublishActionSetting(req.params.channel, req.body || {});
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.get("/api/tasks/:taskId/narrative-style-prompts", (req, res, next) => {
  try {
    ensureTask(req.params.taskId);
    res.json({ items: getNarrativeStylePrompts(req.params.taskId) });
  } catch (err) {
    next(err);
  }
});

app.put("/api/tasks/:taskId/narrative-style-prompts/:promptId", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const row = db
      .prepare("SELECT * FROM narrative_style_prompts WHERE task_id = ? AND id = ?")
      .get(taskId, req.params.promptId);
    if (!row) {
      throw new Error("narrative_style_prompt_not_found");
    }
    const name = String(req.body?.name ?? row.name).trim() || row.name;
    const promptText = String(req.body?.prompt_text ?? row.prompt_text).trim() || row.prompt_text;
    db.prepare("UPDATE narrative_style_prompts SET name = ?, prompt_text = ?, updated_at = ? WHERE id = ?").run(
      name,
      promptText,
      now(),
      row.id
    );
    addLog(taskId, "info", `Narrative style prompt updated: ${name}`);
    const updated = db.prepare("SELECT * FROM narrative_style_prompts WHERE id = ?").get(row.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.get("/api/clean-prompt", (_req, res) => {
  res.json(getCleanPromptState());
});

app.post("/api/clean-prompt/versions", (req, res, next) => {
  try {
    const content = req.body?.content;
    if (!content || typeof content !== "string") {
      throw new Error("clean_prompt_content_required");
    }
    const versionId = saveCleanPromptVersion(content, "user");
    res.status(201).json({ versionId, ...getCleanPromptState() });
  } catch (err) {
    next(err);
  }
});

app.post("/api/clean-prompt/restore/:versionId", (req, res, next) => {
  try {
    const restored = restoreCleanPromptVersion(req.params.versionId);
    if (!restored) {
      throw new Error("clean_prompt_version_not_found");
    }
    res.json({ ok: true, ...getCleanPromptState() });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/clean-prompt/versions/:versionId", (req, res, next) => {
  try {
    const versionId = req.params.versionId;
    const target = db.prepare("SELECT * FROM clean_prompt_versions WHERE id = ?").get(versionId);
    if (!target) {
      throw new Error("clean_prompt_version_not_found");
    }

    const total = db.prepare("SELECT COUNT(1) AS c FROM clean_prompt_versions").get().c;
    if (total <= 1) {
      throw new Error("clean_prompt_last_version_protected");
    }

    db.prepare("DELETE FROM clean_prompt_versions WHERE id = ?").run(versionId);

    const state = db.prepare("SELECT * FROM clean_prompt_state WHERE id = 'default'").get();
    if (state?.current_version_id === versionId) {
      const fallback = db.prepare("SELECT id FROM clean_prompt_versions ORDER BY created_at DESC LIMIT 1").get();
      if (!fallback?.id) {
        throw new Error("clean_prompt_fallback_missing");
      }
      db.prepare("UPDATE clean_prompt_state SET current_version_id = ?, updated_at = ? WHERE id = 'default'").run(
        fallback.id,
        now()
      );
    }

    res.json({ ok: true, deletedVersionId: versionId, ...getCleanPromptState() });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks", (req, res) => {
  const id = uid("task");
  const at = now();
  db.prepare(
    "INSERT INTO tasks (id, aspect_ratio, phase, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, req.body?.aspectRatio || "9:16", "INPUT", "idle", at, at);
  addLog(id, "info", "Task created");
  res.status(201).json(taskState(id));
});

app.get("/api/tasks", (_req, res) => {
  const items = db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100").all();
  res.json({ items });
});

app.get("/api/tasks/summary", (_req, res) => {
  res.json({ items: taskSummaryList() });
});

app.delete("/api/tasks/:taskId", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);

    db.transaction(() => {
      db.prepare("DELETE FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE task_id = ?)").run(taskId);
      db.prepare("DELETE FROM prompts WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM artifacts WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM narrative_style_prompts WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM narrative_options WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM production_tasks WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM logs WHERE task_id = ?").run(taskId);
      db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId);
    })();

    res.json({ ok: true, deletedTaskId: taskId });
  } catch (err) {
    next(err);
  }
});

app.get("/api/tasks/:taskId/state", (req, res, next) => {
  try {
    res.json(taskState(req.params.taskId));
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/upload-source", upload.single("image"), (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    if (!req.file?.buffer) {
      throw new Error("missing_image");
    }
    const artifactId = insertArtifact(taskId, "source_image", req.file.mimetype || "image/png", req.file.buffer, {
      name: req.file.originalname || "source"
    });
    db.prepare("UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?").run("STYLE", now(), taskId);
    addLog(taskId, "success", "Source image uploaded");
    res.json({ artifactId, url: artifactUrl(artifactId) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/production-frame/upload", upload.single("image"), (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const role = String(req.body?.role || "").trim();
    if (!req.file?.buffer) {
      throw new Error("missing_image");
    }
    if (role !== "start" && role !== "end") {
      throw new Error("production_frame_role_invalid");
    }
    const artifactType = role === "start" ? "production_start_image" : "production_end_image";
    const artifactId = insertArtifact(taskId, artifactType, req.file.mimetype || "image/png", req.file.buffer, {
      role,
      name: req.file.originalname || `${role}-frame`
    });
    if (role === "start") {
      db.prepare("UPDATE tasks SET selected_start_artifact_id = ?, updated_at = ? WHERE id = ?").run(artifactId, now(), taskId);
      addLog(taskId, "success", "Production start frame uploaded");
    } else {
      db.prepare("UPDATE tasks SET selected_end_artifact_id = ?, updated_at = ? WHERE id = ?").run(artifactId, now(), taskId);
      addLog(taskId, "success", "Production end frame uploaded");
    }
    res.json({ role, artifactId, url: artifactUrl(artifactId), task: getTask(taskId) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/cover-source/upload", upload.single("image"), (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    if (!req.file?.buffer) {
      throw new Error("missing_image");
    }
    const artifactId = insertArtifact(taskId, "cover_source_image", req.file.mimetype || "image/png", req.file.buffer, {
      name: req.file.originalname || "cover-source"
    });
    addLog(taskId, "success", "Cover source image uploaded");
    res.json({ artifactId, url: artifactUrl(artifactId) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/cover-frame/generate", upload.array("images", PRODUCTION_REFINE_MAX_REFERENCES), async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    const task = ensureTask(taskId);
    const requestedBaseArtifactId = String(
      req.body?.baseArtifactId || req.body?.selectedCoverArtifactId || task.cover_artifact_id || task.selected_start_artifact_id || ""
    ).trim();
    const baseArtifact = requestedBaseArtifactId ? getImageArtifactInTask(taskId, requestedBaseArtifactId) : null;
    const refs = Array.isArray(req.files) ? req.files : [];
    if (!baseArtifact && refs.length === 0) {
      throw new Error("cover_base_image_required");
    }
    const title = String(req.body?.title || "").trim();
    const promptText = String(req.body?.prompt || "").trim();
    const settings = getModelSettings();
    const result = await generateCoverFrameWithGemini({
      taskId,
      baseArtifact,
      referenceFiles: refs,
      settings,
      title,
      promptText
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/production-frame/refine", upload.array("images", PRODUCTION_REFINE_MAX_REFERENCES), async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    const task = ensureTask(taskId);
    const role = String(req.body?.role || "").trim();
    if (role !== "start" && role !== "end") {
      throw new Error("production_frame_role_invalid");
    }
    const promptText = String(req.body?.prompt || "").trim();
    if (!promptText) {
      throw new Error("production_refine_prompt_required");
    }

    const selectedArtifactId = role === "start" ? task.selected_start_artifact_id : task.selected_end_artifact_id;
    if (!selectedArtifactId) {
      throw new Error(role === "start" ? "production_start_frame_required" : "production_end_frame_required");
    }
    const baseFrameArtifact = getImageArtifactInTask(taskId, selectedArtifactId);
    if (!baseFrameArtifact) {
      throw new Error(role === "start" ? "production_start_frame_required" : "production_end_frame_required");
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const invalidFile = files.find((file) => !String(file?.mimetype || "").startsWith("image/"));
    if (invalidFile) {
      throw new Error("production_refine_only_image_files_allowed");
    }

    const settings = getModelSettings();
    const result = await refineProductionFrameWithGemini({
      taskId,
      role,
      baseFrameArtifact,
      referenceFiles: files,
      settings,
      promptText
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/clean-image", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const src = latestArtifact(taskId, "source_image");
    if (!src) {
      throw new Error("source_image_required");
    }
    const settings = getModelSettings();
    const cleanPrompt = getCleanPromptState();
    const result = await cleanImageWithGemini({
      taskId,
      sourceArtifact: src,
      settings,
      promptText: cleanPrompt.currentContent,
      onMessage: null
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/api/tasks/:taskId/clean-image/stream", async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const src = latestArtifact(taskId, "source_image");
    if (!src) {
      throw new Error("source_image_required");
    }
    const settings = getModelSettings();
    const cleanPrompt = getCleanPromptState();

    const result = await cleanImageWithGemini({
      taskId,
      sourceArtifact: src,
      settings,
      promptText: cleanPrompt.currentContent,
      onMessage: push
    });

    push({ type: "done", ...result });
  } catch (error) {
    addLog(taskId, "error", `Clean failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    res.end();
  }
});

app.post("/api/tasks/:taskId/crop-image", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    if (!req.body?.croppedDataUrl) {
      throw new Error("cropped_data_required");
    }
    const { mimeType, buffer } = decodeDataUrl(req.body.croppedDataUrl);
    const id = insertArtifact(taskId, "cropped_image", mimeType, buffer, {
      ratio: req.body?.ratio || "9:16",
      crop: req.body?.crop || null
    });
    db.prepare("UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?").run("STYLE", now(), taskId);
    addLog(taskId, "success", "Image cropped");
    res.json({ artifactId: id, url: artifactUrl(id) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/style-prompts/generate", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const settings = getModelSettings();
    const styleActionSettings = getStyleActionSettings();
    const sourceArtifact =
      latestArtifact(taskId, "cropped_image") || latestArtifact(taskId, "cleaned_image") || latestArtifact(taskId, "source_image");
    if (!sourceArtifact) {
      throw new Error("image_required");
    }
    generateStylePromptsWithGemini({
      taskId,
      sourceArtifact,
      settings,
      instruction: styleActionSettings.prompt_generation_instruction,
      onMessage: null
    })
      .then((result) => res.json(result))
      .catch(next);
  } catch (err) {
    next(err);
  }
});

const handleStylePromptsStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const settings = getModelSettings();
    const styleActionSettings = getStyleActionSettings();
    const sourceArtifact =
      latestArtifact(taskId, "cropped_image") || latestArtifact(taskId, "cleaned_image") || latestArtifact(taskId, "source_image");
    if (!sourceArtifact) {
      throw new Error("image_required");
    }
    const result = await generateStylePromptsWithGemini({
      taskId,
      sourceArtifact,
      settings,
      instruction: styleActionSettings.prompt_generation_instruction,
      onMessage: push
    });
    push({ type: "done", promptCount: result.prompts.filter((p) => p.prompt_type === "style").length });
  } catch (error) {
    addLog(taskId, "error", `Style prompt generation failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    res.end();
  }
};

app.get("/api/tasks/:taskId/style-prompts/generate/stream", handleStylePromptsStream);
app.post("/api/tasks/:taskId/style-prompts/generate/stream", handleStylePromptsStream);

app.post("/api/tasks/:taskId/style-images/generate", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const sourceArtifact =
      latestArtifact(taskId, "cropped_image") || latestArtifact(taskId, "cleaned_image") || latestArtifact(taskId, "source_image");
    if (!sourceArtifact) {
      throw new Error("image_required");
    }
    const settings = getModelSettings();
    const result = await generateStyleImagesWithGemini({ taskId, sourceArtifact, settings, onMessage: null });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const handleStyleImagesStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const sourceArtifact =
      latestArtifact(taskId, "cropped_image") || latestArtifact(taskId, "cleaned_image") || latestArtifact(taskId, "source_image");
    if (!sourceArtifact) {
      throw new Error("image_required");
    }
    const settings = getModelSettings();
    const result = await generateStyleImagesWithGemini({ taskId, sourceArtifact, settings, onMessage: push });
    push({ type: "done", ...result });
  } catch (error) {
    addLog(taskId, "error", `Style generation failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    res.end();
  }
};

app.get("/api/tasks/:taskId/style-images/generate/stream", handleStyleImagesStream);
app.post("/api/tasks/:taskId/style-images/generate/stream", handleStyleImagesStream);

app.post("/api/tasks/:taskId/start-image/select", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const artifactId = req.body?.artifactId;
    if (!artifactId) {
      throw new Error("artifact_id_required");
    }
    db.prepare("UPDATE tasks SET selected_start_artifact_id = ?, phase = ?, updated_at = ? WHERE id = ?").run(
      artifactId,
      "NARRATIVE",
      now(),
      taskId
    );
    addLog(taskId, "success", "Start frame selected");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/narrative-prompts/generate", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const settings = getModelSettings();
    const narrativeSettings = getNarrativeActionSettings();
    const sourceArtifact = requireSelectedStartFrameArtifact(taskId);
    generateNarrativePromptsWithGemini({
      taskId,
      sourceArtifact,
      settings,
      instruction: narrativeSettings.generation_instruction,
      onMessage: null
    })
      .then((result) => res.json(result))
      .catch(next);
  } catch (err) {
    next(err);
  }
});

const handleNarrativePromptsStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const settings = getModelSettings();
    const narrativeSettings = getNarrativeActionSettings();
    const sourceArtifact = requireSelectedStartFrameArtifact(taskId);
    const result = await generateNarrativePromptsWithGemini({
      taskId,
      sourceArtifact,
      settings,
      instruction: narrativeSettings.generation_instruction,
      onMessage: push
    });
    push({ type: "done", promptCount: result.narrativeStylePrompts.length });
  } catch (error) {
    addLog(taskId, "error", `Narrative prompt generation failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    res.end();
  }
};

app.get("/api/tasks/:taskId/narrative-prompts/generate/stream", handleNarrativePromptsStream);
app.post("/api/tasks/:taskId/narrative-prompts/generate/stream", handleNarrativePromptsStream);

app.post("/api/tasks/:taskId/narratives/generate", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const settings = getModelSettings();
    const sourceArtifact = requireSelectedStartFrameArtifact(taskId);
    generateNarrativeEndFramesWithGemini({
      taskId,
      sourceArtifact,
      settings,
      generationInstruction: getNarrativeActionSettings().generation_instruction,
      onMessage: null
    })
      .then((result) => res.json(result))
      .catch(next);
  } catch (err) {
    next(err);
  }
});

const handleNarrativesStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let heartbeatMessage = "Narrative stream connected";
  let heartbeatScene = 0;
  const pushHeartbeat = () => {
    push({
      type: "heartbeat",
      message: `${heartbeatMessage} (${heartbeatScene}/3)`,
      timestamp: new Date().toISOString()
    });
  };

  const pushWithHeartbeatState = (payload) => {
    if (payload?.type === "log" && payload?.message) {
      const msg = String(payload.message);
      const sceneMatch = msg.match(/Narrative\s+(\d+)\/3/i);
      if (sceneMatch?.[1]) {
        heartbeatScene = Number(sceneMatch[1]) || heartbeatScene;
      }
      if (/generating scripts/i.test(msg)) {
        heartbeatMessage = "Narrative generating scripts";
      } else if (/generating tail frame image/i.test(msg)) {
        heartbeatMessage = "Narrative generating tail frame";
      } else if (/saved/i.test(msg)) {
        heartbeatMessage = "Narrative scene saved";
      }
    }
    if (payload?.type === "item_saved" && payload?.index) {
      heartbeatScene = Number(payload.index) || heartbeatScene;
      heartbeatMessage = "Narrative item saved";
    }
    push(payload);
  };

  const heartbeatTimer = setInterval(pushHeartbeat, 8000);
  pushHeartbeat();

  try {
    const settings = getModelSettings();
    const sourceArtifact = requireSelectedStartFrameArtifact(taskId);
    const result = await generateNarrativeEndFramesWithGemini({
      taskId,
      sourceArtifact,
      settings,
      generationInstruction: getNarrativeActionSettings().generation_instruction,
      onMessage: pushWithHeartbeatState
    });
    heartbeatMessage = "Narrative generation completed";
    heartbeatScene = 3;
    push({ type: "done", narrativeCount: result.narratives.length });
  } catch (error) {
    addLog(taskId, "error", `Narrative generation failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    clearInterval(heartbeatTimer);
    res.end();
  }
};

app.get("/api/tasks/:taskId/narratives/generate/stream", handleNarrativesStream);
app.post("/api/tasks/:taskId/narratives/generate/stream", handleNarrativesStream);

app.put("/api/tasks/:taskId/narratives/:narrativeId", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const row = db
      .prepare("SELECT * FROM narrative_options WHERE task_id = ? AND id = ?")
      .get(taskId, req.params.narrativeId);
    if (!row) {
      throw new Error("narrative_not_found");
    }

    const title = String(req.body?.title ?? row.title).trim() || row.title;
    const description = String(req.body?.description ?? row.description).trim() || row.description;
    const part1 = String(req.body?.part1_prompt ?? row.part1_prompt).trim() || row.part1_prompt;
    const part2 = String(req.body?.part2_prompt ?? row.part2_prompt).trim() || row.part2_prompt;
    const endFrame = String(req.body?.end_frame_prompt ?? row.end_frame_prompt).trim() || row.end_frame_prompt;

    const body = req.body || {};
    const changed = {
      part1: Object.prototype.hasOwnProperty.call(body, "part1_prompt"),
      part2: Object.prototype.hasOwnProperty.call(body, "part2_prompt"),
      end: Object.prototype.hasOwnProperty.call(body, "end_frame_prompt")
    };

    db.prepare(
      "UPDATE narrative_options SET title = ?, description = ?, part1_prompt = ?, part2_prompt = ?, end_frame_prompt = ? WHERE id = ?"
    ).run(title, description, part1, part2, endFrame, row.id);

    persistNarrativePromptVersions(
      taskId,
      {
        part1: changed.part1 ? part1 : "",
        part2: changed.part2 ? part2 : "",
        end: changed.end ? endFrame : ""
      },
      "user"
    );

    addLog(taskId, "info", `Narrative scene updated: ${title}`);
    const updated = db
      .prepare("SELECT * FROM narrative_options WHERE id = ?")
      .get(row.id);
    res.json({ ...updated, end_frame_url: updated.end_frame_artifact_id ? artifactUrl(updated.end_frame_artifact_id) : null });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/narratives/:narrativeId/confirm", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const narrative = db
      .prepare("SELECT * FROM narrative_options WHERE task_id = ? AND id = ?")
      .get(taskId, req.params.narrativeId);
    if (!narrative) {
      throw new Error("narrative_not_found");
    }

    const payload = req.body || {};
    const part1 = payload.part1Prompt || narrative.part1_prompt;
    const part2 = payload.part2Prompt || narrative.part2_prompt;
    const end = payload.endFramePrompt || narrative.end_frame_prompt;

    persistNarrativePromptVersions(taskId, { part1, part2, end }, "user");

    let endFrameId = narrative.end_frame_artifact_id || null;
    if (!endFrameId) {
      const startFrame = db
        .prepare("SELECT * FROM artifacts WHERE id = ?")
        .get(getTask(taskId).selected_start_artifact_id);
      if (!startFrame) {
        throw new Error("start_frame_required");
      }
      endFrameId = insertArtifact(taskId, "end_frame_image", startFrame.mime_type, startFrame.data, {
        fromNarrative: narrative.id
      });
    }

    db.prepare("UPDATE tasks SET selected_narrative_id = ?, phase = ?, updated_at = ? WHERE id = ?").run(
      narrative.id,
      "GENERATION",
      now(),
      taskId
    );

    addLog(taskId, "success", "Narrative confirmed and end frame generated");
    res.json({ endFrameArtifactId: endFrameId, url: artifactUrl(endFrameId) });
  } catch (err) {
    next(err);
  }
});

app.put("/api/tasks/:taskId/production-config", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    const task = ensureTask(taskId);

    let nextStartArtifactId =
      req.body?.startArtifactId === undefined ? task.selected_start_artifact_id : req.body?.startArtifactId || null;
    let nextEndArtifactId =
      req.body?.endArtifactId === undefined ? task.selected_end_artifact_id : req.body?.endArtifactId || null;
    let nextNarrativeId =
      req.body?.narrativeId === undefined ? task.selected_narrative_id : req.body?.narrativeId || null;
    let nextCoverEnabled =
      req.body?.coverEnabled === undefined ? Number(task.cover_enabled || 0) : (req.body?.coverEnabled ? 1 : 0);
    let nextCoverArtifactId =
      req.body?.coverArtifactId === undefined ? task.cover_artifact_id : req.body?.coverArtifactId || null;
    const hasCoverTitle = Object.prototype.hasOwnProperty.call(req.body || {}, "coverTitle");
    const hasCoverPrompt = Object.prototype.hasOwnProperty.call(req.body || {}, "coverPrompt");
    const hasCoverDuration = Object.prototype.hasOwnProperty.call(req.body || {}, "coverDurationSeconds");
    const nextCoverTitle = hasCoverTitle ? String(req.body?.coverTitle || "").trim() : String(task.cover_title || "");
    const nextCoverPrompt = hasCoverPrompt ? String(req.body?.coverPrompt || "").trim() : String(task.cover_prompt || "");
    let nextCoverDurationSeconds = hasCoverDuration
      ? Number(req.body?.coverDurationSeconds)
      : Number(task.cover_duration_seconds || 1);
    if (!Number.isFinite(nextCoverDurationSeconds) || nextCoverDurationSeconds <= 0) {
      nextCoverDurationSeconds = Number(task.cover_duration_seconds || 1) || 1;
    }
    nextCoverDurationSeconds = Math.max(0.2, Math.min(8, nextCoverDurationSeconds));

    if (nextStartArtifactId && !getImageArtifactInTask(taskId, nextStartArtifactId)) {
      if (req.body?.startArtifactId === undefined) {
        addLog(taskId, "warn", `Production config stale start frame cleared: ${nextStartArtifactId}`);
        nextStartArtifactId = null;
      } else {
        throw new Error("production_start_image_not_found");
      }
    }
    if (nextEndArtifactId && !getImageArtifactInTask(taskId, nextEndArtifactId)) {
      if (req.body?.endArtifactId === undefined) {
        addLog(taskId, "warn", `Production config stale end frame cleared: ${nextEndArtifactId}`);
        nextEndArtifactId = null;
      } else {
        throw new Error("production_end_image_not_found");
      }
    }
    if (nextNarrativeId) {
      const narrative = db
        .prepare("SELECT id FROM narrative_options WHERE task_id = ? AND id = ?")
        .get(taskId, nextNarrativeId);
      if (!narrative) {
        if (req.body?.narrativeId === undefined) {
          addLog(taskId, "warn", `Production config stale narrative cleared: ${nextNarrativeId}`);
          nextNarrativeId = null;
        } else {
          throw new Error("production_narrative_not_found");
        }
      }
    }
    if (nextCoverArtifactId && !getImageArtifactInTask(taskId, nextCoverArtifactId)) {
      if (req.body?.coverArtifactId === undefined) {
        addLog(taskId, "warn", `Production config stale cover frame cleared: ${nextCoverArtifactId}`);
        nextCoverArtifactId = null;
      } else {
        throw new Error("cover_image_not_found");
      }
    }
    if (!nextCoverArtifactId) {
      nextCoverEnabled = 0;
    }

    db.prepare(
      "UPDATE tasks SET selected_start_artifact_id = ?, selected_end_artifact_id = ?, selected_narrative_id = ?, cover_enabled = ?, cover_artifact_id = ?, cover_title = ?, cover_prompt = ?, cover_duration_seconds = ?, updated_at = ? WHERE id = ?"
    ).run(
      nextStartArtifactId,
      nextEndArtifactId,
      nextNarrativeId,
      nextCoverEnabled,
      nextCoverArtifactId,
      nextCoverTitle,
      nextCoverPrompt,
      nextCoverDurationSeconds,
      now(),
      taskId
    );

    addLog(
      taskId,
      "info",
      `Production configuration updated: start=${nextStartArtifactId || "-"}, end=${nextEndArtifactId || "-"}, narrative=${nextNarrativeId || "-"}, cover=${nextCoverEnabled ? "on" : "off"}, coverImage=${nextCoverArtifactId || "-"}, coverSeconds=${nextCoverDurationSeconds.toFixed(2)}`
    );
    res.json({ ok: true, task: getTask(taskId) });
  } catch (err) {
    next(err);
  }
});

async function runProductionPipeline({ taskId, onMessage, count = 2 }) {
  const task = ensureTask(taskId);
  const clipCount = normalizeProductionClipCount(count);
  await ensureFfmpegReady();

  const startFrame = getImageArtifactInTask(taskId, task.selected_start_artifact_id);
  if (!startFrame) {
    throw new Error("production_start_image_required: select a production start frame first; prompt-only video generation is forbidden");
  }

  const endFrame = getImageArtifactInTask(taskId, task.selected_end_artifact_id);

  const selectedNarrative = task.selected_narrative_id
    ? db.prepare("SELECT * FROM narrative_options WHERE task_id = ? AND id = ?").get(taskId, task.selected_narrative_id)
    : null;
  if (!selectedNarrative) {
    throw new Error("production_narrative_required");
  }

  const settings = getModelSettings();
  const maxIndexRow = db
    .prepare("SELECT COALESCE(MAX(task_index), -1) AS max_index FROM production_tasks WHERE task_id = ?")
    .get(taskId);
  const nextIndex = (maxIndexRow?.max_index ?? -1) + 1;
  const productionTaskId = uid("pt");
  db.prepare(
    "INSERT INTO production_tasks (id, task_id, task_index, status, step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(productionTaskId, taskId, nextIndex, "processing", "generating_part1", now(), now());

  const push = (payload) => {
    onMessage?.({ ...payload, timestamp: payload.timestamp || new Date().toISOString() });
  };
  const log = (level, message) => {
    const text = `[Production ${nextIndex + 1}] ${message}`;
    addLog(taskId, level, text);
    push({ type: "log", level, message: text });
  };

  let heartbeatStep = "preparing";
  let heartbeatVideoIndex = 0;
  const heartbeatTotal = clipCount === 1 ? 1 : 3;
  const emitHeartbeat = () => {
    push({
      type: "heartbeat",
      message: `Production run ${nextIndex + 1}: ${heartbeatStep} (${heartbeatVideoIndex}/${heartbeatTotal})`
    });
  };
  const setHeartbeat = (step, videoIndex) => {
    heartbeatStep = step;
    heartbeatVideoIndex = videoIndex;
    emitHeartbeat();
  };
  const heartbeatTimer = setInterval(emitHeartbeat, 8000);

  try {
    log("info", `Start run with model=${settings.video_model}`);
    log("info", `Production clip mode: count=${clipCount}`);
    log("info", `Models supporting start+end frame transport: ${frameCapableModelsText()}`);
    log("info", `Using selected production frames: start=${startFrame.id}, end=${endFrame?.id || "-"}`);
    if (!VEO_START_END_FRAME_MODELS.includes(settings.video_model)) {
      log(
        "warn",
        `Current model is not in verified start+end-frame list. Strict frame payload will be sent and run will fail if unsupported: ${settings.video_model}`
      );
    }

    setHeartbeat("generating video #1 (Part1)", 1);
    const part1EndFrame = clipCount === 1 ? endFrame : null;
    if (clipCount === 1) {
      log("info", `Single-clip proof: passing start frame with optional end frame to VEO start=${startFrame.id}, end=${endFrame?.id || "-"}`);
    }
    const part1Video = await generateVideoWithVeo({
      settings,
      prompt: selectedNarrative.part1_prompt,
      startImageArtifact: startFrame,
      endImageArtifact: part1EndFrame,
      aspectRatio: resolveTaskAspectRatio(taskId),
      onLog: log
    });
    const part1Id = insertArtifact(taskId, "video_part1", part1Video.mimeType, part1Video.buffer, {
      runIndex: nextIndex,
      taskIndex: nextIndex,
      narrativeId: selectedNarrative.id,
      narrativeTitle: selectedNarrative.title,
      part1Prompt: selectedNarrative.part1_prompt,
      startArtifactId: startFrame.id,
      endArtifactId: clipCount === 1 ? endFrame?.id || null : null,
      provider: settings.provider,
      videoModel: settings.video_model
    });
    db.prepare("UPDATE production_tasks SET part1_artifact_id = ?, step = ?, updated_at = ? WHERE id = ?").run(
      part1Id,
      "extracting_tail_frame",
      now(),
      productionTaskId
    );
    push({
      type: "item_saved",
      kind: "production_video",
      slot: "part1",
      taskIndex: nextIndex,
      artifactId: part1Id,
      url: artifactUrl(part1Id)
    });

    if (clipCount === 1) {
      db.prepare(
        "UPDATE production_tasks SET status = ?, step = ?, part1_artifact_id = ?, bridge_artifact_id = NULL, part2_artifact_id = NULL, stitched_artifact_id = NULL, updated_at = ? WHERE id = ?"
      ).run("success", "complete", part1Id, now(), productionTaskId);
      db.prepare("UPDATE tasks SET phase = ?, status = ?, updated_at = ? WHERE id = ?").run("RESULT", "ready", now(), taskId);
      addLog(taskId, "success", `Production finished single-clip (${settings.video_model}) with narrative: ${selectedNarrative.title}`);
      return { ok: true, taskIndex: nextIndex, productionTaskId, clipCount };
    }

    setHeartbeat("ffmpeg extracting tail frame from video #1", 1);
    log("info", `ffmpeg extract tail frame start: ${FFMPEG_BIN} -sseof -0.1 -frames:v 1`);
    const extractedTail = await extractLastFrameWithFfmpeg(part1Video.buffer, "jpg");
    const bridgeId = insertArtifact(taskId, "bridge_frame", extractedTail.mimeType, extractedTail.buffer, {
      runIndex: nextIndex,
      fromVideoArtifactId: part1Id,
      source: "ffmpeg_last_frame"
    });
    log("success", "ffmpeg extract tail frame done");

    const part2StartFrame = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(bridgeId);
    db.prepare("UPDATE production_tasks SET bridge_artifact_id = ?, step = ?, updated_at = ? WHERE id = ?").run(
      bridgeId,
      "generating_part2",
      now(),
      productionTaskId
    );

    setHeartbeat("generating video #2 (Part2)", 2);
    const part2Video = await generateVideoWithVeo({
      settings,
      prompt: selectedNarrative.part2_prompt,
      startImageArtifact: part2StartFrame,
      endImageArtifact: endFrame,
      aspectRatio: resolveTaskAspectRatio(taskId),
      onLog: log
    });
    const part2Id = insertArtifact(taskId, "video_part2", part2Video.mimeType, part2Video.buffer, {
      runIndex: nextIndex,
      taskIndex: nextIndex,
      narrativeId: selectedNarrative.id,
      narrativeTitle: selectedNarrative.title,
      part2Prompt: selectedNarrative.part2_prompt,
      startArtifactId: bridgeId,
      endArtifactId: endFrame?.id || null,
      provider: settings.provider,
      videoModel: settings.video_model
    });
    db.prepare("UPDATE production_tasks SET part2_artifact_id = ?, step = ?, updated_at = ? WHERE id = ?").run(
      part2Id,
      "stitching",
      now(),
      productionTaskId
    );
    push({
      type: "item_saved",
      kind: "production_video",
      slot: "part2",
      taskIndex: nextIndex,
      artifactId: part2Id,
      url: artifactUrl(part2Id)
    });

    setHeartbeat("ffmpeg stitching video #1 + #2 -> #3", 3);
    log("info", `ffmpeg stitch start: ${FFMPEG_BIN} concat 2 videos`);
    const stitchedVideo = await concatVideosWithFfmpeg(part1Video.buffer, part2Video.buffer);
    const stitchedId = insertArtifact(taskId, "video_stitched", stitchedVideo.mimeType, stitchedVideo.buffer, {
      runIndex: nextIndex,
      taskIndex: nextIndex,
      narrativeId: selectedNarrative.id,
      part1VideoArtifactId: part1Id,
      part2VideoArtifactId: part2Id,
      provider: settings.provider,
      videoModel: settings.video_model,
      source: "ffmpeg_concat"
    });
    log("success", "ffmpeg stitch done");

    db.prepare(
      "UPDATE production_tasks SET status = ?, step = ?, part1_artifact_id = ?, bridge_artifact_id = ?, part2_artifact_id = ?, stitched_artifact_id = ?, updated_at = ? WHERE id = ?"
    ).run("success", "complete", part1Id, bridgeId, part2Id, stitchedId, now(), productionTaskId);
    push({
      type: "item_saved",
      kind: "production_video",
      slot: "stitched",
      taskIndex: nextIndex,
      artifactId: stitchedId,
      url: artifactUrl(stitchedId)
    });

    db.prepare("UPDATE tasks SET phase = ?, status = ?, updated_at = ? WHERE id = ?").run("RESULT", "ready", now(), taskId);
    addLog(taskId, "success", `Production finished (${settings.video_model}) with narrative: ${selectedNarrative.title}`);

    return { ok: true, taskIndex: nextIndex, productionTaskId, clipCount };
  } catch (err) {
    db.prepare("UPDATE production_tasks SET status = ?, step = ?, error = ?, updated_at = ? WHERE id = ?").run(
      "error",
      "failed",
      err.message || String(err),
      now(),
      productionTaskId
    );
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
  }
}

app.post("/api/tasks/:taskId/production/start", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    const result = await runProductionPipeline({ taskId, onMessage: null, count: req.body?.count });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const handleProductionStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runProductionPipeline({ taskId, onMessage: push, count: req.body?.count });
    push({ type: "done", ...result });
  } catch (error) {
    addLog(taskId, "error", `Production failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    res.end();
  }
};

app.get("/api/tasks/:taskId/production/start/stream", handleProductionStream);
app.post("/api/tasks/:taskId/production/start/stream", handleProductionStream);

app.post("/api/tasks/:taskId/prompts/:promptId/versions", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const payload = resolvePromptVersionBilingualInput(req.body || {});
    const contentZh = payload.zh;
    const contentEn = payload.en;
    if (!contentZh && !contentEn) {
      throw new Error("invalid_content");
    }
    const prompt = db.prepare("SELECT * FROM prompts WHERE id = ? AND task_id = ?").get(req.params.promptId, taskId);
    if (!prompt) {
      throw new Error("prompt_not_found");
    }
    const vid = uid("pv");
    db.prepare("INSERT INTO prompt_versions (id, prompt_id, content, content_zh, content_en, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      vid,
      prompt.id,
      contentEn || contentZh,
      contentZh,
      contentEn,
      "user",
      now()
    );
    db.prepare("UPDATE prompts SET current_version_id = ? WHERE id = ?").run(vid, prompt.id);
    addLog(taskId, "info", `Prompt ${prompt.name} updated`);
    res.status(201).json({ versionId: vid });
  } catch (err) {
    next(err);
  }
});

app.get("/api/tasks/:taskId/bgm-audio-source", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const audioPathInput = String(req.query?.path || "").trim();
    if (!audioPathInput) {
      throw new Error("bgm_audio_path_required");
    }
    const resolvedAudioPath = path.isAbsolute(audioPathInput)
      ? path.normalize(audioPathInput)
      : path.resolve(process.cwd(), audioPathInput);
    const ext = path.extname(resolvedAudioPath).toLowerCase();
    const mimeMap = {
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".wav": "audio/wav",
      ".flac": "audio/flac",
      ".ogg": "audio/ogg"
    };
    const mime = mimeMap[ext] || "application/octet-stream";
    let stats;
    try {
      stats = await fs.stat(resolvedAudioPath);
    } catch {
      throw new Error("bgm_audio_file_not_found");
    }
    if (!stats?.isFile?.()) {
      throw new Error("bgm_audio_file_not_found");
    }

    const totalSize = Number(stats.size) || 0;
    const rangeHeader = String(req.headers.range || "").trim();

    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", "bytes");

    if (!rangeHeader) {
      res.setHeader("Content-Length", String(totalSize));
      createReadStream(resolvedAudioPath).pipe(res);
      return;
    }

    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
    if (!match) {
      res.status(416).setHeader("Content-Range", `bytes */${totalSize}`).end();
      return;
    }

    const startRaw = match[1];
    const endRaw = match[2];
    let start = startRaw ? Number(startRaw) : 0;
    let end = endRaw ? Number(endRaw) : totalSize - 1;

    if (startRaw === "" && endRaw) {
      const suffixLength = Number(endRaw);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
        res.status(416).setHeader("Content-Range", `bytes */${totalSize}`).end();
        return;
      }
      start = Math.max(totalSize - suffixLength, 0);
      end = totalSize - 1;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
      res.status(416).setHeader("Content-Range", `bytes */${totalSize}`).end();
      return;
    }

    end = Math.min(end, totalSize - 1);
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    res.setHeader("Content-Length", String(chunkSize));
    createReadStream(resolvedAudioPath, { start, end }).pipe(res);
  } catch (err) {
    next(err);
  }
});

app.put("/api/tasks/:taskId/prompts/:promptId/name", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const name = (req.body?.name || "").trim();
    const prompt = db.prepare("SELECT * FROM prompts WHERE id = ? AND task_id = ?").get(req.params.promptId, taskId);
    if (!prompt) {
      throw new Error("prompt_not_found");
    }

    let finalName = name;
    if (!finalName) {
      const rows = db
        .prepare("SELECT id FROM prompts WHERE task_id = ? AND prompt_type = ? ORDER BY created_at ASC, id ASC")
        .all(taskId, prompt.prompt_type);
      const index = Math.max(1, rows.findIndex((r) => r.id === prompt.id) + 1);
      if (prompt.prompt_type === "style") {
        finalName = `Style Prompt ${index}`;
      } else if (prompt.prompt_type === "narrative") {
        finalName = `Narrative Prompt ${index}`;
      } else {
        finalName = `Prompt ${index}`;
      }
    }

    db.prepare("UPDATE prompts SET name = ? WHERE id = ?").run(finalName, prompt.id);
    addLog(taskId, "info", `Prompt name updated: ${finalName}`);
    res.json({ ok: true, promptId: prompt.id, name: finalName });
  } catch (err) {
    next(err);
  }
});

app.put("/api/tasks/:taskId/prompts/:promptId/lang", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const lang = req.body?.lang === "zh" ? "zh" : "en";
    const prompt = db.prepare("SELECT * FROM prompts WHERE id = ? AND task_id = ?").get(req.params.promptId, taskId);
    if (!prompt) {
      throw new Error("prompt_not_found");
    }
    db.prepare("UPDATE prompts SET active_lang = ? WHERE id = ?").run(lang, prompt.id);
    addLog(taskId, "info", `Prompt language updated: ${prompt.name} -> ${lang}`);
    res.json({ ok: true, promptId: prompt.id, lang });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/prompts/:promptId/restore/:versionId", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    const version = db
      .prepare("SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?")
      .get(req.params.versionId, req.params.promptId);
    if (!version) {
      throw new Error("version_not_found");
    }
    db.prepare("UPDATE prompts SET current_version_id = ? WHERE id = ?").run(req.params.versionId, req.params.promptId);
    const prompt = db.prepare("SELECT * FROM prompts WHERE id = ? AND task_id = ?").get(req.params.promptId, taskId);
    if (prompt?.prompt_type === "narrative") {
      syncNarrativeOptionFromPromptVersions(taskId);
    }
    addLog(taskId, "info", "Prompt version restored");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/tasks/:taskId/prompts/:promptId/versions/:versionId", (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);

    const prompt = db.prepare("SELECT * FROM prompts WHERE id = ? AND task_id = ?").get(req.params.promptId, taskId);
    if (!prompt) {
      throw new Error("prompt_not_found");
    }

    const version = db
      .prepare("SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?")
      .get(req.params.versionId, prompt.id);
    if (!version) {
      throw new Error("version_not_found");
    }

    const total = db.prepare("SELECT COUNT(1) AS c FROM prompt_versions WHERE prompt_id = ?").get(prompt.id).c;
    if (total <= 1) {
      throw new Error("prompt_last_version_protected");
    }

    db.prepare("DELETE FROM prompt_versions WHERE id = ? AND prompt_id = ?").run(version.id, prompt.id);

    if (prompt.current_version_id === version.id) {
      const fallback = db
        .prepare("SELECT id FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(prompt.id);
      if (!fallback?.id) {
        throw new Error("prompt_fallback_missing");
      }
      db.prepare("UPDATE prompts SET current_version_id = ? WHERE id = ?").run(fallback.id, prompt.id);
    }

    addLog(taskId, "info", `Prompt version deleted: ${prompt.name}`);
    res.json({ ok: true, deletedVersionId: version.id });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/bgm-preview", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    await ensureFfmpegReady();

    const payload = req.body || {};
    const durationSeconds = normalizeDurationSeconds(payload.durationSeconds, 16);
    const mode = String(payload.mode || "manual").toLowerCase() === "auto" ? "auto" : "manual";
    const audioPathInput = String(payload.audioPath || "").trim();
    if (!audioPathInput) {
      throw new Error("bgm_audio_path_required");
    }

    const resolvedAudioPath = path.isAbsolute(audioPathInput)
      ? path.normalize(audioPathInput)
      : path.resolve(process.cwd(), audioPathInput);

    let audioBuffer;
    try {
      audioBuffer = await fs.readFile(resolvedAudioPath);
    } catch {
      throw new Error("bgm_audio_file_not_found");
    }

    const totalDuration = await detectAudioDurationSeconds(resolvedAudioPath);

    let startSeconds = Math.max(0, Number(payload.startSeconds) || 0);
    let sourceDurationSeconds = durationSeconds;
    let playbackRate = normalizePlaybackRate(payload.playbackRate, 1);
    let autoScore = null;

    if (mode === "auto") {
      const silenceIntervals = await detectSilenceIntervals(resolvedAudioPath);
      const nonSilentSegments = buildNonSilentSegments(totalDuration, silenceIntervals);
      const selected = selectAutoPhraseSegment({
        totalDuration,
        targetDuration: durationSeconds,
        nonSilentSegments,
        silenceIntervals
      });
      startSeconds = selected.startSeconds;
      sourceDurationSeconds = selected.sourceDurationSeconds;
      playbackRate = selected.playbackRate;
      autoScore = selected.score;
    } else {
      sourceDurationSeconds = durationSeconds * playbackRate;
      if (startSeconds + sourceDurationSeconds > totalDuration) {
        startSeconds = Math.max(0, totalDuration - sourceDurationSeconds);
      }
      if (startSeconds > totalDuration - 0.05) {
        startSeconds = 0;
      }
      sourceDurationSeconds = Math.min(sourceDurationSeconds, Math.max(0.2, totalDuration - startSeconds));
      playbackRate = normalizePlaybackRate(sourceDurationSeconds / durationSeconds, playbackRate);
    }

    const preview = await renderBgmPreviewAudio({
      audioBuffer,
      startSeconds,
      sourceDurationSeconds,
      targetDurationSeconds: durationSeconds,
      playbackRate
    });

    const previewArtifactId = insertArtifact(taskId, "audio_bgm_preview", preview.mimeType, preview.buffer, {
      mode,
      sourceAudioPath: resolvedAudioPath,
      startSeconds,
      sourceDurationSeconds,
      targetDurationSeconds: preview.targetDurationSeconds,
      playbackRate: preview.playbackRate,
      totalDuration,
      autoScore
    });

    addLog(
      taskId,
      "success",
      `BGM preview generated (${mode}): start=${startSeconds.toFixed(2)}s, source=${sourceDurationSeconds.toFixed(2)}s, rate=${preview.playbackRate.toFixed(3)}`
    );

    res.json({
      ok: true,
      mode,
      previewAudioArtifactId: previewArtifactId,
      previewAudioUrl: artifactUrl(previewArtifactId),
      startSeconds,
      sourceDurationSeconds,
      durationSeconds: preview.targetDurationSeconds,
      playbackRate: preview.playbackRate,
      autoScore
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/bgm-compose", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    await ensureFfmpegReady();

    const payload = req.body || {};
    const requestedVideoArtifactId = String(payload.videoArtifactId || "").trim();
    const previewAudioArtifactId = String(payload.previewAudioArtifactId || "").trim();
    const durationSeconds = normalizeDurationSeconds(payload.durationSeconds, 16);

    const latestProductionRun = db
      .prepare("SELECT * FROM production_tasks WHERE task_id = ? ORDER BY task_index DESC LIMIT 1")
      .get(taskId);
    const fallbackVideoArtifactId =
      latestProductionRun?.stitched_artifact_id || latestProductionRun?.part2_artifact_id || latestProductionRun?.part1_artifact_id || "";
    const selectedVideoArtifactId = requestedVideoArtifactId || fallbackVideoArtifactId;
    if (!selectedVideoArtifactId) {
      throw new Error("production_video_required");
    }

    const videoArtifact = getVideoArtifactInTask(taskId, selectedVideoArtifactId);
    if (!videoArtifact) {
      throw new Error("production_video_not_found");
    }

    let previewAudioArtifact = previewAudioArtifactId ? getAudioArtifactInTask(taskId, previewAudioArtifactId) : null;
    if (previewAudioArtifactId && !previewAudioArtifact) {
      throw new Error("bgm_preview_audio_not_found");
    }

    if (!previewAudioArtifact) {
      const audioPathInput = String(payload.audioPath || "").trim();
      if (!audioPathInput) {
        throw new Error("bgm_preview_audio_required");
      }
      const resolvedAudioPath = path.isAbsolute(audioPathInput)
        ? path.normalize(audioPathInput)
        : path.resolve(process.cwd(), audioPathInput);
      let audioBuffer;
      try {
        audioBuffer = await fs.readFile(resolvedAudioPath);
      } catch {
        throw new Error("bgm_audio_file_not_found");
      }
      const rate = normalizePlaybackRate(payload.playbackRate, 1);
      const startSeconds = Math.max(0, Number(payload.startSeconds) || 0);
      const sourceDurationSeconds = durationSeconds * rate;
      const preview = await renderBgmPreviewAudio({
        audioBuffer,
        startSeconds,
        sourceDurationSeconds,
        targetDurationSeconds: durationSeconds,
        playbackRate: rate
      });
      const generatedPreviewId = insertArtifact(taskId, "audio_bgm_preview", preview.mimeType, preview.buffer, {
        mode: "manual",
        sourceAudioPath: resolvedAudioPath,
        startSeconds,
        sourceDurationSeconds,
        targetDurationSeconds: preview.targetDurationSeconds,
        playbackRate: preview.playbackRate
      });
      previewAudioArtifact = getAudioArtifactInTask(taskId, generatedPreviewId);
    }

    const result = await composeVideoWithPreparedAudio({
      videoBuffer: videoArtifact.data,
      audioBuffer: previewAudioArtifact.data,
      durationSeconds
    });

    const artifactId = insertArtifact(taskId, "video_bgm", result.mimeType, result.buffer, {
      sourceVideoArtifactId: videoArtifact.id,
      previewAudioArtifactId: previewAudioArtifact.id,
      durationSeconds: result.durationSeconds,
      strategy: "full_phrase_auto_or_manual_preview_then_compose"
    });

    db.prepare("UPDATE tasks SET phase = ?, status = ?, updated_at = ? WHERE id = ?").run("RESULT", "ready", now(), taskId);
    addLog(taskId, "success", `BGM mix generated: video=${videoArtifact.id}, preview=${previewAudioArtifact.id}, duration=${result.durationSeconds.toFixed(2)}s`);

    res.json({
      ok: true,
      artifactId,
      url: artifactUrl(artifactId),
      sourceVideoArtifactId: videoArtifact.id,
      previewAudioArtifactId: previewAudioArtifact.id,
      durationSeconds: result.durationSeconds
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/bgm-segment-compose", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    const task = ensureTask(taskId);
    await ensureFfmpegReady();

    const payload = req.body || {};
    const requestedVideoArtifactId = String(payload.videoArtifactId || "").trim();
    const audioPathInput = String(payload.audioPath || "").trim();
    if (!audioPathInput) {
      throw new Error("bgm_audio_path_required");
    }
    const audioStartSeconds = Math.max(0, Number(payload.audioStartSeconds) || 0);
    const audioEndSeconds = Number(payload.audioEndSeconds);
    if (!Number.isFinite(audioEndSeconds) || audioEndSeconds <= audioStartSeconds) {
      throw new Error("bgm_segment_invalid_range");
    }

    const latestProductionRun = db
      .prepare("SELECT * FROM production_tasks WHERE task_id = ? ORDER BY task_index DESC LIMIT 1")
      .get(taskId);
    const fallbackVideoArtifactId =
      latestProductionRun?.stitched_artifact_id || latestProductionRun?.part2_artifact_id || latestProductionRun?.part1_artifact_id || "";
    const selectedVideoArtifactId = requestedVideoArtifactId || fallbackVideoArtifactId;
    if (!selectedVideoArtifactId) {
      throw new Error("production_video_required");
    }
    const videoArtifact = getVideoArtifactInTask(taskId, selectedVideoArtifactId);
    if (!videoArtifact) {
      throw new Error("production_video_not_found");
    }

    const resolvedAudioPath = path.isAbsolute(audioPathInput)
      ? path.normalize(audioPathInput)
      : path.resolve(process.cwd(), audioPathInput);

    let audioBuffer;
    try {
      audioBuffer = await fs.readFile(resolvedAudioPath);
    } catch {
      throw new Error("bgm_audio_file_not_found");
    }

    const audioPlaybackRate = normalizeSegmentPlaybackRate(payload.audioPlaybackRate, 1);
    const targetMusicDurationSeconds = Number(payload.targetMusicDurationSeconds);
    const useCoverFrame = payload.useCoverFrame === undefined ? Boolean(task.cover_enabled) : Boolean(payload.useCoverFrame);
    const requestedCoverArtifactId = String(payload.coverArtifactId || task.cover_artifact_id || "").trim();
    const rawCoverDurationSeconds = payload.coverDurationSeconds === undefined
      ? Number(task.cover_duration_seconds || 1)
      : Number(payload.coverDurationSeconds);
    const coverDurationSeconds = Math.max(0.2, Math.min(8, Number.isFinite(rawCoverDurationSeconds) ? rawCoverDurationSeconds : 1));
    let coverArtifact = null;
    if (useCoverFrame) {
      coverArtifact = getImageArtifactInTask(taskId, requestedCoverArtifactId);
      if (!coverArtifact) {
        throw new Error("bgm_cover_frame_required");
      }
    }

    const result = await composeVideoByAudioSegment({
      videoBuffer: videoArtifact.data,
      audioBuffer,
      audioStartSeconds,
      audioEndSeconds,
      audioPlaybackRate,
      targetMusicDurationSeconds,
      coverImageBuffer: coverArtifact?.data || null,
      coverDurationSeconds: useCoverFrame ? coverDurationSeconds : 0
    });

    const artifactId = insertArtifact(taskId, "video_bgm_stretch", result.mimeType, result.buffer, {
      sourceVideoArtifactId: videoArtifact.id,
      sourceAudioPath: resolvedAudioPath,
      audioStartSeconds: result.audioStartSeconds,
      audioEndSeconds: result.audioEndSeconds,
      clipDurationSeconds: result.clipDurationSeconds,
      finalMusicDurationSeconds: result.finalMusicDurationSeconds,
      audioPlaybackRate: result.audioPlaybackRate,
      videoDurationSeconds: result.videoDurationSeconds,
      videoSpeed: result.videoSpeed,
      useCoverFrame: result.useCoverFrame,
      coverArtifactId: coverArtifact?.id || null,
      coverDurationSeconds: result.coverDurationSeconds,
      coverTransitionSeconds: result.coverTransitionSeconds,
      videoBodyDurationSeconds: result.videoBodyDurationSeconds,
      strategy: "audio_segment_drives_video_speed"
    });

    addLog(
      taskId,
      "success",
      `BGM segment compose ready: video=${videoArtifact.id}, clip=${result.clipDurationSeconds.toFixed(2)}s, cover=${result.useCoverFrame ? "on" : "off"}, videoSpeed=${result.videoSpeed.toFixed(3)}`
    );

    res.json({
      ok: true,
      artifactId,
      url: artifactUrl(artifactId),
      sourceVideoArtifactId: videoArtifact.id,
      clipDurationSeconds: result.clipDurationSeconds,
      finalMusicDurationSeconds: result.finalMusicDurationSeconds,
      audioPlaybackRate: result.audioPlaybackRate,
      videoDurationSeconds: result.videoDurationSeconds,
      videoSpeed: result.videoSpeed,
      useCoverFrame: result.useCoverFrame,
      coverDurationSeconds: result.coverDurationSeconds,
      coverTransitionSeconds: result.coverTransitionSeconds,
      videoBodyDurationSeconds: result.videoBodyDurationSeconds
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/bgm-segment-recommend", async (req, res, next) => {
  try {
    const taskId = req.params.taskId;
    ensureTask(taskId);
    await ensureFfmpegReady();

    const payload = req.body || {};
    const audioPathInput = String(payload.audioPath || "").trim();
    if (!audioPathInput) {
      throw new Error("bgm_audio_path_required");
    }

    const resolvedAudioPath = path.isAbsolute(audioPathInput)
      ? path.normalize(audioPathInput)
      : path.resolve(process.cwd(), audioPathInput);
    const totalDuration = await detectAudioDurationSeconds(resolvedAudioPath);
    const silenceIntervals = await detectSilenceIntervals(resolvedAudioPath);
    const nonSilentSegments = buildNonSilentSegments(totalDuration, silenceIntervals);

    const requestedVideoArtifactId = String(payload.videoArtifactId || "").trim();
    let targetDuration = Number(payload.targetDurationSeconds);
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      const videoArtifact = getVideoArtifactInTask(taskId, requestedVideoArtifactId);
      if (videoArtifact) {
        targetDuration = await detectVideoDurationSeconds(videoArtifact.data);
      }
    }
    if (!Number.isFinite(targetDuration) || targetDuration <= 0) {
      targetDuration = Math.min(16, totalDuration);
    }

    const selected = selectAutoPhraseSegment({
      totalDuration,
      targetDuration,
      nonSilentSegments,
      silenceIntervals
    });
    const startSeconds = Math.max(0, Math.min(totalDuration - 0.05, selected.startSeconds));
    const clipDurationSeconds = Math.max(0.05, Math.min(selected.sourceDurationSeconds, totalDuration - startSeconds));
    const endSeconds = Math.min(totalDuration, startSeconds + clipDurationSeconds);

    addLog(
      taskId,
      "info",
      `BGM segment recommended: start=${startSeconds.toFixed(2)}s, end=${endSeconds.toFixed(2)}s, clip=${clipDurationSeconds.toFixed(2)}s`
    );

    res.json({
      ok: true,
      startSeconds,
      endSeconds,
      clipDurationSeconds,
      totalDurationSeconds: totalDuration,
      score: selected.score
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/tasks/:taskId/publish", async (req, res, next) => {
  const taskId = req.params.taskId;
  try {
    const result = await executePublishPipeline({
      taskId,
      sourceDescription: req.body?.sourceDescription,
      shortTitle: req.body?.shortTitle,
      onMessage: null
    });
    res.json(result);
  } catch (err) {
    db.prepare("UPDATE tasks SET status = ?, phase = ?, updated_at = ? WHERE id = ?").run(
      resolvePublishFailedStatus(err),
      "RESULT",
      now(),
      taskId
    );
    addLog(taskId, "error", `[Publish] Failed: ${err.message || String(err)}`);
    next(err);
  }
});

app.post("/api/tasks/:taskId/publish/prefill-generate", async (req, res, next) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
    const channel = normalizePublishChannel(req.body?.channel);
    const settings = getModelSettings();
    const publishActionSettings = getPublishActionSettings();
    const channelInstruction = publishActionSettings[channel]?.instruction || "";
    const instruction = String(req.body?.instruction || channelInstruction || "").trim();
    if (!instruction) {
      throw new Error("publish_prefill_instruction_missing");
    }
    const generated = await generatePublishPrefillWithGemini({
      taskId,
      channel,
      sourceDescription: req.body?.sourceDescription,
      instruction,
      currentDraft: req.body?.currentDraft || {},
      settings
    });
    addLog(taskId, "success", `[Publish] Prefill generated for ${PUBLISH_CHANNEL_LABELS[channel] || channel}`);
    res.json({ ok: true, channel, prefill: generated.prefill, meta: generated.meta });
  } catch (err) {
    if (String(err?.message || "") === "publish_prefill_title_expand_failed_retry" && err?.partialPrefill) {
      addLog(
        taskId,
        "info",
        `[Publish] Prefill generated but title length requirement not met for ${PUBLISH_CHANNEL_LABELS[normalizePublishChannel(req.body?.channel)] || req.body?.channel}`
      );
      res.json({
        ok: false,
        channel: normalizePublishChannel(req.body?.channel),
        prefill: err.partialPrefill,
        meta: {
          ...(err.partialMeta || {}),
          warning: "title_length_not_met"
        }
      });
      return;
    }
    addLog(taskId, "error", `[Publish] Prefill failed: ${err.message || String(err)}`);
    next(err);
  }
});

const handlePublishPrefillStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const channel = normalizePublishChannel(req.body?.channel);
    const settings = getModelSettings();
    const publishActionSettings = getPublishActionSettings();
    const channelInstruction = publishActionSettings[channel]?.instruction || "";
    const instruction = String(req.body?.instruction || channelInstruction || "").trim();
    if (!instruction) {
      throw new Error("publish_prefill_instruction_missing");
    }
    const generated = await generatePublishPrefillWithGemini({
      taskId,
      channel,
      sourceDescription: req.body?.sourceDescription,
      instruction,
      currentDraft: req.body?.currentDraft || {},
      settings,
      onDebugEvent: (event) => push({ type: "prefill_debug", ...event })
    });
    addLog(taskId, "success", `[Publish] Prefill generated for ${PUBLISH_CHANNEL_LABELS[channel] || channel}`);
    push({
      type: "done",
      result: {
        ok: true,
        channel,
        prefill: generated.prefill,
        meta: generated.meta
      }
    });
  } catch (err) {
    if (String(err?.message || "") === "publish_prefill_title_expand_failed_retry" && err?.partialPrefill) {
      const channel = normalizePublishChannel(req.body?.channel);
      addLog(
        taskId,
        "info",
        `[Publish] Prefill generated but title length requirement not met for ${PUBLISH_CHANNEL_LABELS[channel] || channel}`
      );
      push({
        type: "done",
        result: {
          ok: false,
          channel,
          prefill: err.partialPrefill,
          meta: {
            ...(err.partialMeta || {}),
            warning: "title_length_not_met"
          }
        }
      });
    } else {
      addLog(taskId, "error", `[Publish] Prefill failed: ${err.message || String(err)}`);
      push({ type: "error", error: err.message || String(err) });
    }
  } finally {
    res.end();
  }
};

app.post("/api/tasks/:taskId/publish/prefill-generate/stream", handlePublishPrefillStream);

const handlePublishStream = async (req, res) => {
  const taskId = req.params.taskId;
  try {
    ensureTask(taskId);
  } catch (err) {
    res.status(err.status || 404).json({ error: err.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const push = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await executePublishPipeline({
      taskId,
      sourceDescription: req.body?.sourceDescription,
      shortTitle: req.body?.shortTitle,
      onMessage: push
    });
    push({ type: "done", ...result });
  } catch (error) {
    db.prepare("UPDATE tasks SET status = ?, phase = ?, updated_at = ? WHERE id = ?").run(
      resolvePublishFailedStatus(error),
      "RESULT",
      now(),
      taskId
    );
    addLog(taskId, "error", `[Publish] Failed: ${error.message || String(error)}`);
    push({ type: "error", error: error.message || String(error) });
  } finally {
    res.end();
  }
};

app.get("/api/tasks/:taskId/publish/stream", handlePublishStream);
app.post("/api/tasks/:taskId/publish/stream", handlePublishStream);

app.get("/api/artifacts/:artifactId/content", (req, res, next) => {
  try {
    const a = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(req.params.artifactId);
    if (!a) {
      const err = new Error("artifact_not_found");
      err.status = 404;
      throw err;
    }
    res.setHeader("Content-Type", a.mime_type);
    res.send(a.data);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  const code = err.status || 400;
  res.status(code).json({ error: err.message || "unknown_error" });
});

const port = Number(process.env.PORT || 5172);
const host = String(process.env.HOST || "0.0.0.0");
app.listen(port, host, () => {
  console.log(`OpenFlow API listening on http://${host}:${port}`);
});
