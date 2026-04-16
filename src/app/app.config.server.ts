import { mergeApplicationConfig, ApplicationConfig, DestroyRef, inject, provideEnvironmentInitializer } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { ɵAnimationEngine as AnimationEngine } from '@angular/animations/browser';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

/**
 * Logs AnimationEngine state at teardown to expose the leak.
 *
 * On each SSR request, TransitionAnimationEngine.destroy() queues a cleanup
 * callback into _whenQuietFns via afterFlushAnimationsDone().
 *
 * engine.flush() is called during change detection inside the *next* request's
 * rendering, which drains the prior callback — but by then the current request's
 * teardown has already queued a new one. So pendingCallbacks is always 1 from
 * request 2 onwards: the most recent request's callback is never flushed during
 * teardown. If the server goes idle after the last request, that callback (and
 * anything it closes over) is never collected.
 *
 * Expected output:
 *   request 1:   pendingCallbacks=0  (probe fires before destroy() queues the callback)
 *   requests 2+: pendingCallbacks=1  (previous request's callback still pending)
 */
const animationLeakDetector = provideEnvironmentInitializer(() => {
  const engine = inject(AnimationEngine, { optional: true });
  const destroyRef = inject(DestroyRef);

  if (!engine) {
    console.warn('[animation-leak] AnimationEngine not found in injector');
    return;
  }

  destroyRef.onDestroy(() => {
    const te = (engine as any)._transitionEngine;
    const pendingCallbacks = te?._whenQuietFns?.length ?? 0;
    const retainedElements = te?.namespacesByHostElement?.size ?? 0;

    console.log(
      `[animation-leak] onDestroy: pendingCallbacks=${pendingCallbacks}, retainedHostElements=${retainedElements}`
    );

    // Uncomment the following lines to apply the workaround:
    // for (let i = 0; i < 10 && te?._whenQuietFns?.length > 0; i++) {
    //   engine.flush();
    // }
    // console.log(
    //   `[animation-leak] after fix: pendingCallbacks=${te?._whenQuietFns?.length ?? 0}, retainedHostElements=${te?.namespacesByHostElement?.size ?? 0}`
    // );
  });
});

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    animationLeakDetector,
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
