import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "openflow.sqlite");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export function uid(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      aspect_ratio TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      selected_start_artifact_id TEXT,
      selected_end_artifact_id TEXT,
      selected_narrative_id TEXT,
      cover_enabled INTEGER NOT NULL DEFAULT 0,
      cover_artifact_id TEXT,
      cover_title TEXT NOT NULL DEFAULT '',
      cover_prompt TEXT NOT NULL DEFAULT '',
      cover_duration_seconds REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      meta_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      prompt_type TEXT NOT NULL,
      name TEXT NOT NULL,
      active_lang TEXT NOT NULL DEFAULT 'en',
      current_version_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      prompt_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      content_zh TEXT NOT NULL,
      content_en TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS narrative_options (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      part1_prompt TEXT NOT NULL,
      part2_prompt TEXT NOT NULL,
      end_frame_prompt TEXT NOT NULL,
      end_frame_artifact_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS narrative_style_prompts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      prompt_index INTEGER NOT NULL,
      name TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(task_id, prompt_index)
    );

    CREATE TABLE IF NOT EXISTS narrative_action_settings (
      id TEXT PRIMARY KEY,
      generation_instruction TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS publish_action_settings (
      channel TEXT PRIMARY KEY,
      instruction TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS production_tasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      task_index INTEGER NOT NULL,
      status TEXT NOT NULL,
      step TEXT NOT NULL,
      part1_artifact_id TEXT,
      bridge_artifact_id TEXT,
      part2_artifact_id TEXT,
      stitched_artifact_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_settings (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      prompt_model TEXT NOT NULL DEFAULT 'gemini-3.0-flash',
      image_model TEXT NOT NULL,
      video_model TEXT NOT NULL,
      api_key TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS style_action_settings (
      id TEXT PRIMARY KEY,
      prompt_generation_instruction TEXT NOT NULL,
      style_image_instruction TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clean_prompt_versions (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clean_prompt_state (
      id TEXT PRIMARY KEY,
      current_version_id TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const modelCols = db.prepare("PRAGMA table_info(model_settings)").all();
  if (!modelCols.some((c) => c.name === "prompt_model")) {
    db.prepare("ALTER TABLE model_settings ADD COLUMN prompt_model TEXT NOT NULL DEFAULT 'gemini-3.0-flash'").run();
  }

  const existing = db.prepare("SELECT id FROM model_settings WHERE id = 'default'").get();
  if (!existing) {
    db.prepare(
      "INSERT INTO model_settings (id, provider, prompt_model, image_model, video_model, api_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "default",
      "gemini",
      "gemini-3.0-flash",
      "gemini-2.5-flash-image",
      "veo-3.1-fast-generate-preview",
      "",
      now()
    );
  }
  db.prepare("UPDATE model_settings SET prompt_model = COALESCE(NULLIF(prompt_model, ''), 'gemini-3.0-flash') WHERE id = 'default'").run();

  const promptCols = db.prepare("PRAGMA table_info(prompts)").all();
  if (!promptCols.some((c) => c.name === "active_lang")) {
    db.prepare("ALTER TABLE prompts ADD COLUMN active_lang TEXT NOT NULL DEFAULT 'en'").run();
  }
  db.prepare("UPDATE prompts SET active_lang = CASE WHEN active_lang = 'zh' THEN 'zh' ELSE 'en' END").run();

  const promptVersionCols = db.prepare("PRAGMA table_info(prompt_versions)").all();
  if (!promptVersionCols.some((c) => c.name === "content")) {
    db.prepare("ALTER TABLE prompt_versions ADD COLUMN content TEXT NOT NULL DEFAULT ''").run();
  }
  if (!promptVersionCols.some((c) => c.name === "content_zh")) {
    db.prepare("ALTER TABLE prompt_versions ADD COLUMN content_zh TEXT NOT NULL DEFAULT ''").run();
  }
  if (!promptVersionCols.some((c) => c.name === "content_en")) {
    db.prepare("ALTER TABLE prompt_versions ADD COLUMN content_en TEXT NOT NULL DEFAULT ''").run();
  }

  const styleSettings = db.prepare("SELECT id FROM style_action_settings WHERE id = 'default'").get();
  const defaultPromptInstruction =
    "Generate exactly 3 style prompts based on the selected source image. Required styles: (1) Song-dynasty blank-leaving minimalism, (2) Chinese wuxia cinematic realism, (3) Chinese painting aesthetic realism. In all prompts, enforce tiny human figure versus monumental landscape contrast to convey solitude, real-world scene plausibility, and cinematic 4K film quality. Keep subject identity and core composition stable.";
  if (!styleSettings) {
    db.prepare(
      "INSERT INTO style_action_settings (id, prompt_generation_instruction, style_image_instruction, updated_at) VALUES (?, ?, ?, ?)"
    ).run(
      "default",
      defaultPromptInstruction,
      "Generate style images with consistent subject identity, clean structure, and cinematic color harmony.",
      now()
    );
  } else {
    db.prepare(
      "UPDATE style_action_settings SET prompt_generation_instruction = ?, updated_at = ? WHERE id = 'default' AND (prompt_generation_instruction = '' OR prompt_generation_instruction = ?)"
    ).run(
      defaultPromptInstruction,
      now(),
      "Generate 3 high quality style prompts based on the selected source image. Keep subject identity and scene composition stable."
    );
  }

  const cleanState = db.prepare("SELECT id FROM clean_prompt_state WHERE id = 'default'").get();
  if (!cleanState) {
    const versionId = uid("cpv");
    db.prepare(
      "INSERT INTO clean_prompt_versions (id, content, source, created_at) VALUES (?, ?, ?, ?)"
    ).run(
      versionId,
      "Remove all visible text, subtitles, watermarks, logos and decorative borders from the image. Preserve scene composition, subject scale, lighting and natural texture. Fill removed areas naturally with coherent details, no artifacts.",
      "system",
      now()
    );
    db.prepare(
      "INSERT INTO clean_prompt_state (id, current_version_id, updated_at) VALUES (?, ?, ?)"
    ).run("default", versionId, now());
  }

  const narrativeCols = db.prepare("PRAGMA table_info(narrative_options)").all();
  if (!narrativeCols.some((c) => c.name === "end_frame_artifact_id")) {
    db.prepare("ALTER TABLE narrative_options ADD COLUMN end_frame_artifact_id TEXT").run();
  }

  const taskCols = db.prepare("PRAGMA table_info(tasks)").all();
  if (!taskCols.some((c) => c.name === "selected_end_artifact_id")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN selected_end_artifact_id TEXT").run();
  }
  if (!taskCols.some((c) => c.name === "cover_enabled")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN cover_enabled INTEGER NOT NULL DEFAULT 0").run();
  }
  if (!taskCols.some((c) => c.name === "cover_artifact_id")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN cover_artifact_id TEXT").run();
  }
  if (!taskCols.some((c) => c.name === "cover_title")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN cover_title TEXT NOT NULL DEFAULT ''").run();
  }
  if (!taskCols.some((c) => c.name === "cover_prompt")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN cover_prompt TEXT NOT NULL DEFAULT ''").run();
  }
  if (!taskCols.some((c) => c.name === "cover_duration_seconds")) {
    db.prepare("ALTER TABLE tasks ADD COLUMN cover_duration_seconds REAL NOT NULL DEFAULT 1").run();
  }

  const narrativeSettings = db.prepare("SELECT id FROM narrative_action_settings WHERE id = 'default'").get();
  const defaultNarrativeInstruction =
    "生成 3 条风格生成提示词（仅模板，不输出最终分镜/尾帧图），风格分别为：宋代留白、中国武侠、国画美风。每条提示词都必须约束后续视频生成满足：视角保持一致、4K、电影感、无背景音乐、无任何字幕、只有环境声、人物衣服随风飘动、树木随风摆动（若有树木）、水体流淌（若有水体）、风起云涌、整体风景结构不改变。";
  if (!narrativeSettings) {
    db.prepare(
      "INSERT INTO narrative_action_settings (id, generation_instruction, updated_at) VALUES (?, ?, ?)"
    ).run(
      "default",
      defaultNarrativeInstruction,
      now()
    );
  } else {
    db.prepare(
      "UPDATE narrative_action_settings SET generation_instruction = ?, updated_at = ? WHERE id = 'default' AND (generation_instruction = '' OR generation_instruction = ?)"
    ).run(
      defaultNarrativeInstruction,
      now(),
      "Generate exactly 3 narrative scenes based on the selected style image. Each scene must include: title, description, part1 prompt, part2 prompt, and end-frame prompt. Ensure cinematic continuity and emotional progression."
    );
  }

  const publishActionDefaults = [
    {
      channel: "video_channel",
      instruction:
        "请为微信视频号生成发布预填内容，仅输出短标题和描述。风格要简洁自然，有东方意境，避免夸张营销语。"
    },
    {
      channel: "douyin",
      instruction:
        "请为抖音号生成发布预填内容，输出标题、描述、话题。语气要抓人但不低俗，适合短视频浏览场景。"
    },
    {
      channel: "xiaohongshu",
      instruction:
        "请为小红书生成发布预填内容，输出标题、描述、话题。语气偏分享与审美表达，像一篇简短笔记。"
    }
  ];
  const upsertPublishAction = db.prepare(
    "INSERT INTO publish_action_settings (channel, instruction, updated_at) VALUES (?, ?, ?) ON CONFLICT(channel) DO UPDATE SET instruction = excluded.instruction, updated_at = excluded.updated_at"
  );
  for (const item of publishActionDefaults) {
    const existing = db.prepare("SELECT channel FROM publish_action_settings WHERE channel = ?").get(item.channel);
    if (!existing) {
      upsertPublishAction.run(item.channel, item.instruction, now());
    }
  }
}

export function now() {
  return new Date().toISOString();
}

export function addLog(taskId, level, message) {
  db.prepare(
    "INSERT INTO logs (id, task_id, level, message, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(uid("log"), taskId, level, message, now());
}
