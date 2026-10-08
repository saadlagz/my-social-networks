import mongoose from 'mongoose';

import HttpError from '../utils/http-error.mjs';

export const notFoundHandler = (req, res) => {
  res.status(404).json({
    code: 404,
    message: 'Not Found',
    errors: [`la route ${req.method} ${req.path} n'existe pas`]
  });
};

// Express 5 envoie ici toutes les erreurs, y compris celles levées dans les routes async
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof HttpError) {
    res.status(err.code).json({ code: err.code, message: err.message, errors: err.errors });
    return;
  }

  // body JSON mal formé ou trop gros (erreurs levées par express.json())
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ code: 400, message: 'Bad Request', errors: ['le body JSON est mal formé'] });
    return;
  }

  if (err.type === 'entity.too.large') {
    res.status(413).json({ code: 413, message: 'Payload Too Large', errors: ['le body dépasse 100 ko'] });
    return;
  }

  // deuxième ligne de défense : les validateurs des schémas mongoose
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({
      code: 400,
      message: 'Bad Request',
      errors: Object.values(err.errors).map((error) => error.message)
    });
    return;
  }

  // index unique violé (ex : deux requêtes simultanées qui passent le contrôle d'unicité)
  if (err.code === 11000) {
    res.status(409).json({ code: 409, message: 'Conflict', errors: ['cette ressource existe déjà'] });
    return;
  }

  console.error('[ERROR] api ->', err);
  res.status(500).json({ code: 500, message: 'Internal Server Error' });
};
