const cluster = require('cluster');
const os = require('os');
const restify = require('restify');
const path = require('path');

const numCPUs = Math.min(16, os.cpus().length);

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
    name: 'EBGIS',
    version: '1.0.0'
  });

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