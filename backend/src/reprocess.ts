import { PageDetectorService } from './services/pageDetector.service.js';

async function run() {
  const t0 = Date.now();
  console.log('Running improved PageDetectorService on 1303 real frames...');
  const res = await PageDetectorService.processJob('0a5a53a0-fd68-4f80-a913-4925ee0556a9');
  console.log(`Finished in ${((Date.now() - t0) / 1000).toFixed(1)}s!`);
  console.log(`Result: ${res.totalFramesInput} frames -> ${res.finalPagesExtracted} curated pages (removed ${res.duplicatesRemoved} duplicates)`);
  res.pages.forEach((p) => {
    console.log(`  Page ${p.pageNumber}: ${p.imagePath} [${p.startTimestamp.toFixed(1)}s - ${p.endTimestamp.toFixed(1)}s]`);
  });
}

run().catch(console.error);

