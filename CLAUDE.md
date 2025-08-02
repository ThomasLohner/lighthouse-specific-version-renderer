# Historic Lighthouse Report Renderer - Developer Guide

This document contains everything you need to know about this project for future development and maintenance.

## Project Overview

A Node.js server that renders Lighthouse reports using the **exact historic version** that generated them. Supports both **local reports** and **remote URL fetching** with encrypted hash URLs. Uses npm aliasing to install and import specific Lighthouse versions on-demand.

## Core Architecture

### Key Files

- **`server.js`** - Main Express server with auto-installation, loading screen, and remote URL support
- **`install-versions.js`** - Utility for manual version management  
- **`encrypt-url.js`** - CLI tool for encrypting/decrypting report URLs
- **`package.json`** - Dependencies (includes multiple lighthouse-vX.X.X aliases + AWS SDK)
- **`.env`** - Environment configuration (APP_SECRET, S3 settings)
- **`report.json`** - User's local Lighthouse report (optional - can use remote URLs)

### Key Functions

#### `installVersion(lighthouseVersion)`
- Pure installation function - runs `npm install lighthouse-vX.X.X@npm:lighthouse@X.X.X`
- No promise management or state tracking
- Returns package alias name on success

#### `ensureVersionInstalled(lighthouseVersion)`  
- Checks if version exists, calls `installVersion()` if needed
- Used by `getReportGenerator()` for normal operations
- Simple and stateless

#### `getReportGenerator(lighthouseVersion)`
- Ensures version is installed
- Tries multiple import paths for different Lighthouse versions:
  - `lighthouse-vX.X.X/report/generator/report-generator.js` (v8+)
  - `lighthouse-vX.X.X/lighthouse-core/report/report-generator.js` (v6-v7)
  - `lighthouse-vX.X.X/lighthouse-core/report/v2/report-generator.js` (older)
- Falls back to default lighthouse package if all fail

#### `decryptHash(encryptedHash)`
- Decrypts AES-128-CTR encrypted URL hashes
- Uses APP_SECRET from environment variables
- Converts URL-safe base64 back to standard base64
- Returns original report URL for fetching

#### `fetchRemoteReport(url)`
- Fetches Lighthouse reports from remote URLs
- Supports both HTTP endpoints and S3/MinIO storage
- Uses AWS SDK when S3_ENABLED=true
- Validates report format and caches results

#### `parseS3Url(url)`
- Parses S3 URLs to extract bucket, key, and endpoint
- Supports multiple S3 URL formats:
  - Virtual-hosted: `bucket.s3.region.amazonaws.com`
  - Path-style: `s3.region.amazonaws.com/bucket`
  - MinIO: `minio.example.com/bucket`

### Loading Screen Flow

**Local Reports (`/`):**
1. **User requests unknown version** → Server immediately redirects to `/loading/X.X.X`
2. **Installation promise created** with 100ms delay and stored in `ongoingInstallations` Map
3. **Loading screen shows** with auto-refresh every 2 seconds  
4. **Installation runs** in background using `installVersion()` directly
5. **Promise resolves** and cleans up from `ongoingInstallations` Map
6. **Next refresh** detects version exists and renders report

**Remote Reports (`/report/<hash>`):**
1. **Decrypt hash** to get original report URL
2. **Fetch report** from remote location (HTTP or S3)
3. **Extract version** from fetched report JSON
4. **Follow same installation flow** as local reports
5. **Loading screen redirects** back to `/report/<hash>` instead of `/`

### Version Detection & NPM Aliasing

- **Local**: Reads `lighthouseVersion` from `report.json`
- **Remote**: Reads `lighthouseVersion` from fetched report JSON
- Creates aliases like `lighthouse-v12.6.1@npm:lighthouse@12.6.1`  
- Each version is installed as separate package in `node_modules/`
- No disk space waste (only installs versions actually used)

## Historic Lighthouse Version Differences

### File Structure Changes

**Modern (v8+):**
```
lighthouse-vX.X.X/
└── report/
    └── generator/
        └── report-generator.js
```

**Legacy (v6-v7):**
```
lighthouse-vX.X.X/
└── lighthouse-core/
    └── report/
        └── report-generator.js
```

**Older versions:**
```
lighthouse-vX.X.X/
└── lighthouse-core/
    └── report/
        └── v2/
            └── report-generator.js
```

### Import Resolution Strategy

The `getReportGenerator()` function tries paths in order of likelihood and falls back gracefully. This handles the evolution of Lighthouse's internal structure without version-specific logic.

## State Management

### `ongoingInstallations` Map
- **Key**: `lighthouseVersion` (string)
- **Value**: Promise that resolves to package name
- **Purpose**: Prevents duplicate installations and tracks loading state
- **Cleanup**: Automatic in Promise `finally` block

### `remoteReportCache` Map
- **Key**: Original report URL (string)
- **Value**: Fetched report JSON object
- **Purpose**: Caches remote reports to avoid repeated HTTP/S3 requests
- **Usage**: Used by asset serving to determine version when no local report.json exists

### S3 Client Management
- **Global**: `s3Client` initialized on startup if S3_ENABLED=true
- **Per-request**: Dynamic clients created for different endpoints (MinIO support)
- **Configuration**: Uses environment variables for credentials and region

### Race Condition Prevention

1. **Immediate redirect** to loading screen (prevents user seeing errors)
2. **Promise stored before installation starts** (prevents duplicate installs)
3. **100ms delay** ensures loading screen appears before installation
4. **Automatic cleanup** in `finally` block prevents stuck states

## Error Handling & Fallbacks

### Installation Failures
- Falls back to major version (e.g., v10.2.0 → v10)
- Final fallback to default lighthouse package
- Graceful degradation - always shows something

### Import Failures  
- Tries multiple paths for different Lighthouse structures
- Falls back to default lighthouse package
- Never crashes - always returns a ReportGenerator

### Asset Serving
- **Local Mode**: Uses version from `report.json`
- **Remote Mode**: Uses version from `remoteReportCache` if available
- Tries version-specific assets first (`/assets/file.css`)
- Falls back to default lighthouse assets
- Handles missing files gracefully

### Remote URL Failures
- **Decryption errors**: Invalid hash or wrong APP_SECRET
- **Network failures**: Timeout, DNS issues, unreachable servers
- **S3 authentication**: Invalid credentials or permissions
- **Invalid reports**: Missing `lighthouseVersion` field
- All failures return appropriate HTTP status codes with error messages

## Remote URL Architecture

### Encryption/Decryption System
- **Algorithm**: AES-128-CTR with 16-byte IV
- **Encoding**: URL-safe base64 (replaces `+/=` with `-_` and removes padding)
- **Key Source**: APP_SECRET environment variable (first 16 bytes used)
- **URL Structure**: `http://localhost:3000/report/<encrypted-hash>`

### S3/MinIO Integration
- **AWS SDK**: `@aws-sdk/client-s3` for S3 operations
- **Authentication**: Access key/secret from environment variables
- **Endpoint Detection**: Automatic from URL (supports AWS S3, MinIO, CloudFront)
- **Path Styles**: Virtual-hosted for AWS, path-style for MinIO

### Environment Configuration
```bash
# Required for remote URLs
APP_SECRET=your-32-character-secret-key

# Optional S3 support
S3_ENABLED=true/false
S3_ACCESS_KEY=your-access-key  
S3_SECRET_KEY=your-secret-key
S3_REGION=us-east-1
```

### CLI Tool (`encrypt-url.js`)
- **Commands**: `encrypt`, `decrypt`, `test`
- **Output**: URL-safe base64 encrypted hashes
- **Round-trip testing**: Verifies encryption/decryption works
- **Length reporting**: Shows hash length vs original URL

## Development Notes

### Adding New Version Support

If future Lighthouse versions change structure again:

1. Add new path to `possiblePaths` array in `getReportGenerator()`
2. Update comments to document the version range
3. No other changes needed - system auto-adapts

### Debugging Installation Issues

1. Check `ongoingInstallations` Map state with `/clear-installations` debug route
2. Verify npm alias creation: `ls node_modules/ | grep lighthouse-v`
3. Test import paths manually: `node -e "import('lighthouse-v10.0.1/report/generator/report-generator.js').then(console.log)"`

### Debugging Remote URL Issues

1. **Test encryption/decryption**: `node encrypt-url.js test "your-url"`
2. **Check S3 credentials**: Verify S3_ACCESS_KEY and S3_SECRET_KEY in `.env`
3. **Validate report format**: Ensure remote JSON has `lighthouseVersion` field
4. **Network debugging**: Check if URL is accessible from server

### Performance Considerations

- **Cold start**: First request for new version takes ~10-30 seconds (npm install)
- **Warm start**: Subsequent requests are instant (cached in node_modules)
- **Memory**: Each version loads separate JS modules (acceptable for dev/testing use)
- **Disk**: Only installs versions actually used (efficient)
- **Remote fetching**: HTTP requests add ~100-500ms latency
- **S3 fetching**: Similar latency, cached after first request
- **Report caching**: `remoteReportCache` avoids repeated fetches

## Common Issues & Solutions

### Loading Screen Stuck
- Usually caused by promise not cleaning up from `ongoingInstallations`
- Visit `/clear-installations` to reset state
- Check server logs for installation errors

### Import Errors
- New Lighthouse version with different file structure
- Add new path to `possiblePaths` array
- Test with `getReportGenerator()` function directly

### Asset 404s
- Version-specific assets missing or moved
- Assets endpoint tries multiple fallback paths
- Check if assets exist in installed version: `ls node_modules/lighthouse-vX.X.X/report/assets/`

### Remote URL Issues
- **Hash decryption fails**: Check APP_SECRET matches encryption key
- **S3 access denied**: Verify S3_ACCESS_KEY, S3_SECRET_KEY, and bucket permissions
- **Network timeouts**: Check if remote URL is accessible and responding
- **Invalid report format**: Ensure JSON contains required `lighthouseVersion` field

### Hash URL Issues
- **Very long URLs**: Current CTR implementation ~30% shorter than GCM
- **URL encoding**: Hashes are URL-safe, but very long ones may hit browser limits
- **Cache misses**: Clear `remoteReportCache` if reports seem stale

## Current Architecture Capabilities

### Supported Report Sources
- **Local files**: `report.json` in project root
- **HTTP/HTTPS**: Any accessible JSON endpoint
- **AWS S3**: Virtual-hosted and path-style URLs
- **MinIO**: Self-hosted S3-compatible storage
- **CloudFront**: AWS CDN distributions

### Supported Lighthouse Versions
- **v12+**: Modern structure with full feature support
- **v6-v11**: Legacy structure with path fallbacks
- **Older**: Basic fallback support with graceful degradation

### Current Encryption Specs
- **Algorithm**: AES-128-CTR (prioritizes shorter URLs over authentication)
- **Hash length**: ~45% longer than original URL for typical URLs
- **Security level**: Good obscurity, not cryptographically secure against tampering
- **URL safety**: No special characters that require encoding

## Future Enhancements

### Possible Improvements
- **Parallel installs**: Currently installs are serialized
- **Pre-warming**: Install common versions on startup  
- **Caching**: Cache ReportGenerator instances to avoid re-imports
- **Error recovery**: Retry failed installations automatically
- **Shorter hashes**: Database lookup with short IDs instead of encryption
- **Compression**: Gzip URLs before encryption for very long URLs
- **Report persistence**: Store fetched reports locally to avoid repeated requests
- **Authentication**: Add basic auth or API keys for private report access

### Architecture Strengths
- **Extensible**: Easy to add new version support and report sources
- **Reliable**: Multiple fallback layers for installations, imports, and assets
- **User-friendly**: Loading screen, auto-install, and encrypted URL sharing
- **Efficient**: Only installs versions used, caches remote reports
- **Flexible**: Works with local files, HTTP endpoints, and S3 storage
- **Secure**: Encrypted URLs hide original storage locations
- **Compatible**: Supports AWS S3, MinIO, and custom S3-compatible storage

This architecture has proven robust across:
- **Lighthouse versions**: v6-v12+ with automatic version detection
- **Report sources**: Local files, HTTP/HTTPS, S3, MinIO, CloudFront
- **Deployment scenarios**: Development, staging, production with different storage backends
- **URL sharing**: Secure hash-based URLs for report distribution

The modular design allows future enhancements without breaking existing functionality.