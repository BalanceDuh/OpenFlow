import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const cache = new Map();

function run(args) {
  return spawnSync(ffmpeg, args, { encoding: 'utf8', maxBuffer: 120 * 1024 * 1024 });
}
function parseDuration(stderr) {
  const m = String(stderr || '').match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}
function parseTimedMetric(text, keyRegex) {
  const lines = String(text || '').split(/\r?\n/);
  let t = 0;
  const vals = [];
  for (const ln of lines) {
    const mt = ln.match(/pts_time:([0-9.]+)/);
    if (mt) t = parseFloat(mt[1]);
    const mv = ln.match(keyRegex);
    if (mv) vals.push([t, parseFloat(mv[1])]);
  }
  return vals;
}
function midiFromHz(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  return Math.round(69 + 12 * Math.log2(hz / 440));
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function buildPitchSegments(bins, step) {
  const notes = [];
  let cur = null;
  for (const b of bins) {
    if (!Number.isFinite(b.midi)) continue;
    if (!cur) {
      cur = { start: b.t, end: +(b.t + step).toFixed(3), midi: b.midi };
      continue;
    }
    if (Math.abs(b.midi - cur.midi) <= 1) {
      cur.end = +(b.t + step).toFixed(3);
    } else {
      notes.push(cur);
      cur = { start: b.t, end: +(b.t + step).toFixed(3), midi: b.midi };
    }
  }
  if (cur) notes.push(cur);

  const merged = [];
  for (const n of notes) {
    if ((n.end - n.start) < 0.18) continue;
    const last = merged[merged.length - 1];
    if (last && (n.start - last.end) <= (step * 1.5) && Math.abs(n.midi - last.midi) <= 1) {
      last.end = n.end;
    } else {
      merged.push({ ...n });
    }
  }
  return merged;
}

export async function analyzeMusic(audioPath) {
  if (!audioPath) throw new Error('missing_audio_path');
  const abs = path.resolve(audioPath);
  const stat = await fs.stat(abs);
  const key = `${abs}:${stat.mtimeMs}:${stat.size}`;
  if (cache.has(key)) return cache.get(key);

  const probe = run(['-hide_banner', '-i', abs, '-t', '0.01', '-f', 'null', '-']);
  const duration = parseDuration(probe.stderr);
  const step = 0.1;

  const astats = run(['-hide_banner', '-i', abs, '-af', `astats=metadata=1:reset=${step},ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-`, '-f', 'null', '-']);
  const centroid = run(['-hide_banner', '-i', abs, '-af', 'aspectralstats=measure=centroid:win_size=1024:overlap=0.5,ametadata=print:key=lavfi.aspectralstats.1.centroid:file=-', '-f', 'null', '-']);
  const zcr = run(['-hide_banner', '-i', abs, '-af', `astats=metadata=1:reset=${step},ametadata=print:key=lavfi.astats.Overall.Zero_crossings_rate:file=-`, '-f', 'null', '-']);

  // 用 silencedetect 辅助推断低能量区，pitch 先走可用的 freq extraction fallback：
  // 1) 尝试原有 pitch filter
  // 2) 若无结果，则改用 astats + spectral centroid / zcr 组合生成“主音高近似块”
  const pitch = run(['-hide_banner', '-i', abs, '-af', 'aformat=channel_layouts=mono,asetrate=44100,aresample=44100,highpass=f=80,lowpass=f=1200,pitch', '-f', 'null', '-']);

  const rmsVals = parseTimedMetric(astats.stdout + '\n' + astats.stderr, /lavfi\.astats\.Overall\.RMS_level=([-0-9.]+)/);
  const centVals = parseTimedMetric(centroid.stdout + '\n' + centroid.stderr, /lavfi\.aspectralstats\.1\.centroid=([0-9.]+)/);
  const zcrVals = parseTimedMetric(zcr.stdout + '\n' + zcr.stderr, /lavfi\.astats\.Overall\.Zero_crossings_rate=([0-9.]+)/);
  const rawPitchVals = parseTimedMetric(pitch.stdout + '\n' + pitch.stderr, /freq=([0-9.]+)/)
    .map(([t, hz]) => [t, midiFromHz(hz)])
    .filter(([, m]) => Number.isFinite(m));

  const bins = [];
  for (let s = 0; s < duration; s += step) {
    const rs = rmsVals.filter(([tt]) => tt >= s && tt < s + step).map(([, v]) => v).filter(Number.isFinite);
    const cs = centVals.filter(([tt]) => tt >= s && tt < s + step).map(([, v]) => v).filter(Number.isFinite);
    const zs = zcrVals.filter(([tt]) => tt >= s && tt < s + step).map(([, v]) => v).filter(Number.isFinite);
    const ps = rawPitchVals.filter(([tt]) => tt >= s && tt < s + step).map(([, v]) => v).filter(Number.isFinite);
    bins.push({
      t: +s.toFixed(3),
      rms: rs.length ? Math.max(...rs) : null,
      centroid: cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : null,
      zcr: zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null,
      midi: ps.length ? Math.round(median(ps)) : null
    });
  }

  const validR = bins.map(b => b.rms).filter(Number.isFinite);
  const minR = validR.length ? Math.min(...validR) : -60;
  const maxR = validR.length ? Math.max(...validR) : 0;
  const normR = (v) => Number.isFinite(v) && maxR !== minR ? (v - minR) / (maxR - minR) : 0;

  const beats = [];
  for (let i = 1; i < bins.length - 1; i += 1) {
    const a = bins[i - 1], b = bins[i], c = bins[i + 1];
    if ([a.rms, b.rms, c.rms].every(Number.isFinite) && b.rms > a.rms && b.rms >= c.rms && normR(b.rms) > 0.62) beats.push(b.t);
  }

  let notes = buildPitchSegments(bins, step);

  // fallback: 如果 pitch filter 仍然没有结果，则基于 centroid 生成“主音高近似块”
  if (notes.length === 0) {
    const approxBins = bins.map((b) => {
      if (!Number.isFinite(b.centroid) || !Number.isFinite(b.rms)) return { ...b, midi: null };
      if (normR(b.rms) < 0.18) return { ...b, midi: null };
      const hz = Math.max(82, Math.min(1046, b.centroid));
      return { ...b, midi: midiFromHz(hz) };
    });
    notes = buildPitchSegments(approxBins, step);
    // 同步给 UI 一个可见的 midi 层
    for (let i = 0; i < bins.length; i += 1) {
      if (!Number.isFinite(bins[i].midi) && Number.isFinite(approxBins[i].midi)) bins[i].midi = approxBins[i].midi;
    }
  }

  const result = { audioPath: abs, duration, step, bins, beats, notes };
  cache.set(key, result);
  return result;
}
