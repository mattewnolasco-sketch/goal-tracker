const express = require('express');
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}

// GET previously found opportunities
router.get('/opportunities', requireAuth, (req, res) => {
  const opps = db.prepare('SELECT * FROM opportunities WHERE user_id = ? ORDER BY found_at DESC').all(req.user.id);
  res.json(opps);
});

// POST scan Gmail and find new opportunities with Claude
router.post('/scan', requireAuth, async (req, res) => {
  if (!req.user.accessToken) {
    return res.status(400).json({ error: 'No Gmail access. Please log out and sign in again.' });
  }

  try {
    const emails = await fetchRecentEmails(req.user.accessToken);
    if (emails.length === 0) {
      return res.json({ opportunities: [], message: 'No relevant emails found in the last 30 days.' });
    }

    const opportunities = await analyzeWithClaude(emails, req.user);

    // Save to database (avoid duplicates by title)
    const insert = db.prepare(`
      INSERT OR IGNORE INTO opportunities (user_id, title, description, category, source, deadline)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const opp of opportunities) {
      insert.run(req.user.id, opp.title, opp.description, opp.category || 'academic', opp.source || null, opp.deadline || null);
    }

    const all = db.prepare('SELECT * FROM opportunities WHERE user_id = ? ORDER BY found_at DESC').all(req.user.id);
    res.json({ opportunities: all, scanned: emails.length });
  } catch (err) {
    console.error('Scan error:', err.message);
    res.status(500).json({ error: 'Failed to scan Gmail. ' + err.message });
  }
});

// DELETE an opportunity
router.delete('/opportunities/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM opportunities WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

async function fetchRecentEmails(accessToken) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  // Search for academic opportunity emails from the last 30 days
  const query = 'subject:(internship OR "study abroad" OR scholarship OR fellowship OR "research opportunity" OR "career fair" OR "job opportunity" OR "graduate program") newer_than:30d';

  const listRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 20 });
  const messages = listRes.data.messages || [];

  const emails = [];
  for (const msg of messages.slice(0, 15)) {
    try {
      const full = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'metadata', metadataHeaders: ['Subject', 'From', 'Date'] });
      const headers = full.data.payload.headers;
      const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      const snippet = full.data.snippet || '';
      emails.push({ subject, from, date, snippet });
    } catch {
      // skip unreadable messages
    }
  }
  return emails;
}

async function analyzeWithClaude(emails, user) {
  const emailList = emails.map((e, i) =>
    `Email ${i + 1}:\nFrom: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\nPreview: ${e.snippet}`
  ).join('\n\n---\n\n');

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are an academic advisor AI. The student's name is ${user.name}. Analyze these emails from their school Gmail and identify genuine academic opportunities they should act on.

${emailList}

For each real opportunity found, respond with a JSON array. Each item should have:
- title: short name of the opportunity
- description: 1-2 sentence summary of what it is and why it matters
- category: one of "internship", "study_abroad", "scholarship", "research", "career", "academic"
- source: who sent it (organization/school)
- deadline: deadline date if mentioned, otherwise null

Only include real opportunities worth the student's attention. Skip spam, newsletters, and generic announcements.
Respond with ONLY a valid JSON array, no other text.`
    }]
  });

  try {
    const text = message.content[0].text.trim();
    const json = text.startsWith('[') ? text : text.match(/\[[\s\S]*\]/)?.[0] || '[]';
    return JSON.parse(json);
  } catch {
    return [];
  }
}

module.exports = router;
