-- Initialize the production calendar only when no authoritative state exists.
INSERT INTO calendar_state (id, store_json, revision, updated_at)
SELECT
  1,
  '{"revision":1,"slots":[],"recurrences":[{"id":"default-weekly-tuesday-talks","name":"Weekly Sangha Meeting","itemType":"talk","frequency":"weekly","monthlyMode":"weekday","interval":1,"startDate":"2026-07-21","startTime":"19:00","endTime":"20:30","title":"Sangha Meeting","description":"Each 90 minute gathering is divided into 30 minute segments:\n\u25cf Group meditation with instruction for newcomers\n\u25cf Recorded Dharma talk from a teacher presented by one of the members\n\u25cf Open discussion about the teachings and meditation practice","usePhysicalLocation":true,"useDefaultLocation":true,"location":"Unity of Eau Claire\n1808 Folsom Street\nEau Claire, WI 54703","useZoom":false,"active":true,"skippedDates":[],"createdAt":"2026-07-21T00:00:00.000Z","updatedAt":""}],"history":[],"settings":{"defaultLocation":"Unity of Eau Claire\n1808 Folsom Street\nEau Claire, WI 54703","signupWindowMonths":1,"zoomName":"","zoomEmail":"","zoomLink":""}}',
  1,
  '2026-07-21T00:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM calendar_state WHERE id = 1);
