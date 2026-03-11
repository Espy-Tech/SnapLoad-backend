/**
 * SnapLoad — Backend Express
 * Téléchargeur de vidéos via yt-dlp (gratuit) ou RapidAPI (cloud)
 *
 * Installation : npm install
 * Lancement    : node server.js
 */

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════
// MIDDLEWARES
// ═══════════════════════════════════════
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

// Limite : 20 requêtes par IP toutes les 10 minutes
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de requêtes. Réessayez dans 10 minutes.' }
});
app.use('/api/', limiter);

// ═══════════════════════════════════════
// VALIDATION DE L'URL
// ═══════════════════════════════════════
const ALLOWED_DOMAINS = [
  'tiktok.com', 'vm.tiktok.com',
  'youtube.com', 'youtu.be',
  'instagram.com',
  'facebook.com', 'fb.watch',
  'twitter.com', 'x.com',
  'reddit.com', 'v.redd.it',
  'twitch.tv',
  'dailymotion.com',
  'vimeo.com'
];

function isAllowedUrl(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_DOMAINS.some(d => hostname.endsWith(d));
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════
// MÉTHODE 1 : yt-dlp (LOCAL, GRATUIT)
// Installer : pip install yt-dlp
// ═══════════════════════════════════════
function getVideoInfoYtDlp(url) {
  return new Promise((resolve, reject) => {
    // --dump-json retourne les métadonnées sans télécharger
    const cmd = `yt-dlp --dump-json --no-playlist "${url}"`;

    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        // Construire la liste des qualités disponibles
        const formats = (info.formats || [])
          .filter(f => f.vcodec !== 'none' && f.ext === 'mp4')
          .map(f => ({
            format_id: f.format_id,
            quality:   f.height ? `${f.height}p` : f.format_note,
            ext:       f.ext,
            filesize:  f.filesize,
            fps:       f.fps,
            vcodec:    f.vcodec,
          }))
          .sort((a, b) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0));

        resolve({
          title:     info.title,
          thumbnail: info.thumbnail,
          duration:  info.duration,
          platform:  info.extractor_key,
          formats:   formats,
          webpage_url: info.webpage_url,
        });
      } catch (e) {
        reject(new Error('Impossible de parser les infos vidéo'));
      }
    });
  });
}

function downloadWithYtDlp(url, formatId, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `yt-dlp -f "${formatId}+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/best" --merge-output-format mp4 -o "${outputPath}" "${url}"`;
    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(outputPath);
    });
  });
}

function extractAudioWithYtDlp(url, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(outputPath);
    });
  });
}

// ═══════════════════════════════════════
// MÉTHODE 2 : RapidAPI (CLOUD)
// Créer un compte sur rapidapi.com
// Souscrire à "All Video Downloader" ou "Social Media Video Downloader"
// Mettre la clé dans .env : RAPIDAPI_KEY=votre_clé
// ═══════════════════════════════════════
function getVideoInfoRapidApi(url) {
  return new Promise((resolve, reject) => {
    if (!process.env.RAPIDAPI_KEY) {
      reject(new Error('RAPIDAPI_KEY non configurée dans .env'));
      return;
    }

    // API : "Social Download All In One" by manh'g
    // POST /v1/social/autolink
    const body = JSON.stringify({ url });

    const options = {
      method: 'POST',
      hostname: 'social-download-all-in-one.p.rapidapi.com',
      path: '/v1/social/autolink',
      headers: {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(body),
        'X-RapidAPI-Key':  process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'social-download-all-in-one.p.rapidapi.com'
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          console.log('[RapidAPI FULL]', data);
          const json = JSON.parse(data);

          const medias = json.medias || json.links || json.data || [];

          // Filtrer uniquement les vraies videos (type=video, extension=mp4)
          const qualities = medias
            .filter(m => m.url && m.url.startsWith('http') && m.type === 'video' && m.extension === 'mp4')
            .map((m, i) => ({
              label:       m.quality || m.resolution || ('Option ' + (i+1)),
              directUrl:   m.url,
              info:        'MP4',
              recommended: i === 0,
            }));

          if (qualities.length === 0) {
            reject(new Error('Aucun lien trouvé. La vidéo est peut-être privée.'));
            return;
          }

          resolve({
            title:     json.title     || json.name    || 'Vidéo',
            thumbnail: json.thumbnail || json.picture || json.cover || '',
            duration:  json.duration  || null,
            platform:  json.source    || json.src     || 'unknown',
            links:     qualities,
          });

        } catch (e) {
          console.error('[RapidAPI error]', e.message);
          reject(new Error('Réponse API invalide : ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════
// ROUTES API
// ═══════════════════════════════════════

// GET /api/info?url=...
// Retourne les métadonnées + qualités disponibles
app.get('/api/info', async (req, res) => {
  const { url } = req.query;

  if (!url)              return res.status(400).json({ error: 'URL manquante' });
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'Plateforme non supportée' });

  try {
    // Choisir la méthode selon la config
    const method = process.env.DOWNLOAD_METHOD || 'ytdlp'; // 'ytdlp' ou 'rapidapi'

    if (method === 'rapidapi') {
      const info = await getVideoInfoRapidApi(url);
      return res.json({
        method: 'rapidapi',
        title:     info.title,
        thumbnail: info.thumbnail,
        duration:  info.duration,
        platform:  info.platform,
        qualities: info.links.map(l => ({
          label:      l.label || 'Auto',
          directUrl:  l.directUrl,
          info:       l.info,
        }))
      });
    } else {
      // yt-dlp
      const info = await getVideoInfoYtDlp(url);
      return res.json({
        method: 'ytdlp',
        title:     info.title,
        thumbnail: info.thumbnail,
        duration:  info.duration,
        platform:  info.platform,
        qualities: info.formats.map(f => ({
          label:     f.quality,
          format_id: f.format_id,
          ext:       f.ext,
          filesize:  f.filesize,
        }))
      });
    }
  } catch (err) {
    console.error('[/api/info]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/proxy-download
// Télécharge depuis une URL distante et la streame — contourne le CORS Instagram
app.post('/api/proxy-download', async (req, res) => {
  const { directUrl, filename } = req.body;
  if (!directUrl) return res.status(400).json({ error: 'directUrl manquante' });

  try {
    const protocol = directUrl.startsWith('https') ? require('https') : require('http');
    protocol.get(directUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.instagram.com/',
      }
    }, (proxyRes) => {
      res.setHeader('Content-Disposition', `attachment; filename="${filename || 'video.mp4'}"`);
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'video/mp4');
      if (proxyRes.headers['content-length']) {
        res.setHeader('Content-Length', proxyRes.headers['content-length']);
      }
      proxyRes.pipe(res);
    }).on('error', (err) => {
      console.error('[proxy-download]', err.message);
      res.status(500).json({ error: 'Impossible de télécharger la vidéo' });
    });
  } catch (err) {
    console.error('[proxy-download]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/download
// Télécharge la vidéo et la streame au client (mode yt-dlp uniquement)
app.post('/api/download', async (req, res) => {
  const { url, format_id } = req.body;

  if (!url || !format_id) return res.status(400).json({ error: 'Paramètres manquants' });
  if (!isAllowedUrl(url))  return res.status(400).json({ error: 'URL non autorisée' });

  const tmpFile = path.join('/tmp', `snapload_${Date.now()}.mp4`);

  try {
    await downloadWithYtDlp(url, format_id, tmpFile);

    res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
    res.setHeader('Content-Type', 'video/mp4');

    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(tmpFile, () => {})); // Nettoyage auto
    stream.on('error', () => {
      fs.unlink(tmpFile, () => {});
      res.status(500).json({ error: 'Erreur de streaming' });
    });
  } catch (err) {
    fs.unlink(tmpFile, () => {});
    console.error('[/api/download]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/audio
// Extrait l'audio MP3
app.post('/api/audio', async (req, res) => {
  const { url } = req.body;

  if (!url)              return res.status(400).json({ error: 'URL manquante' });
  if (!isAllowedUrl(url)) return res.status(400).json({ error: 'URL non autorisée' });

  const tmpFile = path.join('/tmp', `snapload_audio_${Date.now()}.mp3`);

  try {
    await extractAudioWithYtDlp(url, tmpFile);

    res.setHeader('Content-Disposition', 'attachment; filename="audio.mp3"');
    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('end', () => fs.unlink(tmpFile, () => {}));
  } catch (err) {
    fs.unlink(tmpFile, () => {});
    console.error('[/api/audio]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Sanity check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', method: process.env.DOWNLOAD_METHOD || 'ytdlp' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 SnapLoad Backend démarré sur http://localhost:${PORT}`);
  console.log(`📦 Méthode : ${process.env.DOWNLOAD_METHOD || 'ytdlp'}`);
  console.log(`🔑 RapidAPI Key : ${process.env.RAPIDAPI_KEY ? '✓ configurée' : '✗ non configurée'}\n`);
});


