import autocannon from 'autocannon';

const TARGET_URL = 'http://localhost:3000/api/test';
const TENANT_HEADER = 'tenant_load_test';
const DURATION_SECONDS = 30;
const CONNECTIONS = 50;

const instance = autocannon(
  {
    url: TARGET_URL,
    duration: DURATION_SECONDS,
    connections: CONNECTIONS,
    headers: {
      'X-Tenant-ID': TENANT_HEADER,
    },
  },
  (err, result) => {
    if (err) {
      console.error('Load test error:', err);
      process.exit(1);
    }

    const p50 = result.latency.p50;
    const p99 = result.latency.p99;
    const totalRequests = result.requests.total;
    const total429 = result['4xx'] ?? 0;

    console.log('\n=== Load Test Results ===');
    console.log(`Target:          ${TARGET_URL}`);
    console.log(`Duration:        ${DURATION_SECONDS}s`);
    console.log(`Connections:     ${CONNECTIONS}`);
    console.log(`Tenant:          ${TENANT_HEADER}`);
    console.log('');
    console.log(`p50 latency:     ${p50} ms`);
    console.log(`p99 latency:     ${p99} ms`);
    console.log(`Total requests:  ${totalRequests}`);
    console.log(`Total 429s:      ${total429}`);
    console.log('=========================\n');
  },
);

autocannon.track(instance, { renderProgressBar: true });
