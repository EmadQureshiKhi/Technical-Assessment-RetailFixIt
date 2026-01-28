# Load and Performance Tests

This directory contains load and performance tests for the RetailFixIt Vendor Scoring Service.

## Prerequisites

Install k6 load testing tool:

```bash
# macOS
brew install k6

# Windows (using Chocolatey)
choco install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6
```

## Running Tests

### Start the API Server

First, start the API server:

```bash
# From the project root
npm run start:api
# Or
cd src/backend/api && npm start
```

### Run Load Tests

```bash
# Run with default settings (localhost:3000)
k6 run tests/load/scoring-load-test.js

# Run against a different environment
k6 run -e BASE_URL=https://api.staging.retailfixit.com tests/load/scoring-load-test.js

# Run with custom duration
k6 run --duration 10m tests/load/scoring-load-test.js

# Run with custom VUs
k6 run --vus 50 --duration 5m tests/load/scoring-load-test.js
```

## Test Scenarios

The load test includes three scenarios:

### 1. Sustained Load Test
- **Rate**: 100 requests/second
- **Duration**: 5 minutes
- **Purpose**: Verify system handles expected production load

### 2. Spike Test
- **Pattern**: Ramp from 10 to 200 req/s, hold, then ramp down
- **Duration**: ~4 minutes
- **Purpose**: Test system behavior under sudden traffic spikes

### 3. Stress Test
- **Pattern**: Gradually increase from 50 to 500 req/s
- **Duration**: 10 minutes
- **Purpose**: Find system breaking point and verify graceful degradation

## Performance Thresholds

The tests verify the following SLAs:

| Metric | Threshold |
|--------|-----------|
| p99 Latency (Recommendations) | < 2 seconds |
| p99 Latency (Overrides) | < 2 seconds |
| p95 HTTP Request Duration | < 1.5 seconds |
| Error Rate | < 1% |

## Test Results

Results are saved to `tests/load/results/summary.json` after each run.

### Sample Output

```
========== LOAD TEST SUMMARY ==========

Recommendation API Latency:
  avg: 45.23ms
  p95: 120.45ms
  p99: 250.67ms

Override API Latency:
  avg: 38.12ms
  p95: 95.34ms
  p99: 180.23ms

Error Rate: 0.05%
Successful Requests: 29850
Failed Requests: 15

========================================
```

## Interpreting Results

### Good Results
- p99 latency under 2 seconds
- Error rate under 1%
- No significant increase in latency under load

### Warning Signs
- p99 latency approaching 2 seconds
- Error rate between 0.5% and 1%
- Latency increasing linearly with load

### Critical Issues
- p99 latency exceeding 2 seconds
- Error rate above 1%
- Exponential latency increase
- Connection timeouts

## Troubleshooting

### High Latency
1. Check database connection pool size
2. Verify ML endpoint response times
3. Check for memory leaks
4. Review caching effectiveness

### High Error Rate
1. Check service logs for errors
2. Verify database connections
3. Check rate limiting configuration
4. Review circuit breaker state

### Connection Issues
1. Verify service is running
2. Check firewall rules
3. Verify BASE_URL is correct
4. Check for port conflicts

## CI/CD Integration

Add to your CI pipeline:

```yaml
load-test:
  stage: test
  script:
    - k6 run --out json=results.json tests/load/scoring-load-test.js
  artifacts:
    paths:
      - results.json
    when: always
```
