import type { Env } from '../types';
import { currentTimestamp, generateId } from '../utils/helpers';

export interface LineMessageSettings {
  id: string;
  line_oa_id: string;
  tenant_id: string;
  enable_processing_reply: number;
  processing_reply_text: string;
  enable_success_flex: number;
  enable_duplicate_flex: number;
  enable_failed_reply: number;
  failed_reply_text: string;
  logo_image_url: string;
  play_url: string;
  header_title_text: string;
  success_status_text: string;
  duplicate_status_text: string;
  failed_status_text: string;
  footer_text: string;
  button_text: string;
  header_background_color: string;
  body_background_color: string;
  footer_background_color: string;
  header_title_color: string;
  status_success_color: string;
  status_failed_color: string;
  labels_color: string;
  values_color: string;
  secondary_text_color: string;
  separator_color: string;
  button_color: string;
  created_at: number;
  updated_at: number;
}

const DEFAULT_SETTINGS: Omit<LineMessageSettings, 'id' | 'line_oa_id' | 'tenant_id' | 'created_at' | 'updated_at'> = {
  enable_processing_reply: 1,
  processing_reply_text: '⌛ ระบบกำลังตรวจสอบ รบกวนคุณพี่รอสักครู่นะคะ 🙏',
  enable_success_flex: 1,
  enable_duplicate_flex: 1,
  enable_failed_reply: 1,
  failed_reply_text: 'ระบบทำรายการไม่สำเร็จ เดี๋ยวน้องแอดมินจะตรวจสอบให้ค่ะ🙏',
  logo_image_url: 'https://lh3.googleusercontent.com/pw/AP1GczNX0bkhtsKfNWK2SS9C68wqtI-zOH6pgtz6FNBlPR8XKQDUmNm93D6HsKb1UuEFafEhHtv4cdNy58IaVEXL9oZlqnXQ_lK4E60ye8Mo4tW2tgfh29tXGmXwZlN_DZZfq-IDkVzf7QalpJvaELnKOZTK',
  play_url: 'https://example.com/login',
  header_title_text: 'AUTO DEPOSIT SUCCESS',
  success_status_text: 'ฝากเงินสำเร็จ',
  duplicate_status_text: 'พบรายการซ้ำ',
  failed_status_text: 'ไม่สามารถทำรายการได้',
  footer_text: 'ขอบคุณที่ใช้บริการค่ะ',
  button_text: 'เข้าเล่นเกม',
  header_background_color: '#000000',
  body_background_color: '#1A1A1A',
  footer_background_color: '#000000',
  header_title_color: '#D4AF37',
  status_success_color: '#33FF33',
  status_failed_color: '#FF4D4D',
  labels_color: '#D4AF37',
  values_color: '#FFFFFF',
  secondary_text_color: '#888888',
  separator_color: '#333333',
  button_color: '#D4AF37',
};

async function ensureLineMessageSettingsTable(env: Env): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS line_message_settings (
      id TEXT PRIMARY KEY,
      line_oa_id TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL,
      enable_processing_reply INTEGER NOT NULL DEFAULT 1,
      processing_reply_text TEXT NOT NULL DEFAULT 'กำลังดำเนินการ กรุณารอสักครู่ค่ะ',
      enable_success_flex INTEGER NOT NULL DEFAULT 1,
      enable_duplicate_flex INTEGER NOT NULL DEFAULT 1,
      enable_failed_reply INTEGER NOT NULL DEFAULT 1,
      failed_reply_text TEXT NOT NULL DEFAULT 'ขออภัย ไม่สามารถประมวลผลรายการได้ กรุณาติดต่อแอดมิน',
      logo_image_url TEXT NOT NULL DEFAULT '',
      play_url TEXT NOT NULL DEFAULT '',
      header_title_text TEXT NOT NULL DEFAULT 'AUTO DEPOSIT SUCCESS',
      success_status_text TEXT NOT NULL DEFAULT '✅ ฝากเงินสำเร็จ',
      duplicate_status_text TEXT NOT NULL DEFAULT '⚠️ พบรายการซ้ำ',
      failed_status_text TEXT NOT NULL DEFAULT '❌ ไม่สามารถทำรายการได้',
      footer_text TEXT NOT NULL DEFAULT 'ขอบคุณที่ใช้บริการค่ะ',
      button_text TEXT NOT NULL DEFAULT 'เข้าเล่นเกม',
      header_background_color TEXT NOT NULL DEFAULT '#000000',
      body_background_color TEXT NOT NULL DEFAULT '#1A1A1A',
      footer_background_color TEXT NOT NULL DEFAULT '#000000',
      header_title_color TEXT NOT NULL DEFAULT '#D4AF37',
      status_success_color TEXT NOT NULL DEFAULT '#33FF33',
      status_failed_color TEXT NOT NULL DEFAULT '#FF4D4D',
      labels_color TEXT NOT NULL DEFAULT '#D4AF37',
      values_color TEXT NOT NULL DEFAULT '#FFFFFF',
      secondary_text_color TEXT NOT NULL DEFAULT '#888888',
      separator_color TEXT NOT NULL DEFAULT '#333333',
      button_color TEXT NOT NULL DEFAULT '#D4AF37',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (line_oa_id) REFERENCES line_oas(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    )`
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_line_message_settings_tenant ON line_message_settings(tenant_id)`
  ).run();
}

function normalizeColor(value: any, fallback: string): string {
  const raw = String(value || '').trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(raw)) {
    return raw;
  }
  return fallback;
}

function toIntToggle(value: any, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    return value > 0 ? 1 : 0;
  }
  const normalized = String(value).toLowerCase().trim();
  if (normalized === '1' || normalized === 'true' || normalized === 'on') {
    return 1;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'off') {
    return 0;
  }
  return fallback;
}

function toText(value: any, fallback: string): string {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : fallback;
}

export async function getOrCreateLineMessageSettings(
  env: Env,
  lineOAId: string,
  tenantId: string
): Promise<LineMessageSettings> {
  await ensureLineMessageSettingsTable(env);

  const existing = await env.DB.prepare(
    `SELECT * FROM line_message_settings WHERE line_oa_id = ? AND tenant_id = ? LIMIT 1`
  )
    .bind(lineOAId, tenantId)
    .first<LineMessageSettings>();

  if (existing) {
    return existing;
  }

  const now = currentTimestamp();
  const id = generateId();

  await env.DB.prepare(
    `INSERT INTO line_message_settings (
      id, line_oa_id, tenant_id,
      enable_processing_reply, processing_reply_text,
      enable_success_flex, enable_duplicate_flex, enable_failed_reply, failed_reply_text,
      logo_image_url, play_url,
      header_title_text, success_status_text, duplicate_status_text, failed_status_text,
      footer_text, button_text,
      header_background_color, body_background_color, footer_background_color,
      header_title_color, status_success_color, status_failed_color,
      labels_color, values_color, secondary_text_color, separator_color, button_color,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      lineOAId,
      tenantId,
      DEFAULT_SETTINGS.enable_processing_reply,
      DEFAULT_SETTINGS.processing_reply_text,
      DEFAULT_SETTINGS.enable_success_flex,
      DEFAULT_SETTINGS.enable_duplicate_flex,
      DEFAULT_SETTINGS.enable_failed_reply,
      DEFAULT_SETTINGS.failed_reply_text,
      DEFAULT_SETTINGS.logo_image_url,
      DEFAULT_SETTINGS.play_url,
      DEFAULT_SETTINGS.header_title_text,
      DEFAULT_SETTINGS.success_status_text,
      DEFAULT_SETTINGS.duplicate_status_text,
      DEFAULT_SETTINGS.failed_status_text,
      DEFAULT_SETTINGS.footer_text,
      DEFAULT_SETTINGS.button_text,
      DEFAULT_SETTINGS.header_background_color,
      DEFAULT_SETTINGS.body_background_color,
      DEFAULT_SETTINGS.footer_background_color,
      DEFAULT_SETTINGS.header_title_color,
      DEFAULT_SETTINGS.status_success_color,
      DEFAULT_SETTINGS.status_failed_color,
      DEFAULT_SETTINGS.labels_color,
      DEFAULT_SETTINGS.values_color,
      DEFAULT_SETTINGS.secondary_text_color,
      DEFAULT_SETTINGS.separator_color,
      DEFAULT_SETTINGS.button_color,
      now,
      now
    )
    .run();

  return (await env.DB.prepare(
    `SELECT * FROM line_message_settings WHERE line_oa_id = ? AND tenant_id = ? LIMIT 1`
  )
    .bind(lineOAId, tenantId)
    .first<LineMessageSettings>()) as LineMessageSettings;
}

export async function updateLineMessageSettings(
  env: Env,
  lineOAId: string,
  tenantId: string,
  payload: any
): Promise<LineMessageSettings> {
  const current = await getOrCreateLineMessageSettings(env, lineOAId, tenantId);
  const now = currentTimestamp();

  const next = {
    enable_processing_reply: toIntToggle(payload.enable_processing_reply, current.enable_processing_reply),
    processing_reply_text: toText(payload.processing_reply_text, current.processing_reply_text),
    enable_success_flex: toIntToggle(payload.enable_success_flex, current.enable_success_flex),
    enable_duplicate_flex: toIntToggle(payload.enable_duplicate_flex, current.enable_duplicate_flex),
    enable_failed_reply: toIntToggle(payload.enable_failed_reply, current.enable_failed_reply),
    failed_reply_text: toText(payload.failed_reply_text, current.failed_reply_text),
    logo_image_url: toText(payload.logo_image_url, current.logo_image_url),
    play_url: toText(payload.play_url, current.play_url),
    header_title_text: toText(payload.header_title_text, current.header_title_text),
    success_status_text: toText(payload.success_status_text, current.success_status_text),
    duplicate_status_text: toText(payload.duplicate_status_text, current.duplicate_status_text),
    failed_status_text: toText(payload.failed_status_text, current.failed_status_text),
    footer_text: toText(payload.footer_text, current.footer_text),
    button_text: toText(payload.button_text, current.button_text),
    header_background_color: normalizeColor(payload.header_background_color, current.header_background_color),
    body_background_color: normalizeColor(payload.body_background_color, current.body_background_color),
    footer_background_color: normalizeColor(payload.footer_background_color, current.footer_background_color),
    header_title_color: normalizeColor(payload.header_title_color, current.header_title_color),
    status_success_color: normalizeColor(payload.status_success_color, current.status_success_color),
    status_failed_color: normalizeColor(payload.status_failed_color, current.status_failed_color),
    labels_color: normalizeColor(payload.labels_color, current.labels_color),
    values_color: normalizeColor(payload.values_color, current.values_color),
    secondary_text_color: normalizeColor(payload.secondary_text_color, current.secondary_text_color),
    separator_color: normalizeColor(payload.separator_color, current.separator_color),
    button_color: normalizeColor(payload.button_color, current.button_color),
  };

  await env.DB.prepare(
    `UPDATE line_message_settings
     SET enable_processing_reply = ?,
         processing_reply_text = ?,
         enable_success_flex = ?,
         enable_duplicate_flex = ?,
         enable_failed_reply = ?,
         failed_reply_text = ?,
         logo_image_url = ?,
         play_url = ?,
         header_title_text = ?,
         success_status_text = ?,
         duplicate_status_text = ?,
         failed_status_text = ?,
         footer_text = ?,
         button_text = ?,
         header_background_color = ?,
         body_background_color = ?,
         footer_background_color = ?,
         header_title_color = ?,
         status_success_color = ?,
         status_failed_color = ?,
         labels_color = ?,
         values_color = ?,
         secondary_text_color = ?,
         separator_color = ?,
         button_color = ?,
         updated_at = ?
     WHERE line_oa_id = ? AND tenant_id = ?`
  )
    .bind(
      next.enable_processing_reply,
      next.processing_reply_text,
      next.enable_success_flex,
      next.enable_duplicate_flex,
      next.enable_failed_reply,
      next.failed_reply_text,
      next.logo_image_url,
      next.play_url,
      next.header_title_text,
      next.success_status_text,
      next.duplicate_status_text,
      next.failed_status_text,
      next.footer_text,
      next.button_text,
      next.header_background_color,
      next.body_background_color,
      next.footer_background_color,
      next.header_title_color,
      next.status_success_color,
      next.status_failed_color,
      next.labels_color,
      next.values_color,
      next.secondary_text_color,
      next.separator_color,
      next.button_color,
      now,
      lineOAId,
      tenantId
    )
    .run();

  return (await env.DB.prepare(
    `SELECT * FROM line_message_settings WHERE line_oa_id = ? AND tenant_id = ? LIMIT 1`
  )
    .bind(lineOAId, tenantId)
    .first<LineMessageSettings>()) as LineMessageSettings;
}
