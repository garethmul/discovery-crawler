/**
 * Simple logger utility
 * Cache-busting timestamp: ${new Date().toISOString()}
 */
const logger = {
  info: (message) => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`${timestamp} info: ${message}`);
  },
  
  warn: (message) => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.warn(`${timestamp} warn: ${message}`);
  },
  
  error: (message) => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.error(`${timestamp} error: ${message}`);
  },
  
  debug: (message) => {
    if (process.env.DEBUG) {
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.debug(`${timestamp} debug: ${message}`);
    }
  }
};

export default logger; 