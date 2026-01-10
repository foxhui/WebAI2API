::: info
This English version is translated by **Gemini 3 Flash**.
:::

# Troubleshooting

Diagnosis and solutions for common problems.

## Operational Issues

### Window Forcing Itself to Foreground

**Problem**: The browser window actively brings itself to the foreground during a task.

**Solution**:
- On Windows and macOS, you can use a separate virtual desktop (Win + Tab) specifically for the program.
- On Linux, use Xvfb mode.

## Request Issues

### Request Rejected (429 Too Many Requests)

**Problem**: Too many concurrent requests; the queue is full.

**Solution**:
- Enable streaming mode (`stream: true`), which allows for unlimited queuing.
- Reduce the number of concurrent requests.
- Increase the `queue.queueBuffer` value in your configuration.

### Request Timeout

**Problem**: The task did not complete within 120 seconds.

**Solution**:
- Enable streaming mode and use the heartbeat mechanism to keep the connection alive.
- Check if your network connection is stable.
- Some complex prompts may simply require more time.

## Verification Issues

### reCAPTCHA Failure

**Problem**: Returns `recaptcha validation failed`.

**Solution**:
- Reduce the frequency of requests.
- Enter Login Mode to complete the verification manually.
- Use a stable and clean IP address.
- Check IP cleanliness using tools like [ping0.cc](https://ping0.cc).

### Cloudflare Challenge

**Problem**: The browser is stuck on the Cloudflare verification page.

**Solution**:
- Use VNC to complete the verification manually.
- Change your IP address.
- Avoid using datacenter IPs.

## Login Issues

### Login State Lost

**Problem**: You are asked to log in again after a service restart.

**Solution**:
- Ensure the `data` directory is persistent.
- Verify that the `userDataMark` configuration is correct.
- Avoid deleting browser data directories.

### OAuth Login Failure

**Problem**: Login redirects via Google or other OAuth providers fail.

**Solution**:
- Ensure `accounts.google.com` is accessible.
- Check if your proxy configuration is correct.
- Try changing your IP address.

## Browser Issues

### Browser Fails to Start

**Problem**: Camoufox cannot start.

**Solution**:
```bash
# Re-initialize Camoufox
npm run init
```

### Out of Memory

**Problem**: The browser crashes due to insufficient memory.

**Solution**:
- Increase server RAM (2GB+ recommended).
- Reduce the number of simultaneously running browser instances.
- Ensure `--shm-size=2gb` is set in Docker environments.

## Network Issues

### Proxy Connection Failed

**Problem**: Unable to connect to the proxy server.

**Solution**:
- Check the proxy server address and port.
- Verify proxy authentication credentials.
- Test if the proxy server is working correctly.

### Target Website Inaccessible

**Problem**: Unable to access sites like LMArena or Gemini.

**Solution**:
- Check your network connectivity.
- Try using a proxy.
- Confirm the target website is not blocked.

## Log Diagnosis

### View Detailed Logs

Set the log level in `config.yaml`:

```yaml
logLevel: debug
```

### Common Log Messages

| Log Content | Description |
| --- | --- |
| `Worker pool initialization failed` | Check configuration and network. |
| `Worker does not support model` | Verify if the model name is correct. |
| `Verification timeout` | Manual verification is required. |
| `Page closed` | The browser may have crashed. |

## Getting Help

If the above methods do not resolve your issue:

1. Check [GitHub Issues](https://github.com/foxhui/WebAI2API/issues).
2. Submit an Issue including:
   - Log output (with `logLevel: debug`).
   - Your configuration file (hide sensitive information).
   - Your OS and Node.js version.
