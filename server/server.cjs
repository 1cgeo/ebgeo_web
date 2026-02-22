const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');

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
  const fastify = require('fastify')({ logger: false });

  // Compressão gzip/brotli automática
  fastify.register(require('@fastify/compress'));

  // Cache headers para produção
  fastify.addHook('onSend', (request, reply, payload, done) => {
    const url = request.url;

    // Cache longo para assets com hash (imutáveis)
    if (url.includes('/assets/') && url.match(/-[a-f0-9]{8}\./)) {
      reply.header('Cache-Control', 'public, max-age=31536000, immutable'); // 1 ano
    }
    // Cache médio para vendors (mudam raramente)
    else if (url.includes('/vendors/')) {
      reply.header('Cache-Control', 'public, max-age=604800'); // 1 semana
    }
    // Cache curto para outros arquivos
    else {
      reply.header('Cache-Control', 'public, max-age=3600'); // 1 hora
    }

    done();
  });

  // Servir arquivos estáticos do dist/
  fastify.register(require('@fastify/static'), {
    root: distPath,
    prefix: '/',
  });

  // SPA fallback: qualquer rota não encontrada retorna index.html
  fastify.setNotFoundHandler((request, reply) => {
    reply.sendFile('index.html');
  });

  const port = process.env.PORT || 8082;
  fastify.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`EBGEO listening at ${address}`);
  });

  console.log(`Worker ${process.pid} started`);
}
