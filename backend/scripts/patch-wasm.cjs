#!/usr/bin/env node
/**
 * Fix for wasm-feature-detect syntax error in Node.js < 22.19
 *
 * wasm-feature-detect v1.10.0+ contains `import.source(...)` syntax in its
 * CJS and ESM distributions for detecting the WebAssembly sourcePhaseImports proposal.
 * In Node.js 18 & 20 (and early Node 22 without experimental flags), V8 cannot parse
 * `import.source` and immediately throws:
 *   SyntaxError: Unexpected identifier 'source'
 *
 * This script safely replaces the problematic syntax with `async () => false`,
 * allowing tesseract.js to load its worker without crashing.
 */

const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(process.cwd(), 'node_modules', 'wasm-feature-detect', 'dist', 'cjs', 'index.cjs'),
  path.join(process.cwd(), 'node_modules', 'wasm-feature-detect', 'dist', 'esm', 'index.js'),
  path.join(__dirname, '..', 'node_modules', 'wasm-feature-detect', 'dist', 'cjs', 'index.cjs'),
  path.join(__dirname, '..', 'node_modules', 'wasm-feature-detect', 'dist', 'esm', 'index.js'),
];

let patchedCount = 0;

for (const targetPath of candidates) {
  try {
    if (fs.existsSync(targetPath)) {
      let content = fs.readFileSync(targetPath, 'utf8');
      if (content.includes('import.source')) {
        content = content.replace(
          /sourcePhaseImports:\(\)=>\(async\(\)=>\{[^}]+\}\)\(\)/g,
          'sourcePhaseImports:async()=>false'
        );
        content = content.replace(
          /sourcePhaseImports=\(\)=>\(async\(\)=>\{[^}]+\}\)\(\)/g,
          'sourcePhaseImports=async()=>false'
        );
        // Fallback catch-all for any remaining import.source
        content = content.replace(/import\.source\([^)]+\)/g, 'Promise.resolve(false)');
        fs.writeFileSync(targetPath, content, 'utf8');
        console.log(`[patch-wasm] Patched ${targetPath} successfully.`);
        patchedCount++;
      }
    }
  } catch (err) {
    console.warn(`[patch-wasm] Warning: Failed to patch ${targetPath}:`, err.message);
  }
}

if (patchedCount > 0) {
  console.log(`[patch-wasm] Completed patching ${patchedCount} wasm-feature-detect distribution files.`);
} else {
  console.log('[patch-wasm] wasm-feature-detect is already clean or not found.');
}

