import jwt from 'jsonwebtoken';
import validator from 'validator';

import { unauthorized } from '../utils/http-error.mjs';

// vérifie le header "Authorization: Bearer <token>" et place l'utilisateur dans req.user
export default (config, models) => {
  const authenticate = (required) => async (req, res, next) => {
    const [scheme, token] = (req.headers.authorization || '').split(' ');

    if (scheme !== 'Bearer' || !token) {
      if (!required) {
        next();
        return;
      }

      throw unauthorized('token manquant : envoyez le header Authorization: Bearer <token>');
    }

    let payload;

    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized('token invalide ou expiré, reconnectez-vous avec POST /auth/login');
    }

    const user = validator.isMongoId(String(payload.sub)) ? await models.User.findById(payload.sub) : null;

    // le compte a pu être supprimé alors que son token est encore valide
    if (!user) throw unauthorized('le compte associé à ce token n\'existe plus');

    req.user = user;
    next();
  };

  return {
    // route réservée aux utilisateurs connectés
    required: authenticate(true),
    // route publique, mais qui affiche plus de choses à un utilisateur connecté
    optional: authenticate(false)
  };
};
