import { PageDetectorService } from './services/pageDetector.service.js';
import { OcrService } from './services/ocr.service.js';

async function run() {
  const jobId = '0a5a53a0-fd68-4f80-a913-4925ee0556a9';
  const t0 = Date.now();
  console.log(`Running conservative OCR-guided page detector on job ${jobId}...`);

  const res = await PageDetectorService.processJob(jobId);
  console.log(`Finished in ${((Date.now() - t0) / 1000).toFixed(1)}s!`);
  console.log(`Results: ${res.totalFramesInput} frames -> ${res.finalPagesExtracted} pages preserved!`);

  res.pages.forEach((p) => {
    console.log(
      `  Page ${p.pageNumber}: ${p.imagePath} [${p.startTimestamp.toFixed(1)}s - ${p.endTimestamp.toFixed(1)}s]`
    );
  });

  await OcrService.terminateWorker();
}

run().catch(console.error);

