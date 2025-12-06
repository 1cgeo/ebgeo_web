const cluster = require('cluster');
const os = require('os');
const restify = require('restify');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const numCPUs = Math.min(16, Math.ceil(os.cpus().length / 2));

// Determinar qual diretório servir: dist/ (produção) ou desenvolvimento
const distPath = path.join(__dirname, '../dist');
const hasDistBuild = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

if (!hasDistBuild) {
  console.error('ERRO: Pasta dist/ não encontrada ou incompleta.');
  console.error('Execute "npm run build" antes de iniciar o servidor de produção.');
  process.exit(1);
}

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);
  console.log(`Servindo arquivos de: ${distPath}`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    // Opcionalmente, reiniciar worker se morrer
    // cluster.fork();
  });
} else {
  const server = restify.createServer({
    name: 'EBGEO',
    version: '1.0.0'
  });

  // Compressão gzip/deflate para reduzir tamanho das respostas (~70% de economia)
  server.use((req, res, next) => {
    const acceptEncoding = req.headers['accept-encoding'] || '';

    // Tipos de arquivo que devem ser comprimidos
    const compressibleTypes = /\.(js|css|html|json|xml|txt|svg|ico)$/i;

    if (compressibleTypes.test(req.url) && acceptEncoding) {
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      let chunks = [];

      res.write = (chunk) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      };

      res.end = (chunk) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const body = Buffer.concat(chunks);

        // Só comprimir se o corpo for maior que 1KB
        if (body.length > 1024) {
          if (acceptEncoding.includes('gzip')) {
            res.setHeader('Content-Encoding', 'gzip');
            res.removeHeader('Content-Length');
            const compressed = zlib.gzipSync(body);
            originalWrite(compressed);
            originalEnd();
            return;
          } else if (acceptEncoding.includes('deflate')) {
            res.setHeader('Content-Encoding', 'deflate');
            res.removeHeader('Content-Length');
            const compressed = zlib.deflateSync(body);
            originalWrite(compressed);
            originalEnd();
            return;
          }
        }

        originalWrite(body);
        originalEnd();
      };
    }

    return next();
  });

  // Cache headers para produção
  server.use((req, res, next) => {
    // Cache longo para assets com hash (imutáveis)
    if (req.url.includes('/assets/') && req.url.match(/-[a-f0-9]{8}\./)) {
      res.header('Cache-Control', 'public, max-age=31536000, immutable'); // 1 ano
    }
    // Cache médio para vendors (mudam raramente)
    else if (req.url.includes('/vendors/')) {
      res.header('Cache-Control', 'public, max-age=604800'); // 1 semana
    }
    // Cache curto para outros arquivos
    else {
      res.header('Cache-Control', 'public, max-age=3600'); // 1 hora
    }
    return next();
  });

  // Servir arquivos estáticos do dist/
  server.get('/*', restify.plugins.serveStatic({
    directory: distPath,
    default: 'index.html'
  }));

  const port = process.env.PORT || 8082;
  server.listen(port, () => {
    console.log('%s listening at %s', server.name, server.url);
  });

  console.log(`Worker ${process.pid} started`);
}
