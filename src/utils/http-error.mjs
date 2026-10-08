// erreur HTTP levée dans les contrôleurs : Express 5 la transmet au middleware errors.mjs
// qui renvoie toujours le même format { code, message, errors }
const HttpError = class HttpError extends Error {
  constructor(code, message, errors) {
    super(message);
    this.code = code;
    this.errors = errors;
  }
};

export const badRequest = (errors) => new HttpError(400, 'Bad Request', errors);
export const unauthorized = (error) => new HttpError(401, 'Unauthorized', [error]);
export const forbidden = (error) => new HttpError(403, 'Forbidden', [error]);
export const notFound = (resource) => new HttpError(404, `${resource} Not Found`);
export const conflict = (error) => new HttpError(409, 'Conflict', [error]);

export default HttpError;
