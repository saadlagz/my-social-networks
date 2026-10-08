import validator from 'validator';

import { badRequest, forbidden, notFound } from './http-error.mjs';

// champs d'un utilisateur visibles par les autres (jamais l'email ni le mot de passe)
export const PUBLIC_USER = 'firstname lastname avatar';

// fonctionne avec un ObjectId, un document peuplé (populate) ou une chaîne
export const toId = (value) => String(value && value._id ? value._id : value);
// compare deux identifiants (ou documents) : utilisateur, fil, photo...
export const sameUser = (a, b) => !!a && !!b && toId(a) === toId(b);
export const includesUser = (list, user) => !!user && list.some((id) => toId(id) === toId(user));
export const uniqueIds = (ids) => [...new Set(ids.map(toId))];

/* ---------- groupes ---------- */

export const isGroupAdmin = (group, user) => includesUser(group.administrators, user);
export const isGroupMember = (group, user) => includesUser(group.members, user);
// un groupe secret n'existe pas pour ceux qui n'en sont pas membres
export const canSeeGroup = (group, user) => group.type !== 'secret' || isGroupMember(group, user);
// le contenu (membres, fil, événements) d'un groupe privé est réservé aux membres
export const canReadGroup = (group, user) => group.type === 'public' || isGroupMember(group, user);

/* ---------- événements ---------- */

export const isOrganizer = (event, user) => includesUser(event.organizers, user);
// les organisateurs font aussi partie des participants
export const isParticipant = (event, user) => includesUser(event.participants, user);
// un événement privé n'existe pas pour ceux qui n'y participent pas
export const canSeeEvent = (event, user) => event.visibility === 'public' || isParticipant(event, user);

export async function findById(Model, id, resource) {
  if (typeof id !== 'string' || !validator.isMongoId(id)) throw notFound(resource);

  const doc = await Model.findById(id);

  if (!doc) throw notFound(resource);

  return doc;
}

// level : see (voir le groupe), read (voir son contenu), member, admin
export async function loadGroup(models, id, user, level = 'see') {
  const group = await findById(models.Group, toId(id), 'Group');

  if (!canSeeGroup(group, user)) throw notFound('Group');
  if (level === 'read' && !canReadGroup(group, user)) throw forbidden('groupe privé : contenu réservé aux membres');
  if (level === 'member' && !isGroupMember(group, user)) throw forbidden('action réservée aux membres du groupe');
  if (level === 'admin' && !isGroupAdmin(group, user)) throw forbidden('action réservée aux administrateurs du groupe');

  return group;
}

export function checkEvent(event, user, level = 'see') {
  if (!canSeeEvent(event, user)) throw notFound('Event');
  if (level === 'participant' && !isParticipant(event, user)) throw forbidden('action réservée aux participants de l\'événement');
  if (level === 'organizer' && !isOrganizer(event, user)) throw forbidden('action réservée aux organisateurs de l\'événement');

  return event;
}

// level : see (voir l'événement), participant, organizer
export async function loadEvent(models, id, user, level = 'see') {
  const event = await findById(models.Event, toId(id), 'Event');

  return checkEvent(event, user, level);
}

// vérifie que tous les utilisateurs d'une liste existent avant de les ajouter
export async function checkUsersExist(User, ids, field = 'user_ids') {
  const unique = uniqueIds(ids);

  if (unique.length === 0) return;

  const count = await User.countDocuments({ _id: { $in: unique } });

  if (count !== unique.length) throw badRequest([`${field} contient des utilisateurs qui n'existent pas`]);
}
