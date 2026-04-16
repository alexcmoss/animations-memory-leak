import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

let requestCount = 0;

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  const n = ++requestCount;
  const before = process.memoryUsage();

  angularApp
    .handle(req)
    .then((response) => {
      if (response) {
        const after = process.memoryUsage();
        const heapDelta = ((after.heapUsed - before.heapUsed) / 1024).toFixed(0);
        console.log(
          `[req #${n}] heapUsed=${(after.heapUsed / 1024 / 1024).toFixed(1)}MB (delta: ${heapDelta}KB)`
        );
        writeResponseToNodeResponse(response, res);
      } else {
        next();
      }
    })
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
    console.log('Run: for i in $(seq 1 50); do curl -s http://localhost:4000/ > /dev/null; done');
    console.log('Watch the [animation-leak] log lines — pendingCallbacks=0 on req 1, then =1 on every subsequent request (last request\'s callback always unrun).');
  });
}

export const reqHandler = createNodeRequestHandler(app);
