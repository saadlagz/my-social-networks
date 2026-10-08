const common = {
  // durée de validité du token JWT renvoyé par /auth/login
  jwtExpiresIn: '24h',
  // nombre d'essais de connexion autorisés par IP toutes les 15 minutes
  loginRateLimit: 20
};

export default {
  development: {
    ...common,
    type: 'development',
    port: Number(process.env.PORT) || 3000,
    mongodb: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/my-social-networks',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-a-ne-pas-utiliser-en-production',
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
    logs: true
  },
  test: {
    ...common,
    type: 'test',
    // port 0 : le système choisit un port libre, les tests lisent le port réel
    port: 0,
    mongodb: process.env.MONGODB_URI_TEST || 'mongodb://127.0.0.1:27017/my-social-networks-test',
    jwtSecret: 'test-secret',
    publicUrl: 'http://localhost:3000',
    loginRateLimit: 1000,
    logs: false
  },
  production: {
    ...common,
    type: 'production',
    port: Number(process.env.PORT) || 3000,
    // lien Atlas et secret JWT lus depuis l'environnement : ils ne doivent jamais être dans le code
    mongodb: process.env.MONGODB_URI || '',
    jwtSecret: process.env.JWT_SECRET || '',
    publicUrl: process.env.PUBLIC_URL || '',
    logs: true
  }
};
