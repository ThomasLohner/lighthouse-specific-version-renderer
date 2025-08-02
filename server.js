import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { fromEnv } from '@aws-sdk/credential-providers';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Track ongoing installations to show loading screen
const ongoingInstallations = new Map();

// Cache remote report data for version detection
const remoteReportCache = new Map();

// S3 Client setup
let s3Client = null;
if (process.env.S3_ENABLED === 'true') {
  s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });
}

// S3 URL parsing utility
function parseS3Url(url) {
  try {
    const urlObj = new URL(url);
    let bucket, key, endpoint;
    
    // Handle different S3 URL patterns
    if (urlObj.hostname.includes('.s3.') || urlObj.hostname.includes('.s3-')) {
      // Virtual-hosted style: https://bucket.s3.region.amazonaws.com/path/file.json
      bucket = urlObj.hostname.split('.')[0];
      key = urlObj.pathname.slice(1); // Remove leading slash
      endpoint = urlObj.origin.replace(`${bucket}.`, ''); // Extract S3 endpoint
    } else if (urlObj.hostname.includes('amazonaws.com')) {
      // Path-style: https://s3.region.amazonaws.com/bucket/path/file.json
      const pathParts = urlObj.pathname.slice(1).split('/');
      bucket = pathParts[0];
      key = pathParts.slice(1).join('/');
      endpoint = urlObj.origin;
    } else {
      // MinIO or custom S3-compatible: https://minio.example.com/bucket/path/file.json
      const pathParts = urlObj.pathname.slice(1).split('/');
      bucket = pathParts[0];
      key = pathParts.slice(1).join('/');
      endpoint = urlObj.origin;
    }
    
    return { bucket, key, endpoint };
  } catch (error) {
    throw new Error(`Invalid S3 URL format: ${error.message}`);
  }
}

// Utility functions for encryption/decryption
function decryptHash(encryptedHash) {
  try {
    const secret = process.env.APP_SECRET;
    if (!secret) {
      throw new Error('APP_SECRET not configured');
    }
    
    // Restore URL-safe base64 to standard base64 and add padding if needed
    let base64 = encryptedHash
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '=';
    }
    
    // Base64 decode the hash
    const encryptedBuffer = Buffer.from(base64, 'base64');
    
    // Extract IV (16 bytes) and encrypted data
    const iv = encryptedBuffer.subarray(0, 16);
    const encrypted = encryptedBuffer.subarray(16);
    
    // Create decipher with CTR mode
    const decipher = crypto.createDecipheriv('aes-128-ctr', Buffer.from(secret.slice(0, 16), 'utf8'), iv);
    
    // Decrypt
    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error.message);
    throw new Error('Invalid or corrupted hash');
  }
}

async function fetchRemoteReport(url) {
  try {
    console.log(`Fetching report from: ${url}`);
    
    // Check if S3 is enabled and we have an S3 client
    if (process.env.S3_ENABLED === 'true' && s3Client) {
      return await fetchFromS3(url);
    } else {
      return await fetchFromHttp(url);
    }
  } catch (error) {
    console.error('Failed to fetch remote report:', error.message);
    throw new Error(`Failed to fetch report: ${error.message}`);
  }
}

async function fetchFromS3(url) {
  const { bucket, key, endpoint } = parseS3Url(url);
  console.log(`Fetching from S3 - Bucket: ${bucket}, Key: ${key}, Endpoint: ${endpoint}`);
  
  // Create a new S3 client with the specific endpoint for this request
  const clientForRequest = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: endpoint !== `https://s3.${process.env.S3_REGION || 'us-east-1'}.amazonaws.com` ? endpoint : undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: !endpoint.includes('amazonaws.com'), // Use path style for MinIO
  });
  
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  
  const response = await clientForRequest.send(command);
  const body = await response.Body.transformToString();
  const reportData = JSON.parse(body);
  
  // Validate that it's a Lighthouse report
  if (!reportData.lighthouseVersion) {
    throw new Error('Invalid Lighthouse report: missing lighthouseVersion');
  }
  
  return reportData;
}

async function fetchFromHttp(url) {
  const response = await fetch(url, {
    timeout: 10000, // 10 second timeout
    headers: {
      'User-Agent': 'Lighthouse-Report-Renderer/1.0'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const reportData = await response.json();
  
  // Validate that it's a Lighthouse report
  if (!reportData.lighthouseVersion) {
    throw new Error('Invalid Lighthouse report: missing lighthouseVersion');
  }
  
  return reportData;
}

async function installVersion(lighthouseVersion) {
  // Create alias name using exact version
  const aliasName = `lighthouse-v${lighthouseVersion}`;
  
  try {
    // Install the exact version with alias
    const installCommand = `npm install ${aliasName}@npm:lighthouse@${lighthouseVersion}`;
    console.log(`Running: ${installCommand}`);
    
    execSync(installCommand, { 
      stdio: 'pipe',
      cwd: __dirname 
    });
    
    console.log(`✅ Successfully installed Lighthouse v${lighthouseVersion} as ${aliasName}`);
    return aliasName;
    
  } catch (error) {
    console.error(`❌ Failed to install Lighthouse v${lighthouseVersion}:`, error.message);
    
    // Try major version fallback
    const majorVersion = lighthouseVersion.split('.')[0];
    const majorAliasName = `lighthouse-v${majorVersion}`;
    const majorAliasPath = path.join(__dirname, 'node_modules', majorAliasName);
    
    if (fs.existsSync(majorAliasPath)) {
      console.log(`Using major version fallback: ${majorAliasName}`);
      return majorAliasName;
    }
    
    console.log(`Falling back to current lighthouse package`);
    return 'lighthouse';
  }
}

async function ensureVersionInstalled(lighthouseVersion) {
  const aliasName = `lighthouse-v${lighthouseVersion}`;
  const aliasPath = path.join(__dirname, 'node_modules', aliasName);
  
  if (fs.existsSync(aliasPath)) {
    return aliasName;
  }
  
  return await installVersion(lighthouseVersion);
}

async function getReportGenerator(lighthouseVersion) {
  try {
    const packageName = await ensureVersionInstalled(lighthouseVersion);
    
    // Try different possible paths for different Lighthouse versions
    const possiblePaths = [
      `${packageName}/report/generator/report-generator.js`,  // v8+
      `${packageName}/lighthouse-core/report/report-generator.js`,  // v6-v7
      `${packageName}/lighthouse-core/report/v2/report-generator.js`,  // older versions
    ];
    
    for (const modulePath of possiblePaths) {
      try {
        const module = await import(modulePath);
        return module.ReportGenerator || module.default;
      } catch (importError) {
        continue;
      }
    }
    
    throw new Error(`Could not find ReportGenerator for ${packageName}`);
    
  } catch (error) {
    // Fallback to default lighthouse
    const module = await import('lighthouse/report/generator/report-generator.js');
    return module.ReportGenerator;
  }
}

// Serve assets dynamically based on version
app.get('/assets/:file', async (req, res) => {
  try {
    let lighthouseVersion;
    
    // First try to get version from local report.json
    try {
      const reportJson = JSON.parse(fs.readFileSync('report.json', 'utf8'));
      lighthouseVersion = reportJson.lighthouseVersion;
    } catch (localError) {
      // If local file doesn't exist, try to find version from cached remote reports
      // Check if there's a cached report we can use for version detection
      if (remoteReportCache.size > 0) {
        const firstCachedReport = remoteReportCache.values().next().value;
        lighthouseVersion = firstCachedReport?.lighthouseVersion;
      }
    }
    
    if (!lighthouseVersion) {
      throw new Error('No lighthouse version available for asset serving');
    }
    
    const exactAliasName = `lighthouse-v${lighthouseVersion}`;
    
    // Try exact version first
    let assetPath = path.join(__dirname, 'node_modules', exactAliasName, 'report', 'assets', req.params.file);
    
    if (fs.existsSync(assetPath)) {
      res.sendFile(assetPath);
      return;
    }
    
    // Try major version fallback
    const majorVersion = lighthouseVersion.split('.')[0];
    const majorAliasName = `lighthouse-v${majorVersion}`;
    assetPath = path.join(__dirname, 'node_modules', majorAliasName, 'report', 'assets', req.params.file);
    
    if (fs.existsSync(assetPath)) {
      res.sendFile(assetPath);
      return;
    }
    
    // Final fallback to default lighthouse
    assetPath = path.join(__dirname, 'node_modules', 'lighthouse', 'report', 'assets', req.params.file);
    if (fs.existsSync(assetPath)) {
      res.sendFile(assetPath);
    } else {
      res.status(404).send('Asset not found');
    }
  } catch (error) {
    res.status(404).send('Asset not found');
  }
});

// Debug route to clear stuck installations
app.get('/clear-installations', (req, res) => {
  ongoingInstallations.clear();
  res.send('Cleared all ongoing installations. <a href="/">Go back</a>');
});

// Loading screen route
app.get('/loading/:version', (req, res) => {
  const version = req.params.version;
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Installing Lighthouse v${version}...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .loading-container {
      text-align: center;
      padding: 2rem;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 { margin: 0 0 1rem; font-size: 1.5rem; }
    p { margin: 0; opacity: 0.9; }
    .version { 
      font-family: 'Monaco', 'Menlo', monospace; 
      background: rgba(255, 255, 255, 0.2);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
    }
  </style>
  <script>
    // Auto-refresh every 2 seconds to check if installation is complete
    setTimeout(() => {
      const urlParams = new URLSearchParams(window.location.search);
      const returnTo = urlParams.get('returnTo');
      window.location.href = returnTo || '/';
    }, 2000);
  </script>
</head>
<body>
  <div class="loading-container">
    <div class="spinner"></div>
    <h1>Installing Lighthouse</h1>
    <p>Installing version <span class="version">v${version}</span>...</p>
    <p style="margin-top: 1rem; font-size: 0.9rem; opacity: 0.7;">
      This may take a few moments
    </p>
  </div>
</body>
</html>
  `);
});

// New route for encrypted hash URLs
app.get('/report/:hash', async (req, res) => {
  try {
    const encryptedHash = req.params.hash;
    
    // Decrypt the hash to get the original URL
    const originalUrl = decryptHash(encryptedHash);
    
    // Check if we have cached data for this URL
    let reportJson = remoteReportCache.get(originalUrl);
    
    if (!reportJson) {
      // Fetch the report from remote URL
      reportJson = await fetchRemoteReport(originalUrl);
      
      // Cache the report data
      remoteReportCache.set(originalUrl, reportJson);
    }
    
    const version = reportJson.lighthouseVersion;
    
    // Check if version needs to be installed
    const aliasName = `lighthouse-v${version}`;
    const aliasPath = path.join(__dirname, 'node_modules', aliasName);
    const versionExists = fs.existsSync(aliasPath);
    const installationOngoing = ongoingInstallations.has(version);
    
    // If version exists, clear any stuck installation tracking and proceed
    if (versionExists) {
      if (installationOngoing) {
        ongoingInstallations.delete(version);
      }
      
      // Generate the report directly
      const ReportGenerator = await getReportGenerator(version);
      let html = ReportGenerator.generateReportHtml(reportJson);
      
      // Replace asset paths to use version-specific assets
      html = html.replace(/src="([^"]*\.(?:js|css))"/g, '/assets/$1');
      html = html.replace(/href="([^"]*\.css)"/g, 'href="/assets/$1"');
      
      res.send(html);
      return;
    }
    
    // Version doesn't exist - need to install  
    if (!installationOngoing) {
      // Create installation promise and store it immediately
      const installPromise = (async () => {
        try {
          // Small delay to ensure loading screen appears first
          await new Promise(resolve => setTimeout(resolve, 100));
          return await installVersion(version);
        } finally {
          // Always clean up the installation tracking
          ongoingInstallations.delete(version);
        }
      })();
      
      ongoingInstallations.set(version, installPromise);
      res.redirect(`/loading/${version}?returnTo=${encodeURIComponent('/report/' + encryptedHash)}`);
      return;
    }
    
    // Installation is ongoing, show loading screen
    res.redirect(`/loading/${version}?returnTo=${encodeURIComponent('/report/' + encryptedHash)}`);
    
  } catch (error) {
    res.status(500).send(`Error processing report: ${error.message}`);
  }
});

app.get('/', async (req, res) => {
  try {
    const reportJson = JSON.parse(fs.readFileSync('report.json', 'utf8'));
    const version = reportJson.lighthouseVersion;
    
    // Check if version needs to be installed
    const aliasName = `lighthouse-v${version}`;
    const aliasPath = path.join(__dirname, 'node_modules', aliasName);
    const versionExists = fs.existsSync(aliasPath);
    const installationOngoing = ongoingInstallations.has(version);
    
    // If version exists, clear any stuck installation tracking and proceed
    if (versionExists) {
      if (installationOngoing) {
        ongoingInstallations.delete(version);
      }
      
      // Generate the report directly
      const ReportGenerator = await getReportGenerator(version);
      let html = ReportGenerator.generateReportHtml(reportJson);
      
      // Replace asset paths to use version-specific assets
      html = html.replace(/src="([^"]*\.(?:js|css))"/g, '/assets/$1');
      html = html.replace(/href="([^"]*\.css)"/g, 'href="/assets/$1"');
      
      res.send(html);
      return;
    }
    
    // Version doesn't exist - need to install  
    if (!installationOngoing) {
      // Create installation promise and store it immediately
      const installPromise = (async () => {
        try {
          // Small delay to ensure loading screen appears first
          await new Promise(resolve => setTimeout(resolve, 100));
          return await installVersion(version);
        } finally {
          // Always clean up the installation tracking
          ongoingInstallations.delete(version);
        }
      })();
      
      ongoingInstallations.set(version, installPromise);
      res.redirect(`/loading/${version}`);
      return;
    }
    
    // Installation is ongoing, show loading screen
    res.redirect(`/loading/${version}`);
    
  } catch (error) {
    res.status(500).send(`Error reading or rendering report: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Lighthouse report server running on http://localhost:${PORT}`);
});