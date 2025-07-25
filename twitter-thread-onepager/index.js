const express = require('express');
const { TwitterApi } = require('twitter-api-v2');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = new sqlite3.Database(path.join(__dirname, 'threads.db'));

// Initialize DB
function initDB() {
  db.run(`CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE,
      html TEXT,
      text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // for simple full text search
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS thread_index USING fts5(text, url, content='threads', content_rowid='id')`);
}
initDB();

// create index triggers
function createTriggers() {
  db.run(`CREATE TRIGGER IF NOT EXISTS threads_ai AFTER INSERT ON threads BEGIN
    INSERT INTO thread_index(rowid, text, url) VALUES (new.id, new.text, new.url);
  END;`);

  db.run(`CREATE TRIGGER IF NOT EXISTS threads_ad AFTER DELETE ON threads BEGIN
    INSERT INTO thread_index(thread_index, rowid, text, url) VALUES('delete', old.id, old.text, old.url);
  END;`);

  db.run(`CREATE TRIGGER IF NOT EXISTS threads_au AFTER UPDATE ON threads BEGIN
    INSERT INTO thread_index(thread_index, rowid, text, url) VALUES('delete', old.id, old.text, old.url);
    INSERT INTO thread_index(rowid, text, url) VALUES (new.id, new.text, new.url);
  END;`);
}
createTriggers();

// Config for Twitter API (requires environment variables)
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_SECRET,
});

async function fetchThread(url) {
  // Extract tweet id from URL
  const match = url.match(/status\/(\d+)/);
  if (!match) throw new Error('Invalid twitter status URL');
  const tweetId = match[1];

  const thread = await twitterClient.v2.singleTweet(tweetId, {
    expansions: ['attachments.media_keys', 'author_id', 'referenced_tweets.id'],
    'media.fields': ['url', 'preview_image_url'],
    'tweet.fields': ['conversation_id', 'author_id', 'created_at', 'entities'],
    'user.fields': ['name', 'username', 'profile_image_url'],
  });

  const conversationId = thread.data.conversation_id;
  const searchRes = await twitterClient.v2.search(`conversation_id:${conversationId} from:${thread.data.author_id}`, {
    expansions: ['attachments.media_keys'],
    'media.fields': ['url', 'preview_image_url', 'type'],
    max_results: 100,
  });

  const tweets = searchRes.tweets || searchRes.data || [];
  const includes = searchRes.includes || {};
  tweets.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return { tweets, includes };
}

function renderHTML(tweets, includes = {}) {
  let body = '';
  const mediaMap = {};
  if (includes.media) {
    includes.media.forEach(m => {
      mediaMap[m.media_key] = m;
    });
  }
  tweets.forEach(t => {
    const text = t.text.replace(/\n/g, '<br/>');
    body += `<p>${text}</p>`;
    if (t.attachments && t.attachments.media_keys) {
      t.attachments.media_keys.forEach(mk => {
        const m = mediaMap[mk];
        if (!m) return;
        if (m.type === 'photo') {
          body += `<img src="${m.url}" style="max-width:100%"/>`;
        } else if (m.type === 'animated_gif' || m.type === 'video') {
          const src = m.preview_image_url || m.url;
          body += `<video src="${src}" controls style="max-width:100%"></video>`;
        }
      });
    }
  });
  return `<!doctype html><html><body>${body}</body></html>`;
}

app.post('/api/thread', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try {
    const { tweets, includes } = await fetchThread(url);
    const html = renderHTML(tweets, includes);
    const text = tweets.map(t => t.text).join('\n');
    db.run('INSERT OR REPLACE INTO threads(url, html, text) VALUES(?,?,?)', [url, html, text]);
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/history', (req, res) => {
  db.all('SELECT id, url, created_at FROM threads ORDER BY created_at DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/search', (req, res) => {
  const q = req.query.q;
  db.all('SELECT url, snippet(thread_index) as snippet FROM thread_index WHERE thread_index MATCH ? LIMIT 20', [q], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/thread/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT html FROM threads WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).send('Not found');
    res.send(row.html);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
