import { readFileSync } from 'node:fs';
import express from 'express';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

import config from './config.mjs';
import registerModels from './models/index.mjs';
import routes from './controllers/routes.mjs';
import authMiddleware from './middlewares/auth.mjs';
import { notFoundHandler, errorHandler } from './middlewares/errors.mjs';

const Server = class Server {
  constructor(env) {
    this.app = express();
    this.config = config[env] || config.development;
  }

  log(message) {
    if (this.config.logs) console.log(message);
  }

  async dbConnect() {
    // on réessaie toutes les 5 secondes tant que MongoDB ne répond pas au démarrage
    while (!this.connect) {
      try {
        this.connect = await mongoose.createConnection(this.config.mongodb).asPromise();
        this.log('[CONNECT] api dbConnect() -> mongodb connected');
      } catch (err) {
        console.error(`[ERROR] api dbConnect() -> ${err.message}, nouvel essai dans 5s`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }

    // une fois connecté, mongoose se reconnecte tout seul en cas de coupure
    this.connect.on('disconnected', () => {
      if (!this.closing) console.error('[ERROR] api dbConnect() -> mongodb disconnected');
    });
    this.connect.on('reconnected', () => this.log('[CONNECT] api dbConnect() -> mongodb reconnected'));

    this.models = registerModels(this.connect);

    // construit les index (dont les index uniques) avant d'accepter la première requête
    await Promise.all(Object.values(this.models).map((Model) => Model.init()));
  }

  middleware() {
    this.app.disable('x-powered-by');
    this.app.use(express.json({ limit: '100kb' }));
  }

  docs() {
    const spec = YAML.parse(readFileSync(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'));

    this.app.get('/openapi.json', (req, res) => res.status(200).json(spec));
    this.app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'My Social Networks API' }));
    this.app.get('/', (req, res) => res.redirect('/docs'));
  }

  routes() {
    const context = {
      models: this.models,
      config: this.config,
      auth: authMiddleware(this.config, this.models)
    };

    Object.values(routes).forEach((Controller) => new Controller(this.app, context));

    this.app.use(notFoundHandler);
    this.app.use(errorHandler);
  }

  async run() {
    if (!this.config.mongodb || !this.config.jwtSecret) {
      console.error(`[ERROR] api run() -> MONGODB_URI et JWT_SECRET sont obligatoires en ${this.config.type}`);
      process.exit(1);
    }

    await this.dbConnect();
    this.middleware();
    this.docs();
    this.routes();

    await new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, resolve);
    });

    this.log(`[START] api run() -> ${this.config.type} sur http://localhost:${this.server.address().port} (doc : /docs)`);

    return this.server;
  }

  async stop() {
    this.closing = true;

    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    if (this.connect) await this.connect.close();

    this.log('[CLOSE] api stop() -> serveur et mongodb fermés');
  }
};

export default Server;
