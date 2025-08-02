# Lighthouse Specific Version Report Renderer

A Node.js server that renders Lighthouse reports using the **exact historic version** that generated them. Supports both local reports and **remote URL fetching** with encrypted hash URLs for security.

## Features

✅ **Exact version matching** - Uses the precise Lighthouse version from your reports  
✅ **Automatic installation** - Missing versions install automatically with loading screen  
✅ **Multi-version support** - Handles Lighthouse v6+ with different file structures  
✅ **Authentic rendering** - Uses the actual historic ReportGenerator and assets  
✅ **Remote URL fetching** - Fetch reports from any HTTP endpoint or S3 bucket  
✅ **Encrypted hash URLs** - Secure URL hiding with AES-128-CTR encryption  
✅ **S3/MinIO support** - Native support for AWS S3 and MinIO storage  
✅ **Zero configuration** - Works with local files or remote URLs  

## Quick Start

1. **Clone and install:**
   ```bash
   git clone <repo-url>
   cd light-report
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   # Copy the example .env file
   cp .env.example .env
   
   # Edit .env with your configuration
   nano .env
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Use the renderer:**

   **For local reports:**
   - Add your `report.json` file to the project root
   - Visit `http://localhost:3000`

   **For remote reports:**
   - Encrypt your report URL: `node encrypt-url.js encrypt "https://example.com/report.json"`
   - Visit `http://localhost:3000/report/<encrypted-hash>`

## Remote Report URLs

### Encryption Tool

#### CLI Usage
Use the included `encrypt-url.js` CLI tool to generate secure encrypted hashes:

```bash
# Encrypt a report URL
node encrypt-url.js encrypt "https://storage.googleapis.com/mybucket/report.json"

# Test round-trip encryption
node encrypt-url.js test "https://example.com/report.json"

# Decrypt a hash back to original URL
node encrypt-url.js decrypt "encrypted-hash-here"
```

#### Programmatic Usage
You can also encrypt URLs programmatically in your own JavaScript code:

```javascript
import crypto from 'crypto';

function encryptUrl(url, secret) {
  // Generate random IV (16 bytes for AES-128-CTR)
  const iv = crypto.randomBytes(16);
  
  // Create cipher with CTR mode
  const cipher = crypto.createCipheriv('aes-128-ctr', Buffer.from(secret.slice(0, 16), 'utf8'), iv);
  
  // Encrypt the URL
  let encrypted = cipher.update(url, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  // Combine IV and encrypted data
  const combined = Buffer.concat([iv, encrypted]);
  
  // Base64 encode with URL-safe characters and remove padding
  return combined.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Example usage
const reportUrl = "https://storage.googleapis.com/mybucket/report.json";
const secret = "your-32-character-secret-key";
const encryptedHash = encryptUrl(reportUrl, secret);

console.log(`Encrypted hash: ${encryptedHash}`);
console.log(`Report URL: http://localhost:3000/report/${encryptedHash}`);
```

For a complete implementation with error handling and decryption, see `encrypt-url.js`.

### S3/MinIO Support

Configure S3 access in your `.env` file:

```bash
# S3 Configuration
S3_ENABLED=true
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1
```

**Supported S3 URL formats:**
- AWS S3: `https://bucket.s3.region.amazonaws.com/path/report.json`
- MinIO: `https://minio.example.com/bucket/path/report.json`
- CloudFront: `https://d123456.cloudfront.net/path/report.json`

### Security Features

- **AES-128-CTR encryption** for URL obscurity
- **URL-safe base64** encoding (no special characters)
- **Hidden original URLs** - only encrypted hashes are visible
- **Compact hashes** - ~30% shorter than previous implementation

## Manual Version Management

```bash
# Install exact versions
node install-versions.js 12.6.1 10.4.0 11.7.1

# Install major versions (latest of each)
node install-versions.js 12 10 11

# Install common versions
node install-versions.js --common

# List installed versions
node install-versions.js --list
```

## How It Works

### Local Reports
1. **Version Detection**: Reads `lighthouseVersion` from your `report.json`
2. **Smart Installation**: If `lighthouse-v12.6.1` doesn't exist, automatically runs `npm install lighthouse-v12.6.1@npm:lighthouse@12.6.1`
3. **Loading Screen**: Shows beautiful loading UI during installation
4. **Path Resolution**: Tries multiple import paths for different Lighthouse versions
5. **Authentic Rendering**: Uses the exact ReportGenerator, CSS, and JS from that version

### Remote Reports
1. **URL Encryption**: Use `encrypt-url.js` to create secure hash from report URL
2. **Hash Decryption**: Server decrypts hash to get original report URL
3. **Remote Fetching**: Downloads report JSON from HTTP endpoint or S3 bucket
4. **Version Detection**: Extracts `lighthouseVersion` from fetched report
5. **Installation & Rendering**: Same process as local reports

## NPM Aliasing

This project uses **npm aliases** to install multiple Lighthouse versions side-by-side. Instead of overwriting the default `lighthouse` package, we create aliases like:

```bash
npm install lighthouse-v12.6.1@npm:lighthouse@12.6.1
npm install lighthouse-v10.4.0@npm:lighthouse@10.4.0
```

This creates separate packages in `node_modules/`:
- `lighthouse-v12.6.1/` (contains Lighthouse v12.6.1)
- `lighthouse-v10.4.0/` (contains Lighthouse v10.4.0)
- `lighthouse/` (default/latest version)

Each version maintains its own files, dependencies, and internal structure, ensuring perfect isolation and authentic rendering.

## Version Support

- **v12+**: Modern structure (`/report/generator/report-generator.js`)
- **v6-v7**: Legacy structure (`/lighthouse-core/report/report-generator.js`)  
- **Older**: Fallback paths and graceful degradation
- **Assets**: Version-specific CSS, JS, and templates served correctly

## Environment Configuration

Create a `.env` file in the project root:

```bash
# Encryption secret for URL hashing (required for remote URLs)
APP_SECRET=your-32-character-secret-key-here

# S3 Configuration (optional, for S3/MinIO support)
S3_ENABLED=false
S3_ACCESS_KEY=your-s3-access-key
S3_SECRET_KEY=your-s3-secret-key
S3_REGION=us-east-1
```

## Project Structure

```
lighthouse-report/
├── server.js              # Main server with auto-install & loading screen
├── install-versions.js    # Manual version installer utility  
├── encrypt-url.js         # URL encryption CLI tool
├── package.json           # Dependencies
├── .env                   # Environment configuration
├── README.md              # This file
└── report.json            # Your local Lighthouse report (optional)
```

## Example Usage

### Local Report Example
**For a report with `"lighthouseVersion": "10.4.0"`:**
1. Place `report.json` in project root
2. Visit `http://localhost:3000`
3. Server detects v10.4.0 is needed and shows loading screen
4. Installs `lighthouse-v10.4.0@npm:lighthouse@10.4.0`
5. Renders with authentic v10.4.0 ReportGenerator and assets

### Remote Report Example
```bash
# 1. Encrypt your report URL
node encrypt-url.js encrypt "https://storage.googleapis.com/my-bucket/lighthouse-report.json"

# 2. Use the generated hash in your URL
# http://localhost:3000/report/IvrHOSU2UpzG3Y9gKC-BgnV1UAB-0dbKOkBpJ1ODf4_l...

# 3. Server automatically:
#    - Decrypts the hash to get original URL
#    - Fetches the report from remote location
#    - Detects Lighthouse version and installs if needed
#    - Renders with historic accuracy
```

**Perfect for:**
- Securely sharing Lighthouse reports without exposing storage URLs
- Comparing reports across different Lighthouse versions
- Ensuring consistent historic rendering  
- Archiving reports with authentic visual appearance
- Development and testing with multiple Lighthouse versions
- Integration with CI/CD pipelines storing reports in S3