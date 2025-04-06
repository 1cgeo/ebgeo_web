// Path: server\server.js
const cluster = require('cluster');
const os = require('os');
const restify = require('restify');
const path = require('path');
const fs = require('fs');

const numCPUs = Math.min(16, Math.ceil(os.cpus().length / 2));

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create a log file name with current date
const getLogFilePath = () => {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  return path.join(logsDir, `access_${date}.log`);
};

// Function to log requests
const logRequest = (req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const method = req.method;
  const url = req.url;
  const userAgent = req.headers['user-agent'] || 'Unknown';
  
  const logEntry = `${timestamp} | ${ip} | ${method} | ${url} | ${userAgent}\n`;
  
  // Log to file
  fs.appendFile(getLogFilePath(), logEntry, (err) => {
    if (err) console.error('Error writing to log file:', err);
  });
  
  return next();
};

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  // Fork workers.
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    // Optionally, you can fork a new worker if one dies
    // cluster.fork();
  });
} else {
  const server = restify.createServer({
    name: 'EBGEO',
    version: '1.0.0'
  });

  // Add logging middleware
  server.use(logRequest);

  server.use((req, res, next) => {
    res.header('Cache-Control', 'public, max-age=262800'); // 1 mês
    return next();
  });

  server.get('/*', restify.plugins.serveStatic({
    directory: path.join(__dirname, '../public'),
    default: 'index.html'
  }));

  const port = process.env.PORT || 8080;
  server.listen(port, () => {
    console.log('%s listening at %s', server.name, server.url);
  });

  console.log(`Worker ${process.pid} started`);
}