#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function installExactVersion(version) {
  const aliasName = `lighthouse-v${version}`;
  
  try {
    console.log(`📦 Installing exact Lighthouse v${version} as ${aliasName}...`);
    
    const installCommand = `npm install ${aliasName}@npm:lighthouse@${version}`;
    console.log(`Running: ${installCommand}`);
    
    execSync(installCommand, { stdio: 'inherit' });
    
    console.log(`✅ Successfully installed Lighthouse v${version}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to install Lighthouse v${version}:`, error.message);
    return false;
  }
}

function installMajorVersion(majorVersion) {
  const aliasName = `lighthouse-v${majorVersion}`;
  
  try {
    console.log(`📦 Installing Lighthouse v${majorVersion}.x as ${aliasName}...`);
    
    const installCommand = `npm install ${aliasName}@npm:lighthouse@${majorVersion}`;
    console.log(`Running: ${installCommand}`);
    
    execSync(installCommand, { stdio: 'inherit' });
    
    console.log(`✅ Successfully installed Lighthouse v${majorVersion}.x`);
    return true;
    
  } catch (error) {
    console.error(`❌ Failed to install Lighthouse v${majorVersion}.x:`, error.message);
    return false;
  }
}

function listInstalledVersions() {
  console.log('Installed Lighthouse versions:');
  
  const nodeModulesPath = 'node_modules';
  if (!fs.existsSync(nodeModulesPath)) {
    console.log('  No node_modules directory found');
    return;
  }
  
  const dirs = fs.readdirSync(nodeModulesPath);
  const lighthouseVersions = dirs.filter(dir => dir.startsWith('lighthouse-v'));
  
  if (lighthouseVersions.length === 0) {
    console.log('  No additional Lighthouse versions installed');
    console.log('  Only default lighthouse package available');
  } else {
    lighthouseVersions.forEach(dir => {
      const version = dir.replace('lighthouse-v', '');
      console.log(`  ✅ v${version} (${dir})`);
    });
  }
  
  // Also show default lighthouse
  const defaultExists = fs.existsSync('node_modules/lighthouse');
  console.log(`  ${defaultExists ? '✅' : '❌'} default lighthouse package`);
}

function installCommonVersions() {
  console.log('🚀 Installing common Lighthouse major versions...\n');
  
  const commonVersions = ['8', '9', '10', '11', '12'];
  let successCount = 0;
  
  for (const version of commonVersions) {
    if (installMajorVersion(version)) {
      successCount++;
    }
    console.log(''); // Add spacing
  }
  
  console.log(`📊 Summary: ${successCount}/${commonVersions.length} major versions installed successfully`);
}

// Check command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage:');
  console.log('  node install-versions.js 12.6.1 10.4.0    # Install exact versions');
  console.log('  node install-versions.js 12 10            # Install major versions');
  console.log('  node install-versions.js --common         # Install common major versions');
  console.log('  node install-versions.js --list           # List installed versions');
} else if (args[0] === '--list') {
  listInstalledVersions();
} else if (args[0] === '--common') {
  installCommonVersions();
} else {
  // Install specific versions
  console.log(`🚀 Installing specific versions: ${args.join(', ')}\n`);
  
  let successCount = 0;
  for (const version of args) {
    const success = version.includes('.') 
      ? installExactVersion(version)  // Exact version like "12.6.1"
      : installMajorVersion(version); // Major version like "12"
    
    if (success) {
      successCount++;
    }
    console.log('');
  }
  
  console.log(`📊 Summary: ${successCount}/${args.length} versions installed successfully`);
}