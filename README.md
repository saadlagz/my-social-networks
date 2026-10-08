# My Social Networks

TP du module API : une API REST pour le nouveau service d'événements et de groupes de Facebook, en Node.js / Express / MongoDB.

Tout le cahier des charges est couvert (utilisateurs, événements, groupes, fils de discussion, albums photo, sondages, billetterie), ainsi que les deux bonus (shopping list et covoiturage).

## Lancer le projet

Il faut Node.js 22+ et un MongoDB local sur le port 27017.

```bash
npm install
npm run dev
```

L'API tourne sur http://localhost:3000. Les variables d'environnement possibles sont dans `.env.example` (port, lien MongoDB, secret JWT). En développement, des valeurs par défaut sont prévues dans `src/config.mjs`, donc rien n'est obligatoire.

Pour les tests :

```bash
npm test
```

Les tests utilisent une base séparée (`my-social-networks-test`) qui est vidée à chaque lancement.

## Documentation

- Swagger : http://localhost:3000/docs (on peut tester les routes directement, bouton "Authorize" pour mettre le token)
- Fichier OpenAPI : `docs/openapi.yaml`
- Collection Postman : `docs/my-social-networks.postman_collection.json`

Pour s'authentifier, on crée un compte avec `POST /auth/register` ou on se connecte avec `POST /auth/login`. Les deux renvoient un token JWT à mettre dans le header `Authorization: Bearer <token>`.

Les erreurs ont toujours le même format :

```json
{ "code": 400, "message": "Bad Request", "errors": ["end_date doit être après start_date"] }
```

Les listes sont paginées avec `?page=` et `?limit=` (20 par défaut, 100 max).

## Organisation du code

```
src/
  server.mjs        Express, connexion MongoDB, routes
  config.mjs        config par environnement
  controllers/      une classe par ressource (comme en cours)
  models/           schémas Mongoose
  validators/       règles de validation des body
  middlewares/      authentification JWT et gestion des erreurs
  utils/            validation, droits d'accès, pagination
docs/               OpenAPI et Postman
test/               tests
```

## Collections

| Collection | Contenu |
| --- | --- |
| users | prénom, nom, email (unique), mot de passe hashé, avatar, bio |
| groups | paramètres du groupe, administrateurs, membres |
| events | infos de l'événement, organisateurs, participants, groupe éventuel, options activées |
| threads | fil de discussion lié à un groupe ou à un événement (pas les deux) |
| messages | messages d'un fil, avec `reply_to` pour les réponses |
| albums, photos, photo_comments | albums d'un événement, leurs photos et commentaires |
| polls, poll_answers | sondages (questions et choix) et réponses des participants |
| ticket_types, tickets | types de billets et billets achetés |
| shopping_items | bonus shopping list |
| carpools | bonus covoiturage |

J'ai mis les messages, photos, réponses et billets dans des collections à part plutôt que dans le document de l'événement ou du groupe, parce qu'ils peuvent être très nombreux (et un document MongoDB est limité à 16 Mo). Les questions d'un sondage, elles, restent dans le sondage puisqu'elles sont peu nombreuses et toujours lues ensemble.

## Routes principales

| Ressource | Routes |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Utilisateurs | `GET /users`, `GET /users/:id`, `PATCH /users/me`, `DELETE /users/me` |
| Groupes | `/groups`, `/groups/:id`, `/groups/:id/members`, `/groups/:id/join`, `/groups/:id/events`, `/groups/:id/thread` |
| Événements | `/events`, `/events/:id`, `/events/:id/participants`, `/events/:id/join`, `/events/:id/invite-group`, `/events/:id/share`, `/events/:id/thread` |
| Discussions | `/threads/:id`, `/threads/:id/messages` |
| Albums | `/events/:id/albums`, `/albums/:id`, `/albums/:id/photos`, `/photos/:id`, `/photos/:id/comments` |
| Sondages | `/events/:id/polls`, `/polls/:id`, `/polls/:id/answers`, `/polls/:id/results` |
| Billetterie | `/events/:id/ticket-types`, `/ticket-types/:id`, `/ticket-types/:id/tickets`, `/events/:id/tickets`, `/tickets/:id` |
| Shopping list | `/events/:id/shopping-items`, `/shopping-items/:id` |
| Covoiturage | `/events/:id/carpools`, `/carpools/:id`, `/carpools/:id/passengers` |

Le détail de chaque route (body attendu, réponses, droits) est dans le Swagger.

## Choix que j'ai faits

Le sujet laisse pas mal de points ouverts, voici comment je les ai traités :

- **Authentification** : il faut savoir qui est organisateur ou administrateur, donc j'ai ajouté une connexion avec JWT. Les mots de passe sont hashés avec bcrypt.
- **Rôles** : un organisateur est aussi participant, un administrateur est aussi membre. Un événement garde toujours au moins un organisateur et un groupe au moins un administrateur.
- **Visibilité** : un groupe secret ou un événement privé renvoie une 404 aux personnes qui n'en font pas partie, pour ne pas révéler qu'il existe. Un groupe privé est visible mais son contenu est réservé aux membres. Un événement créé dans un groupe privé ou secret n'est visible que par les membres du groupe.
- **Groupes** : dans un groupe, on peut inviter tous les membres d'un coup (`invite_group_members` à la création, ou `POST /events/:id/invite-group`). Si le groupe n'autorise pas les membres à publier, ils peuvent quand même répondre aux messages, puisque le sujet précise que chaque membre peut répondre.
- **Partage** : `GET /events/:id/share` renvoie des liens de partage (Facebook, X, LinkedIn, WhatsApp, mail) pour les événements publics.
- **Billetterie** : l'achat se fait sans compte puisque le sujet parle de "personne extérieure". La personne est identifiée par son email, avec un index unique pour qu'elle n'ait qu'un billet par événement. Le compteur de billets vendus est incrémenté avec une condition `sold < quantity` dans la même requête, pour ne pas dépasser la quantité si deux achats arrivent en même temps.
- **Sondages** : la réponse doit contenir un choix pour chaque question, et le choix doit appartenir à la question. Une personne ne peut répondre qu'une fois.
- **Shopping list** : "Chips", "chips" et "CHIPS " sont considérés comme le même article.
- **Covoiturage** : en plus de proposer un trajet, les participants peuvent réserver une place.
- **Options** : billetterie, shopping list et covoiturage sont désactivés par défaut et s'activent dans `settings` de l'événement.
- **Suppression** : supprimer un événement supprime aussi tout ce qui lui est lié (messages, photos, sondages, billets...).
- **Photos** : on stocke l'URL de la photo, pas le fichier.

## Validation et sécurité

Les body sont vérifiés avec la librairie `validator` avant d'arriver en base (`src/validators/`) : types, longueurs, emails, URL, dates, montants... Toutes les erreurs sont renvoyées d'un coup. Les champs non prévus sont ignorés, donc on ne peut pas par exemple s'ajouter un rôle en l'envoyant dans le body.

Les schémas Mongoose ont aussi leurs propres contraintes (champs requis, enum, index uniques), en deuxième sécurité.

À côté de ça : l'email des utilisateurs n'est jamais renvoyé aux autres, la connexion est limitée à 20 essais par quart d'heure, et le secret JWT est lu dans les variables d'environnement en production.

---

Saad Lagzouli - EFREI
