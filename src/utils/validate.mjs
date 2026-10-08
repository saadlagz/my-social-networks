import validator from 'validator';

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true };
// lettres de toutes les langues (é, ü, ñ...), espaces, tirets et apostrophes
const NAME_REGEX = /^[\p{L}][\p{L} '-]*$/u;

// chaque checker renvoie { value } (valeur nettoyée) ou { error } (message ou liste de messages)
const checkers = {
  string(value, rule, field) {
    if (typeof value !== 'string') return { error: `${field} doit être une chaîne de caractères` };

    // un mot de passe ne doit pas être modifié : trim: false
    const clean = rule.trim === false ? value : validator.trim(value);
    const min = rule.min ?? 1;
    const max = rule.max ?? 255;

    if (!validator.isLength(clean, { min, max })) {
      return { error: `${field} doit contenir entre ${min} et ${max} caractères` };
    }

    return { value: clean };
  },

  name(value, rule, field) {
    const result = checkers.string(value, { max: 50, ...rule }, field);

    if (result.error) return result;
    if (!NAME_REGEX.test(result.value)) {
      return { error: `${field} ne doit contenir que des lettres, espaces, tirets ou apostrophes` };
    }

    return result;
  },

  email(value, rule, field) {
    if (typeof value !== 'string' || !validator.isEmail(validator.trim(value))) {
      return { error: `${field} doit être une adresse email valide` };
    }

    return { value: validator.trim(value).toLowerCase() };
  },

  password(value, rule, field) {
    const strong = typeof value === 'string'
      && value.length <= 72 // bcrypt ignore tout ce qui dépasse 72 octets
      && validator.isStrongPassword(value, {
        minLength: 8, minLowercase: 0, minUppercase: 0, minNumbers: 1, minSymbols: 0
      })
      && /\p{L}/u.test(value);

    if (!strong) return { error: `${field} doit contenir entre 8 et 72 caractères dont au moins une lettre et un chiffre` };

    return { value };
  },

  url(value, rule, field) {
    if (typeof value !== 'string' || !validator.isURL(validator.trim(value), URL_OPTIONS)) {
      return { error: `${field} doit être un lien valide commençant par http:// ou https://` };
    }

    return { value: validator.trim(value) };
  },

  date(value, rule, field) {
    if (typeof value !== 'string' || !validator.isISO8601(value, { strict: true, strictSeparator: true })) {
      return { error: `${field} doit être une date au format ISO 8601 (ex : 2026-12-31T20:00:00Z)` };
    }

    const date = new Date(value);

    if (rule.past && date > new Date()) return { error: `${field} doit être une date passée` };

    return { value: date };
  },

  boolean(value, rule, field) {
    if (typeof value !== 'boolean') return { error: `${field} doit valoir true ou false` };

    return { value };
  },

  integer(value, rule, field) {
    const isInt = (typeof value === 'number' && Number.isInteger(value))
      || (typeof value === 'string' && validator.isInt(validator.trim(value)));
    const number = Number(value);
    const min = rule.min ?? 0;
    const max = rule.max ?? Number.MAX_SAFE_INTEGER;

    if (!isInt || number < min || number > max) return { error: `${field} doit être un nombre entier entre ${min} et ${max}` };

    return { value: number };
  },

  // montant : 2 décimales maximum (ex : 12.50)
  amount(value, rule, field) {
    const number = typeof value === 'string' ? Number(validator.trim(value)) : value;
    const min = rule.min ?? 0;
    const max = rule.max ?? 100000;

    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max
      || !validator.isDecimal(String(number), { decimal_digits: '0,2' })) {
      return { error: `${field} doit être un montant entre ${min} et ${max} avec 2 décimales maximum` };
    }

    return { value: number };
  },

  postalCode(value, rule, field) {
    if (typeof value !== 'string' || !validator.isPostalCode(validator.trim(value), 'any')) {
      return { error: `${field} doit être un code postal valide` };
    }

    return { value: validator.trim(value) };
  },

  enum(value, rule, field) {
    if (!rule.values.includes(value)) return { error: `${field} doit valoir ${rule.values.join(', ')}` };

    return { value };
  },

  id(value, rule, field) {
    if (typeof value !== 'string' || !validator.isMongoId(value)) return { error: `${field} doit être un identifiant valide` };

    return { value };
  },

  ids(value, rule, field) {
    const min = rule.min ?? 0;
    const max = rule.max ?? 500;

    if (!Array.isArray(value) || value.length < min || value.length > max
      || !value.every((id) => typeof id === 'string' && validator.isMongoId(id))) {
      return { error: `${field} doit être une liste de ${min} à ${max} identifiants valides` };
    }

    // les doublons sont retirés
    return { value: [...new Set(value)] };
  },

  // objet imbriqué (ex : address, settings) validé avec ses propres règles
  object(value, rule, field, options) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: `${field} doit être un objet` };

    const result = validate(value, rule.rules, { partial: options.partial, prefix: `${field}.` });

    return result.errors.length > 0 ? { error: result.errors } : { value: result.value };
  },

  // validation spécifique écrite dans le validator de la ressource (ex : questions d'un sondage)
  custom(value, rule, field) {
    return rule.check(value, field);
  }
};

/**
 * Valide un body à partir d'une liste de règles et ne garde que les champs connus
 * (un champ non prévu, ex : "organizers" dans un PATCH, est ignoré).
 *
 * rules : { champ: { type, required, default, nullable, min, max, values, ... } }
 * partial : true pour un PATCH, seuls les champs envoyés sont vérifiés
 */
export default function validate(body, rules, { partial = false, prefix = '' } = {}) {
  const errors = [];
  const value = {};

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: [prefix ? `${prefix.slice(0, -1)} doit être un objet` : 'le body doit être un objet JSON'], value };
  }

  Object.entries(rules).forEach(([name, rule]) => {
    const field = `${prefix}${name}`;
    let raw = body[name];

    if (raw === undefined) {
      if (partial) return;
      if (rule.required) {
        errors.push(`${field} est requis`);
        return;
      }
      if (rule.default === undefined) return;

      raw = structuredClone(rule.default);
    }

    // null permet d'effacer un champ facultatif (ex : description: null)
    if (raw === null) {
      if (rule.nullable) value[name] = null;
      else errors.push(`${field} ne peut pas être null`);
      return;
    }

    const result = checkers[rule.type](raw, rule, field, { partial });

    if (result.error) errors.push(...[].concat(result.error));
    else value[name] = result.value;
  });

  return { errors, value };
}
