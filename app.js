const express = require('express');
const session = require('express-session');
const crypto = require('crypto');
const SpotifyWebApi = require('spotify-web-api-node');
const { URLSearchParams } = require('url');

const app = express();
const port = 8888;

// CONFIG
const CLIENT_ID = '6fb7cde5f1b6445cacbfe24d669239a6';
const REDIRECT_URI = `http://127.0.0.1:${port}/callback`;
const SOURCE_PLAYLIST_ID = '6tAckVAXr7fMzOa7o8Z2GF';
const TARGET_PLAYLIST_ID = '64lZ0qMveaX8XPAOM3NMQx';
const SCOPES = ['playlist-modify-public', 'playlist-modify-private', 'playlist-read-private'];

app.use(session({
  secret: crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: true,
}));

function generateCodeVerifier(length = 64) {
  return crypto.randomBytes(length).toString('base64url');
}

function generateCodeChallenge(codeVerifier) {
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  return hash.toString('base64url');
}

const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);

const spotifyApi = new SpotifyWebApi({
  clientId: CLIENT_ID,
  redirectUri: REDIRECT_URI,
});

app.get('/', (req, res) => {
  const authUrl = `https://accounts.spotify.com/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES.join(' '),
      redirect_uri: REDIRECT_URI,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
    }).toString();

  res.redirect(authUrl);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send('Authorization failed.');

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
      }),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const tokenData = await response.json();

    if (!tokenData.access_token) {
      return res.send('Token exchange failed.');
    }

    spotifyApi.setAccessToken(tokenData.access_token);
    spotifyApi.setRefreshToken(tokenData.refresh_token);
    req.session.tokenData = tokenData;

    res.send('Login successful! You may close this window.');
    setTimeout(() => {
      copyPlaylistTracks(); // start copying once authorized
    }, 1000);
  } catch (err) {
    console.error('Callback error:', err);
    res.send('Error during callback.');
  }
});

async function copyPlaylistTracks() {
  try {
    const sourceTracks = [];
    let offset = 0;
    let batch;

    do {
      batch = await spotifyApi.getPlaylistTracks(SOURCE_PLAYLIST_ID, {
        offset,
        limit: 100,
      });
      const uris = batch.body.items.map(item => item.track.uri).filter(Boolean);
      sourceTracks.push(...uris);
      offset += uris.length;
    } while (batch.body.next);

    console.log(`Total tracks to copy: ${sourceTracks.length}`);

    for (let i = 0; i < sourceTracks.length; i += 100) {
      const chunk = sourceTracks.slice(i, i + 100);
      await spotifyApi.addTracksToPlaylist(TARGET_PLAYLIST_ID, chunk);
      console.log(`Added tracks ${i + 1}–${i + chunk.length}`);
    }

    console.log('✅ Playlist copied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error copying tracks:', err.message);
    process.exit(1);
  }
}

app.listen(port, () => {
  console.log(`🚀 Open http://localhost:${port} to authenticate with Spotify`);
});
