const restify = require('restify');
const path = require('path');

const server = restify.createServer({
  name: 'EBGIS',
  version: '1.0.0'
});

server.use((req, res, next) => {
  res.header('Cache-Control', 'public, max-age=262800'); //1 mês
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