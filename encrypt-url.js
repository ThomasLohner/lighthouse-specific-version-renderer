#!/usr/bin/env node

import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function encryptUrl(url) {
  try {
    const secret = process.env.APP_SECRET;
    if (!secret) {
      throw new Error('APP_SECRET not configured in .env file');
    }
    
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
  } catch (error) {
    console.error('Encryption failed:', error.message);
    process.exit(1);
  }
}

function decryptUrl(encryptedHash) {
  try {
    const secret = process.env.APP_SECRET;
    if (!secret) {
      throw new Error('APP_SECRET not configured in .env file');
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
    process.exit(1);
  }
}

function showUsage() {
  console.log(`
Usage: node encrypt-url.js [command] [url]

Commands:
  encrypt <url>    Encrypt a URL and return the hash
  decrypt <hash>   Decrypt a hash and return the original URL
  test <url>       Encrypt then decrypt to test round-trip

Examples:
  node encrypt-url.js encrypt "https://example.com/report.json"
  node encrypt-url.js decrypt "base64-encoded-hash"
  node encrypt-url.js test "https://example.com/report.json"
`);
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  showUsage();
  process.exit(1);
}

const command = args[0];
const input = args[1];

switch (command) {
  case 'encrypt':
    if (!input) {
      console.error('Error: URL required for encrypt command');
      showUsage();
      process.exit(1);
    }
    const hash = encryptUrl(input);
    console.log('\n✅ Encryption successful!');
    console.log(`Original URL: ${input}`);
    console.log(`Encrypted hash: ${hash}`);
    console.log(`Hash length: ${hash.length} characters`);
    console.log(`\nTest URL: http://localhost:3000/report/${hash}`);
    break;
    
  case 'decrypt':
    if (!input) {
      console.error('Error: Hash required for decrypt command');
      showUsage();
      process.exit(1);
    }
    const url = decryptUrl(input);
    console.log('\n✅ Decryption successful!');
    console.log(`Encrypted hash: ${input}`);
    console.log(`Original URL: ${url}`);
    break;
    
  case 'test':
    if (!input) {
      console.error('Error: URL required for test command');
      showUsage();
      process.exit(1);
    }
    console.log('\n🔄 Testing round-trip encryption...');
    const testHash = encryptUrl(input);
    const testUrl = decryptUrl(testHash);
    
    console.log(`Original URL: ${input} (${input.length} chars)`);
    console.log(`Encrypted hash: ${testHash} (${testHash.length} chars)`);
    console.log(`Decrypted URL: ${testUrl}`);
    
    const reduction = Math.round((1 - testHash.length / input.length) * 100);
    console.log(`\n📊 Hash is ${reduction > 0 ? `${Math.abs(reduction)}% shorter` : `${Math.abs(reduction)}% longer`} than original URL`);
    
    if (input === testUrl) {
      console.log('\n✅ Round-trip test PASSED! Encryption/decryption working correctly.');
      console.log(`\nTest URL: http://localhost:3000/report/${testHash}`);
    } else {
      console.log('\n❌ Round-trip test FAILED! URLs do not match.');
      process.exit(1);
    }
    break;
    
  default:
    console.error(`Error: Unknown command '${command}'`);
    showUsage();
    process.exit(1);
}