const express = require('express');
const db = require('../db');
const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// GET all goals for the logged-in user
router.get('/', requireAuth, (req, res) => {
  const goals = db.prepare('SELECT * FROM goals WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(goals.map(dbToGoal));
});

// POST create a new goal
router.post('/', requireAuth, (req, res) => {
  const { title, category, type, current_value, target_value, progress, streak, target_date, notes } = req.body;
  const result = db.prepare(`
    INSERT INTO goals (user_id, title, category, type, current_value, target_value, progress, streak, target_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.user.id, title, category, type, current_value || 0, target_value || 0, progress || 0, streak || 0, target_date || null, notes || null);

  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(result.lastInsertRowid);
  res.json(dbToGoal(goal));
});

// PUT update a goal
router.put('/:id', requireAuth, (req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });

  const { title, category, type, current_value, target_value, progress, streak, last_completed, target_date, notes } = req.body;
  db.prepare(`
    UPDATE goals SET title=?, category=?, type=?, current_value=?, target_value=?, progress=?, streak=?, last_completed=?, target_date=?, notes=?
    WHERE id = ? AND user_id = ?
  `).run(title, category, type, current_value ?? goal.current_value, target_value ?? goal.target_value,
    progress ?? goal.progress, streak ?? goal.streak, last_completed ?? goal.last_completed,
    target_date ?? goal.target_date, notes ?? goal.notes, req.params.id, req.user.id);

  const updated = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
  res.json(dbToGoal(updated));
});

// DELETE a goal
router.delete('/:id', requireAuth, (req, res) => {
  const result = db.prepare('DELETE FROM goals WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Goal not found' });
  res.json({ ok: true });
});

function dbToGoal(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    type: row.type,
    current: row.current_value,
    target: row.target_value,
    progress: row.progress,
    streak: row.streak,
    lastCompleted: row.last_completed,
    targetDate: row.target_date,
    notes: row.notes,
    createdAt: row.created_at * 1000
  };
}

module.exports = router;
