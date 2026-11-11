import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker, Worker } from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Ensures wasm-feature-detect syntax error is eliminated before Tesseract worker spawns.
 * In Node < 22.19, V8 chokes on import.source(...) inside wasm-feature-detect with
 * SyntaxError: Unexpected identifier 'source'.
 */
function ensureWasmFeatureDetectPatched(): void {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'wasm-feature-detect', 'dist', 'cjs', 'index.cjs'),
    path.join(process.cwd(), 'node_modules', 'wasm-feature-detect', 'dist', 'esm', 'index.js'),
    path.resolve(__dirname, '..', '..', 'node_modules', 'wasm-feature-detect', 'dist', 'cjs', 'index.cjs'),
    path.resolve(__dirname, '..', '..', 'node_modules', 'wasm-feature-detect', 'dist', 'esm', 'index.js'),
  ];
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
          content = content.replace(/import\.source\([^)]+\)/g, 'Promise.resolve(false)');
          fs.writeFileSync(targetPath, content, 'utf8');
          console.log(`[OcrService] Patched wasm-feature-detect at ${targetPath}`);
        }
      }
    } catch (err: any) {
      console.warn(`[OcrService] Could not patch ${targetPath}:`, err?.message);
    }
  }
}

export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrToken {
  text: string;
  confidence: number;
  bbox?: OcrBoundingBox;
  isMath?: boolean;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox?: OcrBoundingBox;
}

export interface OcrResult {
  text: string;
  normalizedText: string;
  tokens: OcrToken[];
  words: string[];
  mathSymbols: string[];
  wordCount: number;
  confidence: number;
  lines: OcrLine[];
}

const MATH_TOKEN_REGEX = /[+\-=*/^_\(\)\[\]{}<>≤≥≠≈±×÷√∫∑∏∂∇παβγδεθλμστωΔΩ%]/;

export class OcrService {
  private static worker: Worker | null = null;
  private static initPromise: Promise<Worker> | null = null;

  /**
   * Lazily initialize or retrieve shared Tesseract worker.
   * Resilient: cleans up promise on failure to permit subsequent retries.
   */
  static async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        console.log('[OcrService] Initializing Tesseract OCR worker...');
        ensureWasmFeatureDetectPatched();
        const w = await createWorker('eng');
        this.worker = w;
        console.log('[OcrService] Tesseract OCR worker ready.');
        return w;
      } catch (err) {
        this.worker = null;
        this.initPromise = null;
        throw err;
      }
    })();

    return this.initPromise;
  }

  /**
   * Terminate the worker on shutdown.
   */
  static async terminateWorker(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initPromise = null;
    }
  }

  /**
   * Tokenizes text preserving single-character variables and mathematical operators.
   */
  static tokenizeMathText(text: string): { words: string[]; mathSymbols: string[] } {
    if (!text || text.trim().length === 0) {
      return { words: [], mathSymbols: [] };
    }

    // Match words (including single variables/digits) and mathematical operators
    const matches = text.match(/[a-zA-Z0-9]+|[+\-=*/^_\(\)\[\]{}<>≤≥≠≈±×÷√∫∑∏∂∇παβγδεθλμστωΔΩ%]/g) || [];
    const words: string[] = [];
    const mathSymbols: string[] = [];

    for (const m of matches) {
      const lower = m.toLowerCase();
      words.push(lower);
      if (MATH_TOKEN_REGEX.test(lower)) {
        mathSymbols.push(lower);
      }
    }

    return { words, mathSymbols };
  }

  /**
   * Run OCR on an image file path or Buffer.
   * Extracts raw text, normalized words, mathematical tokens, lines, and bounding boxes.
   */
  static async recognizeText(imageSource: string | Buffer): Promise<OcrResult> {
    try {
      const worker = await this.getWorker();
      const result = await worker.recognize(imageSource);

      const rawText = result.data.text || '';
      const confidence = result.data.confidence || 0;

      // Extract math-aware tokens (preserving x, y, +, =, etc.)
      const { words, mathSymbols } = this.tokenizeMathText(rawText);

      // Extract word-level tokens with bounding boxes
      const tokens: OcrToken[] = [];
      const rawWords = (result.data as any).words || [];
      for (const w of rawWords) {
        if (w.text && w.text.trim().length > 0) {
          const isMath = MATH_TOKEN_REGEX.test(w.text);
          tokens.push({
            text: w.text.trim(),
            confidence: w.confidence || 0,
            bbox: w.bbox ? { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } : undefined,
            isMath,
          });
        }
      }

      // Extract line-level bounding boxes
      const lines: OcrLine[] = [];
      const rawLines = (result.data as any).lines || [];
      for (const l of rawLines) {
        if (l.text && l.text.trim().length > 0) {
          lines.push({
            text: l.text.trim(),
            confidence: l.confidence || 0,
            bbox: l.bbox ? { x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1 } : undefined,
          });
        }
      }

      return {
        text: rawText.trim(),
        normalizedText: words.join(' '),
        tokens,
        words,
        mathSymbols,
        wordCount: words.length,
        confidence,
        lines,
      };
    } catch (err: any) {
      console.warn(`[OcrService] OCR recognition failed: ${err.message}`);
      return {
        text: '',
        normalizedText: '',
        tokens: [],
        words: [],
        mathSymbols: [],
        wordCount: 0,
        confidence: 0,
        lines: [],
      };
    }
  }

  /**
   * Checks whether the current frame introduces significant new handwriting or notes
   * compared to the previous frame.
   *
   * Math-Aware: Detects single variables (x, y, z) and equations (e.g. "x = 5" or "+ C").
   */
  static hasSignificantNewContent(prevWords: string[], currentWords: string[]): boolean {
    if (currentWords.length === 0) return false;

    // Fresh page starting to be written on
    if (prevWords.length === 0 && currentWords.length >= 1) {
      return true;
    }

    // Significant increase in token count (> 15% increase, minimum 2 new tokens)
    if (currentWords.length >= prevWords.length + 2 && currentWords.length > prevWords.length * 1.1) {
      return true;
    }

    // Count new distinct tokens not seen in previous frame
    const prevSet = new Set(prevWords);
    let newTokensCount = 0;
    let newMathOrVarCount = 0;

    for (const w of currentWords) {
      if (!prevSet.has(w)) {
        newTokensCount++;
        if (MATH_TOKEN_REGEX.test(w) || (w.length === 1 && /[a-z0-9]/i.test(w))) {
          newMathOrVarCount++;
        }
      }
    }

    // If 2 or more new math symbols/variables were written (e.g. "x = 5" or "+ C")
    if (newMathOrVarCount >= 2) {
      return true;
    }

    // Or if 3 or more general new tokens appear
    return newTokensCount >= 3;
  }
}

