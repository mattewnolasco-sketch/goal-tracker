const express = require('express');
const passport = require('passport');
const router = express.Router();

// Redirect to Google login — request Gmail read access too
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/gmail.readonly']
}));

// Google redirects here after login
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => res.redirect('/')
);

router.post('/logout', (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email
    }
  });
});

module.exports = router;
