require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const SQLiteStore = require('connect-sqlite3')(session);
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.APP_URL || 'http://localhost:3000'}/auth/google/callback`
  },
  (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value || '';
    const name = profile.displayName || '';

    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
    if (!user) {
      const result = db.prepare('INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)').run(profile.id, email, name);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }

    user.accessToken = accessToken;
    done(null, user);
  }
));

passport.serializeUser((user, done) => done(null, { id: user.id, accessToken: user.accessToken }));
passport.deserializeUser((data, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(data.id);
  if (user) user.accessToken = data.accessToken;
  done(null, user || false);
});

app.use('/auth', require('./routes/auth'));
app.use('/api/goals', require('./routes/goals'));
app.use('/api/academic', require('./routes/academic'));

app.use(express.static('.'));

app.listen(PORT, () => {
  console.log(`Goal Tracker running at http://localhost:${PORT}`);
});
