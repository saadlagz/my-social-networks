import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';

import validate from '../utils/validate.mjs';
import { badRequest, conflict, unauthorized } from '../utils/http-error.mjs';
import rules from '../validators/user.mjs';

const Auth = class Auth {
  constructor(app, { models, auth, config }) {
    this.app = app;
    this.User = models.User;
    this.auth = auth;
    this.config = config;

    // limite les essais de mot de passe par IP (attaque par force brute)
    this.loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: config.loginRateLimit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (req, res) => res.status(429).json({
        code: 429,
        message: 'Too Many Requests',
        errors: ['trop de tentatives de connexion, réessayez dans 15 minutes']
      })
    });

    this.run();
  }

  createToken(user) {
    return jwt.sign({ sub: String(user._id) }, this.config.jwtSecret, { expiresIn: this.config.jwtExpiresIn });
  }

  register() {
    this.app.post('/auth/register', async (req, res) => {
      const { errors, value } = validate(req.body, rules.register);

      if (errors.length > 0) throw badRequest(errors);
      if (await this.User.exists({ email: value.email })) throw conflict('un compte existe déjà avec cet email');

      // le mot de passe n'est jamais stocké en clair
      const user = await this.User.create({ ...value, password: await bcrypt.hash(value.password, 10) });

      res.status(201).json({ token: this.createToken(user), user });
    });
  }

  login() {
    this.app.post('/auth/login', this.loginLimiter, async (req, res) => {
      const { errors, value } = validate(req.body, rules.login);

      if (errors.length > 0) throw badRequest(errors);

      const user = await this.User.findOne({ email: value.email }).select('+password');

      // même message si l'email n'existe pas : on ne révèle pas quels comptes existent
      if (!user || !(await bcrypt.compare(value.password, user.password))) {
        throw unauthorized('email ou mot de passe incorrect');
      }

      res.status(200).json({ token: this.createToken(user), user });
    });
  }

  me() {
    this.app.get('/auth/me', this.auth.required, (req, res) => {
      res.status(200).json(req.user);
    });
  }

  run() {
    this.register();
    this.login();
    this.me();
  }
};

export default Auth;
