import fp from 'fastify-plugin';

/**
 * Minimal Prometheus text-format metrics. Tracks request counts + duration
 * histograms per (method, route, status). Exposes /metrics for scraping.
 *
 * Keeps the footprint tiny (no prom-client dep) since we only expose a handful
 * of counters/histograms; swap for prom-client when we add custom business
 * metrics.
 */

const BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

interface RouteMetric {
  count: number;
  sum_ms: number;
  buckets: number[];
}

function emptyBuckets(): number[] {
  return BUCKETS_MS.map(() => 0);
}

function key(method: string, route: string, status: number): string {
  return `${method}|${route}|${status}`;
}

export default fp(async (app) => {
  const metrics = new Map<string, RouteMetric>();
  const startedAt = Date.now();

  app.addHook('onResponse', (req, reply, done) => {
    const route = req.routeOptions?.url ?? req.url ?? 'unknown';
    const k = key(req.method, route, reply.statusCode);
    const entry = metrics.get(k) ?? { count: 0, sum_ms: 0, buckets: emptyBuckets() };
    const durMs = reply.elapsedTime;
    entry.count += 1;
    entry.sum_ms += durMs;
    for (let i = 0; i < BUCKETS_MS.length; i++) {
      if (durMs <= BUCKETS_MS[i]!) entry.buckets[i]! += 1;
    }
    metrics.set(k, entry);
    done();
  });

  app.get('/metrics', { config: { public: true } }, (_req, reply) => {
    const lines: string[] = [];

    lines.push('# HELP http_requests_total Total HTTP requests');
    lines.push('# TYPE http_requests_total counter');
    for (const [k, m] of metrics) {
      const [method, route, status] = k.split('|');
      lines.push(
        `http_requests_total{method="${method}",route="${route}",status="${status}"} ${m.count}`,
      );
    }

    lines.push('# HELP http_request_duration_ms Request duration histogram');
    lines.push('# TYPE http_request_duration_ms histogram');
    for (const [k, m] of metrics) {
      const [method, route, status] = k.split('|');
      for (let i = 0; i < BUCKETS_MS.length; i++) {
        lines.push(
          `http_request_duration_ms_bucket{method="${method}",route="${route}",status="${status}",le="${BUCKETS_MS[i]}"} ${m.buckets[i]}`,
        );
      }
      lines.push(
        `http_request_duration_ms_bucket{method="${method}",route="${route}",status="${status}",le="+Inf"} ${m.count}`,
      );
      lines.push(
        `http_request_duration_ms_sum{method="${method}",route="${route}",status="${status}"} ${m.sum_ms}`,
      );
      lines.push(
        `http_request_duration_ms_count{method="${method}",route="${route}",status="${status}"} ${m.count}`,
      );
    }

    lines.push('# HELP process_uptime_seconds Process uptime');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`);

    const mem = process.memoryUsage();
    lines.push('# HELP process_memory_bytes Process memory usage');
    lines.push('# TYPE process_memory_bytes gauge');
    lines.push(`process_memory_bytes{kind="rss"} ${mem.rss}`);
    lines.push(`process_memory_bytes{kind="heap_used"} ${mem.heapUsed}`);
    lines.push(`process_memory_bytes{kind="heap_total"} ${mem.heapTotal}`);

    return reply.header('content-type', 'text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });
});
