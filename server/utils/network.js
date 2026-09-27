const os = require('os');

/**
 * Returns the primary LAN IPv4 address (skips internal loopback and virtual adapters).
 * Used for displaying reachable URLs on laptop/mobile across the local subnet.
 */
function getLocalIp() {
  const nets = os.networkInterfaces();

  // 1. Prioritize Wi-Fi, WLAN, or physical Ethernet interfaces
  for (const name of Object.keys(nets)) {
    if (/wi-fi|wireless|wlan|ethernet/i.test(name) && !/vmware|virtual|vethernet|loopback/i.test(name)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  // 2. Fallback to any non-internal, non-virtual IPv4
  for (const name of Object.keys(nets)) {
    if (!/vmware|virtual|vethernet|loopback/i.test(name)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  }

  // 3. Fallback to any non-internal IPv4
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}

module.exports = { getLocalIp };
