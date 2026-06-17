/**
 * Generates base URL from request object (works with domains, IPs, proxies, and ports)
 * @param {Object} req - Express/Node.js request object
 * @returns {string} Fully qualified base URL (e.g., "https://example.com:8080")
 */

function getBaseUrl(req, proxy, includeMountPath = true) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const cfWorker = req.headers['cf-worker'];
    const vercel = req.headers['x-vercel-deployment-url'];
    const host = req.headers['x-forwarded-host'] || req.get('host') || req.hostname || 'localhost';
    const mountPath = includeMountPath ? (req.baseUrl || '') : '';
    
    if (global.cloudflareUrl && proxy === true) {
        return global.cloudflareUrl + mountPath;
    }
    
    if (global.nportUrl && proxy === true) {
        return global.nportUrl + mountPath;
    }
    
    if (cfWorker?.includes('workers.dev') && !vercel?.includes("vercel.app")) {
        return `${protocol}://proxy-embed.${cfWorker.split(',')[0]?.trim()}` + mountPath;
    }

    const forwarded = req.headers['forwarded'];
    if (forwarded) {
        const hostMatch = forwarded.match(/host=([^;]+)/);
        const protoMatch = forwarded.match(/proto=([^;]+)/);
        if (hostMatch && protoMatch) {
            return `${protoMatch[1]}://${hostMatch[1]}${mountPath}`;
        }
    }

    const sanitizedHost = host.replace(/(:\d+)+$/, match => {
        const parts = match.split(':');
        return parts.length > 2 ? `:${parts.pop()}` : match;
    });

    return `${protocol}://${sanitizedHost}${mountPath}`;
}

module.exports = { getBaseUrl };