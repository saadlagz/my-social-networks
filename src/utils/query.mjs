import validator from 'validator';

import { badRequest } from './http-error.mjs';

// avec Express, ?search=a&search=b donne un tableau : on n'accepte qu'une seule valeur
export function queryString(query, name) {
  const value = query[name];

  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw badRequest([`le paramètre ${name} doit être envoyé une seule fois`]);

  return validator.trim(value);
}

export function queryDate(query, name) {
  const value = queryString(query, name);

  if (value === undefined) return undefined;
  if (!validator.isISO8601(value)) throw badRequest([`le paramètre ${name} doit être une date ISO 8601`]);

  return new Date(value);
}

export function queryId(query, name) {
  const value = queryString(query, name);

  if (value !== undefined && !validator.isMongoId(value)) throw badRequest([`le paramètre ${name} doit être un identifiant valide`]);

  return value;
}

export function queryBoolean(query, name) {
  const value = queryString(query, name);

  if (value === undefined) return false;
  if (!['true', 'false'].includes(value)) throw badRequest([`le paramètre ${name} doit valoir true ou false`]);

  return value === 'true';
}

// le texte de recherche est utilisé dans une regex : on échappe les caractères spéciaux
export function searchRegex(value) {
  return { $regex: value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
}

function readInt(query, name, fallback, max) {
  const value = queryString(query, name);

  if (value === undefined) return fallback;
  if (!validator.isInt(value, { min: 1, max })) throw badRequest([`le paramètre ${name} doit être un entier entre 1 et ${max}`]);

  return Number(value);
}

// toutes les listes sont paginées : ?page=1&limit=20 (100 maximum)
export async function paginate(Model, filter, query, { sort, select, populate } = {}) {
  const page = readInt(query, 'page', 1, 100000);
  const limit = readInt(query, 'limit', 20, 100);

  let find = Model.find(filter).sort(sort).skip((page - 1) * limit).limit(limit);

  if (select) find = find.select(select);
  if (populate) find = find.populate(populate);

  const [data, total] = await Promise.all([find, Model.countDocuments(filter)]);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
}
