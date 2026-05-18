-- ลบ metadata รายวัน (เช่น slip_data, sender_name, receiver_name, ...)
DELETE FROM report_logs
WHERE created_at < strftime('%s', 'now', '-1 day')
  AND metadata IS NOT NULL;