import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import Server from '../src/server.mjs';
import config from '../src/config.mjs';

// tests de bout en bout : vraie API + vraie base MongoDB (my-social-networks-test, vidée à chaque lancement)
let server;
let base;

async function api(method, path, { token, body } = {}) {
  const headers = { 'content-type': 'application/json' };

  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();

  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const days = (n) => new Date(Date.now() + n * 24 * 3600 * 1000).toISOString();

// utilisateurs du scénario
const users = {};

async function register(key, firstname) {
  const { status, body } = await api('POST', '/auth/register', {
    body: {
      firstname, lastname: 'Test', email: `${key}@test.fr`, password: 'motdepasse1'
    }
  });

  assert.equal(status, 201);
  users[key] = { id: body.user._id, token: body.token };
}

before(async () => {
  const connect = await mongoose.createConnection(config.test.mongodb).asPromise();

  await connect.dropDatabase();
  await connect.close();

  server = new Server('test');
  const http = await server.run();

  base = `http://127.0.0.1:${http.address().port}`;
});

after(async () => {
  await server.stop();
});

describe('utilisateurs et authentification', () => {
  test('inscription, email unique et mot de passe jamais renvoyé', async () => {
    await register('alice', 'Alice');
    await register('bob', 'Bob');
    await register('chloe', 'Chloé');
    await register('david', 'David');

    const duplicate = await api('POST', '/auth/register', {
      body: {
        firstname: 'Alice', lastname: 'Bis', email: 'ALICE@test.fr', password: 'motdepasse1'
      }
    });

    assert.equal(duplicate.status, 409);

    const me = await api('GET', '/auth/me', { token: users.alice.token });

    assert.equal(me.status, 200);
    assert.equal(me.body.email, 'alice@test.fr');
    assert.equal(me.body.password, undefined);
  });

  test('validators : body invalide refusé avec la liste des erreurs', async () => {
    const { status, body } = await api('POST', '/auth/register', {
      body: {
        firstname: 'Al1ce', email: 'pas-un-email', password: 'court', avatar: 'ftp://x'
      }
    });

    assert.equal(status, 400);
    assert.equal(body.errors.length, 5);
  });

  test('connexion : mauvais mot de passe, token absent ou invalide', async () => {
    assert.equal((await api('POST', '/auth/login', { body: { email: 'alice@test.fr', password: 'faux' } })).status, 401);
    assert.equal((await api('POST', '/auth/login', { body: { email: 'alice@test.fr', password: 'motdepasse1' } })).status, 200);
    assert.equal((await api('GET', '/auth/me')).status, 401);
    assert.equal((await api('GET', '/auth/me', { token: 'abc' })).status, 401);
  });

  test('profil : modification, changement de mot de passe protégé, recherche sans email', async () => {
    const patch = await api('PATCH', '/users/me', { token: users.bob.token, body: { bio: 'Hello', role: 'admin' } });

    assert.equal(patch.status, 200);
    assert.equal(patch.body.bio, 'Hello');
    assert.equal(patch.body.role, undefined);

    const password = await api('PATCH', '/users/me', { token: users.bob.token, body: { password: 'nouveau123' } });

    assert.equal(password.status, 403);

    const search = await api('GET', '/users?search=chlo', { token: users.alice.token });

    assert.equal(search.body.pagination.total, 1);
    assert.equal(search.body.data[0].email, undefined);
  });
});

const groups = {};

describe('groupes', () => {
  test('création : le créateur est administrateur et un fil de discussion est créé', async () => {
    const { status, body } = await api('POST', '/groups', {
      token: users.alice.token,
      body: { name: 'Club rando', type: 'public', allow_member_posts: false }
    });

    assert.equal(status, 201);
    assert.equal(body.my_role, 'admin');
    assert.equal(body.allow_member_events, false);
    groups.public = body._id;

    const secret = await api('POST', '/groups', { token: users.alice.token, body: { name: 'Bureau', type: 'secret' } });
    const priv = await api('POST', '/groups', { token: users.alice.token, body: { name: 'Famille', type: 'private' } });

    groups.secret = secret.body._id;
    groups.private = priv.body._id;

    assert.equal((await api('GET', `/groups/${groups.public}/thread`, { token: users.alice.token })).status, 200);
  });

  test('visibilité : un groupe secret est invisible, un privé cache ses membres', async () => {
    const list = await api('GET', '/groups', { token: users.bob.token });

    assert.equal(list.body.pagination.total, 2);
    assert.equal((await api('GET', `/groups/${groups.secret}`, { token: users.bob.token })).status, 404);

    const priv = await api('GET', `/groups/${groups.private}`, { token: users.bob.token });

    assert.equal(priv.status, 200);
    assert.equal(priv.body.members, undefined);
    assert.equal((await api('GET', `/groups/${groups.private}/members`, { token: users.bob.token })).status, 403);
  });

  test('adhésion : libre pour un groupe public, sur invitation sinon', async () => {
    assert.equal((await api('POST', `/groups/${groups.public}/join`, { token: users.bob.token })).status, 200);
    assert.equal((await api('POST', `/groups/${groups.public}/join`, { token: users.bob.token })).status, 409);
    assert.equal((await api('POST', `/groups/${groups.private}/join`, { token: users.bob.token })).status, 403);

    const add = await api('POST', `/groups/${groups.public}/members`, {
      token: users.alice.token,
      body: { user_ids: [users.chloe.id] }
    });

    assert.equal(add.body.members_count, 3);
    assert.equal((await api('POST', `/groups/${groups.public}/members`, {
      token: users.bob.token,
      body: { user_ids: [users.david.id] }
    })).status, 403);
  });

  test('administrateurs : le dernier ne peut pas partir', async () => {
    assert.equal((await api('DELETE', `/groups/${groups.public}/members/${users.alice.id}`, {
      token: users.alice.token
    })).status, 409);

    assert.equal((await api('PATCH', `/groups/${groups.public}/members/${users.alice.id}`, {
      token: users.alice.token,
      body: { role: 'member' }
    })).status, 409);
  });

  test('fil de discussion : les membres ne publient pas si interdit, mais peuvent répondre', async () => {
    const { body: thread } = await api('GET', `/groups/${groups.public}/thread`, { token: users.bob.token });
    const post = await api('POST', `/threads/${thread._id}/messages`, { token: users.alice.token, body: { content: 'Bienvenue !' } });

    assert.equal(post.status, 201);
    assert.equal((await api('POST', `/threads/${thread._id}/messages`, {
      token: users.bob.token,
      body: { content: 'Salut' }
    })).status, 403);

    const reply = await api('POST', `/threads/${thread._id}/messages`, {
      token: users.bob.token,
      body: { content: 'Merci !', reply_to: post.body._id }
    });

    assert.equal(reply.status, 201);

    // un non-membre peut lire le fil d'un groupe public mais pas écrire
    assert.equal((await api('GET', `/threads/${thread._id}/messages`, { token: users.david.token })).status, 200);
    assert.equal((await api('POST', `/threads/${thread._id}/messages`, {
      token: users.david.token,
      body: { content: 'Coucou', reply_to: post.body._id }
    })).status, 403);

    const removed = await api('DELETE', `/threads/${thread._id}/messages/${post.body._id}`, { token: users.alice.token });

    assert.equal(removed.body.deleted_replies, 1);
  });
});

const events = {};

describe('événements', () => {
  test('dates et billetterie privée refusées', async () => {
    const dates = await api('POST', '/events', {
      token: users.alice.token,
      body: {
        name: 'Soirée', start_date: days(10), end_date: days(9), location: 'Paris'
      }
    });

    assert.equal(dates.status, 400);

    const ticketing = await api('POST', '/events', {
      token: users.alice.token,
      body: {
        name: 'Soirée', start_date: days(10), end_date: days(11), location: 'Paris', visibility: 'private', settings: { ticketing: true }
      }
    });

    assert.equal(ticketing.status, 400);
  });

  test('dans un groupe : création réservée aux admins si interdit aux membres', async () => {
    assert.equal((await api('POST', '/events', {
      token: users.bob.token,
      body: {
        name: 'Rando', start_date: days(5), end_date: days(6), location: 'Fontainebleau', group: groups.public
      }
    })).status, 403);
  });

  test('dans un groupe : tous les membres invités en un clic', async () => {
    const { status, body } = await api('POST', '/events', {
      token: users.alice.token,
      body: {
        name: 'Rando',
        description: 'Sortie du club',
        start_date: days(5),
        end_date: days(6),
        location: 'Fontainebleau',
        cover_photo: 'https://exemple.com/rando.jpg',
        group: groups.public,
        invite_group_members: true,
        settings: { ticketing: true, shopping_list: true, carpooling: true }
      }
    });

    assert.equal(status, 201);
    assert.equal(body.participants_count, 3);
    assert.equal(body.organizers.length, 1);
    events.rando = body._id;
  });

  test('événement privé : invisible pour les non-participants', async () => {
    const { body } = await api('POST', '/events', {
      token: users.alice.token,
      body: {
        name: 'Anniversaire',
        start_date: days(20),
        end_date: days(21),
        location: 'Lyon',
        visibility: 'private',
        organizers: [users.chloe.id],
        participants: [users.bob.id]
      }
    });

    events.private = body._id;
    assert.equal(body.participants_count, 3);
    assert.equal((await api('GET', `/events/${events.private}`, { token: users.david.token })).status, 404);
    assert.equal((await api('POST', `/events/${events.private}/join`, { token: users.david.token })).status, 404);
    assert.equal((await api('GET', '/events', { token: users.david.token })).body.pagination.total, 1);
    assert.equal((await api('GET', '/events?mine=true', { token: users.bob.token })).body.pagination.total, 2);
  });

  test('participants : rejoindre, rôles, dernier organisateur', async () => {
    assert.equal((await api('POST', `/events/${events.rando}/join`, { token: users.david.token })).status, 200);
    assert.equal((await api('DELETE', `/events/${events.rando}/participants/${users.alice.id}`, {
      token: users.alice.token
    })).status, 409);

    const promote = await api('PATCH', `/events/${events.rando}/participants/${users.bob.id}`, {
      token: users.alice.token,
      body: { role: 'organizer' }
    });

    assert.equal(promote.body.organizers.length, 2);
  });

  test('partage sur les réseaux sociaux : événement public d\'un groupe public', async () => {
    const share = await api('GET', `/events/${events.rando}/share`, { token: users.alice.token });

    assert.equal(share.status, 200);
    assert.match(share.body.links.facebook, /facebook\.com\/sharer/);
    assert.equal((await api('GET', `/events/${events.private}/share`, { token: users.alice.token })).status, 403);
  });

  test('fil de discussion d\'événement réservé aux participants', async () => {
    const thread = await api('GET', `/events/${events.private}/thread`, { token: users.bob.token });

    assert.equal(thread.status, 200);
    assert.equal((await api('POST', `/threads/${thread.body._id}/messages`, {
      token: users.bob.token,
      body: { content: 'J\'apporte le gâteau' }
    })).status, 201);
    assert.equal((await api('GET', `/threads/${thread.body._id}/messages`, { token: users.david.token })).status, 404);
  });
});

describe('albums photo', () => {
  test('photos postées et commentées par les participants uniquement', async () => {
    const album = await api('POST', `/events/${events.rando}/albums`, { token: users.chloe.token, body: { name: 'Sommet' } });

    assert.equal(album.status, 201);

    const photo = await api('POST', `/albums/${album.body._id}/photos`, {
      token: users.chloe.token,
      body: { url: 'https://exemple.com/sommet.jpg', caption: 'Vue' }
    });

    assert.equal(photo.status, 201);
    assert.equal((await api('POST', `/albums/${album.body._id}/photos`, {
      token: users.chloe.token,
      body: { url: 'pas-une-url' }
    })).status, 400);

    const outsider = (await api('POST', '/auth/register', {
      body: {
        firstname: 'Eve', lastname: 'Test', email: 'eve@test.fr', password: 'motdepasse1'
      }
    })).body;

    users.eve = { id: outsider.user._id, token: outsider.token };

    assert.equal((await api('POST', `/photos/${photo.body._id}/comments`, {
      token: users.eve.token,
      body: { content: 'Joli' }
    })).status, 403);
    assert.equal((await api('POST', `/photos/${photo.body._id}/comments`, {
      token: users.bob.token,
      body: { content: 'Superbe' }
    })).status, 201);

    const detail = await api('GET', `/photos/${photo.body._id}`, { token: users.alice.token });

    assert.equal(detail.body.comments_count, 1);
  });
});

describe('sondages', () => {
  let poll;

  test('création réservée aux organisateurs', async () => {
    const body = {
      title: 'Organisation',
      questions: [
        { label: 'Quel repas ?', choices: ['Pique-nique', 'Restaurant'] },
        { label: 'Quelle heure ?', choices: ['8h', '9h', '10h'] }
      ]
    };

    assert.equal((await api('POST', `/events/${events.rando}/polls`, { token: users.chloe.token, body })).status, 403);
    assert.equal((await api('POST', `/events/${events.rando}/polls`, {
      token: users.alice.token,
      body: { title: 'X', questions: [{ label: 'Q', choices: ['Seul'] }] }
    })).status, 400);

    const created = await api('POST', `/events/${events.rando}/polls`, { token: users.alice.token, body });

    assert.equal(created.status, 201);
    poll = created.body;
  });

  test('une seule réponse par question, toutes les questions, une seule participation', async () => {
    const [q1, q2] = poll.questions;
    const answers = [
      { question: q1._id, choice: q1.choices[0]._id },
      { question: q2._id, choice: q2.choices[2]._id }
    ];

    assert.equal((await api('POST', `/polls/${poll._id}/answers`, {
      token: users.chloe.token,
      body: { answers: [answers[0]] }
    })).status, 400);
    assert.equal((await api('POST', `/polls/${poll._id}/answers`, {
      token: users.chloe.token,
      body: { answers: [answers[0], { question: q1._id, choice: q1.choices[1]._id }, answers[1]] }
    })).status, 400);
    assert.equal((await api('POST', `/polls/${poll._id}/answers`, {
      token: users.chloe.token,
      body: { answers: [answers[0], { question: q2._id, choice: q1.choices[0]._id }] }
    })).status, 400);
    assert.equal((await api('POST', `/polls/${poll._id}/answers`, { token: users.chloe.token, body: { answers } })).status, 201);
    assert.equal((await api('POST', `/polls/${poll._id}/answers`, { token: users.chloe.token, body: { answers } })).status, 409);
    assert.equal((await api('POST', `/polls/${poll._id}/answers`, { token: users.bob.token, body: { answers } })).status, 201);
    assert.equal((await api('POST', `/polls/${poll._id}/answers`, { token: users.eve.token, body: { answers } })).status, 403);

    const results = await api('GET', `/polls/${poll._id}/results`, { token: users.alice.token });

    assert.equal(results.body.respondents, 2);
    assert.equal(results.body.questions[0].choices[0].votes, 2);
    assert.equal(results.body.questions[1].choices[0].votes, 0);
  });
});

describe('billetterie', () => {
  let standard;

  test('types de billets créés par un organisateur, visibles sans compte', async () => {
    const created = await api('POST', `/events/${events.rando}/ticket-types`, {
      token: users.alice.token,
      body: { name: 'Standard', amount: 12.5, quantity: 2 }
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.remaining, 2);
    standard = created.body._id;

    assert.equal((await api('POST', `/events/${events.rando}/ticket-types`, {
      token: users.alice.token,
      body: { name: 'VIP', amount: 10.999, quantity: 0 }
    })).status, 400);
    assert.equal((await api('POST', `/events/${events.private}/ticket-types`, {
      token: users.alice.token,
      body: { name: 'VIP', amount: 10, quantity: 1 }
    })).status, 409);
    assert.equal((await api('GET', `/events/${events.rando}/ticket-types`)).status, 200);
  });

  test('achat par une personne extérieure : 1 billet par personne, quantité limitée', async () => {
    const buyer = (email) => ({
      firstname: 'Jean',
      lastname: 'Dupont',
      email,
      address: {
        street: '10 rue de la Paix', zip_code: '75002', city: 'Paris', country: 'France'
      }
    });

    const bought = await api('POST', `/ticket-types/${standard}/tickets`, { body: buyer('jean@exemple.fr') });

    assert.equal(bought.status, 201);
    assert.equal(bought.body.amount, 12.5);
    assert.ok(bought.body.purchased_at);

    assert.equal((await api('POST', `/ticket-types/${standard}/tickets`, { body: buyer('JEAN@exemple.fr') })).status, 409);
    assert.equal((await api('POST', `/ticket-types/${standard}/tickets`, {
      body: { ...buyer('x@exemple.fr'), address: { street: 'a' } }
    })).status, 400);
    assert.equal((await api('POST', `/ticket-types/${standard}/tickets`, { body: buyer('paul@exemple.fr') })).status, 201);
    assert.equal((await api('POST', `/ticket-types/${standard}/tickets`, { body: buyer('marie@exemple.fr') })).status, 409);

    const tickets = await api('GET', `/events/${events.rando}/tickets`, { token: users.alice.token });

    assert.equal(tickets.body.pagination.total, 2);
    assert.equal((await api('GET', `/events/${events.rando}/tickets`, { token: users.chloe.token })).status, 403);
    assert.equal((await api('DELETE', `/ticket-types/${standard}`, { token: users.alice.token })).status, 409);
    assert.equal((await api('PATCH', `/events/${events.rando}`, {
      token: users.alice.token,
      body: { settings: { ticketing: false } }
    })).status, 409);
  });
});

describe('shopping list (bonus)', () => {
  test('chaque article est unique par événement', async () => {
    const item = await api('POST', `/events/${events.rando}/shopping-items`, {
      token: users.bob.token,
      body: { name: 'Chips', quantity: 3, arrival_time: days(5) }
    });

    assert.equal(item.status, 201);
    assert.equal(item.body.name_key, undefined);
    assert.equal((await api('POST', `/events/${events.rando}/shopping-items`, {
      token: users.chloe.token,
      body: { name: '  CHIPS ', quantity: 1, arrival_time: days(5) }
    })).status, 409);
    assert.equal((await api('POST', `/events/${events.rando}/shopping-items`, {
      token: users.chloe.token,
      body: { name: 'Eau', quantity: 6, arrival_time: days(30) }
    })).status, 400);
    assert.equal((await api('PATCH', `/shopping-items/${item.body._id}`, {
      token: users.chloe.token,
      body: { quantity: 10 }
    })).status, 403);
  });

  test('désactivée par défaut', async () => {
    assert.equal((await api('GET', `/events/${events.private}/shopping-items`, { token: users.bob.token })).status, 409);
  });
});

describe('covoiturage (bonus)', () => {
  test('proposer un trajet et réserver les places disponibles', async () => {
    const carpool = await api('POST', `/events/${events.rando}/carpools`, {
      token: users.chloe.token,
      body: {
        departure_place: 'Gare de Lyon', departure_time: days(4.9), price: 5, seats: 1, max_detour_minutes: 30
      }
    });

    assert.equal(carpool.status, 201);
    assert.equal(carpool.body.seats_left, 1);

    const id = carpool.body._id;

    assert.equal((await api('POST', `/carpools/${id}/passengers`, { token: users.chloe.token })).status, 409);
    assert.equal((await api('POST', `/carpools/${id}/passengers`, { token: users.bob.token })).status, 200);
    assert.equal((await api('POST', `/carpools/${id}/passengers`, { token: users.david.token })).status, 409);
    assert.equal((await api('PATCH', `/carpools/${id}`, { token: users.chloe.token, body: { seats: 0 } })).status, 400);

    const left = await api('DELETE', `/carpools/${id}/passengers/${users.bob.id}`, { token: users.bob.token });

    assert.equal(left.body.seats_left, 1);
  });
});

describe('suppressions en cascade', () => {
  test('supprimer un événement supprime tout ce qui en dépend', async () => {
    assert.equal((await api('DELETE', `/events/${events.rando}`, { token: users.chloe.token })).status, 403);
    assert.equal((await api('DELETE', `/events/${events.rando}`, { token: users.alice.token })).status, 200);
    assert.equal((await api('GET', `/events/${events.rando}`, { token: users.alice.token })).status, 404);

    const { models } = server;

    assert.equal(await models.Photo.countDocuments(), 0);
    assert.equal(await models.Ticket.countDocuments(), 0);
    assert.equal(await models.PollAnswer.countDocuments(), 0);
    assert.equal(await models.Thread.countDocuments({ event: events.rando }), 0);
  });

  test('un seul administrateur ne peut pas supprimer son compte', async () => {
    assert.equal((await api('DELETE', '/users/me', { token: users.alice.token })).status, 409);
    assert.equal((await api('DELETE', '/users/me', { token: users.eve.token })).status, 200);
    assert.equal((await api('GET', '/auth/me', { token: users.eve.token })).status, 401);
  });

  test('route inconnue et JSON mal formé', async () => {
    assert.equal((await api('GET', '/nope')).status, 404);

    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":'
    });

    assert.equal(response.status, 400);
  });
});
